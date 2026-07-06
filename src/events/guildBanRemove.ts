import { Events, EmbedBuilder } from 'discord.js';
import type { GuildBan } from 'discord.js';
import type { Event } from '../types/index.js';
import { auditLogSettings } from '../services/auditLogSettings.js';
import { logger } from '../utils/logger.js';

export const guildBanRemoveEvent: Event = {
    name: Events.GuildBanRemove,
    async execute(ban: GuildBan) {
        try {
            const guildId = ban.guild.id;
            const config = await auditLogSettings.get(guildId);
            if (!config.enabled || !config.channelId || !config.events.includes('unban')) return;

            const logChannel = ban.guild.channels.cache.get(config.channelId);
            if (!logChannel || !logChannel.isTextBased()) return;

            const embed = new EmbedBuilder()
                .setColor(0x10b981) // Green
                .setThumbnail(ban.user.displayAvatarURL())
                .setAuthor({
                    name: ban.user.tag,
                    iconURL: ban.user.displayAvatarURL()
                })
                .setTitle('🔓 Member Unbanned')
                .setDescription(`**User:** <@${ban.user.id}> (${ban.user.username})\n**ID:** \`${ban.user.id}\``)
                .setTimestamp();

            await (logChannel as any).send({ embeds: [embed] }).catch(() => {});
        } catch (error) {
            logger.error('Error executing guildBanRemove event:', error);
        }
    }
};

export default guildBanRemoveEvent;
