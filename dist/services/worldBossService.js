import { viralExpansionStore } from './viralExpansionStore.js';
import { CoinTransactionLock } from './coinTransactionLock.js';
import { withGameLock } from './gameLock.js';
import { BOSS_ATTACK_COOLDOWN_MS, BOSS_RESPAWN_MS, BOSS_LIFETIME_MS, bossRewards, gameUuid } from './gameRules.js';
export class WorldBossService {
    store;
    coins;
    now;
    random;
    constructor(store = viralExpansionStore, coins = CoinTransactionLock, now = Date.now, random = Math.random) {
        this.store = store;
        this.coins = coins;
        this.now = now;
        this.random = random;
    }
    async settle(boss) {
        if (!['defeated', 'settling'].includes(boss.status))
            return boss;
        // Only newly recorded rewards are retried; historical bosses were already paid.
        for (const [id, participant] of Object.entries(boss.participants_json)) {
            if (!participant.reward_coins || participant.paid)
                continue;
            const result = await this.coins.grantCoins(id, participant.reward_coins, 'world_boss_raid', `boss:${boss.id}:${id}`, `World Boss reward (+${participant.reward_coins} COINS)`);
            if (!result.success)
                continue;
            const next = structuredClone(boss);
            next.participants_json[id].paid = true;
            if (await this.store.commitWorldBoss(boss, next))
                boss = next;
            else
                return (await this.store.getLatestWorldBoss()) || boss;
        }
        if (boss.status === 'settling' && !Object.values(boss.participants_json).some(p => p.reward_coins && !p.paid)) {
            const settled = { ...boss, status: 'defeated' };
            if (await this.store.commitWorldBoss(boss, settled))
                boss = settled;
        }
        return boss;
    }
    async state() {
        let boss = await this.store.getLatestWorldBoss();
        const now = this.now();
        if (boss?.status === 'active' && now >= Date.parse(boss.spawned_at) + BOSS_LIFETIME_MS) {
            const expired = { ...boss, status: 'expired', defeated_at: new Date(now).toISOString() };
            if (!await this.store.commitWorldBoss(boss, expired))
                return { boss: null, retryAt: now + 1000 };
            boss = expired;
        }
        if (boss?.status === 'active')
            return { boss, retryAt: 0 };
        if (boss) {
            boss = await this.settle(boss);
            const ended = Date.parse(boss.defeated_at || boss.spawned_at);
            const retryAt = (Number.isFinite(ended) ? ended : now) + BOSS_RESPAWN_MS;
            const pending = Object.values(boss.participants_json).some(p => p.reward_coins && !p.paid);
            if (now < retryAt)
                return { boss: null, retryAt, pending };
        }
        const dragon = this.random() >= .5;
        const spawned = {
            id: gameUuid(boss?.id || 'victus-first-raid'),
            boss_type: dragon ? 'ender_dragon' : 'wither', max_hp: dragon ? 10000 : 7500,
            current_hp: dragon ? 10000 : 7500, pool_coins: dragon ? 1000 : 750,
            participants_json: {}, channel_ids: [], status: 'active', spawned_at: new Date(now).toISOString(),
        };
        if (!await this.store.commitWorldBoss(null, spawned))
            return { boss: null, retryAt: now + 1000 };
        return { boss: spawned, retryAt: 0 };
    }
    async getState() { return withGameLock('world-boss', () => this.state()); }
    maintaining = false;
    async maintain() {
        if (this.maintaining)
            return;
        this.maintaining = true;
        try {
            for (const pending of await this.store.getPendingWorldBosses()) {
                await withGameLock('world-boss', () => this.settle(pending));
            }
            await this.getState();
        }
        finally {
            this.maintaining = false;
        }
    }
    async attack(user, type) {
        return withGameLock('world-boss', async () => {
            if (!await this.coins.resolveLinkedUser(user.id)) {
                return { success: false, message: 'Use /link before joining a raid so your bounty can be paid.' };
            }
            const state = await this.state();
            if (!state.boss)
                return { success: false, message: state.pending
                        ? `Rewards are pending and will retry. The next boss arrives <t:${Math.ceil(state.retryAt / 1000)}:R>.`
                        : `The next world boss arrives <t:${Math.ceil(state.retryAt / 1000)}:R>.` };
            const boss = structuredClone(state.boss);
            const previous = boss.participants_json[user.id];
            const nextHit = Date.parse(previous?.last_attack_at || '') + BOSS_ATTACK_COOLDOWN_MS;
            if (this.now() < nextHit)
                return { success: false, message: `Your next attack is ready <t:${Math.ceil(nextHit / 1000)}:R>. /attack and /cast share this cooldown.` };
            const inventory = await this.store.getInventory(user.id);
            const multiplier = ({ wood: 1, stone: 1.5, iron: 2.2, diamond: 3.5, netherite: 5 })[inventory.pickaxe_tier] || 1;
            const base = ({ melee: 15, bow: 25, magic: 40 })[type];
            if (!base)
                throw new Error('Invalid attack type.');
            const damage = Math.min(boss.current_hp, Math.round(base * multiplier * (.8 + this.random() * .4)));
            boss.current_hp -= damage;
            boss.participants_json[user.id] = {
                damage: (previous?.damage || 0) + damage, hits: (previous?.hits || 0) + 1,
                name: user.username, last_attack_at: new Date(this.now()).toISOString(),
            };
            if (!boss.current_hp) {
                boss.status = 'settling';
                boss.defeated_at = new Date(this.now()).toISOString();
                for (const [id, reward] of Object.entries(bossRewards(boss))) {
                    boss.participants_json[id].reward_coins = reward;
                    boss.participants_json[id].paid = reward === 0;
                }
            }
            // Persist the kill and payout plan BEFORE contacting the coin service.
            if (!await this.store.commitWorldBoss(state.boss, boss)) {
                return { success: false, message: 'Another raider landed a hit first. Try again; this attack was not charged.' };
            }
            const settled = await this.settle(boss);
            return { success: true, damageDealt: damage, remainingHp: boss.current_hp,
                maxHp: boss.max_hp, pool: boss.pool_coins, defeated: boss.current_hp === 0,
                rewardSummary: Object.entries(settled.participants_json).filter(([, p]) => p.reward_coins)
                    .sort((a, b) => (b[1].reward_coins || 0) - (a[1].reward_coins || 0)).slice(0, 5)
                    .map(([id, p]) => `<@${id}>: **${p.reward_coins} COINS** (${p.paid ? 'paid' : 'pending; will retry'})`).join('\n') };
        });
    }
}
export const worldBossService = new WorldBossService();
