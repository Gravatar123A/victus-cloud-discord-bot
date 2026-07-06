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

export interface ReactRolesConfig {
    panels: ReactRolePanel[];
}

const DEFAULT_CONFIG: ReactRolesConfig = {
    panels: []
};

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
                ...raw
            };
        } catch (error) {
            logger.error(`Failed to get react roles settings for guild ${guildId}:`, error);
            return DEFAULT_CONFIG;
        }
    }

    async set(guildId: string, updates: Partial<ReactRolesConfig>): Promise<ReactRolesConfig> {
        const current = await this.get(guildId);
        const updated = { ...current, ...updates };
        try {
            await supabase.saveCustomEmbed(guildId, '_react_roles_settings', {
                description: JSON.stringify(updated)
            });
        } catch (error) {
            logger.error(`Failed to save react roles settings for guild ${guildId}:`, error);
        }
        return updated;
    }
}

export const reactRolesSettings = new ReactRolesSettingsService();
