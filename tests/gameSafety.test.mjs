import test from 'node:test';
import assert from 'node:assert/strict';
import { RpgService } from '../dist/services/rpgService.js';
import { WorldBossService } from '../dist/services/worldBossService.js';
import { planSale, bossRewards, BOSS_RESPAWN_MS, BOSS_ATTACK_COOLDOWN_MS } from '../dist/services/gameRules.js';

function inventory(id = 'player') {
    return { discord_id: id, ores_json: { coal: 10, iron: 15, gold: 5, diamond: 19, netherite: 9 },
        fish_json: { cod: 11, salmon: 5, tropical: 3, pufferfish: 1, treasure: 1 },
        mobs_json: [], pickaxe_tier: 'iron', rod_tier: 'wood' };
}
function harness() {
    let inv = inventory();
    let boss = null;
    const bosses = {};
    let pending = null;
    let now = Date.parse('2026-10-11T00:00:00Z');
    const grants = new Map();
    const store = {
        async getInventory() { await Promise.resolve(); return structuredClone(inv); },
        async saveInventory(value) { inv = structuredClone(value); },
        async getPendingSale() { return structuredClone(pending); },
        async savePendingSale(id, value) { pending = structuredClone(value); },
        async getLatestWorldBoss() { return structuredClone(boss); },
        async getPendingWorldBosses() { return structuredClone(Object.values(bosses).filter(b => b.status === 'settling')); },
        async commitWorldBoss(expected, value) {
            if (expected ? JSON.stringify(expected) !== JSON.stringify(bosses[expected.id]) : !!bosses[value.id]) return false;
            bosses[value.id] = structuredClone(value);
            if (!expected || boss?.id === value.id) boss = structuredClone(value);
            return true;
        },
    };
    const coins = {
        async resolveLinkedUser() { return { userId: 'victus-id' }; },
        async grantCoins(id, amount, source, reference) { grants.set(reference, amount); return { success: true, newBalance: 100 }; },
    };
    return { store, coins, grants, clock: () => now, advance: ms => { now += ms; },
        inv: () => inv, boss: () => boss, pending: () => pending,
        setBoss: value => { boss = structuredClone(value); bosses[value.id] = structuredClone(value); },
        rpg: () => new RpgService(store, coins, () => now, () => 0),
        raid: () => new WorldBossService(store, coins, () => now, () => .5) };
}
const user = { id: 'player', username: 'Player' };

