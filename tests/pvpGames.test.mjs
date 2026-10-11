import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PvpService } from '../dist/services/pvpService.js';
import { PvpStore } from '../dist/services/pvpStore.js';
import { rpsWinner, placeMove, boardWinner, PVP_TURN_MS, PVP_COOLDOWN_MS } from '../dist/services/pvpRules.js';
import { pvpCard, rpsCommand, ticTacToeCommand, connect4Command } from '../dist/commands/pvp.js';

function harness() {
    let data = { version: 1, matches: {}, cooldowns: {} };
    let now = 1_000_000;
    const balances = { a: 100, b: 100, c: 100 };
    const applied = new Map();
    const identities = Object.fromEntries(Object.keys(balances).map(id => [id, { discordId: id, userId: `victus-${id}`, email: `${id}@example.com`, username: id }]));
    const store = { async load() { return structuredClone(data); }, async save(state) { data = structuredClone(state); } };
    const wallet = {
        async resolve(id) { return structuredClone(identities[id] || null); },
        async balance(player) { return balances[player.discordId]; },
        async apply(player, payment) {
            if (applied.has(payment.reference)) return 'paid';
            const id = player.email.split('@')[0];
            if (balances[id] + payment.delta < 0) return 'rejected';
            balances[id] += payment.delta;
            applied.set(payment.reference, { ...payment, email: player.email });
            return 'paid';
        },
    };
    const service = () => new PvpService(store, wallet, () => now, () => 0);
    const create = (game = 'rps', stake = 10, opponent = 'b') => service().create({ game, stake, challenger: { id: 'a' }, opponent: { id: opponent }, guildId: 'guild', channelId: 'channel', ...(game === 'battle' ? { mobPowers: [100, 50] } : {}) });
    return { store, wallet, service, create, identities, balances, applied, advance: ms => { now += ms; }, state: () => data };
}

test('RPS rules cover all wins, losses and draws', () => {
    for (const [a, b] of [['rock', 'scissors'], ['scissors', 'paper'], ['paper', 'rock']]) {
        assert.equal(rpsWinner(a, b), 0); assert.equal(rpsWinner(b, a), 1); assert.equal(rpsWinner(a, a), null);
    }
    assert.throws(() => rpsWinner('invalid', 'rock'));
});

test('PvP challenges do not deduct until opponent accepts; winner gets full real-wallet pot', async () => {
    const h = harness(), match = await h.create();
    assert.equal(h.balances.a, 100); assert.equal(h.applied.size, 0);
    await assert.rejects(h.service().action(match.id, 'a', 'accept'), /opponent/);
    await assert.rejects(h.service().action(match.id, 'c', 'accept'), /two challenged/);
    await h.service().action(match.id, 'b', 'accept');
    assert.deepEqual(h.balances, { a: 90, b: 90, c: 100 });
    let active = await h.service().action(match.id, 'a', 'choose', 'rock');
    const hidden = JSON.stringify(pvpCard(active).toJSON());
    assert.match(hidden, /choice locked/); assert.doesNotMatch(hidden, /\*\*rock\*\*/);
    await assert.rejects(h.service().action(match.id, 'a', 'choose', 'paper'), /already locked/);
    active = await h.service().action(match.id, 'b', 'choose', 'scissors');
    assert.equal(active.winner, 0); assert.equal(active.status, 'complete');
    assert.deepEqual(h.balances, { a: 110, b: 90, c: 100 });
    assert.equal(h.applied.size, 3); // two spends and one payout
    await h.service().action(match.id, 'b', 'choose', 'paper');
    await h.service().recover();
    assert.equal(h.applied.size, 3);
});

test('draws refund both stakes and cooldown expires at exactly ten seconds', async () => {
    const h = harness(), match = await h.create();
    await h.service().action(match.id, 'b', 'accept');
    await h.service().action(match.id, 'a', 'choose', 'paper');
    const draw = await h.service().action(match.id, 'b', 'choose', 'paper');
    assert.equal(draw.winner, null); assert.equal(draw.status, 'complete');
    assert.equal(h.balances.a + h.balances.b, 200);
    await assert.rejects(h.create(), /10s/);
    h.advance(PVP_COOLDOWN_MS - 1); await assert.rejects(h.create(), /1s/);
    h.advance(1); assert.ok(await h.create());
});

test('self-play, bots, shared billing accounts, unlinked players and invalid stakes cannot start', async () => {
    const h = harness();
    await assert.rejects(h.create('rps', 10, 'a'), /another human/);
    for (const stake of [0, -1, 1.2, NaN, Infinity, 5001]) await assert.rejects(h.create('rps', stake), /Stake/);
    await assert.rejects(h.service().create({ game: 'rps', challenger: { id: 'a' }, opponent: { id: 'b', bot: true }, stake: 10, guildId: 'g', channelId: 'c' }), /human/);
    h.identities.b.userId = h.identities.a.userId;
    await assert.rejects(h.create(), /different Victus/);
    delete h.identities.b;
    await assert.rejects(h.create(), /Both players must/);
    assert.equal(h.applied.size, 0);
});

