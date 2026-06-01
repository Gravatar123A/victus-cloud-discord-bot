import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { requireAdmin } from '../middleware/requireLinked.js';
import { logger } from '../utils/logger.js';

export const userCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('user')
        .setDescription('User management commands (Admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addSubcommand(sub =>
            sub.setName('info')
                .setDescription('Check information about a Discord user')
                .addUserOption(opt => opt.setName('target').setDescription('The user to check').setRequired(true))
        ),

    async execute(interaction) {
        // Custom admin check (Linked to Victus Cloud admin)
        const isAdmin = await requireAdmin(interaction);
        if (!isAdmin) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'info') {
                const targetUser = interaction.options.getUser('target', true);

                // Fetch link status
                const linkedAccount = await supabase.getLinkedAccount(targetUser.id);

                let profile = null;
                let servers: any[] = [];
                let history: any[] = [];

                if (linkedAccount) {
                    // Fetch full profile info
                    profile = await supabase.getUserProfile(linkedAccount.user_id);
                    // Fetch user servers
                    servers = await supabase.getServers(); // Enhance this later for specific user filtering
                    // Fetch history
                    history = await supabase.getUserHistory(linkedAccount.user_id);
                }

                const container = ComponentsV2.userInfoContainer(
                    targetUser.tag,
                    targetUser.id,
                    !!linkedAccount,
                    profile,
                    servers,
                    history
                );

                await interaction.editReply({
                    components: [container],
                    flags: ComponentsV2.IS_COMPONENTS_V2
                });
            }
        } catch (error) {
            logger.error('User command error:', error);
            const container = ComponentsV2.errorContainer(
                'Data Fetch Error',
                'An error occurred while retrieving user information.'
            );
            await interaction.editReply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2
            });
        }
    },
};
