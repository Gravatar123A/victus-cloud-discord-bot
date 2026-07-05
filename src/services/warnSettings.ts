import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';

export interface WarnConfig {
    enabled: boolean;
    warnChannelId: string | null;
}

export interface WarningRecord {
    id: string;
    userId: string;
    userName: string;
    moderatorId: string;
    moderatorName: string;
    reason: string;
    timestamp: string;
}

const SETTINGS_PATH = join(process.cwd(), 'data', 'warn-settings.json');
const RECORDS_PATH = join(process.cwd(), 'data', 'warnings-log.json');

const DEFAULT_CONFIG: WarnConfig = {
    enabled: false,
    warnChannelId: null
};

// --- Settings ---
async function readAllConfigs(): Promise<Record<string, WarnConfig>> {
    try {
        const raw = await readFile(SETTINGS_PATH, 'utf8');
        return JSON.parse(raw) as Record<string, WarnConfig>;
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            logger.warn('Failed to read warn settings:', error);
        }
        return {};
    }
}

async function writeAllConfigs(configs: Record<string, WarnConfig>): Promise<void> {
    await mkdir(dirname(SETTINGS_PATH), { recursive: true });
    await writeFile(SETTINGS_PATH, JSON.stringify(configs, null, 2), 'utf8');
}

// --- Warning Records ---
async function readAllRecords(): Promise<Record<string, WarningRecord[]>> {
    try {
        const raw = await readFile(RECORDS_PATH, 'utf8');
        return JSON.parse(raw) as Record<string, WarningRecord[]>;
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            logger.warn('Failed to read warning records:', error);
        }
        return {};
    }
}

async function writeAllRecords(records: Record<string, WarningRecord[]>): Promise<void> {
    await mkdir(dirname(RECORDS_PATH), { recursive: true });
    await writeFile(RECORDS_PATH, JSON.stringify(records, null, 2), 'utf8');
}

export class WarnSettingsService {
    async get(guildId: string): Promise<WarnConfig> {
        const configs = await readAllConfigs();
        return {
            ...DEFAULT_CONFIG,
            ...(configs[guildId] || {})
        };
    }

    async set(guildId: string, updates: Partial<WarnConfig>): Promise<WarnConfig> {
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

    async getWarnings(guildId: string, userId: string): Promise<WarningRecord[]> {
        const all = await readAllRecords();
        const guildKey = `${guildId}:${userId}`;
        return all[guildKey] || [];
    }

    async addWarning(guildId: string, userId: string, warning: WarningRecord): Promise<WarningRecord[]> {
        const all = await readAllRecords();
        const guildKey = `${guildId}:${userId}`;
        const current = all[guildKey] || [];
        current.push(warning);
        all[guildKey] = current;
        await writeAllRecords(all);
        return current;
    }

    async removeWarning(guildId: string, userId: string, warningId: string): Promise<WarningRecord[] | null> {
        const all = await readAllRecords();
        const guildKey = `${guildId}:${userId}`;
        const current = all[guildKey] || [];
        const index = current.findIndex(w => w.id === warningId);
        if (index === -1) return null;
        current.splice(index, 1);
        all[guildKey] = current;
        await writeAllRecords(all);
        return current;
    }

    async resetWarnings(guildId: string, userId: string): Promise<void> {
        const all = await readAllRecords();
        const guildKey = `${guildId}:${userId}`;
        delete all[guildKey];
        await writeAllRecords(all);
    }
}

export const warnSettings = new WarnSettingsService();
