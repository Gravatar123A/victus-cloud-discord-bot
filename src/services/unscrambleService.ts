import {
    Client,
    Guild,
    GuildTextBasedChannel,
    Message,
    EmbedBuilder,
    PermissionFlagsBits,
} from 'discord.js';
import { supabase } from './supabase.js';
import { CoinTransactionLock } from './coinTransactionLock.js';
import { logger } from '../utils/logger.js';

export interface UnscrambleConfig {
    channelId: string | null;
    autoLock: boolean;
    hintIntervalSeconds: number;
    rewardCoins: number;           // Coins granted to winner (0 = disabled)
    pingRoleId: string | null;     // Role to ping when game starts (default 1551226428371243209)
    autoEnabled: boolean;          // Automated recurring games
    autoIntervalMs: number;        // Time after game end before next game starts (e.g. 10m, 1h)
    nextAutoGameAt: number | null; // Timestamp when next game is scheduled
}

export interface UnscramblePlayerStats {
    userId: string;
    wins: number;
    totalGuesses: number;
    lastWinAt: number;
}

export const DEFAULT_UNSCRAMBLE_CONFIG: UnscrambleConfig = {
    channelId: null,
    autoLock: true,
    hintIntervalSeconds: 45,
    rewardCoins: 0,
    pingRoleId: '1551226428371243209',
    autoEnabled: false,
    autoIntervalMs: 60 * 60 * 1000, // 1 hour default
    nextAutoGameAt: null,
};

export interface ActiveUnscrambleGame {
    guildId: string;
    channelId: string;
    originalWord: string;
    scrambledWord: string;
    category: string;
    hostId: string;
    startedAt: number;
    guessCount: number;
    hintsGiven: number;
    givenHints: string[];
    hintTimer: NodeJS.Timeout | null;
    participants: Set<string>;
    wasLockedBefore: boolean;
}

export interface WordEntry {
    word: string;
    category: string;
    clue?: string;
}

