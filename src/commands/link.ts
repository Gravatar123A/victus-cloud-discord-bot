import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { config } from '../config.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { generateLinkToken, getExpiryTime } from '../utils/tokens.js';
import { assignLinkedRole } from '../utils/roles.js';
import { sendAuditLog, sendNotificationDM } from '../utils/auditing.js';
import { logger } from '../utils/logger.js';

export const linkCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Discord account to Victus Cloud'),

    cooldown: 30, // 30 second cooldown

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

        // Check if already linked
        const existingLink = await supabase.getLinkedAccount(interaction.user.id);
        if (existingLink) {
            const container = ComponentsV2.infoContainer(
                'Already Linked',
                'Your Discord account is already linked to a Victus Cloud account.\n\n' +
                'If you want to link to a different account, first use `/unlink` to remove the current link.'
            );

            await interaction.editReply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        // Generate a secure link token
        const token = generateLinkToken();
        const expiresAt = getExpiryTime(config.bot.linkTokenExpiryMinutes);

        // Store the token
        const linkToken = await supabase.createLinkToken(
            interaction.user.id,
            interaction.user.tag,
            token,
            expiresAt
        );

        if (!linkToken) {
            const container = ComponentsV2.errorContainer(
                'Error',
                'Failed to generate link token. Please try again later.'
            );
            await interaction.editReply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        // Create the link URL
        const linkUrl = `${config.branding.website}/discord-link?token=${token}`;
        const expiryTimestamp = Math.floor(expiresAt.getTime() / 1000);

        // Use Components v2
        const container = ComponentsV2.linkAccountContainer(
            interaction.user.tag,
            interaction.user.displayAvatarURL({ size: 128 }),
            expiryTimestamp,
            linkUrl
        );

        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });

        logger.info(`Link token generated for ${interaction.user.tag} (${interaction.user.id})`);

        // --- Realtime Fallback: Polling ---
        const discordId = interaction.user.id;
        const guildId = interaction.guildId;
        let attempts = 0;
        const maxAttempts = 30; // 30 * 10s = 5 minutes

        const pollInterval = setInterval(async () => {
            attempts++;
            if (attempts > maxAttempts) {
                clearInterval(pollInterval);
                return;
            }

            const linked = await supabase.getLinkedAccount(discordId);
            if (linked) {
                clearInterval(pollInterval);
                logger.info(`✨ Polling: Account link detected for ${discordId}`);

                // 1. Assign Role
                const roleSuccess = await assignLinkedRole(interaction.client, discordId);

                // 2. Send DM Notification
                const dmContainer = ComponentsV2.successContainer(
                    '🎉 Account Successfully Linked!',
                    'Your Discord account has been linked to Victus Cloud.\n\n' +
                    'You now have access to server management commands!'
                );
                await sendNotificationDM(interaction.client, discordId, dmContainer);

                // 3. Send Audit Log
                if (guildId) {
                    await sendAuditLog(
                        interaction.client,
                        guildId,
                        'Account Linked (Fallback)',
                        `👤 **User:** <@${discordId}> (\`${discordId}\`)\n` +
                        `🔗 **Status:** ${roleSuccess ? '✅ Role Assigned' : '⚠️ User not in server'}`,
                        ComponentsV2.Accents.success
                    );
                }
            }
        }, 10000); // Check every 10 seconds
    },
};
