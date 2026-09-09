import { supabase } from './supabase.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface LevelSettingsConfig {
    channelId: string;
}

const DEFAULT_LEVEL_CHANNEL_ID = '1531002070130364426';

export class LevelSettingsService {
    private cache = new Map<string, string>();

    /**
     * Get the configured level-up announcement channel ID for a guild or fallback
     */
    async getChannelId(guildId?: string | null): Promise<string> {
        const targetGuildId = guildId || config.bot.supportGuildId || '1340272406492614798';
        if (this.cache.has(targetGuildId)) {
            return this.cache.get(targetGuildId)!;
        }

        try {
            const embed = await supabase.getCustomEmbed(targetGuildId, '_level_settings');
            if (embed?.description) {
                const parsed = JSON.parse(embed.description);
                if (parsed.channelId) {
                    this.cache.set(targetGuildId, parsed.channelId);
                    return parsed.channelId;
                }
            }
        } catch (error) {
            logger.warn(`Failed to read level settings for guild ${targetGuildId}:`, error);
        }

        const fallback = config.bot.levelUpChannelId || DEFAULT_LEVEL_CHANNEL_ID;
        this.cache.set(targetGuildId, fallback);
        return fallback;
    }

    /**
     * Set the level-up announcement channel ID for a guild
     */
    async setChannelId(guildId: string, channelId: string): Promise<boolean> {
        try {
            this.cache.set(guildId, channelId);
            await supabase.saveCustomEmbed(guildId, '_level_settings', {
                description: JSON.stringify({ channelId }),
            });
            return true;
        } catch (error) {
            logger.error(`Failed to save level settings for guild ${guildId}:`, error);
            return false;
        }
    }
}

export const levelSettings = new LevelSettingsService();