test('declines, cancellations and invite expiry are free; overlapping games are blocked', async () => {
    const h = harness(), match = await h.create();
    await assert.rejects(h.create('connect4', 10, 'c'), /already has/);
    await h.service().action(match.id, 'b', 'decline');
    assert.equal(h.applied.size, 0);
    h.advance(PVP_COOLDOWN_MS);
    const expired = await h.create(); h.advance(120_000);
    await h.service().recover();
    assert.equal((await h.service().get(expired.id)).status, 'complete');
    assert.equal(h.applied.size, 0);
});

test('double acceptance deducts each stake only once and simultaneous RPS choices settle once', async () => {
    const h = harness(), match = await h.create();
    await Promise.allSettled([h.service().action(match.id, 'b', 'accept'), h.service().action(match.id, 'b', 'accept')]);
    assert.equal(h.applied.size, 2);
    await Promise.all([h.service().action(match.id, 'a', 'choose', 'scissors'), h.service().action(match.id, 'b', 'choose', 'rock')]);
    assert.deepEqual(h.balances, { a: 90, b: 110, c: 100 });
    assert.equal(h.applied.size, 3);
});

test('second player running out of funds refunds only the confirmed first stake', async () => {
    const h = harness(), match = await h.create();
    h.balances.b = 0;
    const result = await h.service().action(match.id, 'b', 'accept');
    assert.equal(result.status, 'complete');
    assert.equal(h.balances.a, 100); assert.equal(h.balances.b, 0);
    assert.equal(h.applied.size, 2);
    assert.ok([...h.applied.values()].every(p => p.player === 0));
});

test('a lost debit response is replayed after restart without deducting twice', async () => {
    const h = harness(), match = await h.create();
    const apply = h.wallet.apply;
    h.wallet.apply = async (player, payment) => { await apply(player, payment); throw new Error('lost response'); };
    const pending = await h.service().action(match.id, 'b', 'accept');
    assert.equal(pending.status, 'funding'); assert.equal(h.balances.a, 90); assert.equal(h.balances.b, 100);
    h.wallet.apply = apply;
    await h.service().recover();
    assert.equal((await h.service().get(match.id)).status, 'active');
    assert.deepEqual(h.balances, { a: 90, b: 90, c: 100 });
});

test('ambiguous funding after a long outage refunds both without stranding either stake', async () => {
    const h = harness(), match = await h.create();
    const apply = h.wallet.apply;
    h.wallet.apply = async (player, payment) => { await apply(player, payment); throw new Error('timeout'); };
    await h.service().action(match.id, 'b', 'accept');
    h.advance(PVP_TURN_MS + 1); h.wallet.apply = apply;
    await h.service().recover();
    assert.equal((await h.service().get(match.id)).status, 'complete');
    assert.deepEqual(h.balances, { a: 100, b: 100, c: 100 });
});

test('failed payout and process restart retry the same outcome without paying twice or redirecting accounts', async () => {
    const h = harness(), match = await h.create();
    await h.service().action(match.id, 'b', 'accept');
    const apply = h.wallet.apply;
    h.wallet.apply = async (player, payment) => { await apply(player, payment); throw new Error('response lost'); };
    const result = await h.service().action(match.id, 'b', 'forfeit');
    assert.equal(result.status, 'settling'); assert.equal(h.balances.a, 110);
    h.identities.a.email = 'c@example.com';
    h.wallet.apply = apply; await h.service().recover();
    assert.equal((await h.service().get(match.id)).status, 'complete');
    assert.deepEqual(h.balances, { a: 110, b: 90, c: 100 });
    assert.equal(h.applied.size, 3);
});

test('RPS non-response forfeits to the player who chose; neither choosing refunds both', async () => {
    for (const chose of [true, false]) {
        const h = harness(), match = await h.create(); await h.service().action(match.id, 'b', 'accept');
        if (chose) await h.service().action(match.id, 'a', 'choose', 'rock');
        h.advance(PVP_TURN_MS); await h.service().recover();
        assert.equal((await h.service().get(match.id)).winner, chose ? 0 : null);
        assert.equal(h.balances.a, chose ? 110 : 100); assert.equal(h.balances.b, chose ? 90 : 100);
    }
});

