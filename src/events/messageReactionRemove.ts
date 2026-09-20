import { MessageReaction, PartialMessageReaction, User, PartialUser } from 'discord.js';
import type { Event } from '../types/index.js';
import { reactRolesSettings, matchEmoji } from '../services/reactRolesSettings.js';
import { logger } from '../utils/logger.js';

export const messageReactionRemoveEvent: Event = {
    name: 'messageReactionRemove',
    async execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
        if (user.bot) return;

        // Fetch partial reaction and user if needed
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (err) {
                logger.debug('[ReactRoles] Failed to fetch partial reaction:', err);
                return;
            }
        }

        if (user.partial) {
            try {
                await user.fetch();
            } catch (err) {
                logger.debug('[ReactRoles] Failed to fetch partial user:', err);
                return;
            }
        }

        const message = reaction.message;
        if (!message.guild) return;

        const config = await reactRolesSettings.get(message.guild.id);
        if (!config.reactionRoles || config.reactionRoles.length === 0) return;

        const match = config.reactionRoles.find(
            (rr) => rr.messageId === message.id && matchEmoji(rr.emoji, reaction.emoji)
        );

        if (!match) return;

        try {
            const member = await message.guild.members.fetch(user.id).catch(() => null);
            if (!member) return;

            const targetRole = message.guild.roles.cache.get(match.roleId);
            if (!targetRole) return;

            const botMember = message.guild.members.me;
            if (botMember && targetRole.position >= botMember.roles.highest.position) {
                logger.warn(`[ReactRoles] Cannot remove role ${targetRole.name} - bot role is lower in hierarchy.`);
                return;
            }

            if (member.roles.cache.has(match.roleId)) {
                await member.roles.remove(match.roleId, 'Reaction Role: Removed via emoji unreaction');
                logger.info(`[ReactRoles] Removed role @${targetRole.name} from ${user.tag} in ${message.guild.name}`);
                
                await user.send({
                    content: `❌ The **@${targetRole.name}** role was removed from you in **${message.guild.name}**.`,
                }).catch(() => {});
            }
        } catch (err) {
            logger.error(`[ReactRoles] Failed to remove role ${match.roleId} from ${user.id}:`, err);
        }
    },
};
