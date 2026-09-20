import { reactRolesSettings, matchEmoji } from '../services/reactRolesSettings.js';
import { logger } from '../utils/logger.js';
export const messageReactionRemoveEvent = {
    name: 'messageReactionRemove',
    async execute(reaction, user) {
        if (user.bot)
            return;
        // Fetch partial reaction and user if needed
        if (reaction.partial) {
            try {
                await reaction.fetch();
            }
            catch (err) {
                logger.debug('[ReactRoles] Failed to fetch partial reaction:', err);
                return;
            }
        }
        if (user.partial) {
            try {
                await user.fetch();
            }
            catch (err) {
                logger.debug('[ReactRoles] Failed to fetch partial user:', err);
                return;
            }
        }
        const message = reaction.message;
        if (!message.guild)
            return;
        const config = await reactRolesSettings.get(message.guild.id);
        let targetRoleId = null;
        // 1. Check direct reaction role mappings
        if (config.reactionRoles && config.reactionRoles.length > 0) {
            const match = config.reactionRoles.find((rr) => rr.messageId === message.id && matchEmoji(rr.emoji, reaction.emoji));
            if (match) {
                targetRoleId = match.roleId;
            }
        }
        // 2. Check interactive role panels (support emoji unreaction on panel messages!)
        if (!targetRoleId && config.panels && config.panels.length > 0) {
            const panel = config.panels.find((p) => p.messageId === message.id);
            if (panel) {
                const mapping = panel.mappings.find((m) => matchEmoji(m.emoji, reaction.emoji));
                if (mapping) {
                    targetRoleId = mapping.roleId;
                }
            }
        }
        if (!targetRoleId)
            return;
        try {
            const member = await message.guild.members.fetch(user.id).catch(() => null);
            if (!member)
                return;
            const targetRole = message.guild.roles.cache.get(targetRoleId);
            if (!targetRole)
                return;
            const botMember = message.guild.members.me;
            if (botMember && targetRole.position >= botMember.roles.highest.position) {
                logger.warn(`[ReactRoles] Cannot remove role ${targetRole.name} - bot role is lower in hierarchy.`);
                return;
            }
            if (member.roles.cache.has(targetRoleId)) {
                await member.roles.remove(targetRoleId, 'Reaction Role: Removed via emoji unreaction');
                logger.info(`[ReactRoles] Removed role @${targetRole.name} from ${user.tag} in ${message.guild.name}`);
                await user.send({
                    content: `❌ The **@${targetRole.name}** role was removed from you in **${message.guild.name}**.`,
                }).catch(() => { });
            }
        }
        catch (err) {
            logger.error(`[ReactRoles] Failed to remove role ${targetRoleId} from ${user.id}:`, err);
        }
    },
};
