import test from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from '../dist/services/supabase.js';

function stubLedger(rows, updates) {
    return {
        from(table) {
            assert.equal(table, 'economy_ledger');
            return {
                select() { return this; },
                eq() { return this; },
                order: async () => ({ data: rows, error: null }),
                update(values) {
                    updates.push(values);
                    return { eq() { return this; }, then(resolve) { resolve({ error: null }); } };
                },
            };
        },
    };
}

test('reconciliation mirrors a billing spend without minting the stale local difference', async t => {
    const originals = {
        client: supabase.client,
        getUserProfile: supabase.getUserProfile,
        getPaymenterBalances: supabase.getPaymenterBalances,
        mutatePaymenterCoins: supabase.mutatePaymenterCoins,
        mirrorProfileCoinsFromPaymenter: supabase.mirrorProfileCoinsFromPaymenter,
    };
    t.after(() => Object.assign(supabase, originals));
    const mirrors = [];
    supabase.client = stubLedger([], []);
    supabase.getUserProfile = async () => ({ email: 'customer@example.com', total_cp: 3120 });
    supabase.getPaymenterBalances = async () => ({ found: true, coins: 2920 });
    supabase.mutatePaymenterCoins = async () => { throw new Error('Unexpected coin mutation'); };
    supabase.mirrorProfileCoinsFromPaymenter = async (...args) => mirrors.push(args);

    assert.equal(await supabase.healUserCoins('customer'), 'healed');
    assert.deepEqual(mirrors, [['customer', 2920, 'heal mirror']]);
});

test('reconciliation retries a recorded mutation with its original reference', async t => {
    const originals = {
        client: supabase.client,
        getUserProfile: supabase.getUserProfile,
        getPaymenterBalances: supabase.getPaymenterBalances,
        mutatePaymenterCoins: supabase.mutatePaymenterCoins,
        mirrorProfileCoinsFromPaymenter: supabase.mirrorProfileCoinsFromPaymenter,
    };
    t.after(() => Object.assign(supabase, originals));
    const updates = [];
    const mutations = [];
    const mirrors = [];
    supabase.client = stubLedger([{ id: 'pending-1', amount: 10, reason: 'reward', meta: { source: 'game_reward', reference: 'game:123' } }], updates);
    supabase.getUserProfile = async () => ({ email: 'customer@example.com', total_cp: 20 });
    supabase.getPaymenterBalances = async () => ({ found: true, coins: 30 });
    supabase.mutatePaymenterCoins = async (...args) => { mutations.push(args); return 30; };
    supabase.mirrorProfileCoinsFromPaymenter = async (...args) => mirrors.push(args);

    assert.equal(await supabase.healUserCoins('customer'), 'healed');
    assert.deepEqual(mutations, [['customer@example.com', 10, 'game_reward', 'game:123', 'reward']]);
    assert.deepEqual(updates, [{ kind: 'game_reward', balance_after: 30 }]);
    assert.deepEqual(mirrors, [['customer', 30, 'heal mirror']]);
});