export const WORD_BANK: WordEntry[] = [
    // Technology & Systems
    { word: 'SERVER', category: 'Technology', clue: 'A powerful computer that serves clients and websites' },
    { word: 'DATABASE', category: 'Technology', clue: 'Organized collection of structured information or data' },
    { word: 'NETWORK', category: 'Technology', clue: 'Interconnected computers communicating together' },
    { word: 'FIREWALL', category: 'Technology', clue: 'Network security system monitoring incoming traffic' },
    { word: 'CONTAINER', category: 'Technology', clue: 'Standardized unit of software bundling code and dependencies' },
    { word: 'BANDWIDTH', category: 'Technology', clue: 'Maximum data transfer rate of a network connection' },
    { word: 'PROCESSOR', category: 'Technology', clue: 'The central logic brain of a computing system' },
    { word: 'ETHERNET', category: 'Technology', clue: 'High-speed wired computer networking technology' },
    { word: 'ALGORITHM', category: 'Technology', clue: 'A step-by-step procedure for solving a problem' },
    { word: 'ENCRYPTION', category: 'Technology', clue: 'Encoding information so only authorized parties can read it' },
    { word: 'PROTOCOL', category: 'Technology', clue: 'Set of rules governing the exchange of data' },
    { word: 'TERMINAL', category: 'Technology', clue: 'Command line text interface for operating systems' },
    { word: 'KUBERNETES', category: 'Technology', clue: 'Open-source system for automating deployment of containers' },
    { word: 'DOCKER', category: 'Technology', clue: 'Platform for developing, shipping, and running apps in containers' },
    { word: 'GATEWAY', category: 'Technology', clue: 'A network node connecting two different networks' },
    { word: 'HYPERVISOR', category: 'Technology', clue: 'Software that creates and runs virtual machines' },
    { word: 'VIRTUAL', category: 'Technology', clue: 'Existing in essence or effect though not in actual physical form' },

    // Cloud & Victus Hosting
    { word: 'VICTUS', category: 'Cloud Hosting', clue: 'Premium cloud hosting infrastructure' },
    { word: 'HOSTING', category: 'Cloud Hosting', clue: 'Service that provisions server resources for apps' },
    { word: 'DATACENTER', category: 'Cloud Hosting', clue: 'Facility dedicated to housing computer systems and servers' },
    { word: 'LATENCY', category: 'Cloud Hosting', clue: 'Time delay between input and server response (ping)' },
    { word: 'UPTIME', category: 'Cloud Hosting', clue: 'Percentage of time a server is fully operational' },
    { word: 'PROVISION', category: 'Cloud Hosting', clue: 'The act of setting up server and cloud resources' },
    { word: 'DEPLOYMENT', category: 'Cloud Hosting', clue: 'Process of transforming software to live production' },
    { word: 'INFRASTRUCTURE', category: 'Cloud Hosting', clue: 'Fundamental facilities and systems serving a cloud platform' },
    { word: 'BACKUP', category: 'Cloud Hosting', clue: 'Copy of data made to prevent total data loss' },
    { word: 'SNAPSHOT', category: 'Cloud Hosting', clue: 'Point-in-time image copy of a virtual storage disk' },
    { word: 'MONITORING', category: 'Cloud Hosting', clue: 'Observing server metrics, CPU, and RAM in real time' },
    { word: 'BALANCE', category: 'Cloud Hosting', clue: 'Distributing traffic evenly across multiple nodes' },

    // Gaming & Minecraft
    { word: 'DIAMOND', category: 'Gaming & Minecraft', clue: 'Precious blue gemstone mined deep underground' },
    { word: 'CREEPER', category: 'Gaming & Minecraft', clue: 'Iconic green mob that hisses and explodes' },
    { word: 'OBSIDIAN', category: 'Gaming & Minecraft', clue: 'Tough dark volcanic rock used to build nether portals' },
    { word: 'REDSTONE', category: 'Gaming & Minecraft', clue: 'Mineral used for creating automated circuits and wiring' },
    { word: 'NETHERITE', category: 'Gaming & Minecraft', clue: 'Extremely durable endgame alloy found in the Nether' },
    { word: 'DRAGON', category: 'Gaming & Minecraft', clue: 'Final boss dwelling in the End realm' },
    { word: 'RESPAWN', category: 'Gaming & Minecraft', clue: 'Reappearing in the world after meeting your demise' },
    { word: 'CROSSBOW', category: 'Gaming & Minecraft', clue: 'Ranged weapon shooting high-velocity arrows and rockets' },
    { word: 'ENCHANTMENT', category: 'Gaming & Minecraft', clue: 'Magical enhancements bestowed upon armor and tools' },
    { word: 'EMERALD', category: 'Gaming & Minecraft', clue: 'Green currency traded with village merchants' },
    { word: 'BEDROCK', category: 'Gaming & Minecraft', clue: 'Unbreakable foundational block at the bottom of the world' },
    { word: 'VILLAGER', category: 'Gaming & Minecraft', clue: 'Peaceful humanoid NPC living in settlements' },
    { word: 'FORTRESS', category: 'Gaming & Minecraft', clue: 'Towering brick structure located in the fiery Nether' },
    { word: 'PORTAL', category: 'Gaming & Minecraft', clue: 'Magical gateway transporting players to other dimensions' },
    { word: 'ELYTRA', category: 'Gaming & Minecraft', clue: 'Rare wings allowing players to glide across skies' },
    { word: 'SHULKER', category: 'Gaming & Minecraft', clue: 'Box-like hostile mob that shoots levitation bullets' },
    { word: 'ANVIL', category: 'Gaming & Minecraft', clue: 'Heavy metal block used to repair and rename equipment' },
    { word: 'WITHER', category: 'Gaming & Minecraft', clue: 'Three-headed undead summonable floating boss mob' },

    // Community & Discord
    { word: 'DISCORD', category: 'Community', clue: 'Voice, video, and text communication platform for communities' },
    { word: 'MODERATOR', category: 'Community', clue: 'Staff member keeping chat clean, respectful, and safe' },
    { word: 'COMMUNITY', category: 'Community', clue: 'Unified group of people sharing common gaming interests' },
    { word: 'LEADERBOARD', category: 'Community', clue: 'Ranked board displaying top achieving players' },
    { word: 'REACTION', category: 'Community', clue: 'Emoji feedback attached directly to a message' },
    { word: 'CHAMPION', category: 'Community', clue: 'Victorious title held by tournament and event winners' },
    { word: 'CHALLENGE', category: 'Community', clue: 'A competitive test of skill and speed' },
    { word: 'GIVEAWAY', category: 'Community', clue: 'Free distribution of prizes and rewards to participants' },
    { word: 'TOURNAMENT', category: 'Community', clue: 'Series of contests played among multiple competing teams' },

    // Science & Universe
    { word: 'ASTRONOMY', category: 'Science & Universe', clue: 'The scientific study of celestial bodies and space' },
    { word: 'GALAXY', category: 'Science & Universe', clue: 'Gravitationally bound system of stars, gas, and dark matter' },
    { word: 'NEBULA', category: 'Science & Universe', clue: 'Enormous interstellar cloud of cosmic dust and hydrogen gas' },
    { word: 'ECLIPSE', category: 'Science & Universe', clue: 'Astronomical event where one body obscures another' },
    { word: 'SUPERNOVA', category: 'Science & Universe', clue: 'Colossal stellar explosion at the end of a star’s life' },
    { word: 'QUANTUM', category: 'Science & Universe', clue: 'Discrete packet of energy or matter at the atomic scale' },
    { word: 'GRAVITY', category: 'Science & Universe', clue: 'Fundamental force that draws massive objects together' },
    { word: 'TELESCOPE', category: 'Science & Universe', clue: 'Optical instrument used to gaze into the deep cosmos' },
    { word: 'ASTEROID', category: 'Science & Universe', clue: 'Rocky planetary remnant orbiting the sun' },
    { word: 'SATELLITE', category: 'Science & Universe', clue: 'Artificial or natural body placed in orbit around a celestial body' },
];

