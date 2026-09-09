import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';
const SETTINGS_PATH = join(process.cwd(), 'data', 'bot-settings.json');
async function readSettings() {
    try {
        const raw = await readFile(SETTINGS_PATH, 'utf8');
        return JSON.parse(raw);
    }
    catch (error) {
        if (error?.code !== 'ENOENT') {
            logger.warn('Failed to read local bot settings fallback:', error);
        }
        return {};
    }
}
async function writeSettings(settings) {
    await mkdir(dirname(SETTINGS_PATH), { recursive: true });
    await writeFile(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}
class LocalSettingsService {
    async getAiChannelId(guildId) {
        const settings = await readSettings();
        return settings.guilds?.[guildId]?.ai_channel_id || null;
    }
    async setAiChannelId(guildId, channelId) {
        try {
            const settings = await readSettings();
            settings.guilds ||= {};
            settings.guilds[guildId] ||= {};
            settings.guilds[guildId].ai_channel_id = channelId;
            await writeSettings(settings);
            return true;
        }
        catch (error) {
            logger.error('Failed to write local bot settings fallback:', error);
            return false;
        }
    }
}
export const localSettings = new LocalSettingsService();
