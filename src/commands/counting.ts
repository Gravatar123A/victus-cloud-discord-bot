import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { countingService, CountingConfig } from '../services/countingService.js';

const PALETTE = {
    primary: 0x8b5cf6, // Vibrant Violet
    success: 0x10b981, // Emerald Green
    warning: 0xf59e0b, // Amber
    danger: 0xef4444,  // Rose Red
};

export const countingCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('counting')
        .setDescription('Configure and manage the server counting game')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((sub) =>
            sub
                .setName('enable')
                .setDescription('Enable the counting game in this server')
        )
        .addSubcommand((sub) =>
            sub
                .setName('disable')
                .setDescription('Disable the counting game in this server')
        )
        .addSubcommandGroup((group) =>
            group
                .setName('channel')
                .setDescription('Configure the counting channel')
                .addSubcommand((sub) =>
                    sub
                        .setName('set')
                        .setDescription('Set the designated counting channel')
                        .addChannelOption((opt) =>
                            opt
                                .setName('channel')
                                .setDescription('The channel to use for counting')
                                .addChannelTypes(ChannelType.GuildText)
                                .setRequired(true)
                        )
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('remove')
                        .setDescription('Remove the configured counting channel')
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('config')
                .setDescription('Configure the reset message and reaction emojis')
                .addStringOption((opt) =>
                    opt
                        .setName('reset_message')
                        .setDescription('Message when count is ruined (use {user}, {count}, {highscore})')
                        .setMaxLength(500)
                        .setRequired(false)
                )
                .addStringOption((opt) =>
                    opt
                        .setName('correct_emoji')
                        .setDescription('Emoji reacted on correct number (e.g. ✅, 💎, 🟢)')
                        .setMaxLength(32)
                        .setRequired(false)
                )
                .addStringOption((opt) =>
                    opt
                        .setName('wrong_emoji')
                        .setDescription('Emoji reacted on wrong number (e.g. ❌, 💥, 💀)')
                        .setMaxLength(32)
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('status')
                .setDescription('View current counting status, numbers, and high score')
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guild) {
            await interaction.reply({
                content: '❌ This command can only be used in a server.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const guildId = interaction.guild.id;
        const subGroup = interaction.options.getSubcommandGroup(false);
        const subCommand = interaction.options.getSubcommand();

        // 1. /counting channel set / remove
        if (subGroup === 'channel') {
            if (subCommand === 'set') {
                const targetChannel = interaction.options.getChannel('channel', true, [ChannelType.GuildText]);
                const updated = await countingService.set(guildId, {
                    channelId: targetChannel.id,
                    enabled: true, // auto-enable when channel is chosen
                });

                const embed = new EmbedBuilder()
                    .setColor(PALETTE.success)
                    .setTitle('🔢 Counting Channel Established')
                    .setDescription(
                        `Counting has been bound to <#${targetChannel.id}> and is now **Active**!\n\n` +
                        `› **Next Number to Type:** \`${updated.currentNumber + 1}\`\n` +
                        `› **High Score:** \`${updated.highestScore}\`\n` +
                        `› **Correct Emoji:** ${updated.correctEmoji}\n` +
                        `› **Wrong Emoji:** ${updated.wrongEmoji}`
                    )
                    .setFooter({ text: 'Victus Cloud Counting Engine' })
                    .setTimestamp();

                await interaction.reply({ embeds: [embed] });
                return;
            }

            if (subCommand === 'remove') {
                await countingService.set(guildId, {
                    channelId: null,
                    enabled: false,
                });

                const embed = new EmbedBuilder()
                    .setColor(PALETTE.warning)
                    .setTitle('🔢 Counting Channel Removed')
                    .setDescription('The counting channel binding has been removed and counting is now paused.')
                    .setFooter({ text: 'Victus Cloud Counting Engine' })
                    .setTimestamp();

                await interaction.reply({ embeds: [embed] });
                return;
            }
        }

        // 2. /counting enable
        if (subCommand === 'enable') {
            const current = await countingService.get(guildId);
            const updated = await countingService.set(guildId, { enabled: true });

            const channelNotice = updated.channelId
                ? `Active in <#${updated.channelId}>.`
                : '⚠️ No counting channel is set yet! Set one using `/counting channel set #channel`.';

            const embed = new EmbedBuilder()
                .setColor(PALETTE.success)
                .setTitle('🟢 Counting Game Enabled')
                .setDescription(
                    `The counting system is now **Enabled**!\n\n` +
                    `› **Status:** ${channelNotice}\n` +
                    `› **Current Count:** \`${updated.currentNumber}\` (Next is \`${updated.currentNumber + 1}\`)\n` +
                    `› **All-Time High Score:** \`${updated.highestScore}\``
                )
                .setFooter({ text: 'Victus Cloud Counting Engine' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            return;
        }

        // 3. /counting disable
        if (subCommand === 'disable') {
            const updated = await countingService.set(guildId, { enabled: false });

            const embed = new EmbedBuilder()
                .setColor(PALETTE.danger)
                .setTitle('🔴 Counting Game Disabled')
                .setDescription(
                    `The counting system has been **Disabled**.\n\n` +
                    `Messages in the counting channel will not be processed until re-enabled using \`/counting enable\`.\n` +
                    `Current progress (\`${updated.currentNumber}\`) and high score (\`${updated.highestScore}\`) remain saved.`
                )
                .setFooter({ text: 'Victus Cloud Counting Engine' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            return;
        }

        // 4. /counting config
        if (subCommand === 'config') {
            const resetMsg = interaction.options.getString('reset_message');
            const correctEmoji = interaction.options.getString('correct_emoji');
            const wrongEmoji = interaction.options.getString('wrong_emoji');

            const updates: Partial<CountingConfig> = {};
            if (resetMsg !== null) updates.resetMessage = resetMsg.trim();
            if (correctEmoji !== null) updates.correctEmoji = correctEmoji.trim();
            if (wrongEmoji !== null) updates.wrongEmoji = wrongEmoji.trim();

            const config = Object.keys(updates).length > 0
                ? await countingService.set(guildId, updates)
                : await countingService.get(guildId);

            const embed = new EmbedBuilder()
                .setColor(PALETTE.primary)
                .setTitle('⚙️ Counting System Configuration')
                .setDescription(
                    Object.keys(updates).length > 0
                        ? '✅ **Configuration successfully updated!**'
                        : 'Current counting settings for this server:'
                )
                .addFields(
                    {
                        name: '✅ Correct Reaction Emoji',
                        value: `${config.correctEmoji || '✅'} \`(${config.correctEmoji || '✅'})\``,
                        inline: true,
                    },
                    {
                        name: '❌ Wrong Reaction Emoji',
                        value: `${config.wrongEmoji || '❌'} \`(${config.wrongEmoji || '❌'})\``,
                        inline: true,
                    },
                    {
                        name: '📢 Channel',
                        value: config.channelId ? `<#${config.channelId}>` : '_None configured_',
                        inline: true,
                    },
                    {
                        name: '💥 Reset Message Template',
                        value: `>>> ${config.resetMessage}`,
                        inline: false,
                    },
                    {
                        name: 'ℹ️ Template Variables Supported',
                        value:
                            '• `{user}`: Mentions the perpetrator (`@user`)\n' +
                            '• `{username}`: Plain user tag\n' +
                            '• `{count}`: Number that was reached\n' +
                            '• `{wrong}`: Number that was attempted\n' +
                            '• `{next}`: Next number to start with (`1`)\n' +
                            '• `{highscore}`: All-time record',
                        inline: false,
                    }
                )
                .setFooter({ text: 'Victus Cloud Counting Engine' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            return;
        }

        // 5. /counting status
        if (subCommand === 'status') {
            const config = await countingService.get(guildId);
            const channelText = config.channelId ? `<#${config.channelId}>` : '_None configured_';
            const statusText = config.enabled
                ? (config.channelId ? '🟢 **Active & Listening**' : '🟡 **Enabled (Awaiting channel)**')
                : '🔴 **Disabled**';

            const embed = new EmbedBuilder()
                .setColor(config.enabled ? PALETTE.primary : PALETTE.warning)
                .setTitle('🔢 Counting System Status')
                .setDescription(`Live status and metrics for the **${interaction.guild.name}** counting game.`)
                .addFields(
                    { name: '📡 Status', value: statusText, inline: true },
                    { name: '💬 Channel', value: channelText, inline: true },
                    { name: '🎯 Next Number', value: `**${config.currentNumber + 1}**`, inline: true },
                    { name: '📊 Current Count', value: `\`${config.currentNumber}\``, inline: true },
                    { name: '🏆 High Score', value: `\`${config.highestScore}\``, inline: true },
                    {
                        name: '👤 Last Counter',
                        value: config.lastUserId ? `<@${config.lastUserId}>` : '_None (Next number is 1)_',
                        inline: true,
                    },
                    {
                        name: '🎨 Emojis',
                        value: `Correct: ${config.correctEmoji} • Wrong: ${config.wrongEmoji}`,
                        inline: false,
                    },
                    {
                        name: '📜 Reset Notification',
                        value: `>>> ${config.resetMessage}`,
                        inline: false,
                    }
                )
                .setFooter({ text: 'Victus Cloud Counting Engine' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            return;
        }
    },
};
