import { Events } from 'discord.js';
import { removeInvite } from '../services/inviteCache.js';
import { inviteService } from '../services/inviteService.js';
import { logger } from '../utils/logger.js';
export const inviteDeleteEvent = {
    name: Events.InviteDelete,
    async execute(invite) {
        try {
            if (!invite.guild)
                return;
            removeInvite(invite.guild.id, invite.code);
            inviteService.invalidateCache(invite.guild.id);
        }
        catch (error) {
            logger.error('Error executing inviteDelete event:', error);
        }
    },
};
export default inviteDeleteEvent;
