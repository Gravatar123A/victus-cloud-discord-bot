import {
    Guild,
    GuildTextBasedChannel,
    Message,
    EmbedBuilder,
    PermissionFlagsBits,
} from 'discord.js';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';

export interface GtnConfig {
    channelId: string | null;
    autoLock: boolean;
    hintIntervalSeconds: number;
}

export const DEFAULT_GTN_CONFIG: GtnConfig = {
    channelId: null,
    autoLock: true,
    hintIntervalSeconds: 45,
};

export interface ActiveGtnGame {
    guildId: string;
    channelId: string;
    secretNumber: number;
    hostId: string;
    startedAt: number;
    guessCount: number;
    lowestGuess: number | null;   // highest guess that is lower than secret
    highestGuess: number | null;  // lowest guess that is higher than secret
    givenHints: string[];
    hintTimer: NodeJS.Timeout | null;
    participants: Set<string>;
    wasLockedBefore: boolean;
}

function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

function isPrime(n: number): boolean {
    if (n <= 1) return false;
    if (n <= 3) return true;
    if (n % 2 === 0 || n % 3 === 0) return false;
    for (let i = 5; i * i <= n; i += 6) {
        if (n % i === 0 || n % (i + 2) === 0) return false;
    }
    return true;
}

export function parseGtnGuess(text: string): number | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    // 1. Direct integer
    if (/^-?\d+$/.test(trimmed)) {
        const val = parseInt(trimmed, 10);
        return Number.isSafeInteger(val) ? val : null;
    }

    // 2. First token if someone typed "42 gg" or "100 maybe"
    const firstWord = trimmed.split(/\s+/)[0];
    if (/^-?\d+$/.test(firstWord)) {
        const val = parseInt(firstWord, 10);
        return Number.isSafeInteger(val) ? val : null;
    }

    return null;
}

export class GtnService {
    private cache = new Map<string, GtnConfig>();
    private activeGames = new Map<string, ActiveGtnGame>();

    /**
     * Get GTN configuration for a guild.
     */
    async get(guildId: string): Promise<GtnConfig> {
        const cached = this.cache.get(guildId);
        if (cached) return { ...cached };

        try {
            const embed = await supabase.getCustomEmbed(guildId, '_gtn_settings');
            let raw: Partial<GtnConfig> = {};
            if (embed?.description) {
                raw = JSON.parse(embed.description);
            }
            const config: GtnConfig = {
                ...DEFAULT_GTN_CONFIG,
                ...raw,
            };
            this.cache.set(guildId, config);
            return { ...config };
        } catch (error) {
            logger.error(`[GtnService] Failed to load config for guild ${guildId}:`, error);
            return { ...DEFAULT_GTN_CONFIG };
        }
    }

    /**
     * Save GTN configuration for a guild.
     */
    async set(guildId: string, updates: Partial<GtnConfig>): Promise<GtnConfig> {
        const current = await this.get(guildId);
        const updated: GtnConfig = { ...current, ...updates };
        this.cache.set(guildId, updated);

        try {
            await supabase.saveCustomEmbed(guildId, '_gtn_settings', {
                description: JSON.stringify(updated),
            });
        } catch (error) {
            logger.error(`[GtnService] Failed to save config for guild ${guildId}:`, error);
        }

        return { ...updated };
    }

    /**
     * Get active game for a guild if any.
     */
    getActiveGame(guildId: string): ActiveGtnGame | undefined {
        return this.activeGames.get(guildId);
    }

