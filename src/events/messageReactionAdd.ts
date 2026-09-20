import { MessageReaction, PartialMessageReaction, User, PartialUser } from 'discord.js';
import type { Event } from '../types/index.js';
import { reactRolesSettings, matchEmoji } from '../services/reactRolesSettings.js';
import { logger } from '../utils/logger.js';

export const messageReactionAddEvent: Event = {
    name: 'messageReactionAdd',
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

            // Check if bot can assign this role
            const botMember = message.guild.members.me;
            if (botMember && targetRole.position >= botMember.roles.highest.position) {
                logger.warn(`[ReactRoles] Cannot assign role ${targetRole.name} - bot role is lower in hierarchy.`);
                return;
            }

            if (!member.roles.cache.has(match.roleId)) {
                await member.roles.add(match.roleId, 'Reaction Role: Added via emoji reaction');
                logger.info(`[ReactRoles] Added role @${targetRole.name} to ${user.tag} in ${message.guild.name}`);
                
                await user.send({
                    content: `✅ You have been assigned the **@${targetRole.name}** role in **${message.guild.name}**!`,
                }).catch(() => {});
            }
        } catch (err) {
            logger.error(`[ReactRoles] Failed to add role ${match.roleId} to ${user.id}:`, err);
        }
    },
};
