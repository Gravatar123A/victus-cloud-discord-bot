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

        let targetRoleId: string | null = null;

        // 1. Check direct reaction role mappings
        if (config.reactionRoles && config.reactionRoles.length > 0) {
            const match = config.reactionRoles.find(
                (rr) => rr.messageId === message.id && matchEmoji(rr.emoji, reaction.emoji)
            );
            if (match) {
                targetRoleId = match.roleId;
            }
        }

        // 2. Check interactive role panels (support emoji reaction on panel messages!)
        if (!targetRoleId && config.panels && config.panels.length > 0) {
            const panel = config.panels.find((p) => p.messageId === message.id);
            if (panel) {
                const mapping = panel.mappings.find((m) => matchEmoji(m.emoji, reaction.emoji));
                if (mapping) {
                    targetRoleId = mapping.roleId;
                }
            }
        }

        if (!targetRoleId) return;

        try {
            const member = await message.guild.members.fetch(user.id).catch(() => null);
            if (!member) return;

            const targetRole = message.guild.roles.cache.get(targetRoleId);
            if (!targetRole) return;

            // Check if bot can assign this role
            const botMember = message.guild.members.me;
            if (botMember && targetRole.position >= botMember.roles.highest.position) {
                logger.warn(`[ReactRoles] Cannot assign role ${targetRole.name} - bot role is lower in hierarchy.`);
                return;
            }

            if (!member.roles.cache.has(targetRoleId)) {
                await member.roles.add(targetRoleId, 'Reaction Role: Added via emoji reaction');
                logger.info(`[ReactRoles] Added role @${targetRole.name} to ${user.tag} in ${message.guild.name}`);

                await user.send({
                    content: `✅ You have been assigned the **@${targetRole.name}** role in **${message.guild.name}**!`,
                }).catch(() => {});
            }
        } catch (err) {
            logger.error(`[ReactRoles] Failed to add role ${targetRoleId} to ${user.id}:`, err);
        }
    },
};
