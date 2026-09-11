import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';

export interface AntiNukeConfig {
    enabled: boolean;
    anti_kick: boolean;
    anti_ban: boolean;
    anti_ban_remove: boolean;
    anti_channel_create: boolean;
    anti_channel_delete: boolean;
    anti_role_create: boolean;
    anti_role_delete: boolean;
    anti_role_update: boolean;
    anti_emoji_delete: boolean;
    anti_sticker_delete: boolean;
    anti_guild_update: boolean;
}

const DEFAULT_CONFIG: AntiNukeConfig = {
    enabled: false,
    anti_kick: false,
    anti_ban: false,
    anti_ban_remove: false,
    anti_channel_create: false,
    anti_channel_delete: false,
    anti_role_create: false,
    anti_role_delete: false,
    anti_role_update: false,
    anti_emoji_delete: false,
    anti_sticker_delete: false,
    anti_guild_update: false,
};

export class AntiNukeSettingsService {
    async get(guildId: string): Promise<AntiNukeConfig> {
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_antinuke_settings');
            let raw: any = {};
            if (embed?.description) {
                raw = JSON.parse(embed.description);
            }
            return {
                ...DEFAULT_CONFIG,
                ...raw
            };
        } catch (error) {
            logger.error(`Failed to get antinuke settings for guild ${guildId}:`, error);
            return DEFAULT_CONFIG;
        }
    }

    async set(guildId: string, updates: Partial<AntiNukeConfig>): Promise<AntiNukeConfig> {
        const current = await this.get(guildId);
        const updated = { ...current, ...updates };
        try {
            await supabase.saveCustomEmbed(guildId, '_antinuke_settings', {
                description: JSON.stringify(updated)
            });
        } catch (error) {
            logger.error(`Failed to save antinuke settings for guild ${guildId}:`, error);
        }
        return updated;
    }
}

export const antiNukeSettings = new AntiNukeSettingsService();
