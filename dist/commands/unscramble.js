import { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, } from 'discord.js';
import { unscrambleService, parseTimeDuration, formatDuration } from '../services/unscrambleService.js';
export const unscrambleCommand = {
    data: new SlashCommandBuilder()
        .setName('unscramble')
        .setDescription('Manage and play Unscramble The Word games')
        .setDMPermission(false)
        .addSubcommand((sub) => sub
        .setName('start')
        .setDescription('Start an Unscramble The Word round in a channel')
        .addStringOption((opt) => opt
        .setName('word')
        .setDescription('Custom word players must unscramble (leave blank for random word from bank)')
        .setRequired(false))
        .addStringOption((opt) => opt
        .setName('category')
        .setDescription('Category theme for the custom word (e.g. Technology, Gaming)')
        .setRequired(false))
        .addChannelOption((opt) => opt
        .setName('channel')
        .setDescription('Channel to host the game in (defaults to configured arena or current)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)))
        .addSubcommand((sub) => sub
        .setName('auto')
        .setDescription('Configure automated recurring Unscramble rounds (e.g. 10m, 1h, off)')
        .addStringOption((opt) => opt
        .setName('time')
        .setDescription('Delay before next round starts after a win (e.g. 10m, 1h, off to disable)')
        .setRequired(true))
        .addBooleanOption((opt) => opt
        .setName('start_now')
        .setDescription('Immediately start the first automated round now')
        .setRequired(false)))
        .addSubcommand((sub) => sub
        .setName('coins')
        .setDescription('Configure Victus Coins reward for winning Unscramble')
        .addIntegerOption((opt) => opt
        .setName('amount')
        .setDescription('Number of coins to award winner with linked account (0 to disable)')
        .setMinValue(0)
        .setMaxValue(100000)
        .setRequired(true)))
        .addSubcommand((sub) => sub
        .setName('role')
        .setDescription('Configure role pinged when an Unscramble round starts (default: @1551226428371243209)')
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
        .setDescription('Configure or remove dedicated locked Unscramble arena channel')
        .addChannelOption((opt) => opt
        .setName('channel')
        .setDescription('The channel to keep locked until rounds start')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false))
        .addBooleanOption((opt) => opt
        .setName('remove')
        .setDescription('Remove dedicated Unscramble channel configuration')
        .setRequired(false)))
        .addSubcommand((sub) => sub
        .setName('end')
        .setDescription('End or cancel the current active Unscramble game'))
        .addSubcommand((sub) => sub
        .setName('hint')
        .setDescription('Force an immediate hint in the active Unscramble channel'))
        .addSubcommand((sub) => sub
        .setName('status')
        .setDescription('View status of current game, coins, auto schedule, and channel'))
        .addSubcommand((sub) => sub
        .setName('leaderboard')
        .setDescription('View top Unscramble champions in this server')
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
        let subcommand = null;
        try {
            subcommand = interaction.options.getSubcommand(false);
        }
        catch {
            subcommand = null;
        }
        // Support prefix syntax: !unscramble start [word], !scramble auto 10m, !scramble lb
        const rawMessage = interaction.message;
        let prefixWordArg = null;
        let prefixStringArg = null;
        let prefixTargetChannel = null;
        let prefixRoleArg = null;
        let prefixNumberArg = null;
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
                        prefixNumberArg = parseInt(parts[1], 10);
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
                        prefixNumberArg = parseInt(parts[1], 10);
                    }
                }
                else if (first === 'start') {
                    subcommand = 'start';
                    if (parts[1] && !parts[1].startsWith('<#')) {
                        prefixWordArg = parts[1];
                    }
                }
                else {
                    // Default to start if string passed: e.g. !unscramble SERVER
                    subcommand = 'start';
                    if (!first.startsWith('<#')) {
                        prefixWordArg = first;
                    }
                }
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
        if (!subcommand)
            subcommand = 'status';
        // 1. SUBCOMMAND: START
        if (subcommand === 'start') {
            if (!hasStaffPerms) {
                await interaction.reply({
                    content: '⛔ You need **Manage Messages** or **Manage Server** permission to host an Unscramble round.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const customWord = interaction.options.getString?.('word') ?? prefixWordArg ?? undefined;
            const customCategory = interaction.options.getString?.('category') ?? undefined;
            const config = await unscrambleService.get(interaction.guild.id);
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
                    content: '❌ Could not find a valid text channel to host the round.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => { });
            const result = await unscrambleService.startGame(interaction.guild, targetChannel, interaction.user.id, customWord, customCategory);
            if (!result.success) {
                await interaction.editReply({ content: result.message });
                return;
            }
            await interaction.editReply({
                content: `✅ Unscramble round started in <#${targetChannel.id}>!\nScrambled: **${result.game?.scrambledWord}**\nCategory: **${result.game?.category}**`,
            });
            return;
        }
        // 2. SUBCOMMAND: AUTO
        if (subcommand === 'auto') {
            if (!hasStaffPerms) {
                await interaction.reply({
                    content: '⛔ You need **Manage Server** or **Manage Messages** permission to configure automated rounds.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const rawTime = interaction.options.getString?.('time') ?? prefixStringArg ?? '';
            const startNow = interaction.options.getBoolean?.('start_now') ?? false;
            const parsedMs = parseTimeDuration(rawTime);
            if (parsedMs === null) {
                await interaction.reply({
                    content: '❌ Invalid time format! Examples: `10m` (10 minutes), `1h` (1 hour), `30s` (30 seconds), or `off` to disable.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            if (parsedMs === 0) {
                await unscrambleService.set(interaction.guild.id, {
                    autoEnabled: false,
                    nextAutoGameAt: null,
                });
                await interaction.reply({
                    content: '🛑 **Automated Unscramble games have been disabled.** You can still host manual games with `/unscramble start`.',
                });
                return;
            }
            const config = await unscrambleService.get(interaction.guild.id);
            if (!config.channelId && !interaction.channelId) {
                await interaction.reply({
                    content: '⚠️ Please configure a dedicated arena channel first with `/unscramble channel <#channel>`.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const channelId = config.channelId || interaction.channelId;
            await unscrambleService.set(interaction.guild.id, {
                channelId,
                autoEnabled: true,
                autoIntervalMs: parsedMs,
            });
            const durationStr = formatDuration(parsedMs);
            if (startNow && !unscrambleService.getActiveGame(interaction.guild.id)) {
                await interaction.reply({
                    content: `🟢 **Automated Unscramble enabled!** Starting the first round now, and repeating every **${durationStr}** after each round concludes in <#${channelId}>!`,
                });
                await unscrambleService.launchAutoGame(interaction.guild);
            }
            else {
                unscrambleService.scheduleNextAutoGame(interaction.guild, parsedMs);
                await interaction.reply({
                    content: `🟢 **Automated Unscramble enabled!** Next round starts in **${durationStr}** in <#${channelId}>!`,
                });
            }
            return;
        }
        // 3. SUBCOMMAND: COINS
        if (subcommand === 'coins') {
            if (!hasStaffPerms) {
                await interaction.reply({
                    content: '⛔ You need **Manage Server** permission to configure coin rewards.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const amount = interaction.options.getInteger?.('amount') ?? prefixNumberArg ?? 0;
            await unscrambleService.set(interaction.guild.id, { rewardCoins: amount });
            if (amount > 0) {
                await interaction.reply({
                    content: `🪙 **Victus Coins Reward set to ${amount} Coins!** The first player to unscramble each word with a linked account will receive **+${amount} Coins** automatically credited to their balance.`,
                });
            }
            else {
                await interaction.reply({
                    content: '🪙 **Victus Coins reward disabled for Unscramble.** Winners will receive glory and server leaderboard points.',
                });
            }
            return;
        }
        // 4. SUBCOMMAND: ROLE
        if (subcommand === 'role') {
            if (!hasStaffPerms) {
                await interaction.reply({
                    content: '⛔ You need **Manage Server** permission to configure the ping role.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const reset = interaction.options.getBoolean?.('reset') ?? false;
            const targetRole = interaction.options.getRole?.('role') ?? prefixRoleArg;
            if (reset) {
                await unscrambleService.set(interaction.guild.id, { pingRoleId: '1551226428371243209' });
                await interaction.reply({
                    content: '✅ Reset ping role to default `<@&1551226428371243209>`.',
                });
                return;
            }
            if (targetRole) {
                await unscrambleService.set(interaction.guild.id, { pingRoleId: targetRole.id });
                await interaction.reply({
                    content: `✅ Unscramble game notification role updated to <@&${targetRole.id}>!`,
                });
                return;
            }
            const config = await unscrambleService.get(interaction.guild.id);
            await interaction.reply({
                content: `📢 Current notification role is: ${config.pingRoleId ? `<@&${config.pingRoleId}>` : 'None'}. Use \`/unscramble role role:@Role\` to change it.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        // 5. SUBCOMMAND: CHANNEL
        if (subcommand === 'channel') {
            if (!hasStaffPerms) {
                await interaction.reply({
                    content: '⛔ You need **Manage Channels** or **Manage Server** permission to configure arena channels.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const remove = interaction.options.getBoolean?.('remove') ?? false;
            const channelOption = interaction.options.getChannel?.('channel')
                ?? prefixTargetChannel;
            if (remove) {
                const result = await unscrambleService.removeChannel(interaction.guild);
                await interaction.reply({ content: result.message });
                return;
            }
            if (channelOption) {
                await interaction.deferReply();
                const result = await unscrambleService.setChannel(interaction.guild, channelOption);
                await interaction.editReply({ content: result.message });
                return;
            }
            const config = await unscrambleService.get(interaction.guild.id);
            if (config.channelId) {
                await interaction.reply({
                    content: `🔒 Current dedicated Unscramble arena is <#${config.channelId}>. Use \`/unscramble channel channel:#channel\` to change it, or \`remove:true\` to remove it.`,
                    flags: MessageFlags.Ephemeral,
                });
            }
            else {
                await interaction.reply({
                    content: 'ℹ️ No dedicated Unscramble arena is configured. Specify a channel with `/unscramble channel channel:#channel`.',
                    flags: MessageFlags.Ephemeral,
                });
            }
            return;
        }
        // 6. SUBCOMMAND: END
        if (subcommand === 'end') {
            if (!hasStaffPerms) {
                await interaction.reply({
                    content: '⛔ You need **Manage Messages** permission to end an active game.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const result = await unscrambleService.endGame(interaction.guild, interaction.user.id);
            await interaction.reply({ content: result.message });
            return;
        }
        // 7. SUBCOMMAND: HINT
        if (subcommand === 'hint') {
            const game = unscrambleService.getActiveGame(interaction.guild.id);
            if (!game) {
                await interaction.reply({
                    content: '❌ There is no active Unscramble game right now.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const channel = interaction.guild.channels.cache.get(game.channelId);
            if (!channel || !channel.isTextBased()) {
                await interaction.reply({
                    content: '❌ Active game channel could not be found.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const sent = await unscrambleService.sendHint(interaction.guild.id, channel, true);
            if (sent) {
                await interaction.reply({
                    content: `💡 Clue dispatched to <#${channel.id}>!`,
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
            const config = await unscrambleService.get(interaction.guild.id);
            const game = unscrambleService.getActiveGame(interaction.guild.id);
            const pingRole = config.pingRoleId || '1551226428371243209';
            const embed = new EmbedBuilder()
                .setColor(0x06b6d4)
                .setTitle('🔤 Unscramble The Word System Status')
                .setTimestamp();
            embed.addFields({
                name: '🔒 Dedicated Arena',
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
                    ? `🟢 Enabled (${formatDuration(config.autoIntervalMs || 3600000)} interval)`
                    : '🔴 Disabled',
                inline: true,
            });
            if (game) {
                const spaced = game.scrambledWord.split('').join(' ');
                embed.addFields({ name: '🟢 Active Round', value: `Running in <#${game.channelId}>`, inline: true }, { name: '🧩 Scrambled', value: `\`${spaced}\``, inline: true }, { name: '🏷️ Category', value: `\`${game.category}\``, inline: true }, { name: '🎯 Total Guesses', value: `**${game.guessCount}**`, inline: true }, { name: '👥 Participants', value: `**${game.participants.size}**`, inline: true }, { name: '💡 Clues Given', value: `**${game.hintsGiven}**`, inline: true });
            }
            else {
                embed.addFields({
                    name: '⚪ Current Round',
                    value: config.autoEnabled && config.nextAutoGameAt
                        ? `Next auto round starts <t:${Math.floor(config.nextAutoGameAt / 1000)}:R>!`
                        : 'No round is currently active. Start one with `/unscramble start` or `/unscramble auto`.',
                    inline: false,
                });
            }
            await interaction.reply({ embeds: [embed] });
            return;
        }
        // 9. SUBCOMMAND: LEADERBOARD
        if (subcommand === 'leaderboard') {
            const rawLimit = interaction.options.getInteger?.('limit') ?? prefixNumberArg ?? 10;
            const limit = Math.min(25, Math.max(1, rawLimit));
            const topWinners = await unscrambleService.getTopWinners(interaction.guild.id, limit);
            const userStats = await unscrambleService.getUserStats(interaction.guild.id, interaction.user.id);
            const embed = new EmbedBuilder()
                .setColor(0x06b6d4)
                .setTitle('🔤 Unscramble The Word Leaderboard')
                .setDescription(`Top word champions with the most Unscramble victories in **${interaction.guild.name}**!\n\n` +
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
                    : '*No Unscramble champions recorded yet! Start a round with `/unscramble start` or wait for auto rounds.*'))
                .setFooter({
                text: userStats.rank
                    ? `Your Rank: #${userStats.rank} • ${userStats.stats.wins} wins • ${userStats.stats.totalGuesses} total guesses`
                    : 'You have not won any Unscramble rounds yet. Join the fun!',
                iconURL: interaction.user.displayAvatarURL(),
            })
                .setTimestamp();
            await interaction.reply({ embeds: [embed] });
            return;
        }
    },
};
