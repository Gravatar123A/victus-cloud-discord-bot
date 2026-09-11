import { Events } from 'discord.js';
import type { Event } from '../types/index.js';
import { antiNukeService } from '../services/antiNukeService.js';
import { logger } from '../utils/logger.js';

export const guildUpdateEvent: Event = {
    name: Events.GuildUpdate,
    async execute(oldGuild: any, newGuild: any) {
        try {
            await antiNukeService.handleGuildUpdate(oldGuild, newGuild);
        } catch (error) {
            logger.error('Error executing guildUpdate event:', error);
        }
    }
};

export default guildUpdateEvent;
