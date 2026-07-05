import { ChannelType, Events } from 'discord.js';
import type { GuildMember } from 'discord.js';
import type { Event } from '../types/index.js';
import { welcomeSettings } from '../services/welcomeSettings.js';
import { buildWelcomePayload } from '../commands/welcome.js';
import { logger } from '../utils/logger.js';

export const guildMemberAddEvent: Event = {
    name: Events.GuildMemberAdd,
    async execute(member: GuildMember) {
        try {
            const config = await welcomeSettings.get(member.guild.id);
            if (!config.enabled || !config.channelId) return;

            const channel = member.guild.channels.cache.get(config.channelId);
            if (!channel || channel.type !== ChannelType.GuildText) {
                logger.warn(`Welcome channel ${config.channelId} not found or is not a text channel in guild ${member.guild.id}`);
                return;
            }

            const payload = await buildWelcomePayload(config, member);
            await channel.send(payload).catch((err) => {
                logger.error(`Failed to send welcome message for ${member.user.tag}:`, err);
            });
        } catch (error) {
            logger.error('Error executing guildMemberAdd event:', error);
        }
    }
};
