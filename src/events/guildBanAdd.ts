import { Events, EmbedBuilder } from 'discord.js';
import type { GuildBan } from 'discord.js';
import type { Event } from '../types/index.js';
import { auditLogSettings } from '../services/auditLogSettings.js';
import { logger } from '../utils/logger.js';

export const guildBanAddEvent: Event = {
    name: Events.GuildBanAdd,
    async execute(ban: GuildBan) {
        try {
            const guildId = ban.guild.id;
            const config = await auditLogSettings.get(guildId);
            if (!config.enabled || !config.channelId || !config.events.includes('ban')) return;

            const logChannel = ban.guild.channels.cache.get(config.channelId);
            if (!logChannel || !logChannel.isTextBased()) return;

            const reason = ban.reason || 'No reason provided';

            const embed = new EmbedBuilder()
                .setColor(0xdc2626) // Dark Red
                .setThumbnail(ban.user.displayAvatarURL())
                .setAuthor({
                    name: ban.user.tag,
                    iconURL: ban.user.displayAvatarURL()
                })
                .setTitle('🔨 Member Banned')
                .setDescription(`**User:** <@${ban.user.id}> (${ban.user.username})\n**ID:** \`${ban.user.id}\``)
                .addFields({ name: 'Reason', value: reason })
                .setTimestamp();

            await (logChannel as any).send({ embeds: [embed] }).catch(() => {});
        } catch (error) {
            logger.error('Error executing guildBanAdd event:', error);
        }
    }
};

export default guildBanAddEvent;
