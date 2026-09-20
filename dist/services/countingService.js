import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
export const DEFAULT_COUNTING_CONFIG = {
    enabled: false,
    channelId: null,
    currentNumber: 0,
    lastUserId: null,
    highestScore: 0,
    resetMessage: '❌ {user} ruined the count at **{count}**! Next number is **1**.',
    correctEmoji: '✅',
    wrongEmoji: '❌',
};
/**
 * Safe numeric parser supporting plain integers, first numeric tokens,
 * and elementary arithmetic expressions (+, -, *, /, %, parenthesis).
 */
export function parseCountNumber(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return null;
    // 1. Direct integer
    if (/^-?\d+$/.test(trimmed)) {
        const val = parseInt(trimmed, 10);
        return Number.isSafeInteger(val) ? val : null;
    }
    // 2. Safe basic arithmetic expression without any alpha characters or code execution
    if (/^[\d\s+\/*%().-]+$/.test(trimmed) && /[+\/*%-]/.test(trimmed)) {
        const sanitized = trimmed.replace(/\s+/g, '');
        // Must start with digit, minus, plus, or parenthesis, and end with digit or parenthesis
        if (/^[\d(+-]/.test(sanitized) && /[\d)]$/.test(sanitized)) {
            // Prevent consecutive operators like ** or // or ++
            if (!/[+\/*%-]{2,}/.test(sanitized)) {
                try {
                    const evaluated = Function(`"use strict"; return (${sanitized});`)();
                    if (typeof evaluated === 'number' && Number.isFinite(evaluated) && Number.isSafeInteger(evaluated)) {
                        return evaluated;
                    }
                }
                catch {
                    // Ignore syntax errors in arithmetic
                }
            }
        }
    }
    // 3. First token if someone typed "5 gg" or "10 - nice"
    const firstWord = trimmed.split(/\s+/)[0];
    if (/^-?\d+$/.test(firstWord)) {
        const val = parseInt(firstWord, 10);
        return Number.isSafeInteger(val) ? val : null;
    }
    return null;
}
export class CountingService {
    cache = new Map();
    queues = new Map();
    /**
     * Get counting configuration for a guild with in-memory caching.
     */
    async get(guildId) {
        const cached = this.cache.get(guildId);
        if (cached)
            return { ...cached };
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_counting_settings');
            let raw = {};
            if (embed?.description) {
                raw = JSON.parse(embed.description);
            }
            const config = {
                ...DEFAULT_COUNTING_CONFIG,
                ...raw,
            };
            this.cache.set(guildId, config);
            return { ...config };
        }
        catch (error) {
            logger.error(`[CountingService] Failed to load config for guild ${guildId}:`, error);
            return { ...DEFAULT_COUNTING_CONFIG };
        }
    }
    /**
     * Update counting configuration for a guild.
     */
    async set(guildId, updates) {
        const current = await this.get(guildId);
        const updated = { ...current, ...updates };
        this.cache.set(guildId, updated);
        try {
            await supabase.saveCustomEmbed(guildId, '_counting_settings', {
                description: JSON.stringify(updated),
            });
        }
        catch (error) {
            logger.error(`[CountingService] Failed to save config for guild ${guildId}:`, error);
        }
        return { ...updated };
    }
    /**
     * Process an incoming message in the counting channel.
     * Guaranteed sequential execution per guild to prevent race conditions.
     */
    async handleMessage(message) {
        if (!message.inGuild() || message.author.bot)
            return false;
        const guildId = message.guildId;
        const config = await this.get(guildId);
        // Check if counting is enabled and message is in the designated channel
        if (!config.enabled || !config.channelId || message.channelId !== config.channelId) {
            return false;
        }
        // Parse number from message
        const parsedNumber = parseCountNumber(message.content);
        if (parsedNumber === null) {
            // Not a number attempt: let non-number message pass without breaking count
            return false;
        }
        // Queue processing per guild to prevent race conditions
        const prev = this.queues.get(guildId) || Promise.resolve();
        const next = prev.then(async () => {
            await this.processCount(message, parsedNumber);
        }).catch((err) => {
            logger.error(`[CountingService] Error processing count in guild ${guildId}:`, err);
        });
        this.queues.set(guildId, next);
        await next;
        return true;
    }
    async processCount(message, number) {
        const guildId = message.guildId;
        const config = await this.get(guildId);
        if (!config.enabled || !config.channelId || message.channelId !== config.channelId) {
            return;
        }
        const expected = config.currentNumber + 1;
        const correctEmoji = config.correctEmoji || '✅';
        const wrongEmoji = config.wrongEmoji || '❌';
        // 1. Same user counted twice in a row
        if (message.author.id === config.lastUserId) {
            await this.react(message, wrongEmoji, '❌');
            const resetText = config.resetMessage
                .replace(/{user}/gi, `<@${message.author.id}>`)
                .replace(/{username}/gi, message.author.username)
                .replace(/{count}/gi, String(config.currentNumber))
                .replace(/{wrong}/gi, String(number))
                .replace(/{next}/gi, '1')
                .replace(/{highscore}/gi, String(config.highestScore));
            const notice = `⚠️ **Count Ruined!** You cannot count twice in a row!\n${resetText}`;
            if ('send' in message.channel) {
                await message.channel.send({ content: notice }).catch(() => { });
            }
            await this.set(guildId, {
                currentNumber: 0,
                lastUserId: null,
            });
            return;
        }
        // 2. Incorrect number sent
        if (number !== expected) {
            await this.react(message, wrongEmoji, '❌');
            const resetText = config.resetMessage
                .replace(/{user}/gi, `<@${message.author.id}>`)
                .replace(/{username}/gi, message.author.username)
                .replace(/{count}/gi, String(config.currentNumber))
                .replace(/{wrong}/gi, String(number))
                .replace(/{next}/gi, '1')
                .replace(/{highscore}/gi, String(config.highestScore));
            if ('send' in message.channel) {
                await message.channel.send({ content: resetText }).catch(() => { });
            }
            await this.set(guildId, {
                currentNumber: 0,
                lastUserId: null,
            });
            return;
        }
        // 3. Correct number sent!
        await this.react(message, correctEmoji, '✅');
        const newCount = expected;
        const isNewHighScore = newCount > config.highestScore;
        const newHighScore = isNewHighScore ? newCount : config.highestScore;
        // Celebrate milestones (e.g. 50, 100, 250, 500, 1000...)
        if (newCount > 0 && newCount % 100 === 0) {
            await message.react('🎉').catch(() => { });
        }
        else if (isNewHighScore && newCount >= 20 && newCount % 20 === 0) {
            await message.react('🏆').catch(() => { });
        }
        await this.set(guildId, {
            currentNumber: newCount,
            lastUserId: message.author.id,
            highestScore: newHighScore,
        });
    }
    async react(message, emoji, fallback) {
        try {
            await message.react(emoji);
        }
        catch {
            if (emoji !== fallback) {
                await message.react(fallback).catch(() => { });
            }
        }
    }
}
export const countingService = new CountingService();
