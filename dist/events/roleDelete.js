import { Events } from 'discord.js';
import { antiNukeService } from '../services/antiNukeService.js';
import { logger } from '../utils/logger.js';
export const roleDeleteEvent = {
    name: Events.GuildRoleDelete,
    async execute(role) {
        if (!role.guild)
            return;
        try {
            await antiNukeService.handleRoleDelete(role);
        }
        catch (error) {
            logger.error('Error executing roleDelete event:', error);
        }
    }
};
export default roleDeleteEvent;
