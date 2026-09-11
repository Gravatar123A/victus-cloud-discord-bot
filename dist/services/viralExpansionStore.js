import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
const STORE_PATH = join(process.cwd(), 'data', 'expansion-store.json');
class AsyncMutex {
    queue = [];
    locked = false;
    async acquire() {
        return new Promise((resolve) => {
            const release = () => {
                if (this.queue.length > 0) {
                    const next = this.queue.shift();
                    next();
                }
                else {
                    this.locked = false;
                }
            };
            if (!this.locked) {
                this.locked = true;
                resolve(release);
            }
            else {
                this.queue.push(() => resolve(release));
            }
        });
    }
}
const fileMutex = new AsyncMutex();
export class ViralExpansionStore {
    cache = null;
    async loadLocalStore() {
        if (this.cache)
            return this.cache;
        try {
            const raw = await readFile(STORE_PATH, 'utf8');
            this.cache = JSON.parse(raw);
        }
        catch {
            this.cache = {
                users: {},
                guilds: {},
                referrals: {},
                inventories: {},
                bosses: {},
                wars: {},
                smp_servers: {},
                lifeboats: {},
            };
        }
        return this.cache;
    }
    async saveLocalStore(store) {
        const release = await fileMutex.acquire();
        try {
            this.cache = store;
            await mkdir(dirname(STORE_PATH), { recursive: true });
            const tempPath = `${STORE_PATH}.${Date.now()}.tmp`;
            await writeFile(tempPath, JSON.stringify(store, null, 2), 'utf8');
            await rename(tempPath, STORE_PATH);
        }
        catch (err) {
            logger.error('Failed to save expansion local store:', err);
        }
        finally {
            release();
        }
    }
    // ============================================
    // USERS (First-command unique interaction bonus)
    // ============================================
    async getUser(discordId) {
        // Try Supabase first
        try {
            const { data, error } = await supabase.client
                .from('bot_expansion_users')
                .select('*')
                .eq('discord_id', discordId)
                .maybeSingle();
            if (!error && data) {
                return data;
            }
        }
        catch {
            // Supabase fallback
        }
        const store = await this.loadLocalStore();
        if (!store.users[discordId]) {
            store.users[discordId] = {
                discord_id: discordId,
                global_claim_flag: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            await this.saveLocalStore(store);
        }
        return store.users[discordId];
    }
    async setUserGlobalClaim(discordId, guildId, email) {
        const now = new Date().toISOString();
        // Try Supabase
        try {
            const { error } = await supabase.client
                .from('bot_expansion_users')
                .upsert({
                discord_id: discordId,
                global_claim_flag: true,
                first_interaction_guild_id: guildId,
                victus_email: email || null,
                updated_at: now,
            });
            if (!error)
                return true;
        }
        catch {
            // fallback
        }
        const store = await this.loadLocalStore();
        store.users[discordId] = {
            ...store.users[discordId],
            discord_id: discordId,
            global_claim_flag: true,
            first_interaction_guild_id: guildId,
            victus_email: email || store.users[discordId]?.victus_email || null,
            updated_at: now,
        };
        await this.saveLocalStore(store);
        return true;
    }
    // ============================================
    // GUILDS (Battle Pass & Owner monetization)
    // ============================================
    async getGuild(guildId, ownerId) {
        try {
            const { data, error } = await supabase.client
                .from('bot_guilds')
                .select('*')
                .eq('guild_id', guildId)
                .maybeSingle();
            if (!error && data) {
                return data;
            }
        }
        catch {
            // fallback
        }
        const store = await this.loadLocalStore();
        if (!store.guilds[guildId]) {
            store.guilds[guildId] = {
                guild_id: guildId,
                owner_id: ownerId || '',
                guild_xp: 0,
                guild_level: 1,
                last_chat_at: new Date().toISOString(),
                ram_bonus_claimed: false,
                subdomain_unlocked: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            await this.saveLocalStore(store);
        }
        return store.guilds[guildId];
    }
    async addGuildXp(guildId, xpAmount, ownerId) {
        const guild = await this.getGuild(guildId, ownerId);
        const oldLevel = guild.guild_level;
        const newXp = guild.guild_xp + Math.max(0, Math.round(xpAmount));
        // Level formula: level = Math.floor(Math.sqrt(xp / 500)) + 1
        const newLevel = Math.max(1, Math.floor(Math.sqrt(newXp / 500)) + 1);
        const leveledUp = newLevel > oldLevel;
        const newRewards = [];
        let ramBonusClaimed = guild.ram_bonus_claimed ?? false;
        let subdomainUnlocked = guild.subdomain_unlocked ?? false;
        if (newLevel >= 5 && !ramBonusClaimed) {
            ramBonusClaimed = true;
            newRewards.push('Level 5: Free +1GB RAM Hosting Credit Coupon on Victus Cloud');
        }
        if (newLevel >= 10 && !subdomainUnlocked) {
            subdomainUnlocked = true;
            newRewards.push('Level 10: Free Custom Subdomain (mysmp.victus.gg)');
        }
        const updated = {
            ...guild,
            guild_xp: newXp,
            guild_level: newLevel,
            ram_bonus_claimed: ramBonusClaimed,
            subdomain_unlocked: subdomainUnlocked,
            last_chat_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        try {
            await supabase.client
                .from('bot_guilds')
                .upsert(updated);
        }
        catch {
            // fallback
        }
        const store = await this.loadLocalStore();
        store.guilds[guildId] = updated;
        await this.saveLocalStore(store);
        return { guild: updated, leveledUp, newRewards };
    }
    async updateGuildSettings(guildId, patch) {
        const guild = await this.getGuild(guildId);
        const updated = {
            ...guild,
            ...patch,
            updated_at: new Date().toISOString(),
        };
        try {
            await supabase.client
                .from('bot_guilds')
                .upsert(updated);
        }
        catch {
            // fallback
        }
        const store = await this.loadLocalStore();
        store.guilds[guildId] = updated;
        await this.saveLocalStore(store);
        return updated;
    }
    // ============================================
    // INVENTORY (Minecraft Text-RPG)
    // ============================================
    async getInventory(discordId) {
        try {
            const { data, error } = await supabase.client
                .from('bot_inventory')
                .select('*')
                .eq('discord_id', discordId)
                .maybeSingle();
            if (!error && data) {
                return data;
            }
        }
        catch {
            // fallback
        }
        const store = await this.loadLocalStore();
        if (!store.inventories[discordId]) {
            store.inventories[discordId] = {
                discord_id: discordId,
                ores_json: { coal: 0, iron: 0, gold: 0, diamond: 0, netherite: 0 },
                fish_json: { cod: 0, salmon: 0, tropical: 0, pufferfish: 0, treasure: 0 },
                mobs_json: [],
                pickaxe_tier: 'wood',
                rod_tier: 'wood',
                last_mine_at: null,
                last_fish_at: null,
                updated_at: new Date().toISOString(),
            };
            await this.saveLocalStore(store);
        }
        return store.inventories[discordId];
    }
    async saveInventory(inv) {
        inv.updated_at = new Date().toISOString();
        try {
            await supabase.client
                .from('bot_inventory')
                .upsert(inv);
        }
        catch {
            // fallback
        }
        const store = await this.loadLocalStore();
        store.inventories[inv.discord_id] = inv;
        await this.saveLocalStore(store);
    }
    // ============================================
    // REFERRALS
    // ============================================
    async recordReferral(referrerGuildId, referredDiscordId, email) {
        const referral = {
            id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            referrer_guild_id: referrerGuildId,
            referred_discord_id: referredDiscordId,
            referred_email: email || null,
            status: 'pending',
            coins_rewarded: 30,
            created_at: new Date().toISOString(),
        };
        try {
            await supabase.client
                .from('bot_referrals')
                .insert(referral);
        }
        catch {
            // fallback
        }
        const store = await this.loadLocalStore();
        store.referrals[referredDiscordId] = referral;
        await this.saveLocalStore(store);
        return referral;
    }
    async getGuildReferralStats(guildId) {
        let list = [];
        try {
            const { data, error } = await supabase.client
                .from('bot_referrals')
                .select('*')
                .eq('referrer_guild_id', guildId);
            if (!error && data) {
                list = data;
            }
        }
        catch {
            // fallback
        }
        if (list.length === 0) {
            const store = await this.loadLocalStore();
            list = Object.values(store.referrals).filter((r) => r.referrer_guild_id === guildId);
        }
        const verified = list.filter((r) => r.status === 'verified').length;
        return {
            total: list.length,
            verified,
            coinsEarned: verified * 30,
        };
    }
    // ============================================
    // WORLD BOSSES
    // ============================================
    async getActiveWorldBoss() {
        try {
            const { data, error } = await supabase.client
                .from('bot_world_bosses')
                .select('*')
                .eq('status', 'active')
                .order('spawned_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (!error && data)
                return data;
        }
        catch {
            // fallback
        }
        const store = await this.loadLocalStore();
        const active = Object.values(store.bosses).find((b) => b.status === 'active');
        return active || null;
    }
    async saveWorldBoss(boss) {
        try {
            await supabase.client
                .from('bot_world_bosses')
                .upsert(boss);
        }
        catch {
            // fallback
        }
        const store = await this.loadLocalStore();
        store.bosses[boss.id] = boss;
        await this.saveLocalStore(store);
    }
    // ============================================
    // ALLIANCE WARS
    // ============================================
    async getActiveWar(guildId) {
        try {
            const { data, error } = await supabase.client
                .from('bot_alliance_wars')
                .select('*')
                .eq('status', 'active')
                .or(`guild_1_id.eq.${guildId},guild_2_id.eq.${guildId}`)
                .maybeSingle();
            if (!error && data)
                return data;
        }
        catch {
            // fallback
        }
        const store = await this.loadLocalStore();
        return Object.values(store.wars).find((w) => w.status === 'active' && (w.guild_1_id === guildId || w.guild_2_id === guildId)) || null;
    }
    async saveAllianceWar(war) {
        try {
            await supabase.client
                .from('bot_alliance_wars')
                .upsert(war);
        }
        catch {
            // fallback
        }
        const store = await this.loadLocalStore();
        store.wars[war.id] = war;
        await this.saveLocalStore(store);
    }
    // ============================================
    // SMP NETWORK DIRECTORY
    // ============================================
    async getSmpServers(limit = 10) {
        try {
            const { data, error } = await supabase.client
                .from('bot_smp_network')
                .select('*')
                .order('votes', { ascending: false })
                .limit(limit);
            if (!error && data)
                return data;
        }
        catch {
            // fallback
        }
        const store = await this.loadLocalStore();
        return Object.values(store.smp_servers)
            .sort((a, b) => b.votes - a.votes)
            .slice(0, limit);
    }
    async registerSmpServer(server) {
        const full = {
            ...server,
            id: `smp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            votes: 0,
            created_at: new Date().toISOString(),
        };
        try {
            await supabase.client
                .from('bot_smp_network')
                .upsert(full);
        }
        catch {
            // fallback
        }
        const store = await this.loadLocalStore();
        store.smp_servers[full.guild_id] = full;
        await this.saveLocalStore(store);
        return full;
    }
    // ============================================
    // EMERGENCY LIFEBOAT BACKUPS
    // ============================================
    async getLifeboat(guildId) {
        try {
            const { data, error } = await supabase.client
                .from('bot_lifeboat_backups')
                .select('*')
                .eq('guild_id', guildId)
                .maybeSingle();
            if (!error && data)
                return data;
        }
        catch {
            // fallback
        }
        const store = await this.loadLocalStore();
        return store.lifeboats[guildId] || null;
    }
    async saveLifeboat(lifeboat) {
        try {
            await supabase.client
                .from('bot_lifeboat_backups')
                .upsert(lifeboat);
        }
        catch {
            // fallback
        }
        const store = await this.loadLocalStore();
        store.lifeboats[lifeboat.guild_id] = lifeboat;
        await this.saveLocalStore(store);
    }
    async getAllLifeboats() {
        try {
            const { data, error } = await supabase.client
                .from('bot_lifeboat_backups')
                .select('*');
            if (!error && data)
                return data;
        }
        catch {
            // fallback
        }
        const store = await this.loadLocalStore();
        return Object.values(store.lifeboats);
    }
}
export const viralExpansionStore = new ViralExpansionStore();
