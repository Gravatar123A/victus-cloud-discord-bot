import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';

export interface J2CConfig {
    enabled: boolean;
    channelId: string | null;
    categoryId: string | null;
    nameFormat: string;
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

    async getTempChannels(): Promise<string[]> {
        try {
            const raw = await readFile(TEMP_CHANNELS_PATH, 'utf8');
            return JSON.parse(raw) as string[];
        } catch (error: any) {
            if (error?.code !== 'ENOENT') {
                logger.warn('Failed to read J2C temporary channels:', error);
            }
            return [];
        }
    }

    async addTempChannel(channelId: string): Promise<void> {
        const list = await this.getTempChannels();
        if (!list.includes(channelId)) {
            list.push(channelId);
            await mkdir(dirname(TEMP_CHANNELS_PATH), { recursive: true });
            await writeFile(TEMP_CHANNELS_PATH, JSON.stringify(list, null, 2), 'utf8');
        }
    }

    async removeTempChannel(channelId: string): Promise<void> {
        const list = await this.getTempChannels();
        const filtered = list.filter(id => id !== channelId);
        await mkdir(dirname(TEMP_CHANNELS_PATH), { recursive: true });
        await writeFile(TEMP_CHANNELS_PATH, JSON.stringify(filtered, null, 2), 'utf8');
    }
}

export const j2cSettings = new J2CSettingsService();
