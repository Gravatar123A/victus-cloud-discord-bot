import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { requireAdmin } from '../middleware/requireLinked.js';
import { logger } from '../utils/logger.js';

export const configCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configure bot settings (Admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub.setName('view')
                .setDescription('View current bot configuration')
        )
        .addSubcommand(sub =>
            sub.setName('role')
                .setDescription('Set the role given to linked users')
                .addRoleOption(opt => opt.setName('role').setDescription('Role to assign').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('logs')
                .setDescription('Set the audit logs channel')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('Channel for audit logs')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))
        ),

    async execute(interaction) {
        if (!interaction.guildId) return;

        // Custom admin check (Linked to Victus Cloud admin)
        const isAdmin = await requireAdmin(interaction);
        if (!isAdmin) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'view') {
                const settings = await supabase.getBotSettings(interaction.guildId);
                const roleId = settings?.linked_role_id || 'Not set';
                const channelId = settings?.log_channel_id || 'Not set';

                const container = ComponentsV2.infoContainer(
                    '⚙️ Bot Configuration',
                    `**Server:** ${interaction.guild?.name}\n\n` +
                    `🔹 **Linked Role:** ${roleId !== 'Not set' ? `<@&${roleId}>` : '`Not set`'}\n` +
                    `🔹 **Audit Logs:** ${channelId !== 'Not set' ? `<#${channelId}>` : '`Not set`'}`
                );

                await interaction.editReply({
                    components: [container],
                    flags: ComponentsV2.IS_COMPONENTS_V2
                });
            }
            else if (subcommand === 'role') {
                const role = interaction.options.getRole('role', true);
                const success = await supabase.updateBotSettings(interaction.guildId, {
                    linked_role_id: role.id
                });

                if (success) {
                    const container = ComponentsV2.successContainer(
                        'Configuration Updated',
                        `Linked role has been set to <@&${role.id}>.`
                    );
                    await interaction.editReply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
                } else {
                    throw new Error('Database update failed');
                }
            }
            else if (subcommand === 'logs') {
                const channel = interaction.options.getChannel('channel', true);
                const success = await supabase.updateBotSettings(interaction.guildId, {
                    log_channel_id: channel.id
                });

                if (success) {
                    const container = ComponentsV2.successContainer(
                        'Configuration Updated',
                        `Audit logs will now be sent to <#${channel.id}>.`
                    );
                    await interaction.editReply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
                } else {
                    throw new Error('Database update failed');
                }
            }
        } catch (error) {
            logger.error('Config command error:', error);
            const container = ComponentsV2.errorContainer(
                'Configuration Error',
                'Failed to update bot settings. Please ensure the bot has proper database access.'
            );
            await interaction.editReply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2
            });
        }
    },
};
