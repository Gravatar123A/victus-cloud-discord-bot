import { EmbedBuilder, PermissionFlagsBits, } from 'discord.js';
import { supabase } from './supabase.js';
import { CoinTransactionLock } from './coinTransactionLock.js';
import { logger } from '../utils/logger.js';
export const DEFAULT_GTN_CONFIG = {
    channelId: null,
    autoLock: true,
    hintIntervalSeconds: 45,
    rewardCoins: 0,
    pingRoleId: '1551226428371243209',
    autoEnabled: false,
    autoIntervalMs: 60 * 60 * 1000, // 1 hour default
    maxNumber: 10000,
    nextAutoGameAt: null,
};
export function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (days > 0)
        parts.push(`${days}d`);
    if (hours > 0)
        parts.push(`${hours}h`);
    if (minutes > 0)
        parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0)
        parts.push(`${seconds}s`);
    return parts.join(' ');
}
export function parseTimeDuration(str) {
    const trimmed = str.trim().toLowerCase();
    if (trimmed === '0' || trimmed === 'off' || trimmed === 'disable' || trimmed === 'disabled' || trimmed === 'none') {
        return 0;
    }
    const regex = /(\d+)\s*(d|h|m|s)/g;
    let totalMs = 0;
    let match;
    let matchedAny = false;
    while ((match = regex.exec(trimmed)) !== null) {
        matchedAny = true;
        const val = parseInt(match[1], 10);
        const unit = match[2];
        if (unit === 'd')
            totalMs += val * 24 * 60 * 60 * 1000;
        else if (unit === 'h')
            totalMs += val * 60 * 60 * 1000;
        else if (unit === 'm')
            totalMs += val * 60 * 1000;
        else if (unit === 's')
            totalMs += val * 1000;
    }
    if (!matchedAny) {
        // Direct number interpreted as minutes (e.g. "10" -> 10 minutes)
        if (/^\d+$/.test(trimmed)) {
            const val = parseInt(trimmed, 10);
            return val * 60 * 1000;
        }
        return null;
    }
    return totalMs;
}
function isPrime(n) {
    if (n <= 1)
        return false;
    if (n <= 3)
        return true;
    if (n % 2 === 0 || n % 3 === 0)
        return false;
    for (let i = 5; i * i <= n; i += 6) {
        if (n % i === 0 || n % (i + 2) === 0)
            return false;
    }
    return true;
}
export function parseGtnGuess(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return null;
    // Strict single integer only
    if (/^-?\d+$/.test(trimmed)) {
        const val = parseInt(trimmed, 10);
        return Number.isSafeInteger(val) ? val : null;
    }
    return null;
}
export class GtnService {
    cache = new Map();
    activeGames = new Map();
    autoTimers = new Map();
    /**
     * Get GTN configuration for a guild.
     */
    async get(guildId) {
        const cached = this.cache.get(guildId);
        if (cached)
            return { ...cached };
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_gtn_settings');
            let raw = {};
            if (embed?.description) {
                raw = JSON.parse(embed.description);
            }
            const config = {
                ...DEFAULT_GTN_CONFIG,
                ...raw,
            };
            this.cache.set(guildId, config);
            return { ...config };
        }
        catch (error) {
            logger.error(`[GtnService] Failed to load config for guild ${guildId}:`, error);
            return { ...DEFAULT_GTN_CONFIG };
        }
    }
    /**
     * Save GTN configuration for a guild.
     */
    async set(guildId, updates) {
        const current = await this.get(guildId);
        const updated = { ...current, ...updates };
        this.cache.set(guildId, updated);
        try {
            await supabase.saveCustomEmbed(guildId, '_gtn_settings', {
                description: JSON.stringify(updated),
            });
        }
        catch (error) {
            logger.error(`[GtnService] Failed to save config for guild ${guildId}:`, error);
        }
        return { ...updated };
    }
    /**
     * Get active game for a guild if any.
     */
    getActiveGame(guildId) {
        return this.activeGames.get(guildId);
    }
    /**
     * Lock a channel by denying SendMessages for @everyone.
     */
    async lockChannel(channel, reason = 'GTN channel locked') {
        try {
            if (!('permissionOverwrites' in channel))
                return false;
            await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
                SendMessages: false,
            }, { reason });
            return true;
        }
        catch (err) {
            logger.error(`[GtnService] Failed to lock channel ${channel.id}:`, err);
            return false;
        }
    }
    /**
     * Unlock a channel by allowing SendMessages for @everyone.
     */
    async unlockChannel(channel, reason = 'GTN channel unlocked') {
        try {
            if (!('permissionOverwrites' in channel))
                return false;
            await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
                SendMessages: true,
            }, { reason });
            return true;
        }
        catch (err) {
            logger.error(`[GtnService] Failed to unlock channel ${channel.id}:`, err);
            return false;
        }
    }
    /**
     * Set dedicated GTN event channel and lock it immediately.
     */
    async setGtnChannel(guild, channel) {
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
            .setDescription('This channel is the designated **Guess The Number** arena!\n\n' +
            '🔒 **Status:** Channel is locked.\n' +
            '🔓 It will **automatically unlock** when a game begins (`/gtn start <number>` or automated timer).\n' +
            '🔒 It will **automatically lock** back down when a player wins or the game ends.\n' +
            '💬 **Chat rule:** Only numbers are allowed during games!')
            .setFooter({ text: 'Victus Cloud Events' })
            .setTimestamp();
        await channel.send({ embeds: [embed] }).catch(() => { });
        return {
            success: true,
            message: `✅ Dedicated GTN channel set to <#${channel.id}> and locked until a game starts!`,
        };
    }
    /**
     * Remove dedicated GTN channel and unlock it.
     */
    async removeGtnChannel(guild) {
        const config = await this.get(guild.id);
        if (!config.channelId) {
            return { success: false, message: 'ℹ️ No dedicated GTN channel is currently configured.' };
        }
        const channel = guild.channels.cache.get(config.channelId);
        if (channel && 'permissionOverwrites' in channel) {
            await channel.permissionOverwrites.edit(guild.roles.everyone, {
                SendMessages: null,
            }, { reason: 'GTN dedicated channel removed' }).catch(() => { });
        }
        await this.set(guild.id, { channelId: null });
        return { success: true, message: '✅ Removed dedicated GTN channel and restored permissions.' };
    }
    /**
     * Start a new Guess The Number game.
     */
    async startGame(guild, channel, hostId, secretNumber, maxRange = 10000) {
        if (this.activeGames.has(guild.id)) {
            const active = this.activeGames.get(guild.id);
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
        const game = {
            guildId: guild.id,
            channelId: channel.id,
            secretNumber,
            maxRange,
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
        // Determine ping role (default: 1551226428371243209)
        const pingRoleId = config.pingRoleId || '1551226428371243209';
        const roleMention = pingRoleId ? `<@&${pingRoleId}>` : '';
        // Build start announcement embed
        const startEmbed = new EmbedBuilder()
            .setColor(0x8b5cf6)
            .setTitle('🎲 Guess The Number Game Started!')
            .setDescription(`A new game of **Guess The Number** has begun in this channel!\n\n` +
            `🎯 **Goal:** Guess the secret number (between **1** and **${maxRange}**).\n` +
            `💬 **Rule:** Send **NUMBERS ONLY**. Non-numeric messages will be automatically deleted!\n` +
            `⬆️ **Reactions:** The bot reacts with ⬆️ if higher, or ⬇️ if lower.\n` +
            `🔥 **Hot Guesses:** The bot reacts with 🔥 if you are within 5 of the secret number!\n` +
            `💡 **Hints:** Automatic clues will appear every ${Math.floor(intervalMs / 1000)}s until someone wins!\n\n` +
            `🔓 **Channel is now UNLOCKED!** Good luck!`)
            .addFields({ name: '👑 Host', value: hostId === guild.client.user?.id ? '🤖 Victus Cloud (Automated)' : `<@${hostId}>`, inline: true }, { name: '📊 Range', value: `\`1\` ⟷ \`${maxRange}\``, inline: true }, {
            name: '🪙 Reward',
            value: config.rewardCoins > 0 ? `**${config.rewardCoins} Victus Coins** (Linked accounts)` : 'Glory & Bragging Rights',
            inline: true,
        })
            .setFooter({ text: 'Victus Cloud Events • Type your number below!' })
            .setTimestamp();
        await channel.send({
            content: roleMention ? `🔔 ${roleMention} A new **Guess The Number** game has started!` : undefined,
            embeds: [startEmbed],
            allowedMentions: pingRoleId ? { roles: [pingRoleId] } : undefined,
        }).catch((err) => {
            logger.error('[GtnService] Failed to send game start announcement:', err);
        });
        return {
            success: true,
            message: `✅ Guess The Number game started in <#${channel.id}>!`,
            game,
        };
    }
    /**
     * End / cancel active GTN game.
     */
    async endGame(guild, endedByUserId) {
        const game = this.activeGames.get(guild.id);
        if (!game) {
            return { success: false, message: '❌ There is no active Guess The Number game in this server.' };
        }
        if (game.hintTimer) {
            clearInterval(game.hintTimer);
            game.hintTimer = null;
        }
        this.activeGames.delete(guild.id);
        const channel = guild.channels.cache.get(game.channelId);
        if (channel) {
            const endEmbed = new EmbedBuilder()
                .setColor(0xef4444)
                .setTitle('🛑 Guess The Number Game Ended')
                .setDescription(`The game has been cancelled${endedByUserId ? ` by <@${endedByUserId}>` : ''}.\n\n` +
                `🎯 **Secret Number:** **${game.secretNumber}**\n` +
                `📊 **Total Guesses:** **${game.guessCount}**\n` +
                `👥 **Participants:** **${game.participants.size}**`)
                .setFooter({ text: 'Victus Cloud Events' })
                .setTimestamp();
            await channel.send({ embeds: [endEmbed] }).catch(() => { });
            // Lock channel back if configured
            const config = await this.get(guild.id);
            if (config.channelId === channel.id || game.wasLockedBefore) {
                await this.lockChannel(channel, 'GTN game ended - relocking channel');
                await channel.send({
                    content: '🔒 **Channel Locked:** The event has ended. This channel is locked until the next game!',
                }).catch(() => { });
            }
            // Schedule next game if automated mode is active
            if (config.autoEnabled && config.channelId) {
                this.scheduleNextAutoGame(guild, config.autoIntervalMs);
            }
        }
        return {
            success: true,
            message: `✅ GTN game ended. The secret number was **${game.secretNumber}**.`,
        };
    }
    /**
     * Schedule the next automated game.
     */
    scheduleNextAutoGame(guild, delayMs) {
        const existing = this.autoTimers.get(guild.id);
        if (existing)
            clearTimeout(existing);
        const nextAutoGameAt = Date.now() + delayMs;
        this.set(guild.id, { nextAutoGameAt }).catch(() => { });
        const timer = setTimeout(async () => {
            this.autoTimers.delete(guild.id);
            await this.launchAutoGame(guild);
        }, delayMs);
        this.autoTimers.set(guild.id, timer);
        logger.info(`[GtnService] Scheduled next auto GTN game for guild ${guild.id} in ${formatDuration(delayMs)}`);
    }
    /**
     * Launch an automated game with a random number up to config.maxNumber (default 10,000).
     */
    async launchAutoGame(guild) {
        if (this.activeGames.has(guild.id))
            return;
        const config = await this.get(guild.id);
        if (!config.autoEnabled || !config.channelId)
            return;
        const channel = guild.channels.cache.get(config.channelId);
        if (!channel || !channel.isTextBased())
            return;
        const max = config.maxNumber || 10000;
        const randomSecret = Math.floor(Math.random() * max) + 1;
        const botId = guild.client.user?.id || 'VictusBot';
        logger.info(`[GtnService] Launching automated GTN in guild ${guild.id}, channel ${channel.id}, secret: ${randomSecret} (1-${max})`);
        await this.startGame(guild, channel, botId, randomSecret, max);
    }
    /**
     * Process message in guild.
     * Enforces: "they should not be able to send other messages except numbers"
     */
    async handleMessage(message) {
        if (!message.inGuild() || message.author.bot)
            return false;
        const guildId = message.guildId;
        const game = this.activeGames.get(guildId);
        if (!game || message.channelId !== game.channelId)
            return false;
        // In active GTN channel during an ongoing game:
        const parsedGuess = parseGtnGuess(message.content);
        // If NOT a valid number:
        if (parsedGuess === null) {
            // Staff members with ManageMessages can still send chat or moderator commands
            const isStaff = !!message.member && (message.member.permissions.has(PermissionFlagsBits.ManageMessages) ||
                message.member.permissions.has(PermissionFlagsBits.Administrator));
            if (isStaff) {
                return false;
            }
            // Non-numeric message by a regular member: DELETE IMMEDIATELY
            await message.delete().catch(() => { });
            // Send a transient 3.5-second reminder
            const warnMsg = await message.channel.send({
                content: `⚠️ <@${message.author.id}>, only numeric guesses are allowed in this channel!`,
            }).catch(() => null);
            if (warnMsg) {
                setTimeout(() => {
                    warnMsg.delete().catch(() => { });
                }, 3500);
            }
            return true;
        }
        // Prevent host from guessing their own secret number
        if (message.author.id === game.hostId) {
            await message.react('🤫').catch(() => { });
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
            await message.react('⬆️').catch(() => { });
            // Proximity fire reaction if within 5
            if (secret - parsedGuess <= 5 && secret - parsedGuess > 0) {
                await message.react('🔥').catch(() => { });
            }
            return true;
        }
        // 3. Guess too high -> Lower!
        if (parsedGuess > secret) {
            if (game.highestGuess === null || parsedGuess < game.highestGuess) {
                game.highestGuess = parsedGuess;
            }
            await message.react('⬇️').catch(() => { });
            // Proximity fire reaction if within 5
            if (parsedGuess - secret <= 5 && parsedGuess - secret > 0) {
                await message.react('🔥').catch(() => { });
            }
            return true;
        }
        return false;
    }
    async handleWin(message, game) {
        if (game.hintTimer) {
            clearInterval(game.hintTimer);
            game.hintTimer = null;
        }
        this.activeGames.delete(game.guildId);
        await message.react('🎉').catch(() => { });
        await message.react('🏆').catch(() => { });
        await message.react('🎯').catch(() => { });
        const durationStr = formatDuration(Date.now() - game.startedAt);
        const config = await this.get(game.guildId);
        // Award Victus Coins if configured
        let coinGrantResult = null;
        if (config.rewardCoins > 0) {
            try {
                coinGrantResult = await CoinTransactionLock.grantCoins(message.author.id, config.rewardCoins, 'gtn_reward', `gtn:${game.guildId}:${Date.now()}`, `GTN Game Reward: Guessed secret number ${game.secretNumber}`);
            }
            catch (err) {
                logger.error(`[GtnService] Failed to grant coins to ${message.author.id}:`, err);
                coinGrantResult = { success: false, error: err.message };
            }
        }
        const winEmbed = new EmbedBuilder()
            .setColor(0x10b981) // Emerald Green
            .setTitle('🏆 WE HAVE A WINNER!')
            .setDescription(`🎉 Huge congratulations to <@${message.author.id}> for correctly guessing the secret number **${game.secretNumber}**!\n\n` +
            `The number was accurately guessed after **${game.guessCount}** attempt${game.guessCount === 1 ? '' : 's'}!`)
            .addFields({ name: '👤 Winner', value: `<@${message.author.id}> (${message.author.username})`, inline: true }, { name: '🎯 Secret Number', value: `**${game.secretNumber}**`, inline: true }, { name: '⏱️ Time Taken', value: `**${durationStr}**`, inline: true }, { name: '📊 Total Guesses', value: `**${game.guessCount}**`, inline: true }, { name: '👥 Total Players', value: `**${game.participants.size}**`, inline: true }, { name: '👑 Host', value: game.hostId === message.client.user?.id ? '🤖 Victus Cloud' : `<@${game.hostId}>`, inline: true })
            .setFooter({ text: 'Victus Cloud Events • GG to all players!' })
            .setTimestamp();
        // Add Coin Reward status to embed
        if (config.rewardCoins > 0) {
            if (coinGrantResult?.success) {
                winEmbed.addFields({
                    name: '🪙 Victus Cloud Coins Reward',
                    value: `✅ **+${config.rewardCoins} Coins** added to your linked Victus Cloud account!\n💳 Current Balance: **${coinGrantResult.newBalance}** Coins`,
                    inline: false,
                });
            }
            else if (coinGrantResult?.unlinked) {
                winEmbed.addFields({
                    name: '🪙 Victus Cloud Coins Reward',
                    value: `⚠️ **${config.rewardCoins} Coins** available!\nYour Discord account is not linked to Victus Cloud. Link your account with \`/link\` to claim coin rewards in future games!`,
                    inline: false,
                });
            }
            else if (coinGrantResult?.error) {
                winEmbed.addFields({
                    name: '🪙 Victus Cloud Coins Reward',
                    value: `⚠️ Error adding coins: ${coinGrantResult.error}`,
                    inline: false,
                });
            }
        }
        // Add automated next game notice if auto mode is on
        if (config.autoEnabled && config.channelId) {
            const nextGameTimestamp = Math.floor((Date.now() + config.autoIntervalMs) / 1000);
            winEmbed.addFields({
                name: '⏳ Next Automated Game',
                value: `The next round will start automatically in <t:${nextGameTimestamp}:R> (1 ⟷ ${config.maxNumber || 10000})!`,
                inline: false,
            });
        }
        if ('send' in message.channel) {
            await message.channel.send({
                content: `🎊 **BINGO!** <@${message.author.id}> got it!`,
                embeds: [winEmbed],
            }).catch(() => { });
            // Relock channel if configured
            const channel = message.channel;
            if (config.channelId === channel.id || game.wasLockedBefore) {
                await this.lockChannel(channel, 'GTN game won - relocking channel');
                await channel.send({
                    content: '🔒 **Channel Locked:** The game has concluded. This channel is now locked until the next game!',
                }).catch(() => { });
            }
            // Trigger next auto-game schedule
            if (config.autoEnabled && config.channelId && message.guild) {
                this.scheduleNextAutoGame(message.guild, config.autoIntervalMs);
            }
        }
    }
    /**
     * Generate next dynamic hint.
     */
    generateHint(game) {
        const secret = game.secretNumber;
        const abs = Math.abs(secret);
        const str = abs.toString();
        const digits = str.length;
        const candidates = [];
        // 1. Narrowed range hint
        if (game.lowestGuess !== null || game.highestGuess !== null) {
            const rangeKey = `range_${game.lowestGuess}_${game.highestGuess}`;
            if (!game.givenHints.includes(rangeKey)) {
                let rangeText = '';
                if (game.lowestGuess !== null && game.highestGuess !== null) {
                    rangeText = `📊 The secret number is between **${game.lowestGuess}** and **${game.highestGuess}**!`;
                }
                else if (game.lowestGuess !== null) {
                    rangeText = `📊 The secret number is greater than **${game.lowestGuess}**!`;
                }
                else if (game.highestGuess !== null) {
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
            }
            else {
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
            }
            else {
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
            const lowest = game.lowestGuess !== null ? game.lowestGuess : '1';
            const highest = game.highestGuess !== null ? game.highestGuess : game.maxRange;
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
    async sendHint(guildId, channel, manual = false) {
        const game = this.activeGames.get(guildId);
        if (!game || game.channelId !== channel.id)
            return false;
        const hint = this.generateHint(game);
        if (!hint)
            return false;
        const lowest = game.lowestGuess !== null ? String(game.lowestGuess) : '1';
        const highest = game.highestGuess !== null ? String(game.highestGuess) : String(game.maxRange);
        const embed = new EmbedBuilder()
            .setColor(0xf59e0b) // Amber / Gold
            .setTitle(`💡 Guess The Number Hint: ${hint.title}`)
            .setDescription(hint.text)
            .addFields({ name: '📊 Current Range', value: `\`${lowest}\` ⟷ \`${highest}\``, inline: true }, { name: '🎯 Total Guesses', value: `**${game.guessCount}**`, inline: true }, { name: '👥 Players', value: `**${game.participants.size}**`, inline: true })
            .setFooter({ text: manual ? 'Manual hint requested by host/staff' : 'Periodic automated hint' })
            .setTimestamp();
        await channel.send({ embeds: [embed] }).catch(() => { });
        return true;
    }
    async sendAutomatedHint(guildId, channel) {
        const game = this.activeGames.get(guildId);
        if (!game)
            return;
        // If no guesses have been made yet, prompt players
        if (game.guessCount === 0) {
            const promptEmbed = new EmbedBuilder()
                .setColor(0x8b5cf6)
                .setTitle('⏳ Waiting for Guesses!')
                .setDescription(`No one has made a guess yet! Type any number between 1 and ${game.maxRange} to start narrowing down the range.`)
                .setFooter({ text: 'Victus Cloud Events • Numbers only allowed' });
            await channel.send({ embeds: [promptEmbed] }).catch(() => { });
            return;
        }
        await this.sendHint(guildId, channel, false);
    }
}
export const gtnService = new GtnService();
