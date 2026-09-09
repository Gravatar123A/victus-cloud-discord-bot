import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
const DEFAULT_CONFIG = {
    users: []
};
export class WhitelistSettingsService {
    async get(guildId) {
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_whitelist_settings');
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
            logger.error(`Failed to get whitelist settings for guild ${guildId}:`, error);
            return DEFAULT_CONFIG;
        }
    }
    async set(guildId, updates) {
        const current = await this.get(guildId);
        const updated = { ...current, ...updates };
        try {
            await supabase.saveCustomEmbed(guildId, '_whitelist_settings', {
                description: JSON.stringify(updated)
            });
        }
        catch (error) {
            logger.error(`Failed to save whitelist settings for guild ${guildId}:`, error);
        }
        return updated;
    }
    async isImmune(guildId, userId, category) {
        const config = await this.get(guildId);
        const record = config.users.find(u => u.userId === userId);
        if (!record)
            return false;
        return record.categories.includes(category);
    }
}
export const whitelistSettings = new WhitelistSettingsService();
