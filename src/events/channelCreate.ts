import { Events } from 'discord.js';
import type { Event } from '../types/index.js';
import { antiNukeService } from '../services/antiNukeService.js';
import { logger } from '../utils/logger.js';

export const channelCreateEvent: Event = {
    name: Events.ChannelCreate,
    async execute(channel: any) {
        if (!channel.guild) return;
        try {
            await antiNukeService.handleChannelCreate(channel);
        } catch (error) {
            logger.error('Error executing channelCreate event:', error);
        }
    }
};

export default channelCreateEvent;
