import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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

const SETTINGS_PATH = join(process.cwd(), 'data', 'j2c-settings.json');
const TEMP_CHANNELS_PATH = join(process.cwd(), 'data', 'j2c-temp-channels.json');

const DEFAULT_CONFIG: J2CConfig = {
    enabled: false,
    channelId: null,
    categoryId: null,
    nameFormat: '🔊 {username}\'s Lounge'
};

async function readAllConfigs(): Promise<Record<string, J2CConfig>> {
    try {
        const raw = await readFile(SETTINGS_PATH, 'utf8');
        return JSON.parse(raw) as Record<string, J2CConfig>;
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            logger.warn('Failed to read J2C settings:', error);
        }
        return {};
    }
}

async function writeAllConfigs(configs: Record<string, J2CConfig>): Promise<void> {
    await mkdir(dirname(SETTINGS_PATH), { recursive: true });
    await writeFile(SETTINGS_PATH, JSON.stringify(configs, null, 2), 'utf8');
}

export class J2CSettingsService {
    async get(guildId: string): Promise<J2CConfig> {
        const configs = await readAllConfigs();
        return {
            ...DEFAULT_CONFIG,
            ...(configs[guildId] || {})
        };
    }

    async set(guildId: string, updates: Partial<J2CConfig>): Promise<J2CConfig> {
        const configs = await readAllConfigs();
        const current = {
            ...DEFAULT_CONFIG,
            ...(configs[guildId] || {})
        };
        const updated = { ...current, ...updates };
        configs[guildId] = updated;
        await writeAllConfigs(configs);
        return updated;
    }

    async getTempChannelsInfo(): Promise<TempVoiceChannelInfo[]> {
        try {
            const raw = await readFile(TEMP_CHANNELS_PATH, 'utf8');
            const parsed = JSON.parse(raw) as any[];
            return parsed.map((item: any) => {
                if (typeof item === 'string') {
                    return { channelId: item, ownerId: '' }; // legacy fallback
                }
                return item as TempVoiceChannelInfo;
            });
        } catch (error: any) {
            if (error?.code !== 'ENOENT') {
                logger.warn('Failed to read J2C temporary channels:', error);
            }
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
            await mkdir(dirname(TEMP_CHANNELS_PATH), { recursive: true });
            await writeFile(TEMP_CHANNELS_PATH, JSON.stringify(list, null, 2), 'utf8');
        }
    }

    async removeTempChannel(channelId: string): Promise<void> {
        const list = await this.getTempChannelsInfo();
        const filtered = list.filter(i => i.channelId !== channelId);
        await mkdir(dirname(TEMP_CHANNELS_PATH), { recursive: true });
        await writeFile(TEMP_CHANNELS_PATH, JSON.stringify(filtered, null, 2), 'utf8');
    }

    async setTempChannelOwner(channelId: string, ownerId: string): Promise<void> {
        const list = await this.getTempChannelsInfo();
        const item = list.find(i => i.channelId === channelId);
        if (item) {
            item.ownerId = ownerId;
            await mkdir(dirname(TEMP_CHANNELS_PATH), { recursive: true });
            await writeFile(TEMP_CHANNELS_PATH, JSON.stringify(list, null, 2), 'utf8');
        }
    }
}

export const j2cSettings = new J2CSettingsService();