test('tic-tac-toe enforces turns, stale-board protection, and real-pot win settlement', async () => {
    const h = harness(), match = await h.create('tictactoe'); let current = await h.service().action(match.id, 'b', 'accept');
    await assert.rejects(h.service().action(match.id, 'b', 'move', '0', current.revision), /your turn/);
    await assert.rejects(h.service().action(match.id, 'a', 'move', '0', 999), /out of date/);
    for (const [player, square] of [['a', 0], ['b', 3], ['a', 1], ['b', 4], ['a', 2]]) current = await h.service().action(match.id, player, 'move', String(square), current.revision);
    assert.equal(current.winner, 0); assert.equal(current.status, 'complete');
    assert.deepEqual(h.balances, { a: 110, b: 90, c: 100 });
});

test('tic-tac-toe draw refunds, and a timed-out board turn forfeits', async () => {
    const h = harness(), match = await h.create('tictactoe'); let current = await h.service().action(match.id, 'b', 'accept');
    for (const [i, square] of [0, 1, 2, 4, 3, 5, 7, 6, 8].entries()) current = await h.service().action(match.id, i % 2 ? 'b' : 'a', 'move', String(square), current.revision);
    assert.equal(current.winner, null); assert.equal(h.balances.a, 100); assert.equal(h.balances.b, 100);
    h.advance(PVP_COOLDOWN_MS);
    const next = await h.create('connect4'); await h.service().action(next.id, 'b', 'accept'); h.advance(PVP_TURN_MS);
    await h.service().recover();
    assert.equal((await h.service().get(next.id)).winner, 1);
});

test('Connect Four drops by gravity, detects all line directions, rejects full columns, and pays the winner', async () => {
    const h = harness(), match = await h.create('connect4'); let current = await h.service().action(match.id, 'b', 'accept');
    for (const [i, col] of [0, 1, 0, 1, 0, 1, 0].entries()) current = await h.service().action(match.id, i % 2 ? 'b' : 'a', 'move', String(col), current.revision);
    assert.equal(current.winner, 0); assert.equal(h.balances.a, 110); assert.equal(h.balances.b, 90);
    for (const positions of [[35, 36, 37, 38], [35, 28, 21, 14], [35, 29, 23, 17], [38, 30, 22, 14]]) {
        const board = Array(42).fill(null); for (const p of positions) board[p] = 1;
        assert.equal(boardWinner(board, 7, 6, 4), 1);
    }
    const full = Array(42).fill(null); for (let i = 0; i < 6; i++) full[i * 7] = i % 2;
    assert.throws(() => placeMove('connect4', full, 0, 0), /full/);
});

test('pet battles use the same two debits and full-pot settlement', async () => {
    const h = harness(), match = await h.create('battle');
    const result = await h.service().action(match.id, 'b', 'accept');
    assert.equal(result.winner, 0); assert.equal(result.status, 'complete');
    assert.deepEqual(h.balances, { a: 110, b: 90, c: 100 });
});

test('durable PvP journal retains matches and rejects corruption instead of resetting balances', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'victus-pvp-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, 'matches.json');
    const h = harness();
    const store = new PvpStore(path), service = new PvpService(store, h.wallet, () => 1000, () => 0);
    const match = await service.create({ game: 'rps', challenger: { id: 'a' }, opponent: { id: 'b' }, stake: 10, guildId: 'g', channelId: 'c' });
    await service.action(match.id, 'b', 'accept');
    const restarted = new PvpService(new PvpStore(path), h.wallet, () => 1001, () => 0);
    assert.equal((await restarted.get(match.id)).status, 'active');
    await restarted.action(match.id, 'b', 'forfeit'); assert.equal(h.balances.a, 110);
    await writeFile(path, '{broken JSON');
    await assert.rejects(new PvpStore(path).load(), SyntaxError);
});

test('payment intent must reach durable storage before any debit; restart handles a lost post-debit save', async () => {
    const h = harness(), match = await h.create();
    const save = h.store.save;
    h.store.save = async () => { throw new Error('disk full'); };
    await assert.rejects(h.service().action(match.id, 'b', 'accept'), /disk full/);
    assert.equal(h.applied.size, 0);
    let saves = 0;
    h.store.save = async state => { if (++saves === 2) throw new Error('crash after debit'); await save(state); };
    await assert.rejects(h.service().action(match.id, 'b', 'accept'), /crash after debit/);
    assert.equal(h.balances.a, 90); assert.equal(h.applied.size, 1);
    h.store.save = save;
    await h.service().recover();
    assert.equal((await h.service().get(match.id)).status, 'active');
    assert.equal(h.applied.size, 2);
    assert.equal(h.balances.a, 90); assert.equal(h.balances.b, 90);
});

test('all PvP commands require opponent and stake and cannot be registered in DMs', () => {
    for (const command of [rpsCommand, ticTacToeCommand, connect4Command]) {
        const json = command.data.toJSON();
        assert.equal(json.dm_permission, false);
        assert.deepEqual(json.options.map(o => [o.name, o.required]), [['opponent', true], ['amount', true]]);
        assert.equal(json.options[1].max_value, 5000);
    }
});
