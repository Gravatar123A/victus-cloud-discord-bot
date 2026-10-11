import test from 'node:test';
import assert from 'node:assert/strict';
import { pvpWallet } from '../dist/services/pvpWallet.js';
import { supabase } from '../dist/services/supabase.js';
import { config } from '../dist/config.js';

test('production wallet sends actual spend/grant requests to Paymenter with stable references', async t => {
    const originals = { fetch: global.fetch, token: supabase.paymenterInternalToken, url: config.paymenter.url,
        balance: supabase.getPaymenterBalances, mirror: supabase.mirrorProfileCoinsFromPaymenter, ledger: supabase.recordEconomyLedger };
    t.after(() => { global.fetch = originals.fetch; supabase.paymenterInternalToken = originals.token; config.paymenter.url = originals.url;
        supabase.getPaymenterBalances = originals.balance; supabase.mirrorProfileCoinsFromPaymenter = originals.mirror; supabase.recordEconomyLedger = originals.ledger; });
    config.paymenter.url = 'https://paymenter.example.test';
    supabase.paymenterInternalToken = () => 'test-only-token';
    const requests = [], balances = { 'a@example.com': 100, 'b@example.com': 100 }, references = new Map();
    global.fetch = async (url, options) => {
        assert.ok(url.startsWith('https://paymenter.example.test/api/victus/coins/'));
        assert.equal(options.method, 'POST');
        assert.ok(options.signal, 'requests must have a timeout');
        const body = JSON.parse(options.body); requests.push(body);
        const key = `${body.email}:${body.source}:${body.reference}`;
        const delta = url.includes('/spend?') ? -body.amount : body.amount;
        if (references.has(key)) return Response.json({ coins: balances[body.email] });
        if (balances[body.email] + delta < 0) return Response.json({ error: 'Insufficient COINS.' }, { status: 422 });
        balances[body.email] += delta; references.set(key, delta);
        return Response.json({ coins: balances[body.email] });
    };
    supabase.getPaymenterBalances = async email => ({ found: true, coins: balances[email], credits: 0 });
    const mirrors = [];
    supabase.mirrorProfileCoinsFromPaymenter = async (id, coins) => { mirrors.push({ id, coins }); };
    supabase.recordEconomyLedger = async () => true;
    const a = { discordId: 'a', userId: 'victus-a', email: 'a@example.com' };
    const b = { discordId: 'b', userId: 'victus-b', email: 'b@example.com' };
    const stake = { delta: -10, kind: 'stake', reference: 'pvp:match:stake:0' };
    assert.equal(await pvpWallet.apply(a, stake), 'paid');
    assert.equal(await pvpWallet.apply(a, stake), 'paid'); // replay from durable journal
    assert.equal(await pvpWallet.apply(b, { ...stake, reference: 'pvp:match:stake:1' }), 'paid');
    assert.equal(await pvpWallet.apply(a, { delta: 20, kind: 'payout', reference: 'pvp:match:winner' }), 'paid');
    assert.deepEqual(balances, { 'a@example.com': 110, 'b@example.com': 90 });
    assert.equal(references.size, 3);
    assert.equal(requests[0].source, 'pvp_stake'); assert.equal(requests[3].source, 'pvp_payout');
    assert.equal(requests[0].amount, 10); assert.equal(requests[3].amount, 20);
    assert.equal(await pvpWallet.apply(b, { ...stake, delta: -5000, reference: 'insufficient' }), 'rejected');
    // A generic 422 is NOT proof that a previous timed-out debit failed.
    global.fetch = async () => Response.json({ error: 'Validation unavailable' }, { status: 422 });
    await assert.rejects(pvpWallet.apply(b, { ...stake, reference: 'unknown' }), /Validation unavailable/);
    assert.ok(mirrors.some(entry => entry.id === 'victus-a' && entry.coins === 110));
    // Mirror outages never undo a confirmed canonical credit.
    global.fetch = async () => Response.json({ coins: 100 });
    supabase.mirrorProfileCoinsFromPaymenter = async () => { throw new Error('mirror down'); };
    assert.equal(await pvpWallet.apply(b, { delta: 10, kind: 'refund', reference: 'refund' }), 'paid');
});
