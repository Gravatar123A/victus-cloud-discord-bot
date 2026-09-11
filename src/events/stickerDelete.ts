import { Events } from 'discord.js';
import type { Event } from '../types/index.js';
import { antiNukeService } from '../services/antiNukeService.js';
import { logger } from '../utils/logger.js';

export const stickerDeleteEvent: Event = {
    name: Events.GuildStickerDelete,
    async execute(sticker: any) {
        if (!sticker.guild) return;
        try {
            await antiNukeService.handleStickerDelete(sticker);
        } catch (error) {
            logger.error('Error executing stickerDelete event:', error);
        }
    }
};

export default stickerDeleteEvent;
