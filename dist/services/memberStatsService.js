import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
const STATS_DIR = join(process.cwd(), 'data', 'stats');
class MemberStatsService {
    // guildId -> userId -> UserActivityStats
    cache = new Map();
    dirtyGuilds = new Set();
    saveTimer = null;
    constructor() {
        // Auto-save dirty stats every 45 seconds
        this.saveTimer = setInterval(() => {
            this.flush().catch((err) => logger.error('Failed to flush member stats:', err));
        }, 45_000);
        this.saveTimer.unref();
    }
    getFilePath(guildId) {
        return join(STATS_DIR, `guild_${guildId}.json`);
    }
    /**
     * Load guild stats into memory from Supabase or local storage
     */
    async ensureGuildLoaded(guildId) {
        if (this.cache.has(guildId)) {
            return this.cache.get(guildId);
        }
        const statsMap = new Map();
        // 1. Try Supabase custom_embeds key
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_member_stats');
            if (embed?.description) {
                const data = JSON.parse(embed.description);
                for (const [userId, s] of Object.entries(data)) {
                    statsMap.set(userId, {
                        messages: Number(s.messages || 0),
                        voiceMinutes: Number(s.voiceMinutes || 0),
                        lastActive: Number(s.lastActive || 0),
                    });
                }
                this.cache.set(guildId, statsMap);
                return statsMap;
            }
        }
        catch (error) {
            logger.warn(`Failed to fetch stats from Supabase for guild ${guildId}:`, error);
        }
        // 2. Try Local File fallback
        try {
            const filePath = this.getFilePath(guildId);
            const raw = await readFile(filePath, 'utf8');
            const data = JSON.parse(raw);
            for (const [userId, s] of Object.entries(data)) {
                statsMap.set(userId, {
                    messages: Number(s.messages || 0),
                    voiceMinutes: Number(s.voiceMinutes || 0),
                    lastActive: Number(s.lastActive || 0),
                });
            }
        }
        catch (error) {
            if (error?.code !== 'ENOENT') {
                logger.warn(`Failed to read local stats for guild ${guildId}:`, error);
            }
        }
        this.cache.set(guildId, statsMap);
        return statsMap;
    }
    /**
     * Record a user message
     */
    async recordMessage(guildId, userId) {
        if (!guildId || !userId)
            return;
        const guildMap = await this.ensureGuildLoaded(guildId);
        const existing = guildMap.get(userId) || { messages: 0, voiceMinutes: 0, lastActive: 0 };
        existing.messages += 1;
        existing.lastActive = Date.now();
        guildMap.set(userId, existing);
        this.dirtyGuilds.add(guildId);
    }
    /**
     * Record voice channel minutes
     */
    async recordVoiceMinute(guildId, userId, minutes = 1) {
        if (!guildId || !userId)
            return;
        const guildMap = await this.ensureGuildLoaded(guildId);
        const existing = guildMap.get(userId) || { messages: 0, voiceMinutes: 0, lastActive: 0 };
        existing.voiceMinutes += minutes;
        existing.lastActive = Date.now();
        guildMap.set(userId, existing);
        this.dirtyGuilds.add(guildId);
    }
    /**
     * Get user stats
     */
    async getUserStats(guildId, userId) {
        const guildMap = await this.ensureGuildLoaded(guildId);
        return guildMap.get(userId) || { messages: 0, voiceMinutes: 0, lastActive: 0 };
    }
    /**
     * Get top message senders in a guild
     */
    async getTopMessages(guildId, limit = 10) {
        const guildMap = await this.ensureGuildLoaded(guildId);
        const entries = Array.from(guildMap.entries())
            .filter(([, s]) => s.messages > 0)
            .sort((a, b) => b[1].messages - a[1].messages)
            .slice(0, limit)
            .map(([userId, s]) => ({ userId, count: s.messages }));
        return entries;
    }
    /**
     * Get top voice participants in a guild
     */
    async getTopVoice(guildId, limit = 10) {
        const guildMap = await this.ensureGuildLoaded(guildId);
        const entries = Array.from(guildMap.entries())
            .filter(([, s]) => s.voiceMinutes > 0)
            .sort((a, b) => b[1].voiceMinutes - a[1].voiceMinutes)
            .slice(0, limit)
            .map(([userId, s]) => ({ userId, minutes: s.voiceMinutes }));
        return entries;
    }
    /**
     * Persist dirty guild stats to Supabase and local file
     */
    async flush() {
        if (this.dirtyGuilds.size === 0)
            return;
        const toSave = Array.from(this.dirtyGuilds);
        this.dirtyGuilds.clear();
        for (const guildId of toSave) {
            const guildMap = this.cache.get(guildId);
            if (!guildMap)
                continue;
            const plainObj = {};
            for (const [userId, s] of guildMap.entries()) {
                plainObj[userId] = s;
            }
            const jsonStr = JSON.stringify(plainObj);
            // 1. Save to Supabase custom_embeds
            try {
                await supabase.saveCustomEmbed(guildId, '_member_stats', {
                    description: jsonStr,
                });
            }
            catch (err) {
                logger.warn(`Failed to save member stats to Supabase for ${guildId}:`, err);
            }
            // 2. Save to local disk fallback
            try {
                const filePath = this.getFilePath(guildId);
                await mkdir(dirname(filePath), { recursive: true });
                await writeFile(filePath, jsonStr, 'utf8');
            }
            catch (err) {
                logger.warn(`Failed to save local member stats file for ${guildId}:`, err);
            }
        }
    }
}
export const memberStatsService = new MemberStatsService();
