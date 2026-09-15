import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
const AFK_FILE_PATH = join(process.cwd(), 'data', 'afk.json');
export class AfkService {
    // Key: `${guildId}:${userId}` -> AfkRecord
    afkUsers = new Map();
    loaded = false;
    saveTimeout = null;
    constructor() {
        this.init().catch((err) => {
            logger.warn('Failed to initialize local AFK cache:', err);
        });
    }
    makeKey(guildId, userId) {
        return `${guildId}:${userId}`;
    }
    /**
     * Load existing AFK records from local disk storage
     */
    async init() {
        if (this.loaded)
            return;
        try {
            const raw = await readFile(AFK_FILE_PATH, 'utf8');
            const data = JSON.parse(raw);
            for (const [key, record] of Object.entries(data)) {
                if (record && record.userId && record.guildId) {
                    this.afkUsers.set(key, record);
                }
            }
            logger.info(`🔮 Loaded ${this.afkUsers.size} active AFK records from local storage.`);
        }
        catch {
            // Local file doesn't exist yet or is invalid
        }
        this.loaded = true;
    }
    /**
     * Debounced save to local file
     */
    scheduleSave() {
        if (this.saveTimeout)
            return;
        this.saveTimeout = setTimeout(async () => {
            this.saveTimeout = null;
            try {
                const plain = {};
                for (const [key, val] of this.afkUsers.entries()) {
                    plain[key] = val;
                }
                await mkdir(dirname(AFK_FILE_PATH), { recursive: true });
                await writeFile(AFK_FILE_PATH, JSON.stringify(plain, null, 2), 'utf8');
            }
            catch (err) {
                logger.warn('Failed to persist AFK records to local disk:', err);
            }
        }, 1500);
        this.saveTimeout.unref?.();
    }
    /**
     * Fast O(1) in-memory check if user is AFK in a guild
     */
    getAfk(guildId, userId) {
        return this.afkUsers.get(this.makeKey(guildId, userId)) || null;
    }
    /**
     * Set a user as AFK
     */
    async setAfk(guildId, userId, reason = 'AFK') {
        const record = {
            guildId,
            userId,
            reason,
            timestamp: new Date().toISOString(),
            mentions: [],
        };
        this.afkUsers.set(this.makeKey(guildId, userId), record);
        this.scheduleSave();
        // Best effort sync to Supabase custom embed backup
        if (supabase.isAvailable()) {
            supabase.saveCustomEmbed(guildId, `_afk_${userId}`, {
                description: JSON.stringify({
                    reason: record.reason,
                    timestamp: record.timestamp,
                    mentions: record.mentions,
                }),
            }).catch(() => { });
        }
    }
    /**
     * Log a mention for an AFK user
     */
    addMention(guildId, userId, mention) {
        const record = this.getAfk(guildId, userId);
        if (!record)
            return;
        record.mentions.push(mention);
        if (record.mentions.length > 20) {
            record.mentions = record.mentions.slice(-20);
        }
        this.scheduleSave();
        // Best effort sync to Supabase
        if (supabase.isAvailable()) {
            supabase.saveCustomEmbed(guildId, `_afk_${userId}`, {
                description: JSON.stringify({
                    reason: record.reason,
                    timestamp: record.timestamp,
                    mentions: record.mentions,
                }),
            }).catch(() => { });
        }
    }
    /**
     * Remove AFK status when a user returns
     */
    async removeAfk(guildId, userId) {
        const key = this.makeKey(guildId, userId);
        const record = this.afkUsers.get(key) || null;
        if (!record)
            return null;
        this.afkUsers.delete(key);
        this.scheduleSave();
        // Best effort removal from Supabase
        if (supabase.isAvailable()) {
            supabase.deleteCustomEmbed(guildId, `_afk_${userId}`).catch(() => { });
        }
        return record;
    }
}
export const afkService = new AfkService();
