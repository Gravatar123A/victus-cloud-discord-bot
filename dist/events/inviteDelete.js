import { Events } from 'discord.js';
import { removeInvite } from '../services/inviteCache.js';
import { logger } from '../utils/logger.js';
export const inviteDeleteEvent = {
    name: Events.InviteDelete,
    async execute(invite) {
        try {
            if (!invite.guild)
                return;
            removeInvite(invite.guild.id, invite.code);
        }
        catch (error) {
            logger.error('Error executing inviteDelete event:', error);
        }
    },
};
export default inviteDeleteEvent;
