import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';

export interface WelcomeConfig {
    enabled: boolean;
    channelId: string | null;
    template: string;
    embedEnabled: boolean;
    embedTitle: string;
    embedColor: string;
    embedImage: string | null;
    customEmbedName: string | null;
    welcomeType: 'text' | 'embed' | 'custom_embed';
    autoRoleIds: string[];
}

const DEFAULT_CONFIG: WelcomeConfig = {
    enabled: false,
    channelId: null,
    template: 'Welcome {user} to {guild}! You are member #{member_count}!',
    embedEnabled: true,
    embedTitle: 'Welcome to the Server! 🎉',
    embedColor: '#8b5cf6',
    embedImage: null,
    customEmbedName: null,
    welcomeType: 'embed',
    autoRoleIds: []
};

export class WelcomeSettingsService {
    async get(guildId: string): Promise<WelcomeConfig> {
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_welcome_settings');
            let raw: any = {};
            if (embed?.description) {
                raw = JSON.parse(embed.description);
            }
            const config = {
                ...DEFAULT_CONFIG,
                ...raw
            };
            if (!raw.welcomeType) {
                config.welcomeType = (raw.embedEnabled ?? DEFAULT_CONFIG.embedEnabled) ? 'embed' : 'text';
            }
            return config;
        } catch (error) {
            logger.error(`Failed to get welcome settings for guild ${guildId}:`, error);
            return DEFAULT_CONFIG;
        }
    }

    async set(guildId: string, updates: Partial<WelcomeConfig>): Promise<WelcomeConfig> {
        const current = await this.get(guildId);
        const updated = { ...current, ...updates };
        try {
            await supabase.saveCustomEmbed(guildId, '_welcome_settings', {
                description: JSON.stringify(updated)
            });
        } catch (error) {
            logger.error(`Failed to save welcome settings for guild ${guildId}:`, error);
        }
        return updated;
    }
}

export const welcomeSettings = new WelcomeSettingsService();
