import { Events } from 'discord.js';
import { antiNukeService } from '../services/antiNukeService.js';
import { logger } from '../utils/logger.js';
export const guildUpdateEvent = {
    name: Events.GuildUpdate,
    async execute(oldGuild, newGuild) {
        try {
            await antiNukeService.handleGuildUpdate(oldGuild, newGuild);
        }
        catch (error) {
            logger.error('Error executing guildUpdate event:', error);
        }
    }
};
export default guildUpdateEvent;
