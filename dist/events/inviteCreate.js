import { Events } from 'discord.js';
import { upsertInvite } from '../services/inviteCache.js';
import { logger } from '../utils/logger.js';
export const inviteCreateEvent = {
    name: Events.InviteCreate,
    async execute(invite) {
        try {
            if (!invite.guild)
                return;
            upsertInvite(invite.guild.id, invite.code, {
                uses: invite.uses ?? 0,
                inviterId: invite.inviterId ?? invite.inviter?.id ?? null,
            });
        }
        catch (error) {
            logger.error('Error executing inviteCreate event:', error);
        }
    },
};
export default inviteCreateEvent;
