import { Events, EmbedBuilder } from 'discord.js';
import type { GuildMember } from 'discord.js';
import type { Event } from '../types/index.js';
import { auditLogSettings } from '../services/auditLogSettings.js';
import { logger } from '../utils/logger.js';

export const guildMemberRemoveEvent: Event = {
    name: Events.GuildMemberRemove,
    async execute(member: GuildMember) {
        try {
            const guildId = member.guild.id;
            const config = await auditLogSettings.get(guildId);
            if (!config.enabled || !config.channelId || !config.events.includes('member_leave')) return;

            const logChannel = member.guild.channels.cache.get(config.channelId);
            if (!logChannel || !logChannel.isTextBased()) return;

            const rolesStr = member.roles.cache
                .filter(role => role.name !== '@everyone')
                .map(role => `<@&${role.id}>`)
                .join(', ') || 'None';

            const joinedAt = member.joinedAt 
                ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:f> (<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>)`
                : 'Unknown';

            const embed = new EmbedBuilder()
                .setColor(0xef4444) // Red
                .setThumbnail(member.user.displayAvatarURL())
                .setAuthor({
                    name: member.user.tag,
                    iconURL: member.user.displayAvatarURL()
                })
                .setTitle('📤 Member Left')
                .setDescription(`**User:** <@${member.user.id}> (${member.user.username})\n**ID:** \`${member.user.id}\``)
                .addFields(
                    { name: 'Joined Guild At', value: joinedAt },
                    { name: 'Roles', value: rolesStr }
                )
                .setTimestamp();

            await (logChannel as any).send({ embeds: [embed] }).catch(() => {});
        } catch (error) {
            logger.error('Error executing guildMemberRemove event:', error);
        }
    }
};

export default guildMemberRemoveEvent;
