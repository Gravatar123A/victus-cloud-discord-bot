import { Events } from 'discord.js';
import { antiNukeService } from '../services/antiNukeService.js';
import { logger } from '../utils/logger.js';
export const roleCreateEvent = {
    name: Events.GuildRoleCreate,
    async execute(role) {
        if (!role.guild)
            return;
        try {
            await antiNukeService.handleRoleCreate(role);
        }
        catch (error) {
            logger.error('Error executing roleCreate event:', error);
        }
    }
};
export default roleCreateEvent;