export function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

    return parts.join(' ');
}

export function parseTimeDuration(str: string): number | null {
    const trimmed = str.trim().toLowerCase();
    if (trimmed === '0' || trimmed === 'off' || trimmed === 'disable' || trimmed === 'disabled' || trimmed === 'none') {
        return 0;
    }

    const regex = /(\d+)\s*(d|h|m|s)/g;
    let totalMs = 0;
    let match: RegExpExecArray | null;
    let matchedAny = false;

    while ((match = regex.exec(trimmed)) !== null) {
        matchedAny = true;
        const val = parseInt(match[1], 10);
        const unit = match[2];
        if (unit === 'd') totalMs += val * 24 * 60 * 60 * 1000;
        else if (unit === 'h') totalMs += val * 60 * 60 * 1000;
        else if (unit === 'm') totalMs += val * 60 * 1000;
        else if (unit === 's') totalMs += val * 1000;
    }

    if (!matchedAny) {
        if (/^\d+$/.test(trimmed)) {
            const val = parseInt(trimmed, 10);
            return val * 60 * 1000;
        }
        return null;
    }

    return totalMs;
}

export function scrambleWord(word: string): string {
    const upper = word.toUpperCase();
    const letters = upper.split('');
    if (letters.length <= 1) return upper;

    let scrambled = '';
    let attempts = 0;
    do {
        for (let i = letters.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [letters[i], letters[j]] = [letters[j], letters[i]];
        }
        scrambled = letters.join('');
        attempts++;
    } while (scrambled === upper && attempts < 25);

    return scrambled;
}

export class UnscrambleService {
    private cache = new Map<string, UnscrambleConfig>();
    private activeGames = new Map<string, ActiveUnscrambleGame>();
    private autoTimers = new Map<string, NodeJS.Timeout>();
    private leaderboardCache = new Map<string, Map<string, UnscramblePlayerStats>>();

    /**
     * Get Unscramble configuration for a guild.
     */
    async get(guildId: string): Promise<UnscrambleConfig> {
        const cached = this.cache.get(guildId);
        if (cached) return { ...cached };

        try {
            const embed = await supabase.getCustomEmbed(guildId, '_unscramble_settings');
            let raw: Partial<UnscrambleConfig> = {};
            if (embed?.description) {
                raw = JSON.parse(embed.description);
            }
            const config: UnscrambleConfig = {
                ...DEFAULT_UNSCRAMBLE_CONFIG,
                ...raw,
            };
            this.cache.set(guildId, config);
            return { ...config };
        } catch (error) {
            logger.error(`[UnscrambleService] Failed to load config for guild ${guildId}:`, error);
            return { ...DEFAULT_UNSCRAMBLE_CONFIG };
        }
    }

    /**
     * Save Unscramble configuration for a guild.
     */
    async set(guildId: string, updates: Partial<UnscrambleConfig>): Promise<UnscrambleConfig> {
        const current = await this.get(guildId);
        const updated: UnscrambleConfig = { ...current, ...updates };
        this.cache.set(guildId, updated);

        try {
            await supabase.saveCustomEmbed(guildId, '_unscramble_settings', {
                description: JSON.stringify(updated),
            });
        } catch (error) {
            logger.error(`[UnscrambleService] Failed to save config for guild ${guildId}:`, error);
        }

        return { ...updated };
    }

    /**
     * Ensure Unscramble leaderboard stats are loaded for a guild.
     */
    async ensureLeaderboardLoaded(guildId: string): Promise<Map<string, UnscramblePlayerStats>> {
        if (this.leaderboardCache.has(guildId)) {
            return this.leaderboardCache.get(guildId)!;
        }

        const map = new Map<string, UnscramblePlayerStats>();
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_unscramble_leaderboard');
            if (embed?.description) {
                const parsed: Record<string, UnscramblePlayerStats> = JSON.parse(embed.description);
                for (const [uid, stats] of Object.entries(parsed)) {
                    map.set(uid, {
                        userId: uid,
                        wins: Number(stats.wins || 0),
                        totalGuesses: Number(stats.totalGuesses || 0),
                        lastWinAt: Number(stats.lastWinAt || 0),
                    });
                }
            }
        } catch (error) {
            logger.warn(`[UnscrambleService] Failed to load leaderboard for guild ${guildId}:`, error);
        }

