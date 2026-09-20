import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
const DEFAULT_CONFIG = {
    users: [],
    roles: [],
};
export class ExtraOwnerSettingsService {
    async get(guildId) {
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_extra_owners');
            let raw = {};
            if (embed?.description) {
                raw = JSON.parse(embed.description);
            }
            return {
                users: Array.isArray(raw.users) ? raw.users : [],
                roles: Array.isArray(raw.roles) ? raw.roles : [],
            };
        }
        catch (error) {
            logger.error(`Failed to get extra owners for guild ${guildId}:`, error);
            return { users: [], roles: [] };
        }
    }
    async set(guildId, config) {
        try {
            await supabase.saveCustomEmbed(guildId, '_extra_owners', {
                description: JSON.stringify(config),
            });
        }
        catch (error) {
            logger.error(`Failed to save extra owners for guild ${guildId}:`, error);
        }
        return config;
    }
    async addUser(guildId, user) {
        const config = await this.get(guildId);
        if (!config.users.some((u) => u.userId === user.userId)) {
            config.users.push(user);
            await this.set(guildId, config);
        }
        return config;
    }
    async removeUser(guildId, userId) {
        const config = await this.get(guildId);
        const originalLength = config.users.length;
        config.users = config.users.filter((u) => u.userId !== userId);
        if (config.users.length !== originalLength) {
            await this.set(guildId, config);
            return { success: true, config };
        }
        return { success: false, config };
    }
    async addRole(guildId, role) {
        const config = await this.get(guildId);
        if (!config.roles.some((r) => r.roleId === role.roleId)) {
            config.roles.push(role);
            await this.set(guildId, config);
        }
        return config;
    }
    async removeRole(guildId, roleId) {
        const config = await this.get(guildId);
        const originalLength = config.roles.length;
        config.roles = config.roles.filter((r) => r.roleId !== roleId);
        if (config.roles.length !== originalLength) {
            await this.set(guildId, config);
            return { success: true, config };
        }
        return { success: false, config };
    }
    /**
     * Check if a user or member qualifies as an Extra Owner in a guild.
     */
    async isExtraOwner(guild, user, member) {
        const config = await this.get(guild.id);
        if (config.users.some((u) => u.userId === user.id))
            return true;
        const targetMember = member || await guild.members.fetch(user.id).catch(() => null);
        if (targetMember && targetMember.roles) {
            for (const roleEntry of config.roles) {
                if (targetMember.roles.cache.has(roleEntry.roleId))
                    return true;
            }
        }
        return false;
    }
}
export const extraOwnerSettings = new ExtraOwnerSettingsService();
