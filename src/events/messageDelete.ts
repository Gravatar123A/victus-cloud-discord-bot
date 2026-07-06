import { Events, EmbedBuilder } from 'discord.js';
import type { Message } from 'discord.js';
import type { Event } from '../types/index.js';
import { auditLogSettings } from '../services/auditLogSettings.js';
import { logger } from '../utils/logger.js';

export const messageDeleteEvent: Event = {
    name: Events.MessageDelete,
    async execute(message: Message) {
        try {
            if (message.author?.bot) return;

            const guildId = message.guildId;
            if (!guildId) return;

            const config = await auditLogSettings.get(guildId);
            if (!config.enabled || !config.channelId || !config.events.includes('message_delete')) return;

            const logChannel = message.guild?.channels.cache.get(config.channelId);
            if (!logChannel || !logChannel.isTextBased()) return;

            const content = message.content || '*No text content (attachments or embeds only)*';

            const embed = new EmbedBuilder()
                .setColor(0xef4444) // Red
                .setAuthor({
                    name: message.author?.tag || 'Unknown User',
                    iconURL: message.author?.displayAvatarURL()
                })
                .setTitle('🗑️ Message Deleted')
                .setDescription(`**User:** <@${message.author?.id}> (${message.author?.id})\n**Channel:** <#${message.channelId}>`)
                .addFields({ name: 'Content', value: content.slice(0, 1024) })
                .setTimestamp()
                .setFooter({ text: `Message ID: ${message.id}` });

            await (logChannel as any).send({ embeds: [embed] }).catch(() => {});
        } catch (error) {
            logger.error('Error executing messageDelete event:', error);
        }
    }
};

export default messageDeleteEvent;
