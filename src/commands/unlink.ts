import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ContainerBuilder,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { removeLinkedRole } from '../utils/roles.js';
import { logger } from '../utils/logger.js';
import { sendAuditLog, sendNotificationDM } from '../utils/auditing.js';

export const unlinkCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('unlink')
        .setDescription('Unlink your Discord account from Victus Cloud'),

    cooldown: 10,

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

        // Check if linked
        const existingLink = await supabase.getLinkedAccount(interaction.user.id);
        if (!existingLink) {
            const container = ComponentsV2.infoContainer(
                'Not Linked',
                'Your Discord account is not linked to any Victus Cloud account.\n\n' +
                'Use `/link` to connect your account.'
            );
            await interaction.editReply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        const container = new ContainerBuilder()
            .setAccentColor(ComponentsV2.Accents.warning)
            .addTextDisplayComponents(
                ComponentsV2.text(
                    `# ⚠️ Confirm Unlink\n\n` +
                    `Are you sure you want to unlink your Discord account from Victus Cloud?\n\n` +
                    `**You will lose access to:**\n` +
                    `• Managing servers from Discord\n` +
                    `• Viewing billing information\n` +
                    `• Server notifications\n` +
                    `• Your linked member role`
                )
            );

        const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('unlink_confirm')
                .setLabel('Unlink Account')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔓'),
            new ButtonBuilder()
                .setCustomId('unlink_cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        container.addActionRowComponents(buttons);

        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    },

    async handleButton(interaction) {
        if (!interaction.customId.startsWith('unlink_')) return;

        if (interaction.customId === 'unlink_cancel') {
            const container = ComponentsV2.infoContainer(
                'Cancelled',
                'Your account remains linked to Victus Cloud.'
            );
            await interaction.update({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        if (interaction.customId === 'unlink_confirm') {
            await interaction.deferUpdate();

            const success = await supabase.unlinkAccount(interaction.user.id);

            if (success) {
                // Remove linked role
                await removeLinkedRole(interaction.client, interaction.user.id);

                const container = ComponentsV2.successContainer(
                    'Account Unlinked',
                    'Your Discord account has been unlinked from Victus Cloud.\n\n' +
                    'You can link again anytime using `/link`.'
                );
                await interaction.editReply({
                    components: [container],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });

                // Send DM Notification
                await sendNotificationDM(interaction.client, interaction.user.id, container, 'security');

                // Send Audit Log
                if (interaction.guildId) {
                    await sendAuditLog(
                        interaction.client,
                        interaction.guildId,
                        'Account Unlinked',
                        `👤 **User:** ${interaction.user.tag} (\`${interaction.user.id}\`)\n` +
                        `🔓 **Action:** Manual Unlink via command`,
                        ComponentsV2.Accents.warning
                    );
                }

                logger.info(`Account unlinked: ${interaction.user.tag} (${interaction.user.id})`);
            } else {
                const container = ComponentsV2.errorContainer(
                    'Error',
                    'Failed to unlink account. Please try again later.'
                );
                await interaction.editReply({
                    components: [container],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
            }
        }
    },
};
