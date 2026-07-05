import { join } from 'node:path';
import { readFile, rename } from 'node:fs/promises';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';

export async function migrateLocalDataToSupabase() {
    logger.info('📦 Checking for local JSON data files to migrate to Supabase...');

    const dataDir = join(process.cwd(), 'data');

    // Helper to safely check if file exists and read it
    async function readJsonFile(filename: string): Promise<any | null> {
        const path = join(dataDir, filename);
        try {
            const raw = await readFile(path, 'utf8');
            return JSON.parse(raw);
        } catch (error: any) {
            if (error?.code !== 'ENOENT') {
                logger.error(`Failed to read local file ${filename}:`, error);
            }
            return null;
        }
    }

    // Helper to archive/rename the file after migration
    async function archiveFile(filename: string) {
        const oldPath = join(dataDir, filename);
        const newPath = join(dataDir, `${filename}.migrated`);
        try {
            await rename(oldPath, newPath);
            logger.info(`✅ Archived local file ${filename} -> ${filename}.migrated`);
        } catch (error) {
            logger.error(`Failed to archive local file ${filename}:`, error);
        }
    }

    // 1. Welcome Settings
    const welcomes = await readJsonFile('welcome-settings.json');
    if (welcomes && typeof welcomes === 'object') {
        logger.info('Migrating Welcome Settings...');
        for (const [guildId, config] of Object.entries(welcomes)) {
            await supabase.saveCustomEmbed(guildId, '_welcome_settings', {
                description: JSON.stringify(config)
            });
        }
        await archiveFile('welcome-settings.json');
    }

    // 2. J2C Settings
    const j2c = await readJsonFile('j2c-settings.json');
    if (j2c && typeof j2c === 'object') {
        logger.info('Migrating J2C Settings...');
        for (const [guildId, config] of Object.entries(j2c)) {
            await supabase.saveCustomEmbed(guildId, '_j2c_settings', {
                description: JSON.stringify(config)
            });
        }
        await archiveFile('j2c-settings.json');
    }

    // J2C Temp Channels
    const j2cTemp = await readJsonFile('j2c-temp-channels.json');
    if (j2cTemp && Array.isArray(j2cTemp)) {
        logger.info('Migrating J2C Temp Channels...');
        const list = j2cTemp.map((item: any) => {
            if (typeof item === 'string') {
                return { channelId: item, ownerId: '' };
            }
            return item;
        });
        await supabase.saveCustomEmbed('global', '_j2c_temp_channels', {
            description: JSON.stringify(list)
        });
        await archiveFile('j2c-temp-channels.json');
    }

    // 3. Warning Settings
    const warns = await readJsonFile('warn-settings.json');
    if (warns && typeof warns === 'object') {
        logger.info('Migrating Warning Settings...');
        for (const [guildId, config] of Object.entries(warns)) {
            await supabase.saveCustomEmbed(guildId, '_warn_settings', {
                description: JSON.stringify(config)
            });
        }
        await archiveFile('warn-settings.json');
    }

    // Warning Records
    const warnLogs = await readJsonFile('warnings-log.json');
    if (warnLogs && typeof warnLogs === 'object') {
        logger.info('Migrating Warning Logs...');
        for (const [guildKey, records] of Object.entries(warnLogs)) {
            const parts = guildKey.split(':');
            if (parts.length >= 2) {
                const guildId = parts[0];
                const userId = parts[1];
                await supabase.saveCustomEmbed(guildId, `_warnings_${userId}`, {
                    description: JSON.stringify(records)
                });
            }
        }
        await archiveFile('warnings-log.json');
    }

    // 4. Playlists
    const playlists = await readJsonFile('playlists.json');
    if (playlists && typeof playlists === 'object') {
        logger.info('Migrating Playlists...');
        for (const [userKey, userPlaylists] of Object.entries(playlists)) {
            const parts = userKey.split(':');
            if (parts.length >= 2) {
                const guildId = parts[0];
                const userId = parts[1];
                await supabase.saveCustomEmbed(guildId, `_playlist_${userId}`, {
                    description: JSON.stringify(userPlaylists)
                });
            }
        }
        await archiveFile('playlists.json');
    }

    // 5. Staff Applications Settings
    const staffApps = await readJsonFile('staff-app-settings.json');
    if (staffApps && typeof staffApps === 'object') {
        logger.info('Migrating Staff App Settings...');
        for (const [guildId, config] of Object.entries(staffApps)) {
            await supabase.saveCustomEmbed(guildId, '_staff_app_settings', {
                description: JSON.stringify(config)
            });
        }
        await archiveFile('staff-app-settings.json');
    }

    // Staff Applications Submissions
    const submissions = await readJsonFile('staff-submissions.json');
    if (submissions && typeof submissions === 'object') {
        logger.info('Migrating Staff App Submissions...');
        await supabase.saveCustomEmbed('global', '_staff_submissions', {
            description: JSON.stringify(submissions)
        });
        await archiveFile('staff-submissions.json');
    }

    logger.info('📦 Local data migration check completed.');
}
