import { Events } from 'discord.js';
import type { Event } from '../types/index.js';
import { antiNukeService } from '../services/antiNukeService.js';
import { logger } from '../utils/logger.js';

export const roleDeleteEvent: Event = {
    name: Events.GuildRoleDelete,
    async execute(role: any) {
        if (!role.guild) return;
        try {
            await antiNukeService.handleRoleDelete(role);
        } catch (error) {
            logger.error('Error executing roleDelete event:', error);
        }
    }
};

export default roleDeleteEvent;
