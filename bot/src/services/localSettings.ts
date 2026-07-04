import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';

type LocalBotSettings = {
    guilds?: Record<string, {
        ai_channel_id?: string | null;
    }>;
};

const SETTINGS_PATH = join(process.cwd(), 'data', 'bot-settings.json');

async function readSettings(): Promise<LocalBotSettings> {
    try {
        const raw = await readFile(SETTINGS_PATH, 'utf8');
        return JSON.parse(raw) as LocalBotSettings;
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            logger.warn('Failed to read local bot settings fallback:', error);
        }
        return {};
    }
}

async function writeSettings(settings: LocalBotSettings): Promise<void> {
    await mkdir(dirname(SETTINGS_PATH), { recursive: true });
    await writeFile(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

class LocalSettingsService {
    async getAiChannelId(guildId: string): Promise<string | null> {
        const settings = await readSettings();
        return settings.guilds?.[guildId]?.ai_channel_id || null;
    }

    async setAiChannelId(guildId: string, channelId: string | null): Promise<boolean> {
        try {
            const settings = await readSettings();
            settings.guilds ||= {};
            settings.guilds[guildId] ||= {};
            settings.guilds[guildId].ai_channel_id = channelId;
            await writeSettings(settings);
            return true;
        } catch (error) {
            logger.error('Failed to write local bot settings fallback:', error);
            return false;
        }
    }
}

export const localSettings = new LocalSettingsService();
