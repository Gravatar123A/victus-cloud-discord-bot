import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';

export interface J2CConfig {
    enabled: boolean;
    channelId: string | null;
    categoryId: string | null;
    nameFormat: string;
}

export interface TempVoiceChannelInfo {
    channelId: string;
    ownerId: string;
}

const DEFAULT_CONFIG: J2CConfig = {
    enabled: false,
    channelId: null,
    categoryId: null,
    nameFormat: "🔊 {username}'s Lounge"
};

export class J2CSettingsService {
    async get(guildId: string): Promise<J2CConfig> {
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_j2c_settings');
            let raw: any = {};
            if (embed?.description) {
                raw = JSON.parse(embed.description);
            }
            return {
                ...DEFAULT_CONFIG,
                ...raw
            };
        } catch (error) {
            logger.error(`Failed to get J2C settings for guild ${guildId}:`, error);
            return DEFAULT_CONFIG;
        }
    }

    async set(guildId: string, updates: Partial<J2CConfig>): Promise<J2CConfig> {
        const current = await this.get(guildId);
        const updated = { ...current, ...updates };
        try {
            await supabase.saveCustomEmbed(guildId, '_j2c_settings', {
                description: JSON.stringify(updated)
            });
        } catch (error) {
            logger.error(`Failed to save J2C settings for guild ${guildId}:`, error);
        }
        return updated;
    }

    async getTempChannelsInfo(): Promise<TempVoiceChannelInfo[]> {
        try {
            const embed = await supabase.getCustomEmbed('global', '_j2c_temp_channels');
            if (!embed?.description) return [];
            const parsed = JSON.parse(embed.description) as any[];
            return parsed.map((item: any) => {
                if (typeof item === 'string') {
                    return { channelId: item, ownerId: '' };
                }
                return item as TempVoiceChannelInfo;
            });
        } catch (error) {
            logger.error('Failed to get temporary J2C channels info:', error);
            return [];
        }
    }

    async getTempChannels(): Promise<string[]> {
        const info = await this.getTempChannelsInfo();
        return info.map(i => i.channelId);
    }

    async addTempChannel(channelId: string, ownerId: string): Promise<void> {
        const list = await this.getTempChannelsInfo();
        if (!list.some(i => i.channelId === channelId)) {
            list.push({ channelId, ownerId });
            try {
                await supabase.saveCustomEmbed('global', '_j2c_temp_channels', {
                    description: JSON.stringify(list)
                });
            } catch (error) {
                logger.error('Failed to add J2C temp channel:', error);
            }
        }
    }

    async removeTempChannel(channelId: string): Promise<void> {
        const list = await this.getTempChannelsInfo();
        const filtered = list.filter(i => i.channelId !== channelId);
        try {
            await supabase.saveCustomEmbed('global', '_j2c_temp_channels', {
                description: JSON.stringify(filtered)
            });
        } catch (error) {
            logger.error('Failed to remove J2C temp channel:', error);
        }
    }

    async setTempChannelOwner(channelId: string, ownerId: string): Promise<void> {
        const list = await this.getTempChannelsInfo();
        const item = list.find(i => i.channelId === channelId);
        if (item) {
            item.ownerId = ownerId;
            try {
                await supabase.saveCustomEmbed('global', '_j2c_temp_channels', {
                    description: JSON.stringify(list)
                });
            } catch (error) {
                logger.error('Failed to update J2C temp channel owner:', error);
            }
        }
    }
}

export const j2cSettings = new J2CSettingsService();
