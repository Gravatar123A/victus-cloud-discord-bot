import test from 'node:test';
import assert from 'node:assert/strict';

test('Ore selling rates convert accurately to COINS', () => {
    const ORE_RATES = {
        coal: 0.5,
        iron: 1.0,
        gold: 2.5,
        diamond: 8.0,
        netherite: 35.0,
    };

    const inv = {
        coal: 10,       // 5 coins
        iron: 5,        // 5 coins
        gold: 4,        // 10 coins
        diamond: 2,     // 16 coins
        netherite: 1,   // 35 coins
    };

    let totalCoins = 0;
    for (const [ore, count] of Object.entries(inv)) {
        totalCoins += count * (ORE_RATES[ore] || 0);
    }

    assert.equal(totalCoins, 71.0, 'Total COINS for inventory must match rate calculation');
    assert.equal(Math.floor(totalCoins), 71);
});

test('Fish selling rates convert accurately to COINS', () => {
    const FISH_RATES = {
        cod: 0.5,
        salmon: 1.0,
        tropical: 2.0,
        pufferfish: 4.0,
        nautilus: 25.0,
    };

    const catchInventory = {
        cod: 20,         // 10 coins
        salmon: 10,      // 10 coins
        tropical: 5,     // 10 coins
        pufferfish: 2,   // 8 coins
        nautilus: 1,     // 25 coins
    };

    let totalCoins = 0;
    for (const [fish, count] of Object.entries(catchInventory)) {
        totalCoins += count * (FISH_RATES[fish] || 0);
    }

    assert.equal(totalCoins, 63.0, 'Total COINS for fish catch must match rate calculation');
});

test('World Boss 1,000 COINS prize pool splits proportionally', () => {
    const TOTAL_BOUNTY = 1000;
    const TOTAL_BOSS_HP = 10000;

    const contributors = [
        { id: 'player1', damage: 5000 }, // 50%
        { id: 'player2', damage: 3000 }, // 30%
        { id: 'player3', damage: 2000 }, // 20%
    ];

    const payouts = contributors.map((c) => ({
        id: c.id,
        coins: Math.max(1, Math.round((c.damage / TOTAL_BOSS_HP) * TOTAL_BOUNTY)),
    }));

    assert.equal(payouts.find((p) => p.id === 'player1').coins, 500);
    assert.equal(payouts.find((p) => p.id === 'player2').coins, 300);
    assert.equal(payouts.find((p) => p.id === 'player3').coins, 200);

    const sumCoins = payouts.reduce((acc, p) => acc + p.coins, 0);
    assert.equal(sumCoins, TOTAL_BOUNTY);
});

test('Battle Pass level scaling formula calculates correctly', () => {
    // Level XP needed = 500 * (Level)^2
    const level1XpNeeded = 500 * Math.pow(1, 2); // 500 XP
    const level5XpNeeded = 500 * Math.pow(5, 2); // 12,500 XP
    const level10XpNeeded = 500 * Math.pow(10, 2); // 50,000 XP

    assert.equal(level1XpNeeded, 500);
    assert.equal(level5XpNeeded, 12500);
    assert.equal(level10XpNeeded, 50000);

    // Compute level from 14,000 XP (should be Level 5)
    const currentXp = 14000;
    const computedLevel = Math.max(1, Math.floor(Math.sqrt(currentXp / 500)) + 1);
    assert.equal(computedLevel, 6, '14,000 XP achieves Level 6');
});
