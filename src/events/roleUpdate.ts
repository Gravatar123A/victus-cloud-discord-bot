import { Events } from 'discord.js';
import type { Event } from '../types/index.js';
import { antiNukeService } from '../services/antiNukeService.js';
import { logger } from '../utils/logger.js';

export const roleUpdateEvent: Event = {
    name: Events.GuildRoleUpdate,
    async execute(oldRole: any, newRole: any) {
        if (!newRole.guild) return;
        try {
            await antiNukeService.handleRoleUpdate(oldRole, newRole);
        } catch (error) {
            logger.error('Error executing roleUpdate event:', error);
        }
    }
};

export default roleUpdateEvent;
