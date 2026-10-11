import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ViralExpansionStore } from '../dist/services/viralExpansionStore.js';
import { supabase } from '../dist/services/supabase.js';
import { gameUuid } from '../dist/services/gameRules.js';

async function fixture(t) {
    const dir = await mkdtemp(join(tmpdir(), 'victus-rpg-'));
    const path = join(dir, 'store.json');
    const original = supabase.client.from;
    t.after(async () => { supabase.client.from = original; await rm(dir, { recursive: true, force: true }); });
    return { path, store: new ViralExpansionStore(path) };
}
function response(result) {
    const chain = {};
    for (const method of ['select', 'eq', 'order', 'limit', 'insert', 'update', 'upsert']) chain[method] = () => chain;
    chain.maybeSingle = async () => result;
    chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
    return chain;
}

test('pending sale reservations persist across restart and concurrent users keep separate journals', async t => {
    const { path, store } = await fixture(t);
    await Promise.all(Array.from({ length: 12 }, (_, i) => store.savePendingSale(String(i), { reference: `sale-${i}`, coins: i + 1 })));
    const reloaded = new ViralExpansionStore(path);
    for (let i = 0; i < 12; i++) assert.equal((await reloaded.getPendingSale(String(i))).reference, `sale-${i}`);
    await reloaded.savePendingSale('0', null);
    assert.equal((JSON.parse(await readFile(path, 'utf8'))).pending_sales['0'], undefined);
});

test('database failures never turn into an empty inventory, a fresh raid, or successful save', async t => {
    const { store } = await fixture(t);
    supabase.client.from = () => response({ data: null, error: { code: '57014', message: 'timeout' } });
    await assert.rejects(store.getInventory('player'), /Inventory unavailable/);
    await assert.rejects(store.saveInventory({ discord_id: 'player' }), /Inventory save failed/);
    await assert.rejects(store.getLatestWorldBoss(), /Raid unavailable/);
    await assert.rejects(store.commitWorldBoss(null, { id: gameUuid('new') }), /Raid save failed/);
});

test('legacy local raid migrates to a valid database UUID without resetting defeat time', async t => {
    const { path, store } = await fixture(t);
    const old = { id: 'boss_1234', status: 'defeated', spawned_at: '2026-10-11T00:00:00Z', defeated_at: '2026-10-11T00:05:00Z', participants_json: {}, current_hp: 0 };
    await writeFile(path, JSON.stringify({ bosses: { [old.id]: old } }));
    let imported;
    supabase.client.from = () => {
        const chain = response({ data: null, error: null });
        chain.insert = value => { imported = value; return response({ error: null }); };
        return chain;
    };
    const boss = await store.getLatestWorldBoss();
    assert.match(imported.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(boss.defeated_at, old.defeated_at);
    assert.equal(boss.status, 'defeated');
});

test('missing-table fallback returns independent snapshots and never hides corrupt files', async t => {
    const { path, store } = await fixture(t);
    supabase.client.from = () => response({ data: null, error: { code: 'PGRST205' } });
    const inv = await store.getInventory('player');
    inv.ores_json.diamond = 12;
    await store.saveInventory(inv);
    const copy = await store.getInventory('player'); copy.ores_json.diamond = 0;
    assert.equal((await store.getInventory('player')).ores_json.diamond, 12);
    await writeFile(path, '{broken JSON');
    await assert.rejects(new ViralExpansionStore(path).getLatestWorldBoss(), SyntaxError);
});
