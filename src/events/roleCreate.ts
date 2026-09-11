import { Events } from 'discord.js';
import type { Event } from '../types/index.js';
import { antiNukeService } from '../services/antiNukeService.js';
import { logger } from '../utils/logger.js';

export const roleCreateEvent: Event = {
    name: Events.GuildRoleCreate,
    async execute(role: any) {
        if (!role.guild) return;
        try {
            await antiNukeService.handleRoleCreate(role);
        } catch (error) {
            logger.error('Error executing roleCreate event:', error);
        }
    }
};

export default roleCreateEvent;
