import { Events } from 'discord.js';
import type { Invite } from 'discord.js';
import type { Event } from '../types/index.js';
import { upsertInvite } from '../services/inviteCache.js';
import { logger } from '../utils/logger.js';

export const inviteCreateEvent: Event = {
    name: Events.InviteCreate,
    async execute(invite: Invite) {
        try {
            if (!invite.guild) return;
            upsertInvite(invite.guild.id, invite.code, {
                uses: invite.uses ?? 0,
                inviterId: invite.inviterId ?? invite.inviter?.id ?? null,
            });
        } catch (error) {
            logger.error('Error executing inviteCreate event:', error);
        }
    },
};

export default inviteCreateEvent;
