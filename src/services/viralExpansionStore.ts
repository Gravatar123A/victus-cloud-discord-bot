import { mkdir, readFile, open, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
import { gameUuid } from './gameRules.js';

export interface BotExpansionUser {
    discord_id: string;
    victus_email?: string | null;
    coins_balance?: number;
    account_age?: string;
    global_claim_flag: boolean;
    first_interaction_guild_id?: string | null;
    created_at?: string;
    updated_at?: string;
}

export interface BotGuild {
    guild_id: string;
    owner_id: string;
    guild_xp: number;
    guild_level: number;
    ref_code?: string | null;
    airdrop_channel_id?: string | null;
    airdrop_role_id?: string | null;
    last_chat_at?: string;
    ram_bonus_claimed?: boolean;
    subdomain_unlocked?: boolean;
    created_at?: string;
    updated_at?: string;
}

export interface BotReferral {
    id: string;
    referrer_guild_id: string;
    referred_discord_id: string;
    referred_email?: string | null;
    status: 'pending' | 'verified';
    coins_rewarded: number;
    created_at: string;
    verified_at?: string | null;
}

export interface OreInventory {
    coal: number;
    iron: number;
    gold: number;
    diamond: number;
    netherite: number;
}

export interface FishInventory {
    cod: number;
    salmon: number;
    tropical: number;
    pufferfish: number;
    treasure: number;
}

export interface CapturedMob {
    id: string;
    name: string;
    species: string;
    rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';
    power: number;
    health: number;
    capturedAt: string;
    stars: number;
}

export interface BotInventory {
    discord_id: string;
    ores_json: OreInventory;
    fish_json: FishInventory;
    mobs_json: CapturedMob[];
    pickaxe_tier: 'wood' | 'stone' | 'iron' | 'diamond' | 'netherite';
    rod_tier: 'wood' | 'lucky' | 'sea' | 'prismarine';
    last_mine_at?: string | null;
    last_fish_at?: string | null;
    updated_at?: string;
}

export interface BotWorldBoss {
    id: string;
    boss_type: 'ender_dragon' | 'wither';
    max_hp: number;
    current_hp: number;
    pool_coins: number;
    participants_json: Record<string, { damage: number; name: string; hits: number; last_attack_at?: string; reward_coins?: number; paid?: boolean }>;
    channel_ids: string[];
    status: 'active' | 'settling' | 'defeated' | 'expired';
    spawned_at: string;
    defeated_at?: string | null;
}

export interface BotAllianceWar {
    id: string;
    guild_1_id: string;
    guild_2_id: string;
    points_1: number;
    points_2: number;
    status: 'active' | 'ended';
    pool_coins: number;
    starts_at: string;
    ends_at: string;
    winner_guild_id?: string | null;
}

export interface BotSmpServer {
    id: string;
    guild_id: string;
    server_name: string;
    ip: string;
    port: number;
    is_bedrock: boolean;
    category: string;
    description?: string;
    votes: number;
    created_at: string;
}

export interface BotLifeboatBackup {
    id: string;
    guild_id: string;
    server_ip: string;
    server_port: number;
    host_type: string;
    sftp_host?: string;
    sftp_port?: number;
    sftp_user?: string;
    last_status: 'online' | 'offline';
    last_check_at?: string;
    last_backup_at?: string;
    backup_file_path?: string;
}

export interface PendingRpgSale {
    reference: string;
    inventory: BotInventory;
    coins: number;
    sold: { item: string; count: number; coins: number }[];
}

function missingTable(error: any): boolean {
    return ['42P01', 'PGRST205'].includes(error?.code);
}

interface LocalStoreSchema {
    pending_sales?: Record<string, PendingRpgSale>;
    users: Record<string, BotExpansionUser>;
    guilds: Record<string, BotGuild>;
    referrals: Record<string, BotReferral>;
    inventories: Record<string, BotInventory>;
    bosses: Record<string, BotWorldBoss>;
    wars: Record<string, BotAllianceWar>;
    smp_servers: Record<string, BotSmpServer>;
    lifeboats: Record<string, BotLifeboatBackup>;
}

const STORE_PATH = join(process.cwd(), 'data', 'expansion-store.json');

class AsyncMutex {
    private queue: Array<() => void> = [];
    private locked = false;

    async acquire(): Promise<() => void> {
        return new Promise<() => void>((resolve) => {
            const release = () => {
                if (this.queue.length > 0) {
                    const next = this.queue.shift()!;
                    next();
                } else {
                    this.locked = false;
                }
            };

            if (!this.locked) {
                this.locked = true;
                resolve(release);
            } else {
                this.queue.push(() => resolve(release));
            }
        });
    }
}

const fileMutex = new AsyncMutex();

export class ViralExpansionStore {
    private cache: LocalStoreSchema | null = null;
    private loading: Promise<LocalStoreSchema> | null = null;
    constructor(private storePath = STORE_PATH) {}

    private async loadLocalStore(): Promise<LocalStoreSchema> {
        if (this.cache) return this.cache;
        if (!this.loading) this.loading = this.readLocalStore().finally(() => { this.loading = null; });
        return this.loading;
    }

    private async readLocalStore(): Promise<LocalStoreSchema> {
        try {
            const raw = await readFile(this.storePath, 'utf8');
            this.cache = JSON.parse(raw) as LocalStoreSchema;
        } catch (error: any) {
            if (error?.code !== 'ENOENT') throw error;
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

    private async saveLocalStore(store: LocalStoreSchema): Promise<void> {
        const release = await fileMutex.acquire();
        try {
            await mkdir(dirname(this.storePath), { recursive: true });
            const tempPath = `${this.storePath}.${Date.now()}.tmp`;
            const file = await open(tempPath, 'w');
            try { await file.writeFile(JSON.stringify(store, null, 2)); await file.sync(); }
            finally { await file.close(); }
            await rename(tempPath, this.storePath);
            this.cache = store;
        } catch (err) {
            this.cache = null;
            logger.error('Failed to save expansion local store:', err);
            throw err;
        } finally {
            release();
        }
    }

    // ============================================
    // USERS (First-command unique interaction bonus)
    // ============================================

    async getUser(discordId: string): Promise<BotExpansionUser> {
        // Try Supabase first
        try {
            const { data, error } = await supabase.client
                .from('bot_expansion_users')
                .select('*')
                .eq('discord_id', discordId)
                .maybeSingle();

            if (!error && data) {
                return data as BotExpansionUser;
            }
        } catch {
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

    async setUserGlobalClaim(discordId: string, guildId: string, email?: string): Promise<boolean> {
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

            if (!error) return true;
        } catch {
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

    async getGuild(guildId: string, ownerId?: string): Promise<BotGuild> {
        try {
            const { data, error } = await supabase.client
                .from('bot_guilds')
                .select('*')
                .eq('guild_id', guildId)
                .maybeSingle();

            if (!error && data) {
                return data as BotGuild;
            }
        } catch {
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

    async addGuildXp(guildId: string, xpAmount: number, ownerId?: string): Promise<{ guild: BotGuild; leveledUp: boolean; newRewards: string[] }> {
        const guild = await this.getGuild(guildId, ownerId);
        const oldLevel = guild.guild_level;
        const newXp = guild.guild_xp + Math.max(0, Math.round(xpAmount));
        // Level formula: level = Math.floor(Math.sqrt(xp / 500)) + 1
        const newLevel = Math.max(1, Math.floor(Math.sqrt(newXp / 500)) + 1);
        const leveledUp = newLevel > oldLevel;

        const newRewards: string[] = [];
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

        const updated: BotGuild = {
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
        } catch {
            // fallback
        }

        const store = await this.loadLocalStore();
        store.guilds[guildId] = updated;
        await this.saveLocalStore(store);

        return { guild: updated, leveledUp, newRewards };
    }

    async updateGuildSettings(guildId: string, patch: Partial<BotGuild>): Promise<BotGuild> {
        const guild = await this.getGuild(guildId);
        const updated: BotGuild = {
            ...guild,
            ...patch,
            updated_at: new Date().toISOString(),
        };

        try {
            await supabase.client
                .from('bot_guilds')
                .upsert(updated);
        } catch {
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

    async getInventory(discordId: string): Promise<BotInventory> {
        const { data, error } = await supabase.client.from('bot_inventory').select('*').eq('discord_id', discordId).maybeSingle();
        if (error && !missingTable(error)) throw new Error(`Inventory unavailable: ${error.message}`);
        if (data) return structuredClone(data) as BotInventory;
        const store = await this.loadLocalStore();
        if (error && store.inventories[discordId]) return structuredClone(store.inventories[discordId]);
        return {
            discord_id: discordId,
            ores_json: { coal: 0, iron: 0, gold: 0, diamond: 0, netherite: 0 },
            fish_json: { cod: 0, salmon: 0, tropical: 0, pufferfish: 0, treasure: 0 },
            mobs_json: [], pickaxe_tier: 'wood', rod_tier: 'wood',
            last_mine_at: null, last_fish_at: null,
        };
    }

    async saveInventory(inv: BotInventory): Promise<void> {
        const updated = { ...inv, updated_at: new Date().toISOString() };
        const { error } = await supabase.client.from('bot_inventory').upsert(updated);
        if (error && !missingTable(error)) throw new Error(`Inventory save failed: ${error.message}`);
        if (!error) return;
        const store = await this.loadLocalStore();
        store.inventories[inv.discord_id] = updated;
        await this.saveLocalStore(store);
    }

    async getPendingSale(discordId: string): Promise<PendingRpgSale | null> {
        return structuredClone((await this.loadLocalStore()).pending_sales?.[discordId] || null);
    }

    async savePendingSale(discordId: string, sale: PendingRpgSale | null): Promise<void> {
        const store = await this.loadLocalStore();
        store.pending_sales ||= {};
        if (sale) store.pending_sales[discordId] = structuredClone(sale);
        else delete store.pending_sales[discordId];
        await this.saveLocalStore(store);
    }

    // ============================================
    // REFERRALS
    // ============================================

    async recordReferral(referrerGuildId: string, referredDiscordId: string, email?: string): Promise<BotReferral> {
        const referral: BotReferral = {
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
        } catch {
            // fallback
        }

        const store = await this.loadLocalStore();
        store.referrals[referredDiscordId] = referral;
        await this.saveLocalStore(store);
        return referral;
    }

    async getGuildReferralStats(guildId: string): Promise<{ total: number; verified: number; coinsEarned: number }> {
        let list: BotReferral[] = [];
        try {
            const { data, error } = await supabase.client
                .from('bot_referrals')
                .select('*')
                .eq('referrer_guild_id', guildId);

            if (!error && data) {
                list = data as BotReferral[];
            }
        } catch {
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

    async getLatestWorldBoss(): Promise<BotWorldBoss | null> {
        const { data, error } = await supabase.client.from('bot_world_bosses').select('*')
            .order('spawned_at', { ascending: false }).limit(1).maybeSingle();
        if (error && !missingTable(error)) throw new Error(`Raid unavailable: ${error.message}`);
        if (data) return structuredClone(data) as BotWorldBoss;
        const store = await this.loadLocalStore();
        const local = structuredClone(Object.values(store.bosses).sort((a, b) => b.spawned_at.localeCompare(a.spawned_at))[0] || null);
        if (error || !local) return local;
        // Older versions used non-UUID IDs, silently failed DB writes, and kept
        // raids only on disk. Import that raid without resetting its cooldown.
        const migrated = { ...local, id: gameUuid(local.id) };
        const imported = await supabase.client.from('bot_world_bosses').insert(migrated);
        if (imported.error && imported.error.code !== '23505') throw new Error(`Raid recovery failed: ${imported.error.message}`);
        if (imported.error) return this.getLatestWorldBoss();
        return migrated;
    }

    async getPendingWorldBosses(): Promise<BotWorldBoss[]> {
        const pending: BotWorldBoss[] = [];
        for (let offset = 0; ; offset += 100) {
            const { data, error } = await supabase.client.from('bot_world_bosses').select('*')
                .eq('status', 'settling').order('spawned_at').range(offset, offset + 99);
            if (error && !missingTable(error)) throw new Error(`Raid payouts unavailable: ${error.message}`);
            if (error) return structuredClone(Object.values((await this.loadLocalStore()).bosses).filter(boss => boss.status === 'settling'));
            pending.push(...(data || []) as BotWorldBoss[]);
            if (!data || data.length < 100) return pending;
        }
    }

    async getActiveWorldBoss(): Promise<BotWorldBoss | null> {
        const boss = await this.getLatestWorldBoss();
        return boss?.status === 'active' ? boss : null;
    }

    /** Compare-and-swap prevents two workers accepting the same hit/final blow.
     * Spawn IDs are derived from the previous raid, so concurrent spawns collide. */
    async commitWorldBoss(expected: BotWorldBoss | null, boss: BotWorldBoss): Promise<boolean> {
        const query = expected
            ? supabase.client.from('bot_world_bosses').update(boss).eq('id', expected.id)
                .eq('status', expected.status).eq('current_hp', expected.current_hp).select('id')
            : supabase.client.from('bot_world_bosses').insert(boss).select('id');
        const { data, error } = await query;
        if (error?.code === '23505') return false;
        if (error && !missingTable(error)) throw new Error(`Raid save failed: ${error.message}`);
        if (!error) return !!data?.length;
        const store = await this.loadLocalStore();
        const current = store.bosses[boss.id];
        if (expected ? JSON.stringify(current) !== JSON.stringify(expected) : !!current) return false;
        store.bosses[boss.id] = structuredClone(boss);
        await this.saveLocalStore(store);
        return true;
    }

    // ============================================
    // ALLIANCE WARS
    // ============================================

    async getActiveWar(guildId: string): Promise<BotAllianceWar | null> {
        try {
            const { data, error } = await supabase.client
                .from('bot_alliance_wars')
                .select('*')
                .eq('status', 'active')
                .or(`guild_1_id.eq.${guildId},guild_2_id.eq.${guildId}`)
                .maybeSingle();

            if (!error && data) return data as BotAllianceWar;
        } catch {
            // fallback
        }

        const store = await this.loadLocalStore();
        return Object.values(store.wars).find(
            (w) => w.status === 'active' && (w.guild_1_id === guildId || w.guild_2_id === guildId)
        ) || null;
    }

    async saveAllianceWar(war: BotAllianceWar): Promise<void> {
        try {
            await supabase.client
                .from('bot_alliance_wars')
                .upsert(war);
        } catch {
            // fallback
        }

        const store = await this.loadLocalStore();
        store.wars[war.id] = war;
        await this.saveLocalStore(store);
    }

    // ============================================
    // SMP NETWORK DIRECTORY
    // ============================================

    async getSmpServers(limit = 10): Promise<BotSmpServer[]> {
        try {
            const { data, error } = await supabase.client
                .from('bot_smp_network')
                .select('*')
                .order('votes', { ascending: false })
                .limit(limit);

            if (!error && data) return data as BotSmpServer[];
        } catch {
            // fallback
        }

        const store = await this.loadLocalStore();
        return Object.values(store.smp_servers)
            .sort((a, b) => b.votes - a.votes)
            .slice(0, limit);
    }

    async registerSmpServer(server: Omit<BotSmpServer, 'id' | 'votes' | 'created_at'>): Promise<BotSmpServer> {
        const full: BotSmpServer = {
            ...server,
            id: `smp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            votes: 0,
            created_at: new Date().toISOString(),
        };

        try {
            await supabase.client
                .from('bot_smp_network')
                .upsert(full);
        } catch {
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

    async getLifeboat(guildId: string): Promise<BotLifeboatBackup | null> {
        try {
            const { data, error } = await supabase.client
                .from('bot_lifeboat_backups')
                .select('*')
                .eq('guild_id', guildId)
                .maybeSingle();

            if (!error && data) return data as BotLifeboatBackup;
        } catch {
            // fallback
        }

        const store = await this.loadLocalStore();
        return store.lifeboats[guildId] || null;
    }

    async saveLifeboat(lifeboat: BotLifeboatBackup): Promise<void> {
        try {
            await supabase.client
                .from('bot_lifeboat_backups')
                .upsert(lifeboat);
        } catch {
            // fallback
        }

        const store = await this.loadLocalStore();
        store.lifeboats[lifeboat.guild_id] = lifeboat;
        await this.saveLocalStore(store);
    }

    async getAllLifeboats(): Promise<BotLifeboatBackup[]> {
        try {
            const { data, error } = await supabase.client
                .from('bot_lifeboat_backups')
                .select('*');

            if (!error && data) return data as BotLifeboatBackup[];
        } catch {
            // fallback
        }

        const store = await this.loadLocalStore();
        return Object.values(store.lifeboats);
    }
}

export const viralExpansionStore = new ViralExpansionStore();
