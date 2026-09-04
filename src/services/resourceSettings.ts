import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';

export interface ResourceGuildConfig {
    forumChannelId: string | null;
    categoryTagMappings: Record<string, string[]>;
    allowedCategories: string[];
}

const DEFAULT_CONFIG: ResourceGuildConfig = {
    forumChannelId: null,
    categoryTagMappings: {
        Maps: ['maps', 'minecraft', 'worlds', 'map'],
        Builds: ['builds', 'schematics', 'structures', 'build'],
        Lobbies: ['lobbies', 'hub', 'spawn', 'lobby'],
        Plugins: ['plugins', 'spigot', 'paper', 'bukkit'],
        Mods: ['mods', 'forge', 'fabric', 'mod'],
        Bots: ['bots', 'discord-bot', 'bot', 'code'],
        Codes: ['codes', 'source-code', 'scripts', 'code'],
        Other: ['other', 'general', 'resources'],
    },
    allowedCategories: ['Maps', 'Builds', 'Lobbies', 'Plugins', 'Mods', 'Bots', 'Codes', 'Other'],
};

const LOCAL_SETTINGS_PATH = join(process.cwd(), 'data', 'resource-settings.json');

async function readLocalSettings(): Promise<Record<string, ResourceGuildConfig>> {
    try {
        const raw = await readFile(LOCAL_SETTINGS_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            logger.warn('Failed to read local resource settings fallback:', error);
        }
        return {};
    }
}

async function writeLocalSettings(data: Record<string, ResourceGuildConfig>): Promise<void> {
    try {
        await mkdir(dirname(LOCAL_SETTINGS_PATH), { recursive: true });
        await writeFile(LOCAL_SETTINGS_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    } catch (error) {
        logger.error('Failed to write local resource settings fallback:', error);
    }
}

export class ResourceSettingsService {
    async get(guildId: string): Promise<ResourceGuildConfig> {
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_resource_settings');
            if (embed?.description) {
                const parsed = JSON.parse(embed.description);
                return {
                    ...DEFAULT_CONFIG,
                    ...parsed,
                    categoryTagMappings: {
                        ...DEFAULT_CONFIG.categoryTagMappings,
                        ...(parsed.categoryTagMappings || {}),
                    },
                };
            }
        } catch (error) {
            logger.warn(`Supabase resource settings fetch failed for guild ${guildId}, using local fallback:`, error);
        }

        // Fallback to local file storage
        const localData = await readLocalSettings();
        const guildConfig = localData[guildId];
        if (guildConfig) {
            return {
                ...DEFAULT_CONFIG,
                ...guildConfig,
                categoryTagMappings: {
                    ...DEFAULT_CONFIG.categoryTagMappings,
                    ...(guildConfig.categoryTagMappings || {}),
                },
            };
        }

        return DEFAULT_CONFIG;
    }

    async set(guildId: string, updates: Partial<ResourceGuildConfig>): Promise<ResourceGuildConfig> {
        const current = await this.get(guildId);
        const updated: ResourceGuildConfig = {
            ...current,
            ...updates,
        };

        // Save to Supabase
        try {
            await supabase.saveCustomEmbed(guildId, '_resource_settings', {
                description: JSON.stringify(updated),
            });
        } catch (error) {
            logger.error(`Failed to save resource settings to Supabase for guild ${guildId}:`, error);
        }

        // Always save to local file fallback
        const localData = await readLocalSettings();
        localData[guildId] = updated;
        await writeLocalSettings(localData);

        return updated;
    }

    async setForumChannelId(guildId: string, channelId: string | null): Promise<ResourceGuildConfig> {
        return this.set(guildId, { forumChannelId: channelId });
    }

    async setCategoryTagMapping(guildId: string, category: string, tags: string[]): Promise<ResourceGuildConfig> {
        const current = await this.get(guildId);
        const updatedMappings = {
            ...current.categoryTagMappings,
            [category]: tags,
        };
        return this.set(guildId, { categoryTagMappings: updatedMappings });
    }
}

export const resourceSettings = new ResourceSettingsService();
