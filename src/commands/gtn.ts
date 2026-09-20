import {
    ChannelType,
    ChatInputCommandInteraction,
    EmbedBuilder,
    GuildTextBasedChannel,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { gtnService } from '../services/gtnService.js';
import { logger } from '../utils/logger.js';

export const gtnCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('gtn')
        .setDescription('Manage and play Guess The Number games')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addSubcommand((sub) =>
            sub
                .setName('start')
                .setDescription('Start a Guess The Number game in a channel')
                .addIntegerOption((opt) =>
                    opt
                        .setName('number')
                        .setDescription('The secret number players must guess')
                        .setRequired(true)
                )
                .addChannelOption((opt) =>
                    opt
                        .setName('channel')
                        .setDescription('Channel to host the game in (defaults to GTN channel or current)')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('channel')
                .setDescription('Configure or remove the dedicated locked GTN channel')
                .addChannelOption((opt) =>
                    opt
                        .setName('channel')
                        .setDescription('The channel to keep locked until GTN games start')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
                .addBooleanOption((opt) =>
                    opt
                        .setName('remove')
                        .setDescription('Remove the dedicated GTN channel configuration')
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('end')
                .setDescription('End or cancel the current Guess The Number game')
        )
        .addSubcommand((sub) =>
            sub
                .setName('hint')
                .setDescription('Force an immediate hint in the active GTN channel')
        )
        .addSubcommand((sub) =>
            sub
                .setName('status')
                .setDescription('View status of the current game or channel setup')
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guild) {
            await interaction.reply({
                content: '❌ This command can only be used inside a server.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const member = interaction.guild.members.cache.get(interaction.user.id);
        const hasStaffPerms = !!member && (
            member.permissions.has(PermissionFlagsBits.ManageMessages) ||
            member.permissions.has(PermissionFlagsBits.ManageGuild) ||
            member.permissions.has(PermissionFlagsBits.Administrator)
        );

        // Resolve subcommand safely (handles both slash command and prefix interactions)
        let subcommand: string | null = null;
        try {
            subcommand = interaction.options.getSubcommand(false);
        } catch {
            subcommand = null;
        }

        // Support prefix syntax: e.g. !gtn 42, !gtn 42 #channel, !gtn channel #channel, !gtn end
        const rawMessage = (interaction as any).message;
        let prefixArgNumber: number | null = null;
        let prefixTargetChannel: GuildTextBasedChannel | null = null;

        if (!subcommand && rawMessage?.content) {
            const parts = rawMessage.content.trim().split(/\s+/).slice(1);
            if (parts.length > 0) {
                const first = parts[0].toLowerCase();
                if (first === 'channel') {
                    subcommand = 'channel';
                } else if (first === 'end' || first === 'cancel' || first === 'stop') {
                    subcommand = 'end';
                } else if (first === 'hint') {
                    subcommand = 'hint';
                } else if (first === 'status') {
                    subcommand = 'status';
                } else if (first === 'start') {
                    subcommand = 'start';
                    if (parts[1] && /^-?\d+$/.test(parts[1])) {
                        prefixArgNumber = parseInt(parts[1], 10);
                    }
                } else if (/^-?\d+$/.test(first)) {
                    // Direct number: e.g. !gtn 42 #events
                    subcommand = 'start';
                    prefixArgNumber = parseInt(first, 10);
                }

                // Check for channel mention in args
                const channelMention = parts.find((p: string) => /<#(\d+)>/.test(p));
                if (channelMention) {
                    const match = channelMention.match(/\d+/);
                    if (match) {
                        const ch = interaction.guild.channels.cache.get(match[0]);
                        if (ch && ch.isTextBased()) {
                            prefixTargetChannel = ch as GuildTextBasedChannel;
                        }
                    }
                }
            }
        }

        // Default to status if no subcommand determined
        if (!subcommand) subcommand = 'status';

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
            let targetChannel = (interaction.options.getChannel?.('channel') as GuildTextBasedChannel)
                ?? prefixTargetChannel;

            if (!targetChannel) {
                if (config.channelId) {
                    const configured = interaction.guild.channels.cache.get(config.channelId);
                    if (configured && configured.isTextBased()) {
                        targetChannel = configured as GuildTextBasedChannel;
                    }
                }
            }

            if (!targetChannel) {
                targetChannel = interaction.channel as GuildTextBasedChannel;
            }

            if (!targetChannel || !targetChannel.isTextBased()) {
                await interaction.reply({
                    content: '❌ Could not find a valid text channel to host the game.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            // If triggered via prefix, delete host's message so secret number is hidden!
            if (rawMessage && typeof rawMessage.delete === 'function') {
                await rawMessage.delete().catch(() => {});
            }

            const result = await gtnService.startGame(
                interaction.guild,
                targetChannel,
                interaction.user.id,
                rawSecret
            );

            if (!result.success) {
                await interaction.reply({
                    content: result.message,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            // Ephemeral confirmation so the secret number is NEVER leaked!
            await interaction.reply({
                content: `✅ **GTN Game Started!** Secret number **${rawSecret}** set in <#${targetChannel.id}>. Channel is now unlocked!`,
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
        }

        // 2. SUBCOMMAND: CHANNEL
        if (subcommand === 'channel') {
            if (!hasStaffPerms) {
                await interaction.reply({
                    content: '⛔ You need the **Manage Server** permission to configure the GTN channel.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const removeOption = interaction.options.getBoolean?.('remove') ?? false;
            const channelOption = (interaction.options.getChannel?.('channel') as GuildTextBasedChannel)
                ?? prefixTargetChannel;

            // Check if prefix had "remove"
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

            // Neither channel nor remove provided -> show current channel config
            const config = await gtnService.get(interaction.guild.id);
            if (config.channelId) {
                await interaction.reply({
                    content: `🔒 The current dedicated GTN event channel is <#${config.channelId}>.\nUse \`/gtn channel channel:<#channel>\` to change it or \`/gtn channel remove:True\` to remove it.`,
                    flags: MessageFlags.Ephemeral,
                });
            } else {
                await interaction.reply({
                    content: 'ℹ️ No dedicated GTN channel is currently set. Run `/gtn channel channel:<#channel>` to lock a channel for GTN events.',
                    flags: MessageFlags.Ephemeral,
                });
            }
            return;
        }

        // 3. SUBCOMMAND: END / CANCEL
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

        // 4. SUBCOMMAND: HINT
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

            const channel = interaction.guild.channels.cache.get(game.channelId) as GuildTextBasedChannel | undefined;
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
            } else {
                await interaction.reply({
                    content: '⚠️ Unable to generate or send a hint at this time.',
                    flags: MessageFlags.Ephemeral,
                });
            }
            return;
        }

        // 5. SUBCOMMAND: STATUS
        if (subcommand === 'status') {
            const config = await gtnService.get(interaction.guild.id);
            const game = gtnService.getActiveGame(interaction.guild.id);

            const embed = new EmbedBuilder()
                .setColor(0x8b5cf6)
                .setTitle('🎲 Guess The Number Status')
                .setTimestamp();

            if (config.channelId) {
                embed.addFields({ name: '🔒 Dedicated GTN Channel', value: `<#${config.channelId}>`, inline: true });
            } else {
                embed.addFields({ name: '🔒 Dedicated GTN Channel', value: 'None set (runs anywhere)', inline: true });
            }

            if (game) {
                const lowest = game.lowestGuess !== null ? String(game.lowestGuess) : '?';
                const highest = game.highestGuess !== null ? String(game.highestGuess) : '?';
                embed.addFields(
                    { name: '🟢 Active Game', value: `Running in <#${game.channelId}>`, inline: true },
                    { name: '👑 Host', value: `<@${game.hostId}>`, inline: true },
                    { name: '📊 Current Range', value: `\`${lowest}\` ⟷ \`${highest}\``, inline: true },
                    { name: '🎯 Total Guesses', value: `**${game.guessCount}**`, inline: true },
                    { name: '👥 Participants', value: `**${game.participants.size}**`, inline: true },
                    { name: '💡 Hints Given', value: `**${game.givenHints.length}**`, inline: true }
                );
            } else {
                embed.addFields({
                    name: '⚪ Game State',
                    value: 'No game is currently active. Start one with `/gtn start <number>`.',
                    inline: false,
                });
            }

            await interaction.reply({ embeds: [embed] });
            return;
        }
    },
};
