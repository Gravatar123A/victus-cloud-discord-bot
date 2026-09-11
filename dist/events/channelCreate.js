import { Events } from 'discord.js';
import { antiNukeService } from '../services/antiNukeService.js';
import { logger } from '../utils/logger.js';
export const channelCreateEvent = {
    name: Events.ChannelCreate,
    async execute(channel) {
        if (!channel.guild)
            return;
        try {
            await antiNukeService.handleChannelCreate(channel);
        }
        catch (error) {
            logger.error('Error executing channelCreate event:', error);
        }
    }
};
export default channelCreateEvent;
