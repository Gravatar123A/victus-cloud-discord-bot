import { Client, TextChannel, MessageFlags } from 'discord.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from './logger.js';

/**
 * Send an audit log message to the configured log channel
 */
export async function sendAuditLog(
    client: Client,
    guildId: string,
    title: string,
    description: string,
    accent: number = ComponentsV2.Accents.info
): Promise<void> {
    try {
        const settings = await supabase.getBotSettings(guildId);
        const logChannelId = settings?.log_channel_id;

        if (!logChannelId) {
            logger.debug(`No log channel configured for guild ${guildId}`);
            return;
        }

        const channel = await client.channels.fetch(logChannelId).catch(() => null);
        if (!channel || !(channel instanceof TextChannel)) {
            logger.warn(`Log channel ${logChannelId} not found or not a text channel`);
            return;
        }

        const container = ComponentsV2.baseContainer(accent)
            .addTextDisplayComponents(ComponentsV2.text(`# 📜 Audit Log: ${title}\n\n${description}`));

        await channel.send({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2
        });
    } catch (error) {
        logger.error('Failed to send audit log:', error);
    }
}

/**
 * Send a notification DM to a user
 */
export async function sendNotificationDM(
    client: Client,
    discordId: string,
    container: any // ContainerBuilder
): Promise<void> {
    try {
        const user = await client.users.fetch(discordId).catch(() => null);
        if (!user) {
            logger.warn(`Could not fetch user ${discordId} to send DM`);
            return;
        }

        await user.send({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2
        });
        logger.info(`Notification DM sent to ${user.tag} (${discordId})`);
    } catch (error) {
        logger.warn(`Failed to send DM to ${discordId} (DMs might be closed):`, error);
    }
}