        this.leaderboardCache.set(guildId, map);
        return map;
    }

    /**
     * Save Unscramble leaderboard stats to Supabase for a guild.
     */
    async saveLeaderboard(guildId: string): Promise<void> {
        const map = this.leaderboardCache.get(guildId);
        if (!map) return;

        const plainObj: Record<string, UnscramblePlayerStats> = {};
        for (const [uid, stats] of map.entries()) {
            plainObj[uid] = stats;
        }

        try {
            await supabase.saveCustomEmbed(guildId, '_unscramble_leaderboard', {
                description: JSON.stringify(plainObj),
            });
        } catch (error) {
            logger.warn(`[UnscrambleService] Failed to save leaderboard for guild ${guildId}:`, error);
        }
    }

    /**
     * Record a user's guess attempt.
     */
    async recordGuess(guildId: string, userId: string): Promise<void> {
        if (!guildId || !userId) return;
        const map = await this.ensureLeaderboardLoaded(guildId);
        const existing = map.get(userId) || { userId, wins: 0, totalGuesses: 0, lastWinAt: 0 };
        existing.totalGuesses += 1;
        map.set(userId, existing);
    }

    /**
     * Record a user win in Unscramble.
     */
    async recordWin(guildId: string, userId: string): Promise<UnscramblePlayerStats> {
        const map = await this.ensureLeaderboardLoaded(guildId);
        const existing = map.get(userId) || { userId, wins: 0, totalGuesses: 0, lastWinAt: 0 };
        existing.wins += 1;
        existing.lastWinAt = Date.now();
        map.set(userId, existing);
        await this.saveLeaderboard(guildId);
        return { ...existing };
    }

    /**
     * Get top Unscramble winners for a guild.
     */
    async getTopWinners(guildId: string, limit = 100): Promise<UnscramblePlayerStats[]> {
        const map = await this.ensureLeaderboardLoaded(guildId);
        return Array.from(map.values())
            .filter((s) => s.wins > 0)
            .sort((a, b) => {
                if (b.wins !== a.wins) return b.wins - a.wins;
                return a.totalGuesses - b.totalGuesses;
            })
            .slice(0, limit);
    }

    /**
     * Get user Unscramble stats and rank.
     */
    async getUserStats(guildId: string, userId: string): Promise<{ stats: UnscramblePlayerStats; rank: number | null }> {
        const top = await this.getTopWinners(guildId, 1000);
        const index = top.findIndex((s) => s.userId === userId);
        const map = await this.ensureLeaderboardLoaded(guildId);
        const stats = map.get(userId) || { userId, wins: 0, totalGuesses: 0, lastWinAt: 0 };
        return {
            stats,
            rank: index >= 0 ? index + 1 : null,
        };
    }

    /**
     * Get active game for a guild if any.
     */
    getActiveGame(guildId: string): ActiveUnscrambleGame | undefined {
        return this.activeGames.get(guildId);
    }

    /**
     * Lock channel by denying SendMessages for @everyone.
     */
    async lockChannel(channel: GuildTextBasedChannel, reason = 'Unscramble channel locked'): Promise<boolean> {
        try {
            if (!('permissionOverwrites' in channel)) return false;
            await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
                SendMessages: false,
            }, { reason });
            return true;
        } catch (err) {
            logger.error(`[UnscrambleService] Failed to lock channel ${channel.id}:`, err);
            return false;
        }
    }

    /**
     * Unlock channel by allowing SendMessages for @everyone.
     */
    async unlockChannel(channel: GuildTextBasedChannel, reason = 'Unscramble channel unlocked'): Promise<boolean> {
        try {
            if (!('permissionOverwrites' in channel)) return false;
            await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
                SendMessages: true,
            }, { reason });
            return true;
        } catch (err) {
            logger.error(`[UnscrambleService] Failed to unlock channel ${channel.id}:`, err);
            return false;
        }
    }

    /**
     * Set dedicated Unscramble event channel and lock it immediately.
     */
    async setChannel(guild: Guild, channel: GuildTextBasedChannel): Promise<{ success: boolean; message: string }> {
        const botMember = guild.members.me;
        if (botMember && !channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageRoles) && !channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)) {
            return {
                success: false,
                message: '❌ I require **Manage Channels** or **Manage Roles** permission to lock and unlock this channel.',
            };
        }

        await this.set(guild.id, { channelId: channel.id });
        await this.lockChannel(channel, 'Unscramble dedicated channel set - locked until round begins');

        const embed = new EmbedBuilder()
            .setColor(0x06b6d4) // Cyan
            .setTitle('🔒 Unscramble The Word Arena')
            .setDescription(
                'This channel is the designated **Unscramble The Word** arena!\n\n' +
                '🔒 **Status:** Channel is locked.\n' +
                '🔓 It will **automatically unlock** when a game begins (`/unscramble start` or automated timer).\n' +
                '🔒 It will **automatically lock** back down when a player wins or the round ends.\n' +
                '💬 **Goal:** Be the first person to unscramble and type the secret word in chat!'
            )
            .setFooter({ text: 'Victus Cloud Events' })
            .setTimestamp();

        await channel.send({ embeds: [embed] }).catch(() => {});

        return {
            success: true,
            message: `✅ Dedicated Unscramble channel set to <#${channel.id}> and locked until a round starts!`,
        };
    }

    /**
     * Remove dedicated Unscramble channel and unlock it.
     */
    async removeChannel(guild: Guild): Promise<{ success: boolean; message: string }> {
        const config = await this.get(guild.id);
        if (!config.channelId) {
            return { success: false, message: 'ℹ️ No dedicated Unscramble channel is currently configured.' };
        }

        const channel = guild.channels.cache.get(config.channelId) as GuildTextBasedChannel | undefined;
        if (channel && 'permissionOverwrites' in channel) {
            await channel.permissionOverwrites.edit(guild.roles.everyone, {
                SendMessages: null,
            }, { reason: 'Unscramble dedicated channel removed' }).catch(() => {});
        }

        await this.set(guild.id, { channelId: null });
        return { success: true, message: '✅ Removed dedicated Unscramble channel and restored permissions.' };
    }

    /**
     * Start a new Unscramble round.
     */
    async startGame(
        guild: Guild,
        channel: GuildTextBasedChannel,
        hostId: string,
        customWord?: string,
        customCategory?: string
    ): Promise<{ success: boolean; message: string; game?: ActiveUnscrambleGame }> {
        if (this.activeGames.has(guild.id)) {
            const active = this.activeGames.get(guild.id)!;
            return {
                success: false,
                message: `❌ An Unscramble game is already active in <#${active.channelId}>! Use \`/unscramble end\` to finish it first.`,
            };
        }

        const config = await this.get(guild.id);
        const isDedicated = config.channelId === channel.id;

        let wasLocked = false;
        if (isDedicated || config.autoLock) {
            wasLocked = true;
            await this.unlockChannel(channel, 'Unscramble round started - channel unlocked');
        }

        let targetWord = '';
        let targetCategory = customCategory || 'General';

        if (customWord && customWord.trim()) {
            targetWord = customWord.trim().toUpperCase();
        } else {
            const pick = WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)];
            targetWord = pick.word.toUpperCase();
            targetCategory = pick.category;
        }

        const scrambled = scrambleWord(targetWord);

        const game: ActiveUnscrambleGame = {
            guildId: guild.id,
            channelId: channel.id,
            originalWord: targetWord,
            scrambledWord: scrambled,
            category: targetCategory,
            hostId,
            startedAt: Date.now(),
            guessCount: 0,
            hintsGiven: 0,
            givenHints: [],
            hintTimer: null,
            participants: new Set(),
            wasLockedBefore: wasLocked,
        };

        const intervalMs = Math.max(15, config.hintIntervalSeconds || 45) * 1000;
        game.hintTimer = setInterval(async () => {
            await this.sendAutomatedHint(guild.id, channel);
        }, intervalMs);

        this.activeGames.set(guild.id, game);

        const pingRoleId = config.pingRoleId || '1551226428371243209';
        const roleMention = pingRoleId ? `<@&${pingRoleId}>` : '';

        const spacedScramble = scrambled.split('').join(' ');

        const startEmbed = new EmbedBuilder()
            .setColor(0x06b6d4) // Cyan
            .setTitle('🔤 Unscramble The Word!')
            .setDescription(
                `A new round of **Unscramble The Word** has begun!\n\n` +
                `### Scrambled Word:\n` +
                `# 🧩 \`${spacedScramble}\`\n\n` +
                `🎯 **Goal:** Be the first person to unscramble and type the secret word in chat!\n` +
                `💡 **Clues:** Automatic hints will unlock every ${Math.floor(intervalMs / 1000)}s!\n\n` +
                `🔓 **Channel is now UNLOCKED!** Good luck!`
            )
            .addFields(
                { name: '🏷️ Category', value: `\`${targetCategory}\``, inline: true },
                { name: '📏 Length', value: `**${targetWord.length} letters**`, inline: true },
                {
                    name: '🪙 Reward',
                    value: config.rewardCoins > 0 ? `**${config.rewardCoins} Victus Coins**` : 'Glory & Bragging Rights',
                    inline: true,
                }
            )
            .setFooter({ text: 'Victus Cloud Events • Type the unscrambled word below!' })
            .setTimestamp();

        await channel.send({
            content: roleMention ? `🔔 ${roleMention} A new **Unscramble The Word** game has started!` : undefined,
            embeds: [startEmbed],
            allowedMentions: pingRoleId ? { roles: [pingRoleId] } : undefined,
        }).catch((err) => {
            logger.error('[UnscrambleService] Failed to send game start announcement:', err);
        });

        return {
            success: true,
            message: `✅ Unscramble game started in <#${channel.id}>! Scrambled: **${scrambled}**`,
            game,
        };
    }

    /**
     * End active Unscramble game.
     */
    async endGame(guild: Guild, endedByUserId?: string): Promise<{ success: boolean; message: string }> {
        const game = this.activeGames.get(guild.id);
        if (!game) {
            return { success: false, message: '❌ There is no active Unscramble game in this server.' };
        }

        if (game.hintTimer) {
            clearInterval(game.hintTimer);
            game.hintTimer = null;
        }

        this.activeGames.delete(guild.id);

        const channel = guild.channels.cache.get(game.channelId) as GuildTextBasedChannel | undefined;
        if (channel) {
            const endEmbed = new EmbedBuilder()
                .setColor(0xef4444)
                .setTitle('🛑 Unscramble Game Ended')
                .setDescription(
                    `The round has ended${endedByUserId ? ` by <@${endedByUserId}>` : ''}.\n\n` +
                    `🔤 **Original Word:** **${game.originalWord}**\n` +
                    `🧩 **Scrambled Was:** \`${game.scrambledWord}\`\n` +
                    `📊 **Total Guesses:** **${game.guessCount}**\n` +
                    `👥 **Participants:** **${game.participants.size}**`
                )
                .setFooter({ text: 'Victus Cloud Events' })
                .setTimestamp();

            await channel.send({ embeds: [endEmbed] }).catch(() => {});

            const config = await this.get(guild.id);
            if (config.channelId === channel.id || game.wasLockedBefore) {
                await this.lockChannel(channel, 'Unscramble game ended - relocking channel');
                await channel.send({
                    content: '🔒 **Channel Locked:** The event has ended. This channel is locked until the next game!',
                }).catch(() => {});
            }

            if (config.autoEnabled && config.channelId) {
                this.scheduleNextAutoGame(guild, config.autoIntervalMs);
            }
        }

        return {
            success: true,
            message: `✅ Unscramble game ended. The word was **${game.originalWord}**.`,
        };
    }

    /**
     * Schedule next automated game.
     */
    scheduleNextAutoGame(guild: Guild, delayMs: number): void {
        const existing = this.autoTimers.get(guild.id);
        if (existing) clearTimeout(existing);

        const nextAutoGameAt = Date.now() + delayMs;
        this.set(guild.id, { nextAutoGameAt }).catch(() => {});

        const timer = setTimeout(async () => {
            this.autoTimers.delete(guild.id);
            await this.launchAutoGame(guild);
        }, delayMs);

        this.autoTimers.set(guild.id, timer);
        logger.info(`[UnscrambleService] Scheduled next auto Unscramble game for guild ${guild.id} in ${formatDuration(delayMs)}`);
    }

    /**
     * Launch an automated game with a random word from the dictionary.
     */
    async launchAutoGame(guild: Guild): Promise<void> {
        if (this.activeGames.has(guild.id)) return;

        const config = await this.get(guild.id);
        if (!config.autoEnabled || !config.channelId) return;

        const channel = guild.channels.cache.get(config.channelId) as GuildTextBasedChannel | undefined;
        if (!channel || !channel.isTextBased()) return;

        const botId = guild.client.user?.id || 'VictusBot';
        await this.startGame(guild, channel, botId);
    }

    /**
     * Handle incoming chat message in active game.
     */
    async handleMessage(message: Message): Promise<boolean> {
        if (!message.inGuild() || message.author.bot) return false;

        const guildId = message.guildId!;
        const game = this.activeGames.get(guildId);
        if (!game || message.channelId !== game.channelId) return false;

        const cleanContent = message.content.trim().toUpperCase();
        if (!cleanContent) return false;

        // Prevent host from guessing their own custom word
        if (message.author.id === game.hostId && game.hostId !== message.client.user?.id) {
            await message.react('🤫').catch(() => {});
            return true;
        }

        game.participants.add(message.author.id);
        game.guessCount++;
        this.recordGuess(guildId, message.author.id).catch(() => {});

        // Check if guess matches the secret word
        if (cleanContent === game.originalWord) {
            await this.handleWin(message, game);
            return true;
        }

        // Close match reaction if within 1 edit distance or anagram
        if (cleanContent.length === game.originalWord.length) {
            let matches = 0;
            for (let i = 0; i < cleanContent.length; i++) {
                if (cleanContent[i] === game.originalWord[i]) matches++;
            }
            if (matches >= game.originalWord.length - 1 && matches > 2) {
                await message.react('🔥').catch(() => {});
            }
        }

        return false;
    }

    private async handleWin(message: Message, game: ActiveUnscrambleGame): Promise<void> {
        if (game.hintTimer) {
            clearInterval(game.hintTimer);
            game.hintTimer = null;
        }
        this.activeGames.delete(game.guildId);

        await message.react('🎉').catch(() => {});
        await message.react('🏆').catch(() => {});
        await message.react('✨').catch(() => {});

        const durationStr = formatDuration(Date.now() - game.startedAt);
        const config = await this.get(game.guildId);

        const playerStats = await this.recordWin(game.guildId, message.author.id).catch(() => ({
            userId: message.author.id,
            wins: 1,
            totalGuesses: 1,
            lastWinAt: Date.now(),
        }));

        let coinGrantResult: { success: boolean; unlinked?: boolean; newBalance?: number; error?: string } | null = null;
        if (config.rewardCoins > 0) {
            try {
                coinGrantResult = await CoinTransactionLock.grantCoins(
                    message.author.id,
                    config.rewardCoins,
                    'unscramble_reward',
                    `unscramble:${game.guildId}:${Date.now()}`,
                    `Unscramble Game Reward: Unscrambled word "${game.originalWord}"`
                );
            } catch (err) {
                logger.error(`[UnscrambleService] Failed to grant coins to ${message.author.id}:`, err);
                coinGrantResult = { success: false, error: (err as Error).message };
            }
        }

        const winEmbed = new EmbedBuilder()
            .setColor(0x10b981) // Emerald Green
            .setTitle('🏆 WORD UNSCRAMBLED!')
            .setDescription(
                `🎉 Huge congratulations to <@${message.author.id}> for correctly unscrambling **${game.originalWord}**!\n\n` +
                `The word was accurately identified after **${game.guessCount}** attempt${game.guessCount === 1 ? '' : 's'}!`
            )
            .addFields(
                { name: '👤 Winner', value: `<@${message.author.id}> (${message.author.username})`, inline: true },
                { name: '🔤 Secret Word', value: `**${game.originalWord}**`, inline: true },
                { name: '⏱️ Time Taken', value: `**${durationStr}**`, inline: true },
                { name: '📊 Total Guesses', value: `**${game.guessCount}**`, inline: true },
                { name: '🏆 Total Wins', value: `**${playerStats.wins}** victor${playerStats.wins === 1 ? 'y' : 'ies'}`, inline: true },
                { name: '👥 Total Players', value: `**${game.participants.size}**`, inline: true }
            )
            .setFooter({ text: 'Victus Cloud Events • GG to all players!' })
            .setTimestamp();

        if (config.rewardCoins > 0) {
            if (coinGrantResult?.success) {
                winEmbed.addFields({
                    name: '🪙 Victus Cloud Coins Reward',
                    value: `✅ **+${config.rewardCoins} Coins** added to your linked Victus Cloud account!\n💳 Current Balance: **${coinGrantResult.newBalance}** Coins`,
                    inline: false,
                });
            } else if (coinGrantResult?.unlinked) {
                winEmbed.addFields({
                    name: '🪙 Victus Cloud Coins Reward',
                    value: `⚠️ **${config.rewardCoins} Coins** available!\nYour Discord account is not linked. Link your account with \`/link\` to claim coin rewards in future games!`,
                    inline: false,
                });
            }
        }

        if (config.autoEnabled && config.channelId) {
            const nextGameTimestamp = Math.floor((Date.now() + config.autoIntervalMs) / 1000);
            winEmbed.addFields({
                name: '⏳ Next Automated Game',
                value: `The next round will start automatically in <t:${nextGameTimestamp}:R>!`,
                inline: false,
            });
        }

        if ('send' in message.channel) {
            await message.channel.send({
                content: `🎊 **BRILLIANT!** <@${message.author.id}> solved it! The word was **${game.originalWord}**!`,
                embeds: [winEmbed],
            }).catch(() => {});

            const channel = message.channel as GuildTextBasedChannel;
            if (config.channelId === channel.id || game.wasLockedBefore) {
                await this.lockChannel(channel, 'Unscramble round won - relocking channel');
                await channel.send({
                    content: '🔒 **Channel Locked:** The round has concluded. This channel is now locked until the next game!',
                }).catch(() => {});
            }

            if (config.autoEnabled && config.channelId && message.guild) {
                this.scheduleNextAutoGame(message.guild, config.autoIntervalMs);
            }
        }
    }

    /**
     * Send dynamic progressive hints.
     */
    async sendHint(guildId: string, channel: GuildTextBasedChannel, manual = false): Promise<boolean> {
        const game = this.activeGames.get(guildId);
        if (!game || game.channelId !== channel.id) return false;

        game.hintsGiven++;
        const word = game.originalWord;
        const len = word.length;

        let hintTitle = '';
        let hintDesc = '';

        if (game.hintsGiven === 1) {
            hintTitle = 'Hint 1: First Letter Revealed';
            const masked = word[0] + ' ' + '_ '.repeat(len - 1).trim();
            hintDesc = `🔍 The word starts with the letter **${word[0]}**!\n\n` +
                `Pattern: \`${masked}\``;
        } else if (game.hintsGiven === 2) {
            hintTitle = 'Hint 2: Ending Letter Revealed';
            const masked = word[0] + ' ' + '_ '.repeat(len - 2) + word[len - 1];
            hintDesc = `🔍 The word ends with the letter **${word[len - 1]}**!\n\n` +
                `Pattern: \`${masked}\``;
        } else if (game.hintsGiven === 3) {
            const vowels = word.split('').filter((c) => 'AEIOU'.includes(c));
            const uniqueVowels = Array.from(new Set(vowels)).join(', ');
            hintTitle = 'Hint 3: Vowels Contained';
            hintDesc = `🔍 Vowels in this word: **${uniqueVowels || 'None'}** (Total vowels: ${vowels.length})!`;
        } else {
            const found = WORD_BANK.find((w) => w.word.toUpperCase() === word);
            hintTitle = 'Hint 4: Definition Clue';
            hintDesc = found?.clue
                ? `💡 **Clue:** ${found.clue}`
                : `💡 **Clue:** Category is **${game.category}** with **${len} letters**!`;
        }

        const spacedScramble = game.scrambledWord.split('').join(' ');

        const embed = new EmbedBuilder()
            .setColor(0xf59e0b) // Amber
            .setTitle(`💡 Unscramble Clue: ${hintTitle}`)
            .setDescription(
                `${hintDesc}\n\n` +
                `🧩 **Scrambled Word:** \`${spacedScramble}\`\n` +
                `🏷️ **Category:** \`${game.category}\``
            )
            .addFields(
                { name: '📊 Total Guesses', value: `**${game.guessCount}**`, inline: true },
                { name: '👥 Players Active', value: `**${game.participants.size}**`, inline: true }
            )
            .setFooter({ text: manual ? 'Manual hint requested by host/staff' : 'Periodic automated hint' })
            .setTimestamp();

        await channel.send({ embeds: [embed] }).catch(() => {});
        return true;
    }

    private async sendAutomatedHint(guildId: string, channel: GuildTextBasedChannel): Promise<void> {
        const game = this.activeGames.get(guildId);
        if (!game) return;
        await this.sendHint(guildId, channel, false);
    }

    /**
     * Initialize Unscramble service on bot startup.
     * Restores automated recurring game timers across all guilds so bot restarts don't lose auto games.
     */
    async init(client: Client): Promise<void> {
        for (const guild of client.guilds.cache.values()) {
            try {
                const config = await this.get(guild.id);
                if (config.autoEnabled && config.channelId) {
                    const channel = guild.channels.cache.get(config.channelId) as GuildTextBasedChannel | undefined;
                    if (channel && channel.isTextBased()) {
                        if (!this.activeGames.has(guild.id)) {
                            const now = Date.now();
                            const target = config.nextAutoGameAt || now;
                            const delayMs = Math.max(5000, target - now);
                            this.scheduleNextAutoGame(guild, delayMs);
                            logger.info(`[UnscrambleService] Restored automated Unscramble timer for "${guild.name}" (${guild.id}) in ${formatDuration(delayMs)}`);
                        }
                    }
                }
            } catch (err) {
                logger.error(`[UnscrambleService] Failed to restore auto Unscramble for guild ${guild.id}:`, err);
            }
        }
    }
}

export const unscrambleService = new UnscrambleService();
