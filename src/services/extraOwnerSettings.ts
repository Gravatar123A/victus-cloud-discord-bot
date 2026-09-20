import { Guild, GuildMember, User } from 'discord.js';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';

export interface ExtraOwnerUser {
    userId: string;
    username: string;
    addedBy: string;
    addedAt: string;
}

export interface ExtraOwnerRole {
    roleId: string;
    roleName: string;
    addedBy: string;
    addedAt: string;
}

export interface ExtraOwnerConfig {
    users: ExtraOwnerUser[];
    roles: ExtraOwnerRole[];
}

const DEFAULT_CONFIG: ExtraOwnerConfig = {
    users: [],
    roles: [],
};

export class ExtraOwnerSettingsService {
    async get(guildId: string): Promise<ExtraOwnerConfig> {
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_extra_owners');
            let raw: any = {};
            if (embed?.description) {
                raw = JSON.parse(embed.description);
            }
            return {
                users: Array.isArray(raw.users) ? raw.users : [],
                roles: Array.isArray(raw.roles) ? raw.roles : [],
            };
        } catch (error) {
            logger.error(`Failed to get extra owners for guild ${guildId}:`, error);
            return { users: [], roles: [] };
        }
    }

    async set(guildId: string, config: ExtraOwnerConfig): Promise<ExtraOwnerConfig> {
        try {
            await supabase.saveCustomEmbed(guildId, '_extra_owners', {
                description: JSON.stringify(config),
            });
        } catch (error) {
            logger.error(`Failed to save extra owners for guild ${guildId}:`, error);
        }
        return config;
    }

    async addUser(guildId: string, user: ExtraOwnerUser): Promise<ExtraOwnerConfig> {
        const config = await this.get(guildId);
        if (!config.users.some((u) => u.userId === user.userId)) {
            config.users.push(user);
            await this.set(guildId, config);
        }
        return config;
    }

    async removeUser(guildId: string, userId: string): Promise<{ success: boolean; config: ExtraOwnerConfig }> {
        const config = await this.get(guildId);
        const originalLength = config.users.length;
        config.users = config.users.filter((u) => u.userId !== userId);
        if (config.users.length !== originalLength) {
            await this.set(guildId, config);
            return { success: true, config };
        }
        return { success: false, config };
    }

    async addRole(guildId: string, role: ExtraOwnerRole): Promise<ExtraOwnerConfig> {
        const config = await this.get(guildId);
        if (!config.roles.some((r) => r.roleId === role.roleId)) {
            config.roles.push(role);
            await this.set(guildId, config);
        }
        return config;
    }

    async removeRole(guildId: string, roleId: string): Promise<{ success: boolean; config: ExtraOwnerConfig }> {
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
    async isExtraOwner(guild: Guild, user: User, member?: GuildMember | null): Promise<boolean> {
        const config = await this.get(guild.id);
        if (config.users.some((u) => u.userId === user.id)) return true;

        const targetMember = member || await guild.members.fetch(user.id).catch(() => null);
        if (targetMember && targetMember.roles) {
            for (const roleEntry of config.roles) {
                if (targetMember.roles.cache.has(roleEntry.roleId)) return true;
            }
        }
        return false;
    }
}

export const extraOwnerSettings = new ExtraOwnerSettingsService();
