import test from 'node:test';
import assert from 'node:assert/strict';
import { ORE_SELL_PRICES, FISH_SELL_PRICES, bossRewards } from '../dist/services/gameRules.js';

test('production ore prices value a representative inventory correctly', () => {
    const inv = { coal: 10, iron: 5, gold: 4, diamond: 2, netherite: 1 };
    const value = Object.entries(inv).reduce((sum, [ore, count]) => sum + count * ORE_SELL_PRICES[ore], 0);
    assert.equal(value, 43.5);
});

test('production fish prices include treasure and value a representative catch correctly', () => {
    const inv = { cod: 20, salmon: 10, tropical: 5, pufferfish: 2, treasure: 1 };
    const value = Object.entries(inv).reduce((sum, [fish, count]) => sum + count * FISH_SELL_PRICES[fish], 0);
    assert.equal(value, 40.5);
});

test('production boss distribution splits the advertised bounty proportionally', () => {
    const rewards = bossRewards({ pool_coins: 1000, participants_json: {
        player1: { damage: 5000 }, player2: { damage: 3000 }, player3: { damage: 2000 },
    } });
    assert.deepEqual(rewards, { player1: 500, player2: 300, player3: 200 });
});
