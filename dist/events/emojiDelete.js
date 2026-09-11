import { Events } from 'discord.js';
import { antiNukeService } from '../services/antiNukeService.js';
import { logger } from '../utils/logger.js';
export const emojiDeleteEvent = {
    name: Events.GuildEmojiDelete,
    async execute(emoji) {
        if (!emoji.guild)
            return;
        try {
            await antiNukeService.handleEmojiDelete(emoji);
        }
        catch (error) {
            logger.error('Error executing emojiDelete event:', error);
        }
    }
};
export default emojiDeleteEvent;
