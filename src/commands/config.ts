import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { requireAdmin } from '../middleware/requireLinked.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

export const configCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configure bot settings (Admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addSubcommand((sub) =>
            sub
                .setName('view')
                .setDescription('View current bot configuration')
        )
        .addSubcommand((sub) =>
            sub
                .setName('role')
                .setDescription('Set the role given to linked users')
                .addRoleOption((opt) =>
                    opt
                        .setName('role')
                        .setDescription('Role to assign')
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('logs')
                .setDescription('Set the audit logs channel')
                .addChannelOption((opt) =>
                    opt
                        .setName('channel')
                        .setDescription('Channel for audit logs')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('ai-channel')
                .setDescription('Set the channel where AI replies to normal messages')
                .addChannelOption((opt) =>
                    opt
                        .setName('channel')
                        .setDescription('Channel for automatic AI support replies')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('ai-disable')
                .setDescription('Disable automatic AI replies to normal messages')
        ),

    async execute(interaction) {
        if (!interaction.guildId) return;

        const isAdmin = await requireAdmin(interaction);
        if (!isAdmin) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'view') {
                const settings = await supabase.getBotSettings(interaction.guildId);
                const roleId = settings?.linked_role_id || 'Not set';
                const logChannelId = settings?.log_channel_id || 'Not set';
                const aiChannelId = settings?.ai_channel_id || config.bot.aiChannelId || 'Not set';

                const container = ComponentsV2.infoContainer(
                    'Bot Configuration',
                    `**Server:** ${interaction.guild?.name}\n\n` +
                    `**Linked Role:** ${roleId !== 'Not set' ? `<@&${roleId}>` : '`Not set`'}\n` +
                    `**Audit Logs:** ${logChannelId !== 'Not set' ? `<#${logChannelId}>` : '`Not set`'}\n` +
                    `**AI Support Channel:** ${aiChannelId !== 'Not set' ? `<#${aiChannelId}>` : '`Not set`'}\n\n` +
                    `**Auto Register Commands:** ${config.bot.autoRegisterCommands ? '`Enabled`' : '`Disabled`'}`
                );

                await interaction.editReply({
                    components: [container],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
                return;
            }

            if (subcommand === 'role') {
                const role = interaction.options.getRole('role', true);
                const success = await supabase.updateBotSettings(interaction.guildId, {
                    linked_role_id: role.id,
                });

                if (!success) throw new Error('Database update failed');

                await interaction.editReply({
                    components: [
                        ComponentsV2.successContainer(
                            'Configuration Updated',
                            `Linked role has been set to <@&${role.id}>.`
                        ),
                    ],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
                return;
            }

            if (subcommand === 'logs') {
                const channel = interaction.options.getChannel('channel', true);
                const success = await supabase.updateBotSettings(interaction.guildId, {
                    log_channel_id: channel.id,
                });

                if (!success) throw new Error('Database update failed');

                await interaction.editReply({
                    components: [
                        ComponentsV2.successContainer(
                            'Configuration Updated',
                            `Audit logs will now be sent to <#${channel.id}>.`
                        ),
                    ],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
                return;
            }

            if (subcommand === 'ai-channel') {
                const channel = interaction.options.getChannel('channel', true);
                const success = await supabase.updateBotSettings(interaction.guildId, {
                    ai_channel_id: channel.id,
                });

                if (!success) throw new Error('Database update failed');

                await interaction.editReply({
                    components: [
                        ComponentsV2.successContainer(
                            'AI Channel Enabled',
                            `Victus AI will now reply to normal messages in <#${channel.id}>.\n\n` +
                            'Keep this to one focused support channel so it helps users without flooding chat.'
                        ),
                    ],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
                return;
            }

            if (subcommand === 'ai-disable') {
                const success = await supabase.updateBotSettings(interaction.guildId, {
                    ai_channel_id: null,
                });

                if (!success) throw new Error('Database update failed');

                await interaction.editReply({
                    components: [
                        ComponentsV2.successContainer(
                            'AI Channel Disabled',
                            'Victus AI will no longer auto-reply to normal channel messages.'
                        ),
                    ],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
            }
        } catch (error) {
            logger.error('Config command error:', error);
            await interaction.editReply({
                components: [
                    ComponentsV2.errorContainer(
                        'Configuration Error',
                        'Failed to update bot settings. Confirm the bot settings migration is applied and the service role key is valid.'
                    ),
                ],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        }
    },
};
