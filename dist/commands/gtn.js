import { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, } from 'discord.js';
import { gtnService, parseTimeDuration, formatDuration } from '../services/gtnService.js';
export const gtnCommand = {
    data: new SlashCommandBuilder()
        .setName('gtn')
        .setDescription('Manage and play Guess The Number games')
        .setDMPermission(false)
        .addSubcommand((sub) => sub
        .setName('start')
        .setDescription('Start a Guess The Number game in a channel')
        .addIntegerOption((opt) => opt
        .setName('number')
        .setDescription('The secret number players must guess')
        .setRequired(true))
        .addChannelOption((opt) => opt
        .setName('channel')
        .setDescription('Channel to host the game in (defaults to GTN channel or current)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false))
        .addIntegerOption((opt) => opt
        .setName('max_range')
        .setDescription('Maximum range shown to players (default 10000)')
        .setMinValue(1)
        .setRequired(false)))
        .addSubcommand((sub) => sub
        .setName('auto')
        .setDescription('Configure automated recurring GTN games (e.g. 10m, 1h, off)')
        .addStringOption((opt) => opt
        .setName('time')
        .setDescription('Delay before next game starts after a win (e.g. 10m, 1h, off to disable)')
        .setRequired(true))
        .addIntegerOption((opt) => opt
        .setName('max_number')
        .setDescription('Max random number generated (default 10000)')
        .setMinValue(10)
        .setMaxValue(1000000)
        .setRequired(false))
        .addBooleanOption((opt) => opt
        .setName('start_now')
        .setDescription('Immediately start the first automated game now')
        .setRequired(false)))
        .addSubcommand((sub) => sub
        .setName('coins')
        .setDescription('Configure Victus Coins reward for winning GTN')
        .addIntegerOption((opt) => opt
        .setName('amount')
        .setDescription('Number of coins to give to the winner with a linked account (0 to disable)')
        .setMinValue(0)
        .setMaxValue(100000)
        .setRequired(true)))
        .addSubcommand((sub) => sub
        .setName('role')
        .setDescription('Configure role pinged when GTN starts (default: @1551226428371243209)')
        .addRoleOption((opt) => opt
        .setName('role')
        .setDescription('The role to ping')
        .setRequired(false))
        .addBooleanOption((opt) => opt
        .setName('reset')
        .setDescription('Reset to default role (@1551226428371243209)')
        .setRequired(false)))
        .addSubcommand((sub) => sub
        .setName('channel')
        .setDescription('Configure or remove the dedicated locked GTN channel')
        .addChannelOption((opt) => opt
        .setName('channel')
        .setDescription('The channel to keep locked until GTN games start')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false))
        .addBooleanOption((opt) => opt
        .setName('remove')
        .setDescription('Remove the dedicated GTN channel configuration')
        .setRequired(false)))
        .addSubcommand((sub) => sub
        .setName('end')
        .setDescription('End or cancel the current Guess The Number game'))
        .addSubcommand((sub) => sub
        .setName('hint')
        .setDescription('Force an immediate hint in the active GTN channel'))
        .addSubcommand((sub) => sub
        .setName('status')
        .setDescription('View status of the current game, coins, auto schedule, and channel'))
        .addSubcommand((sub) => sub
        .setName('leaderboard')
        .setDescription('View top Guess The Number champions in this server')
        .addIntegerOption((opt) => opt
        .setName('limit')
        .setDescription('Number of top players to show (default 10, max 25)')
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(false))),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({
                content: '❌ This command can only be used inside a server.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const member = interaction.guild.members.cache.get(interaction.user.id);
        const hasStaffPerms = !!member && (member.permissions.has(PermissionFlagsBits.ManageMessages) ||
            member.permissions.has(PermissionFlagsBits.ManageGuild) ||
            member.permissions.has(PermissionFlagsBits.Administrator));
        // Resolve subcommand safely (handles both slash command and prefix interactions)
        let subcommand = null;
        try {
            subcommand = interaction.options.getSubcommand(false);
        }
        catch {
            subcommand = null;
        }
        // Support prefix syntax: e.g. !gtn 42, !gtn auto 10m, !gtn coins 50, !gtn channel #ch
        const rawMessage = interaction.message;
        let prefixArgNumber = null;
        let prefixTargetChannel = null;
        let prefixStringArg = null;
        let prefixRoleArg = null;
        if (!subcommand && rawMessage?.content) {
            const parts = rawMessage.content.trim().split(/\s+/).slice(1);
            if (parts.length > 0) {
                const first = parts[0].toLowerCase();
                if (first === 'auto') {
                    subcommand = 'auto';
                    if (parts[1])
                        prefixStringArg = parts[1];
                }
                else if (first === 'coins' || first === 'coin' || first === 'reward') {
                    subcommand = 'coins';
                    if (parts[1] && /^\d+$/.test(parts[1])) {
                        prefixArgNumber = parseInt(parts[1], 10);
                    }
                }
                else if (first === 'role' || first === 'ping') {
                    subcommand = 'role';
                    const roleMention = parts.find((p) => /<@&(\d+)>/.test(p));
                    if (roleMention) {
                        const m = roleMention.match(/\d+/);
                        if (m)
                            prefixRoleArg = interaction.guild.roles.cache.get(m[0]) ?? null;
                    }
                }
                else if (first === 'channel') {
                    subcommand = 'channel';
                }
                else if (first === 'end' || first === 'cancel' || first === 'stop') {
                    subcommand = 'end';
                }
                else if (first === 'hint') {
                    subcommand = 'hint';
                }
                else if (first === 'status') {
                    subcommand = 'status';
                }
                else if (first === 'leaderboard' || first === 'lb' || first === 'top') {
                    subcommand = 'leaderboard';
                    if (parts[1] && /^\d+$/.test(parts[1])) {
                        prefixArgNumber = parseInt(parts[1], 10);
                    }
                }
                else if (first === 'start') {
                    subcommand = 'start';
                    if (parts[1] && /^-?\d+$/.test(parts[1])) {
                        prefixArgNumber = parseInt(parts[1], 10);
                    }
                }
                else if (/^-?\d+$/.test(first)) {
                    // Direct integer: !gtn 42 #channel
                    subcommand = 'start';
                    prefixArgNumber = parseInt(first, 10);
                }
                // Check for channel mention in args
                const channelMention = parts.find((p) => /<#(\d+)>/.test(p));
                if (channelMention) {
                    const match = channelMention.match(/\d+/);
                    if (match) {
                        const ch = interaction.guild.channels.cache.get(match[0]);
                        if (ch && ch.isTextBased()) {
                            prefixTargetChannel = ch;
                        }
                    }
                }
            }
        }
        // Default to status if no subcommand determined
        if (!subcommand)
            subcommand = 'status';
        // 1. SUBCOMMAND: START
        if (subcommand === 'start') {
            if (!hasStaffPerms) {
                await interaction.reply({
                    content: '⛔ You need the **Manage Messages** or **Manage Server** permission to host a GTN game.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const rawSecret = interaction.options.getInteger?.('number') ?? prefixArgNumber;
            if (rawSecret === null || rawSecret === undefined || isNaN(rawSecret)) {
                await interaction.reply({
                    content: '❌ Please specify a valid integer for the secret number, e.g. `/gtn start number:42` or `!gtn 42`.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const config = await gtnService.get(interaction.guild.id);
            let targetChannel = interaction.options.getChannel?.('channel')
                ?? prefixTargetChannel;
            if (!targetChannel) {
                if (config.channelId) {
                    const configured = interaction.guild.channels.cache.get(config.channelId);
                    if (configured && configured.isTextBased()) {
                        targetChannel = configured;
                    }
                }
            }
            if (!targetChannel) {
                targetChannel = interaction.channel;
            }
            if (!targetChannel || !targetChannel.isTextBased()) {
                await interaction.reply({
                    content: '❌ Could not find a valid text channel to host the game.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            // Hide the host's prefix message with the secret number
            if (rawMessage && typeof rawMessage.delete === 'function') {
                await rawMessage.delete().catch(() => { });
            }
            const maxRange = interaction.options.getInteger?.('max_range') ?? config.maxNumber ?? 10000;
            const result = await gtnService.startGame(interaction.guild, targetChannel, interaction.user.id, rawSecret, maxRange);
            if (!result.success) {
                await interaction.reply({
                    content: result.message,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            await interaction.reply({
                content: `✅ **GTN Game Started!** Secret number **${rawSecret}** set in <#${targetChannel.id}>. Channel unlocked and ping sent!`,
                flags: MessageFlags.Ephemeral,
            }).catch(() => { });
            return;
        }
        // 2. SUBCOMMAND: AUTO
        if (subcommand === 'auto') {
            if (!hasStaffPerms) {
                await interaction.reply({
                    content: '⛔ You need the **Manage Server** or **Manage Messages** permission to configure automated GTN.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const timeStr = interaction.options.getString?.('time') ?? prefixStringArg;
            if (!timeStr) {
                await interaction.reply({
                    content: '❌ Please specify an interval like `10m`, `1h`, `30m`, or `off` to disable. Example: `/gtn auto time:10m`.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const parsedMs = parseTimeDuration(timeStr);
            if (parsedMs === null) {
                await interaction.reply({
                    content: '❌ Invalid time format. Please use formats like `10m`, `30m`, `1h`, `2h`, or `off` to disable.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            // Disabling auto mode
            if (parsedMs === 0) {
                await gtnService.set(interaction.guild.id, {
                    autoEnabled: false,
                    nextAutoGameAt: null,
                });
                await interaction.reply({
                    content: '⏸️ **Automated GTN Games Disabled.** Manual games can still be started with `/gtn start`.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const config = await gtnService.get(interaction.guild.id);
            if (!config.channelId) {
                await interaction.reply({
                    content: '⚠️ Please set a dedicated GTN channel first using `/gtn channel channel:<#channel>` so the bot knows where to host automated games!',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const maxNumber = interaction.options.getInteger?.('max_number') ?? config.maxNumber ?? 10000;
            const startNow = interaction.options.getBoolean?.('start_now') ?? false;
            await gtnService.set(interaction.guild.id, {
                autoEnabled: true,
                autoIntervalMs: parsedMs,
                maxNumber,
            });
            const pingRole = config.pingRoleId || '1551226428371243209';
            if (startNow) {
                await interaction.reply({
                    content: `🚀 **Automated GTN Activated!** Starting the first game now with a random number (1 to ${maxNumber}). Subsequent games will start every **${formatDuration(parsedMs)}** after each win!`,
                    flags: MessageFlags.Ephemeral,
                });
                await gtnService.launchAutoGame(interaction.guild);
            }
            else {
                gtnService.scheduleNextAutoGame(interaction.guild, parsedMs);
                const nextTs = Math.floor((Date.now() + parsedMs) / 1000);
                await interaction.reply({
                    content: `✅ **Automated GTN Enabled!**\n` +
                        `⏱️ **Interval:** Every **${formatDuration(parsedMs)}** after each game concludes.\n` +
                        `🎲 **Range:** Random secret from **1 to ${maxNumber}**.\n` +
                        `📢 **Ping Role:** <@&${pingRole}>\n` +
                        `📍 **Channel:** <#${config.channelId}>\n` +
                        `⏳ **Next Game Starts:** <t:${nextTs}:R> (<t:${nextTs}:f>)`,
                    flags: MessageFlags.Ephemeral,
                });
            }
            return;
        }
        // 3. SUBCOMMAND: COINS
        if (subcommand === 'coins') {
            if (!hasStaffPerms) {
                await interaction.reply({
                    content: '⛔ You need the **Manage Server** permission to configure Victus Coins rewards.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const amount = interaction.options.getInteger?.('amount') ?? prefixArgNumber;
            if (amount === null || amount === undefined || isNaN(amount) || amount < 0) {
                await interaction.reply({
                    content: '❌ Please specify a valid coin reward (0 to disable, or positive integer e.g. 50, 20).',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            await gtnService.set(interaction.guild.id, { rewardCoins: amount });
            if (amount > 0) {
                await interaction.reply({
                    content: `🪙 **Victus Coins Reward Set:** The winner of each GTN game will now receive **${amount} Victus Coins** (awarded automatically to their linked Victus Cloud account)!`,
                    flags: MessageFlags.Ephemeral,
                });
            }
            else {
                await interaction.reply({
                    content: '⏸️ **Victus Coins Reward Disabled:** No coins will be awarded for GTN wins.',
                    flags: MessageFlags.Ephemeral,
                });
            }
            return;
        }
        // 4. SUBCOMMAND: ROLE
        if (subcommand === 'role') {
            if (!hasStaffPerms) {
                await interaction.reply({
                    content: '⛔ You need the **Manage Server** permission to configure the announcement ping role.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const reset = interaction.options.getBoolean?.('reset') ?? false;
            const targetRole = interaction.options.getRole?.('role') ?? prefixRoleArg;
            if (reset) {
                await gtnService.set(interaction.guild.id, { pingRoleId: '1551226428371243209' });
                await interaction.reply({
                    content: '✅ Ping role reset to default: <@&1551226428371243209>.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            if (targetRole) {
                await gtnService.set(interaction.guild.id, { pingRoleId: targetRole.id });
                await interaction.reply({
                    content: `✅ Game start ping role updated to <@&${targetRole.id}>.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const config = await gtnService.get(interaction.guild.id);
            const currentRole = config.pingRoleId || '1551226428371243209';
            await interaction.reply({
                content: `📢 Current GTN ping role is <@&${currentRole}>. Use \`/gtn role role:@role\` to change it.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        // 5. SUBCOMMAND: CHANNEL
        if (subcommand === 'channel') {
            if (!hasStaffPerms) {
                await interaction.reply({
                    content: '⛔ You need the **Manage Server** permission to configure the GTN channel.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const removeOption = interaction.options.getBoolean?.('remove') ?? false;
            const channelOption = interaction.options.getChannel?.('channel')
                ?? prefixTargetChannel;
            const isRemove = removeOption || (rawMessage?.content && /\b(remove|clear|delete|off)\b/i.test(rawMessage.content));
            if (isRemove) {
                const result = await gtnService.removeGtnChannel(interaction.guild);
                await interaction.reply({
                    content: result.message,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            if (channelOption) {
                const result = await gtnService.setGtnChannel(interaction.guild, channelOption);
                await interaction.reply({
                    content: result.message,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const config = await gtnService.get(interaction.guild.id);
            if (config.channelId) {
                await interaction.reply({
                    content: `🔒 The current dedicated GTN event channel is <#${config.channelId}>.\nUse \`/gtn channel channel:<#channel>\` to change it or \`/gtn channel remove:True\` to remove it.`,
                    flags: MessageFlags.Ephemeral,
                });
            }
            else {
                await interaction.reply({
                    content: 'ℹ️ No dedicated GTN channel is currently set. Run `/gtn channel channel:<#channel>` to lock a channel for GTN events.',
                    flags: MessageFlags.Ephemeral,
                });
            }
            return;
        }
        // 6. SUBCOMMAND: END / CANCEL
        if (subcommand === 'end') {
            if (!hasStaffPerms) {
                await interaction.reply({
                    content: '⛔ You need the **Manage Messages** or **Manage Server** permission to end a game.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const result = await gtnService.endGame(interaction.guild, interaction.user.id);
            await interaction.reply({
                content: result.message,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        // 7. SUBCOMMAND: HINT
        if (subcommand === 'hint') {
            if (!hasStaffPerms) {
                await interaction.reply({
                    content: '⛔ Only staff or the host can manually trigger a hint.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const game = gtnService.getActiveGame(interaction.guild.id);
            if (!game) {
                await interaction.reply({
                    content: '❌ There is no active Guess The Number game in this server.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const channel = interaction.guild.channels.cache.get(game.channelId);
            if (!channel) {
                await interaction.reply({
                    content: '❌ Active game channel could not be found.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const sent = await gtnService.sendHint(interaction.guild.id, channel, true);
            if (sent) {
                await interaction.reply({
                    content: `💡 Hint successfully sent to <#${channel.id}>!`,
                    flags: MessageFlags.Ephemeral,
                });
            }
            else {
                await interaction.reply({
                    content: '⚠️ Unable to generate or send a hint at this time.',
                    flags: MessageFlags.Ephemeral,
                });
            }
            return;
        }
        // 8. SUBCOMMAND: STATUS
        if (subcommand === 'status') {
            const config = await gtnService.get(interaction.guild.id);
            const game = gtnService.getActiveGame(interaction.guild.id);
            const pingRole = config.pingRoleId || '1551226428371243209';
            const embed = new EmbedBuilder()
                .setColor(0x8b5cf6)
                .setTitle('🎲 Guess The Number System Status')
                .setTimestamp();
            embed.addFields({
                name: '🔒 Dedicated Channel',
                value: config.channelId ? `<#${config.channelId}>` : 'None (runs anywhere)',
                inline: true,
            }, {
                name: '📢 Ping Role',
                value: `<@&${pingRole}>`,
                inline: true,
            }, {
                name: '🪙 Coin Reward',
                value: config.rewardCoins > 0 ? `**${config.rewardCoins} Coins**` : 'Disabled',
                inline: true,
            }, {
                name: '🤖 Auto Mode',
                value: config.autoEnabled
                    ? `🟢 Enabled (${formatDuration(config.autoIntervalMs || 3600000)} interval, 1-${config.maxNumber || 10000})`
                    : '🔴 Disabled',
                inline: true,
            });
            if (game) {
                const lowest = game.lowestGuess !== null ? String(game.lowestGuess) : '1';
                const highest = game.highestGuess !== null ? String(game.highestGuess) : String(game.maxRange);
                embed.addFields({ name: '🟢 Active Game', value: `Running in <#${game.channelId}>`, inline: true }, { name: '👑 Host', value: game.hostId === interaction.client.user?.id ? '🤖 Victus Cloud' : `<@${game.hostId}>`, inline: true }, { name: '📊 Current Range', value: `\`${lowest}\` ⟷ \`${highest}\``, inline: true }, { name: '🎯 Total Guesses', value: `**${game.guessCount}**`, inline: true }, { name: '👥 Participants', value: `**${game.participants.size}**`, inline: true }, { name: '💡 Hints Given', value: `**${game.givenHints.length}**`, inline: true });
            }
            else {
                embed.addFields({
                    name: '⚪ Current Game',
                    value: config.autoEnabled && config.nextAutoGameAt
                        ? `Next auto game starts <t:${Math.floor(config.nextAutoGameAt / 1000)}:R>!`
                        : 'No game is currently active. Start one with `/gtn start` or `/gtn auto`.',
                    inline: false,
                });
            }
            await interaction.reply({ embeds: [embed] });
            return;
        }
        // 9. SUBCOMMAND: LEADERBOARD
        if (subcommand === 'leaderboard') {
            const rawLimit = interaction.options.getInteger?.('limit') ?? prefixArgNumber ?? 10;
            const limit = Math.min(25, Math.max(1, rawLimit));
            const topWinners = await gtnService.getTopWinners(interaction.guild.id, limit);
            const userStats = await gtnService.getUserStats(interaction.guild.id, interaction.user.id);
            const embed = new EmbedBuilder()
                .setColor(0x8b5cf6)
                .setTitle('🎯 Guess The Number Leaderboard')
                .setDescription(`Top champions with the most Guess The Number victories in **${interaction.guild.name}**!\n\n` +
                (topWinners.length > 0
                    ? topWinners
                        .map((p, idx) => {
                        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `\`#${idx + 1}\``;
                        const winStr = `${p.wins} win${p.wins === 1 ? '' : 's'}`;
                        const guessStr = `${p.totalGuesses} guesses`;
                        const lastWin = p.lastWinAt ? ` • Last win <t:${Math.floor(p.lastWinAt / 1000)}:R>` : '';
                        return `${medal} <@${p.userId}> — **${winStr}** (\`${guessStr}\`)${lastWin}`;
                    })
                        .join('\n')
                    : '*No GTN champions recorded yet! Start a game with `/gtn start <number>` or wait for auto GTN.*'))
                .setFooter({
                text: userStats.rank
                    ? `Your Rank: #${userStats.rank} • ${userStats.stats.wins} wins • ${userStats.stats.totalGuesses} total guesses`
                    : 'You have not won any GTN games yet. Keep guessing!',
                iconURL: interaction.user.displayAvatarURL(),
            })
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
            return;
        }
    },
};
