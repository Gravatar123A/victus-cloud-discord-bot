import { Events } from 'discord.js';
import type { Invite } from 'discord.js';
import type { Event } from '../types/index.js';
import { removeInvite } from '../services/inviteCache.js';
import { logger } from '../utils/logger.js';

export const inviteDeleteEvent: Event = {
    name: Events.InviteDelete,
    async execute(invite: Invite) {
        try {
            if (!invite.guild) return;
            removeInvite(invite.guild.id, invite.code);
        } catch (error) {
            logger.error('Error executing inviteDelete event:', error);
        }
    },
};

export default inviteDeleteEvent;