    /**
     * Lock a channel by denying SendMessages for @everyone.
     */
    async lockChannel(channel: GuildTextBasedChannel, reason = 'GTN channel locked'): Promise<boolean> {
        try {
            if (!('permissionOverwrites' in channel)) return false;
            await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
                SendMessages: false,
            }, { reason });
            return true;
        } catch (err) {
            logger.error(`[GtnService] Failed to lock channel ${channel.id}:`, err);
            return false;
        }
    }

    /**
     * Unlock a channel by allowing SendMessages for @everyone.
     */
    async unlockChannel(channel: GuildTextBasedChannel, reason = 'GTN channel unlocked'): Promise<boolean> {
        try {
            if (!('permissionOverwrites' in channel)) return false;
            await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
                SendMessages: true,
            }, { reason });
            return true;
        } catch (err) {
            logger.error(`[GtnService] Failed to unlock channel ${channel.id}:`, err);
            return false;
        }
    }

    /**
     * Set dedicated GTN event channel and lock it immediately.
     */
    async setGtnChannel(guild: Guild, channel: GuildTextBasedChannel): Promise<{ success: boolean; message: string }> {
        const botMember = guild.members.me;
        if (botMember && !channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageRoles) && !channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)) {
            return {
                success: false,
                message: '❌ I require **Manage Channels** or **Manage Roles** permission to lock and unlock this channel.',
            };
        }

        await this.set(guild.id, { channelId: channel.id });
        await this.lockChannel(channel, 'GTN dedicated channel set - locked until game begins');

        const embed = new EmbedBuilder()
            .setColor(0x8b5cf6)
            .setTitle('🔒 Guess The Number Event Channel')
            .setDescription(
                'This channel is the designated **Guess The Number** arena!\n\n' +
                '🔒 **Status:** Channel is locked.\n' +
                '🔓 It will **automatically unlock** when a game begins (`/gtn start <number>`).\n' +
                '🔒 It will **automatically lock** back down when a player wins or the game ends.'
            )
            .setFooter({ text: 'Victus Cloud Events' })
            .setTimestamp();

        await channel.send({ embeds: [embed] }).catch(() => {});

        return {
            success: true,
            message: `✅ Dedicated GTN channel set to <#${channel.id}> and locked until a game starts!`,
        };
    }

    /**
     * Remove dedicated GTN channel and unlock it.
     */
    async removeGtnChannel(guild: Guild): Promise<{ success: boolean; message: string }> {
        const config = await this.get(guild.id);
        if (!config.channelId) {
            return { success: false, message: 'ℹ️ No dedicated GTN channel is currently configured.' };
        }

        const channel = guild.channels.cache.get(config.channelId) as GuildTextBasedChannel | undefined;
        if (channel && 'permissionOverwrites' in channel) {
            await channel.permissionOverwrites.edit(guild.roles.everyone, {
                SendMessages: null,
            }, { reason: 'GTN dedicated channel removed' }).catch(() => {});
        }

        await this.set(guild.id, { channelId: null });
        return { success: true, message: '✅ Removed dedicated GTN channel and restored permissions.' };
    }

    /**
     * Start a new Guess The Number game.
     */
    async startGame(
        guild: Guild,
        channel: GuildTextBasedChannel,
        hostId: string,
        secretNumber: number
    ): Promise<{ success: boolean; message: string; game?: ActiveGtnGame }> {
        if (this.activeGames.has(guild.id)) {
            const active = this.activeGames.get(guild.id)!;
            return {
                success: false,
                message: `❌ A Guess The Number game is already active in <#${active.channelId}>! Use \`/gtn end\` to end it first.`,
            };
        }

        const config = await this.get(guild.id);
        const isDedicated = config.channelId === channel.id;

        // Unlock channel if it's the dedicated channel or if autoLock is enabled
        let wasLocked = false;
        if (isDedicated || config.autoLock) {
            wasLocked = true;
            await this.unlockChannel(channel, 'GTN game started - channel unlocked');
        }

        const game: ActiveGtnGame = {
            guildId: guild.id,
            channelId: channel.id,
            secretNumber,
            hostId,
            startedAt: Date.now(),
            guessCount: 0,
            lowestGuess: null,
            highestGuess: null,
            givenHints: [],
            hintTimer: null,
            participants: new Set(),
            wasLockedBefore: wasLocked,
        };

        // Setup automated hint timer
        const intervalMs = Math.max(15, config.hintIntervalSeconds || 45) * 1000;
        game.hintTimer = setInterval(async () => {
            await this.sendAutomatedHint(guild.id, channel);
        }, intervalMs);

        this.activeGames.set(guild.id, game);

        // Send game announcement embed
        const startEmbed = new EmbedBuilder()
            .setColor(0x8b5cf6)
            .setTitle('🎲 Guess The Number Game Started!')
            .setDescription(
                `A new game of **Guess The Number** has begun in this channel!\n\n` +
                `🎯 **Goal:** Guess the secret number chosen by <@${hostId}>.\n` +
                `💬 **How to play:** Type any number in this channel.\n` +
                `⬆️ **Bot reactions:** The bot will react with ⬆️ if the number is **higher**, or ⬇️ if it is **lower**.\n` +
                `💡 **Hints:** Clues and range updates will be broadcast periodically until someone wins!\n\n` +
                `🔓 **Channel is now UNLOCKED!** Good luck!`
            )
            .addFields(
                { name: '👑 Host', value: `<@${hostId}>`, inline: true },
                { name: '📊 Current Range', value: '`?` ⟷ `?`', inline: true },
                { name: '💡 First Hint', value: `Arrives in <t:${Math.floor((Date.now() + intervalMs) / 1000)}:R>`, inline: true }
            )
            .setFooter({ text: 'Victus Cloud Events • Type your guesses below!' })
            .setTimestamp();

        await channel.send({ embeds: [startEmbed] }).catch(() => {});

        return {
            success: true,
            message: `✅ Guess The Number game started in <#${channel.id}>!`,
            game,
        };
    }

    /**
     * End / cancel active GTN game.
     */
    async endGame(guild: Guild, endedByUserId?: string): Promise<{ success: boolean; message: string }> {
        const game = this.activeGames.get(guild.id);
        if (!game) {
            return { success: false, message: '❌ There is no active Guess The Number game in this server.' };
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
                .setTitle('🛑 Guess The Number Game Ended')
                .setDescription(
                    `The game has been cancelled${endedByUserId ? ` by <@${endedByUserId}>` : ''}.\n\n` +
                    `🎯 **Secret Number:** **${game.secretNumber}**\n` +
                    `📊 **Total Guesses:** **${game.guessCount}**\n` +
                    `👥 **Participants:** **${game.participants.size}**`
                )
                .setFooter({ text: 'Victus Cloud Events' })
                .setTimestamp();

            await channel.send({ embeds: [endEmbed] }).catch(() => {});

            // Lock channel back if configured
            const config = await this.get(guild.id);
            if (config.channelId === channel.id || game.wasLockedBefore) {
                await this.lockChannel(channel, 'GTN game ended - relocking channel');
                await channel.send({
                    content: '🔒 **Channel Locked:** The event has ended. This channel is locked until the next game!',
                }).catch(() => {});
            }
        }

        return {
            success: true,
            message: `✅ GTN game ended. The secret number was **${game.secretNumber}**.`,
        };
    }

    /**
     * Process message in guild.
     */
    async handleMessage(message: Message): Promise<boolean> {
        if (!message.inGuild() || message.author.bot) return false;

        const guildId = message.guildId!;
        const game = this.activeGames.get(guildId);
        if (!game || message.channelId !== game.channelId) return false;

        const parsedGuess = parseGtnGuess(message.content);
        if (parsedGuess === null) return false;

        // Disallow host from guessing their own number
        if (message.author.id === game.hostId) {
            await message.react('🤫').catch(() => {});
            return true;
        }

        game.participants.add(message.author.id);
        game.guessCount++;

        const secret = game.secretNumber;

        // 1. Correct guess!
        if (parsedGuess === secret) {
            await this.handleWin(message, game);
            return true;
        }

        // 2. Guess too low -> Higher!
        if (parsedGuess < secret) {
            if (game.lowestGuess === null || parsedGuess > game.lowestGuess) {
                game.lowestGuess = parsedGuess;
            }

            await message.react('⬆️').catch(() => {});

            // Proximity fire reaction if within 5
            if (secret - parsedGuess <= 5 && secret - parsedGuess > 0) {
                await message.react('🔥').catch(() => {});
            }
            return true;
        }

        // 3. Guess too high -> Lower!
        if (parsedGuess > secret) {
            if (game.highestGuess === null || parsedGuess < game.highestGuess) {
                game.highestGuess = parsedGuess;
            }

            await message.react('⬇️').catch(() => {});

            // Proximity fire reaction if within 5
            if (parsedGuess - secret <= 5 && parsedGuess - secret > 0) {
                await message.react('🔥').catch(() => {});
            }
            return true;
        }

        return false;
    }

    private async handleWin(message: Message, game: ActiveGtnGame): Promise<void> {
        if (game.hintTimer) {
            clearInterval(game.hintTimer);
            game.hintTimer = null;
        }
        this.activeGames.delete(game.guildId);

        await message.react('🎉').catch(() => {});
        await message.react('🏆').catch(() => {});
        await message.react('🎯').catch(() => {});

        const durationStr = formatDuration(Date.now() - game.startedAt);

        const winEmbed = new EmbedBuilder()
            .setColor(0x10b981) // Emerald Green
            .setTitle('🏆 WE HAVE A WINNER!')
            .setDescription(
                `🎉 Huge congratulations to <@${message.author.id}> for guessing the secret number **${game.secretNumber}**!\n\n` +
                `The number was accurately guessed after **${game.guessCount}** attempt${game.guessCount === 1 ? '' : 's'}!`
            )
            .addFields(
                { name: '👤 Winner', value: `<@${message.author.id}> (${message.author.username})`, inline: true },
                { name: '🎯 Secret Number', value: `**${game.secretNumber}**`, inline: true },
                { name: '⏱️ Time Taken', value: `**${durationStr}**`, inline: true },
                { name: '📊 Total Guesses', value: `**${game.guessCount}**`, inline: true },
                { name: '👥 Total Players', value: `**${game.participants.size}**`, inline: true },
                { name: '👑 Host', value: `<@${game.hostId}>`, inline: true }
            )
            .setFooter({ text: 'Victus Cloud Events • GG to all players!' })
            .setTimestamp();

        if ('send' in message.channel) {
            await message.channel.send({
                content: `🎊 **BINGO!** <@${message.author.id}> got it!`,
                embeds: [winEmbed],
            }).catch(() => {});

            // Relock channel if configured
            const config = await this.get(game.guildId);
            const channel = message.channel as GuildTextBasedChannel;
            if (config.channelId === channel.id || game.wasLockedBefore) {
                await this.lockChannel(channel, 'GTN game won - relocking channel');
                await channel.send({
                    content: '🔒 **Channel Locked:** The game has concluded. This channel is now locked until the next game!',
                }).catch(() => {});
            }
        }
    }

    /**
     * Generate next dynamic hint.
     */
    generateHint(game: ActiveGtnGame): { hintKey: string; title: string; text: string } | null {
        const secret = game.secretNumber;
        const abs = Math.abs(secret);
        const str = abs.toString();
        const digits = str.length;

        interface Candidate {
            key: string;
            title: string;
            text: string;
            priority: number;
        }

        const candidates: Candidate[] = [];

        // 1. Narrowed range hint
        if (game.lowestGuess !== null || game.highestGuess !== null) {
            const rangeKey = `range_${game.lowestGuess}_${game.highestGuess}`;
            if (!game.givenHints.includes(rangeKey)) {
                let rangeText = '';
                if (game.lowestGuess !== null && game.highestGuess !== null) {
                    rangeText = `📊 The secret number is between **${game.lowestGuess}** and **${game.highestGuess}**!`;
                } else if (game.lowestGuess !== null) {
                    rangeText = `📊 The secret number is greater than **${game.lowestGuess}**!`;
                } else if (game.highestGuess !== null) {
                    rangeText = `📊 The secret number is less than **${game.highestGuess}**!`;
                }
                candidates.push({
                    key: rangeKey,
                    title: 'Current Narrowed Range',
                    text: rangeText,
                    priority: 10,
                });
            }
        }

        // 2. Parity hint (even or odd)
        if (!game.givenHints.includes('parity')) {
            const isEven = secret % 2 === 0;
            candidates.push({
                key: 'parity',
                title: 'Number Parity',
                text: isEven
                    ? '🔢 The secret number is an **EVEN** number!'
                    : '🔢 The secret number is an **ODD** number!',
                priority: 8,
            });
        }

        // 3. Digit count
        if (!game.givenHints.includes('digits')) {
            candidates.push({
                key: 'digits',
                title: 'Number Length',
                text: `📏 The secret number has **${digits}** digit${digits > 1 ? 's' : ''}!`,
                priority: 7,
            });
        }

        // 4. Divisibility hints
        if (!game.givenHints.includes('divisibility')) {
            const factors = [10, 5, 3, 4, 7, 2];
            const div = factors.find((f) => secret % f === 0);
            if (div) {
                candidates.push({
                    key: 'divisibility',
                    title: 'Divisibility Rule',
                    text: `➗ The secret number is divisible by **${div}**!`,
                    priority: 6,
                });
            } else {
                candidates.push({
                    key: 'divisibility',
                    title: 'Divisibility Rule',
                    text: `➗ The secret number is **NOT** divisible by 2, 3, 5, or 10!`,
                    priority: 6,
                });
            }
        }

        // 5. Sum of digits
        if (digits > 1 && !game.givenHints.includes('digit_sum')) {
            const sum = str.split('').reduce((acc, char) => acc + parseInt(char, 10), 0);
            candidates.push({
                key: 'digit_sum',
                title: 'Sum of Digits',
                text: `➕ The sum of all digits in the secret number is **${sum}**!`,
                priority: 5,
            });
        }

        // 6. Last digit
        if (digits > 1 && !game.givenHints.includes('last_digit')) {
            const lastDigit = str[str.length - 1];
            candidates.push({
                key: 'last_digit',
                title: 'Ending Digit',
                text: `🔍 The secret number ends with the digit **${lastDigit}**!`,
                priority: 4,
            });
        }

        // 7. First digit
        if (digits > 2 && !game.givenHints.includes('first_digit')) {
            const firstDigit = str[0];
            candidates.push({
                key: 'first_digit',
                title: 'Leading Digit',
                text: `🔍 The secret number begins with the digit **${firstDigit}**!`,
                priority: 3,
            });
        }

        // 8. Math fact (Prime or Square)
        if (!game.givenHints.includes('math_fact')) {
            if (isPrime(secret)) {
                candidates.push({
                    key: 'math_fact',
                    title: 'Special Property',
                    text: '✨ The secret number is a **PRIME** number!',
                    priority: 5,
                });
            } else {
                const sqrt = Math.sqrt(abs);
                if (Number.isInteger(sqrt) && sqrt > 1) {
                    candidates.push({
                        key: 'math_fact',
                        title: 'Special Property',
                        text: `✨ The secret number is a **perfect square** (${sqrt}²)!`,
                        priority: 5,
                    });
                }
            }
        }

        if (candidates.length === 0) {
            // If all hints exhausted, reiterate the tightest range
            const lowest = game.lowestGuess !== null ? game.lowestGuess : '?';
            const highest = game.highestGuess !== null ? game.highestGuess : '?';
            return {
                hintKey: `range_reiterate_${Date.now()}`,
                title: 'Range Summary',
                text: `📊 Keep guessing! The secret number is between **${lowest}** and **${highest}**!`,
            };
        }

        // Pick highest priority available hint
        candidates.sort((a, b) => b.priority - a.priority);
        const selected = candidates[0];
        game.givenHints.push(selected.key);

        return {
            hintKey: selected.key,
            title: selected.title,
            text: selected.text,
        };
    }

    /**
     * Send an automated or manual hint in the channel.
     */
    async sendHint(guildId: string, channel: GuildTextBasedChannel, manual = false): Promise<boolean> {
        const game = this.activeGames.get(guildId);
        if (!game || game.channelId !== channel.id) return false;

        const hint = this.generateHint(game);
        if (!hint) return false;

        const lowest = game.lowestGuess !== null ? String(game.lowestGuess) : '?';
        const highest = game.highestGuess !== null ? String(game.highestGuess) : '?';

        const embed = new EmbedBuilder()
            .setColor(0xf59e0b) // Amber / Gold
            .setTitle(`💡 Guess The Number Hint: ${hint.title}`)
            .setDescription(hint.text)
            .addFields(
                { name: '📊 Current Range', value: `\`${lowest}\` ⟷ \`${highest}\``, inline: true },
                { name: '🎯 Total Guesses', value: `**${game.guessCount}**`, inline: true },
                { name: '👥 Players', value: `**${game.participants.size}**`, inline: true }
            )
            .setFooter({ text: manual ? 'Manual hint requested by host/staff' : 'Periodic automated hint' })
            .setTimestamp();

        await channel.send({ embeds: [embed] }).catch(() => {});
        return true;
    }

    private async sendAutomatedHint(guildId: string, channel: GuildTextBasedChannel): Promise<void> {
        const game = this.activeGames.get(guildId);
        if (!game) return;

        // If no guesses have been made yet, prompt players
        if (game.guessCount === 0) {
            const promptEmbed = new EmbedBuilder()
                .setColor(0x8b5cf6)
                .setTitle('⏳ Waiting for Guesses!')
                .setDescription('No one has made a guess yet! Type any number in this channel to begin narrowing down the range.')
                .setFooter({ text: 'Victus Cloud Events' });

            await channel.send({ embeds: [promptEmbed] }).catch(() => {});
            return;
        }

        await this.sendHint(guildId, channel, false);
    }
}

export const gtnService = new GtnService();
