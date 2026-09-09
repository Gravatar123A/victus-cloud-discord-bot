import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
const DEFAULT_CONFIG = {
    enabled: false,
    warnChannelId: null
};
export class WarnSettingsService {
    async get(guildId) {
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_warn_settings');
            let raw = {};
            if (embed?.description) {
                raw = JSON.parse(embed.description);
            }
            return {
                ...DEFAULT_CONFIG,
                ...raw
            };
        }
        catch (error) {
            logger.error(`Failed to get warn settings for guild ${guildId}:`, error);
            return DEFAULT_CONFIG;
        }
    }
    async set(guildId, updates) {
        const current = await this.get(guildId);
        const updated = { ...current, ...updates };
        try {
            await supabase.saveCustomEmbed(guildId, '_warn_settings', {
                description: JSON.stringify(updated)
            });
        }
        catch (error) {
            logger.error(`Failed to save warn settings for guild ${guildId}:`, error);
        }
        return updated;
    }
    async getWarnings(guildId, userId) {
        try {
            const embed = await supabase.getCustomEmbed(guildId, `_warnings_${userId}`);
            if (!embed?.description)
                return [];
            return JSON.parse(embed.description);
        }
        catch (error) {
            logger.error(`Failed to get warning records for user ${userId} in guild ${guildId}:`, error);
            return [];
        }
    }
    async addWarning(guildId, userId, warning) {
        const current = await this.getWarnings(guildId, userId);
        current.push(warning);
        try {
            await supabase.saveCustomEmbed(guildId, `_warnings_${userId}`, {
                description: JSON.stringify(current)
            });
        }
        catch (error) {
            logger.error(`Failed to add warning record for user ${userId} in guild ${guildId}:`, error);
        }
        return current;
    }
    async removeWarning(guildId, userId, warningId) {
        const current = await this.getWarnings(guildId, userId);
        const index = current.findIndex(w => w.id === warningId);
        if (index === -1)
            return null;
        current.splice(index, 1);
        try {
            await supabase.saveCustomEmbed(guildId, `_warnings_${userId}`, {
                description: JSON.stringify(current)
            });
        }
        catch (error) {
            logger.error(`Failed to remove warning record for user ${userId} in guild ${guildId}:`, error);
        }
        return current;
    }
    async resetWarnings(guildId, userId) {
        try {
            await supabase.deleteCustomEmbed(guildId, `_warnings_${userId}`);
        }
        catch (error) {
            logger.error(`Failed to reset warnings for user ${userId} in guild ${guildId}:`, error);
        }
    }
}
export const warnSettings = new WarnSettingsService();
