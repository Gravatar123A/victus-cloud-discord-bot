import { ChannelType, Events, EmbedBuilder } from 'discord.js';
import type { GuildMember } from 'discord.js';
import type { Event } from '../types/index.js';
import { welcomeSettings } from '../services/welcomeSettings.js';
import { buildWelcomePayload } from '../commands/welcome.js';
import { auditLogSettings } from '../services/auditLogSettings.js';
import { logger } from '../utils/logger.js';

export const guildMemberAddEvent: Event = {
    name: Events.GuildMemberAdd,
    async execute(member: GuildMember) {
        try {
            // Welcome system
            const config = await welcomeSettings.get(member.guild.id);
            if (config.enabled && config.channelId) {
                const channel = member.guild.channels.cache.get(config.channelId);
                if (channel && channel.type === ChannelType.GuildText) {
                    const payload = await buildWelcomePayload(config, member);
                    await channel.send(payload).catch((err) => {
                        logger.error(`Failed to send welcome message for ${member.user.tag}:`, err);
                    });
                }
            }

            // Assign Auto-Roles
            if (config.autoRoleIds && config.autoRoleIds.length > 0) {
                const rolesToAssign = config.autoRoleIds.filter(id => member.guild.roles.cache.has(id));
                if (rolesToAssign.length > 0) {
                    await member.roles.add(rolesToAssign).catch((err) => {
                        logger.error(`Failed to assign auto-roles to ${member.user.tag}:`, err);
                    });
                }
            }

            // Audit logging join event
            const auditConfig = await auditLogSettings.get(member.guild.id);
            if (auditConfig.enabled && auditConfig.channelId && auditConfig.events.includes('member_join')) {
                const logChannel = member.guild.channels.cache.get(auditConfig.channelId);
                if (logChannel && logChannel.isTextBased()) {
                    const accountAge = `<t:${Math.floor(member.user.createdTimestamp / 1000)}:f> (<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>)`;
                    const embed = new EmbedBuilder()
                        .setColor(0x10b981) // Green
                        .setThumbnail(member.user.displayAvatarURL())
                        .setAuthor({
                            name: member.user.tag,
                            iconURL: member.user.displayAvatarURL()
                        })
                        .setTitle('📥 Member Joined')
                        .setDescription(`**User:** <@${member.user.id}> (${member.user.username})\n**ID:** \`${member.user.id}\``)
                        .addFields(
                            { name: 'Account Creation Date', value: accountAge }
                        )
                        .setTimestamp();

                    await (logChannel as any).send({ embeds: [embed] }).catch(() => {});
                }
            }
        } catch (error) {
            logger.error('Error executing guildMemberAdd event:', error);
        }
    }
};
