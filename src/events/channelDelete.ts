import { Events } from 'discord.js';
import type { Event } from '../types/index.js';
import { warnSettings } from '../services/warnSettings.js';
import { antiNukeService } from '../services/antiNukeService.js';
import { logger } from '../utils/logger.js';

export const channelDeleteEvent: Event = {
    name: Events.ChannelDelete,
    async execute(channel: any) {
        if (channel.partial) return;
        if (!channel.guild) return;

        try {
            // 1. Process Anti-Nuke protection first
            await antiNukeService.handleChannelDelete(channel);

            // 2. Handle original warn log channel recreation mapping
            const guildId = channel.guild.id;
            const config = await warnSettings.get(guildId);

            if (config.warnChannelId === channel.id) {
                logger.info(`Warn channel ${channel.id} was deleted in guild ${guildId}. Aligning warn settings to recreated channel...`);
                // Find the newly recreated channel (restored by antiNukeService) and update references
                const newChannel = channel.guild.channels.cache.find((c: any) => c.name === channel.name && c.id !== channel.id);
                if (newChannel) {
                    await warnSettings.set(guildId, { warnChannelId: newChannel.id });
                }
            }
        } catch (error) {
            logger.error('Error executing channelDelete event:', error);
        }
    }
};

export default channelDeleteEvent;
