import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';

export interface RoleMapping {
    emoji: string;
    roleId: string;
    label: string;
}

export interface ReactRolePanel {
    id: string;
    title: string;
    description: string;
    style: 'buttons' | 'select';
    mappings: RoleMapping[];
    messageId?: string;
    channelId?: string;
}

export interface EmojiReactionRole {
    messageId: string;
    channelId: string;
    emoji: string;
    roleId: string;
}

export interface ReactRolesConfig {
    panels: ReactRolePanel[];
    reactionRoles: EmojiReactionRole[];
}

const DEFAULT_CONFIG: ReactRolesConfig = {
    panels: [],
    reactionRoles: [],
};

export function matchEmoji(
    stored: string,
    reactionEmoji: { id?: string | null; name?: string | null; identifier?: string }
): boolean {
    if (!stored) return false;
    const s = stored.trim();

    // 1. Check custom emoji by Snowflake ID
    if (reactionEmoji.id && s.includes(reactionEmoji.id)) return true;

    // 2. Exact match on reaction name or identifier
    if (reactionEmoji.name) {
        if (s === reactionEmoji.name) return true;
        // Strip unicode variation selectors (\uFE0E, \uFE0F) for fuzzy unicode equality
        const normalize = (str: string) => str.replace(/[\uFE0E\uFE0F]/g, '');
        if (normalize(s) === normalize(reactionEmoji.name)) return true;

        if (s.replace(/:/g, '') === reactionEmoji.name.replace(/:/g, '')) return true;
    }

    if (reactionEmoji.identifier) {
        if (s === reactionEmoji.identifier) return true;
        if (s.includes(reactionEmoji.identifier)) return true;
    }

    return false;
}

export class ReactRolesSettingsService {
    async get(guildId: string): Promise<ReactRolesConfig> {
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_react_roles_settings');
            let raw: any = {};
            if (embed?.description) {
                raw = JSON.parse(embed.description);
            }
            return {
                ...DEFAULT_CONFIG,
                ...raw,
                panels: raw.panels || [],
                reactionRoles: raw.reactionRoles || [],
            };
        } catch (error) {
            logger.error(`Failed to get react roles settings for guild ${guildId}:`, error);
            return { ...DEFAULT_CONFIG };
        }
    }

    async set(guildId: string, updates: Partial<ReactRolesConfig>): Promise<ReactRolesConfig> {
        const current = await this.get(guildId);
        const updated: ReactRolesConfig = { ...current, ...updates };
        try {
            await supabase.saveCustomEmbed(guildId, '_react_roles_settings', {
                description: JSON.stringify(updated),
            });
        } catch (error) {
            logger.error(`Failed to save react roles settings for guild ${guildId}:`, error);
        }
        return updated;
    }

    async addReactionRole(guildId: string, role: EmojiReactionRole): Promise<ReactRolesConfig> {
        const config = await this.get(guildId);
        // Remove existing mapping with same messageId and emoji if any
        const filtered = config.reactionRoles.filter(
            (rr) => !(rr.messageId === role.messageId && matchEmoji(rr.emoji, { name: role.emoji, id: role.emoji }))
        );
        filtered.push(role);
        return this.set(guildId, { reactionRoles: filtered });
    }

    async removeReactionRole(guildId: string, messageId: string, emoji?: string): Promise<{ success: boolean; removedCount: number }> {
        const config = await this.get(guildId);
        const initialCount = config.reactionRoles.length;
        const filtered = config.reactionRoles.filter((rr) => {
            if (rr.messageId !== messageId) return true;
            if (emoji && !matchEmoji(rr.emoji, { name: emoji, id: emoji })) return true;
            return false;
        });

        const removedCount = initialCount - filtered.length;
        if (removedCount > 0) {
            await this.set(guildId, { reactionRoles: filtered });
            return { success: true, removedCount };
        }
        return { success: false, removedCount: 0 };
    }
}

export const reactRolesSettings = new ReactRolesSettingsService();
