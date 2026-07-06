import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';

export interface ServerStatsConfig {
    enabled: boolean;
    categoryId: string | null;
    stats: string[]; // ['members', 'online', 'boosts', 'roles', 'channels']
    channelIds: Record<string, string>; // e.g. { members: 'channelId' }
}

const DEFAULT_CONFIG: ServerStatsConfig = {
    enabled: false,
    categoryId: null,
    stats: ['members', 'online', 'boosts'],
    channelIds: {}
};

export class ServerStatsSettingsService {
    async get(guildId: string): Promise<ServerStatsConfig> {
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_server_stats_settings');
            let raw: any = {};
            if (embed?.description) {
                raw = JSON.parse(embed.description);
            }
            return {
                ...DEFAULT_CONFIG,
                ...raw
            };
        } catch (error) {
            logger.error(`Failed to get server stats settings for guild ${guildId}:`, error);
            return DEFAULT_CONFIG;
        }
    }

    async set(guildId: string, updates: Partial<ServerStatsConfig>): Promise<ServerStatsConfig> {
        const current = await this.get(guildId);
        const updated = { ...current, ...updates };
        try {
            await supabase.saveCustomEmbed(guildId, '_server_stats_settings', {
                description: JSON.stringify(updated)
            });
        } catch (error) {
            logger.error(`Failed to save server stats settings for guild ${guildId}:`, error);
        }
        return updated;
    }
}

export const serverStatsSettings = new ServerStatsSettingsService();
