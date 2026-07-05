import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
}

const SETTINGS_PATH = join(process.cwd(), 'data', 'welcome-settings.json');

const DEFAULT_CONFIG: WelcomeConfig = {
    enabled: false,
    channelId: null,
    template: 'Welcome {user} to {guild}! You are member #{member_count}!',
    embedEnabled: true,
    embedTitle: 'Welcome to the Server! 🎉',
    embedColor: '#8b5cf6',
    embedImage: null,
    customEmbedName: null,
    welcomeType: 'embed'
};

async function readAllConfigs(): Promise<Record<string, WelcomeConfig>> {
    try {
        const raw = await readFile(SETTINGS_PATH, 'utf8');
        return JSON.parse(raw) as Record<string, WelcomeConfig>;
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            logger.warn('Failed to read welcome settings:', error);
        }
        return {};
    }
}

async function writeAllConfigs(configs: Record<string, WelcomeConfig>): Promise<void> {
    await mkdir(dirname(SETTINGS_PATH), { recursive: true });
    await writeFile(SETTINGS_PATH, JSON.stringify(configs, null, 2), 'utf8');
}

export class WelcomeSettingsService {
    async get(guildId: string): Promise<WelcomeConfig> {
        const configs = await readAllConfigs();
        const raw = configs[guildId] || {};
        const config = {
            ...DEFAULT_CONFIG,
            ...raw
        };
        // Auto-migrate old embedEnabled settings to welcomeType
        if (!raw.welcomeType) {
            config.welcomeType = (raw.embedEnabled ?? DEFAULT_CONFIG.embedEnabled) ? 'embed' : 'text';
        }
        return config;
    }

    async set(guildId: string, updates: Partial<WelcomeConfig>): Promise<WelcomeConfig> {
        const configs = await readAllConfigs();
        const current = await this.get(guildId);
        const updated = { ...current, ...updates };
        configs[guildId] = updated;
        await writeAllConfigs(configs);
        return updated;
    }
}

export const welcomeSettings = new WelcomeSettingsService();
