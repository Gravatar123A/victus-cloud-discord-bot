import { Events } from 'discord.js';
import { antiNukeService } from '../services/antiNukeService.js';
import { logger } from '../utils/logger.js';
export const roleUpdateEvent = {
    name: Events.GuildRoleUpdate,
    async execute(oldRole, newRole) {
        if (!newRole.guild)
            return;
        try {
            await antiNukeService.handleRoleUpdate(oldRole, newRole);
        }
        catch (error) {
            logger.error('Error executing roleUpdate event:', error);
        }
    }
};
export default roleUpdateEvent;