test('one-click mining is immediate and overlapping clicks cannot bypass its short guard', async () => {
    const h = harness();
    const results = await Promise.allSettled([h.rpg().gather('player', 'mine'), h.rpg().gather('player', 'mine')]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(h.inv().ores_json.coal, 11);
    h.advance(1000);
    await h.rpg().gather('player', 'mine');
    assert.equal(h.inv().ores_json.coal, 12);
});

test('specific quantity sells only that material and common bulk sales preserve rare ores', () => {
    const raw = inventory();
    const partial = planSale(raw, 'diamond', 2);
    assert.equal(partial.coins, 10);
    assert.equal(partial.inventory.ores_json.diamond, 17);
    assert.equal(partial.inventory.ores_json.netherite, 9);
    const common = planSale(raw, 'common');
    assert.equal(common.inventory.ores_json.diamond, 19);
    assert.equal(common.inventory.ores_json.netherite, 9);
    assert.deepEqual(common.inventory.fish_json, raw.fish_json);
    assert.equal(raw.ores_json.coal, 10);
});

test('fractional lots and invalid quantities never destroy materials', () => {
    const sale = planSale(inventory(), 'coal', 8);
    assert.equal(sale.coins, 1);
    assert.equal(sale.inventory.ores_json.coal, 5);
    for (const qty of [0, -1, 1.5, NaN, Infinity, 1000]) assert.throws(() => planSale(inventory(), 'coal', qty));
    assert.throws(() => planSale(inventory(), 'unknown'));
    assert.throws(() => planSale(inventory(), 'all', 2));
    assert.throws(() => planSale(inventory(), 'coal', 1));
});

test('simultaneous sales pay once for the available materials', async () => {
    const h = harness();
    const results = await Promise.allSettled([h.rpg().sell('player', 'diamond'), h.rpg().sell('player', 'diamond')]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(h.grants.size, 1);
    assert.equal(h.inv().ores_json.diamond, 0);
});

test('unlinked sales and inventory save failures pay nothing', async () => {
    const h = harness();
    h.coins.resolveLinkedUser = async () => null;
    await assert.rejects(h.rpg().sell('player', 'diamond'), /link/);
    assert.equal(h.pending(), null);
    assert.equal(h.inv().ores_json.diamond, 19);
    h.coins.resolveLinkedUser = async () => ({ userId: 'linked' });
    h.store.saveInventory = async () => { throw new Error('storage down'); };
    await assert.rejects(h.rpg().sell('player', 'diamond'), /storage down/);
    assert.equal(h.grants.size, 0);
    assert.ok(h.pending());
});

test('ambiguous payout resumes after restart using the SAME reference before further gathering', async () => {
    const h = harness();
    const grant = h.coins.grantCoins;
    h.coins.grantCoins = async (...args) => { await grant(...args); return { success: false }; };
    await assert.rejects(h.rpg().sell('player', 'diamond', 2), /reserved/);
    const reference = h.pending().reference;
    assert.equal(h.inv().ores_json.diamond, 17);
    h.coins.grantCoins = grant;
    await h.rpg().gather('player', 'mine');
    assert.equal(h.grants.size, 1);
    assert.ok(h.grants.has(reference));
    assert.equal(h.pending(), null);
    assert.equal(h.inv().ores_json.diamond, 17);
    assert.equal(h.inv().ores_json.coal, 11);
});

test('crafting cannot downgrade equipment or charge twice', async () => {
    const h = harness();
    await assert.rejects(h.rpg().craft('player', 'pick_stone'), /already own/);
    await assert.rejects(h.rpg().craft('player', 'pick_iron'), /already own/);
    assert.equal(h.inv().ores_json.iron, 15);
    await h.rpg().craft('player', 'rod_lucky').catch(() => {});
    assert.equal(h.inv().rod_tier, 'wood');
});

test('raid cooldown survives service restart and covers melee, cast and other servers', async () => {
    const h = harness();
    assert.equal((await h.raid().attack(user, 'melee')).success, true);
    assert.equal((await h.raid().attack(user, 'magic')).success, false);
    h.advance(BOSS_ATTACK_COOLDOWN_MS);
    assert.equal((await h.raid().attack(user, 'magic')).success, true);
    assert.equal(h.boss().participants_json.player.hits, 2);
});

test('concurrent final blows persist defeat once, cap damage, and cannot respawn via status or attack', async () => {
    const h = harness();
    await h.raid().getState();
    const boss = structuredClone(h.boss()); boss.current_hp = 1; h.setBoss(boss);
    const hits = await Promise.all([h.raid().attack(user, 'magic'), h.raid().attack(user, 'melee')]);
    assert.equal(hits.filter(r => r.success && r.defeated).length, 1);
    assert.equal(h.boss().participants_json.player.damage, 1);
    assert.equal(h.grants.size, 1);
    assert.equal([...h.grants.values()][0], boss.pool_coins);
    assert.equal((await h.raid().getState()).boss, null);
    h.advance(BOSS_RESPAWN_MS - 1);
    assert.equal((await h.raid().attack(user, 'magic')).success, false);
    h.advance(1);
    assert.notEqual((await h.raid().getState()).boss.id, boss.id);
});

test('raid payouts never exceed the pool, even with thousands of tiny contributors', () => {
    const participants_json = Object.fromEntries(Array.from({ length: 1600 }, (_, i) => [String(i), { damage: 1, hits: 1, name: 'Raider' }]));
    const rewards = bossRewards({ pool_coins: 750, participants_json });
    assert.equal(Object.values(rewards).reduce((a, b) => a + b, 0), 750);
    assert.ok(Object.values(rewards).every(Number.isInteger));
});

test('failed defeat persistence awards nothing; failed payouts stay pending and retry idempotently', async () => {
    const h = harness();
    await h.raid().getState();
    const boss = structuredClone(h.boss()); boss.current_hp = 1; h.setBoss(boss);
    const commit = h.store.commitWorldBoss;
    h.store.commitWorldBoss = async () => { throw new Error('database unavailable'); };
    await assert.rejects(h.raid().attack(user, 'magic'), /database unavailable/);
    assert.equal(h.grants.size, 0);
    assert.equal(h.boss().status, 'active');
    h.store.commitWorldBoss = commit;
    const grant = h.coins.grantCoins;
    h.coins.grantCoins = async (...args) => { await grant(...args); return { success: false }; };
    const result = await h.raid().attack(user, 'magic');
    assert.match(result.rewardSummary, /pending/);
    assert.equal(h.boss().status, 'settling');
    h.coins.grantCoins = grant;
    await h.raid().getState();
    assert.equal(h.boss().participants_json.player.paid, true);
    assert.equal(h.grants.size, 1);
});

test('expired and historical defeated raids also respect recovery time', async () => {
    const h = harness();
    await h.raid().getState();
    h.advance(24 * 60 * 60_000);
    assert.equal((await h.raid().getState()).boss, null);
    assert.equal(h.boss().status, 'expired');
    h.advance(BOSS_RESPAWN_MS);
    assert.ok((await h.raid().getState()).boss);
});

test('pending rewards from an older boss recover after the next raid starts', async () => {
    const h = harness();
    await h.raid().getState();
    const boss = structuredClone(h.boss()); boss.current_hp = 1; h.setBoss(boss);
    const grant = h.coins.grantCoins;
    h.coins.grantCoins = async () => ({ success: false });
    await h.raid().attack(user, 'magic');
    h.advance(BOSS_RESPAWN_MS);
    const next = await h.raid().getState();
    assert.notEqual(next.boss.id, boss.id);
    h.coins.grantCoins = grant;
    await h.raid().maintain();
    assert.equal(h.grants.size, 1);
    assert.equal(h.boss().id, next.boss.id);
    assert.deepEqual(await h.store.getPendingWorldBosses(), []);
});
