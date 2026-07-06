import { Events, EmbedBuilder } from 'discord.js';
import type { Message } from 'discord.js';
import type { Event } from '../types/index.js';
import { auditLogSettings } from '../services/auditLogSettings.js';
import { logger } from '../utils/logger.js';

export const messageUpdateEvent: Event = {
    name: Events.MessageUpdate,
    async execute(oldMessage: Message, newMessage: Message) {
        try {
            if (newMessage.author?.bot) return;
            if (oldMessage.content === newMessage.content) return;

            const guildId = newMessage.guildId;
            if (!guildId) return;

            const config = await auditLogSettings.get(guildId);
            if (!config.enabled || !config.channelId || !config.events.includes('message_edit')) return;

            const logChannel = newMessage.guild?.channels.cache.get(config.channelId);
            if (!logChannel || !logChannel.isTextBased()) return;

            const oldContent = oldMessage.content || '*None*';
            const newContent = newMessage.content || '*None*';

            const embed = new EmbedBuilder()
                .setColor(0xf59e0b) // Amber
                .setAuthor({
                    name: newMessage.author?.tag || 'Unknown User',
                    iconURL: newMessage.author?.displayAvatarURL()
                })
                .setTitle('📝 Message Edited')
                .setDescription(`**User:** <@${newMessage.author?.id}> (${newMessage.author?.id})\n**Channel:** <#${newMessage.channelId}>`)
                .addFields(
                    { name: 'Before', value: oldContent.slice(0, 1000) || '*Empty*' },
                    { name: 'After', value: newContent.slice(0, 1000) || '*Empty*' }
                )
                .setTimestamp()
                .setFooter({ text: `Message ID: ${newMessage.id}` });

            await (logChannel as any).send({ embeds: [embed] }).catch(() => {});
        } catch (error) {
            logger.error('Error executing messageUpdate event:', error);
        }
    }
};

export default messageUpdateEvent;
