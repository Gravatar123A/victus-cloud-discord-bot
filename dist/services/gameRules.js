import { createHash } from 'node:crypto';
/** Deterministic UUID, compatible with the existing database primary key. */
export function gameUuid(seed) {
    const hex = createHash('sha256').update(seed).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export const MINE_COOLDOWN_MS = 1000;
export const FISH_COOLDOWN_MS = 5000;
export const BOSS_ATTACK_COOLDOWN_MS = 15_000;
export const BOSS_RESPAWN_MS = 60 * 60_000;
export const BOSS_LIFETIME_MS = 24 * 60 * 60_000;
export const ORE_SELL_PRICES = { coal: .2, iron: .5, gold: 1, diamond: 5, netherite: 25 };
export const FISH_SELL_PRICES = { cod: .3, salmon: .6, tropical: 1.5, pufferfish: 3, treasure: 15 };
export const SELL_PRICES = { ...ORE_SELL_PRICES, ...FISH_SELL_PRICES };
export const RECIPES = {
    pick_stone: { equipment: 'pickaxe_tier', tier: 'stone', material: 'coal', count: 10 },
    pick_iron: { equipment: 'pickaxe_tier', tier: 'iron', material: 'iron', count: 15 },
    pick_diamond: { equipment: 'pickaxe_tier', tier: 'diamond', material: 'diamond', count: 20 },
    pick_netherite: { equipment: 'pickaxe_tier', tier: 'netherite', material: 'netherite', count: 10 },
    rod_lucky: { equipment: 'rod_tier', tier: 'lucky', material: 'gold', count: 10 },
    rod_sea: { equipment: 'rod_tier', tier: 'sea', material: 'diamond', count: 15 },
    rod_prismarine: { equipment: 'rod_tier', tier: 'prismarine', material: 'netherite', count: 8 },
};
export const PICK_TIERS = ['wood', 'stone', 'iron', 'diamond', 'netherite'];
export const ROD_TIERS = ['wood', 'lucky', 'sea', 'prismarine'];
export function normalizeInventory(raw) {
    const inv = structuredClone(raw);
    for (const [field, prices] of [['ores_json', ORE_SELL_PRICES], ['fish_json', FISH_SELL_PRICES]]) {
        let values = inv[field];
        if (typeof values === 'string')
            values = JSON.parse(values);
        inv[field] = Object.fromEntries(Object.keys(prices).map(key => {
            const count = Number(values?.[key] || 0);
            if (!Number.isSafeInteger(count) || count < 0)
                throw new Error('Inventory needs staff review.');
            return [key, count];
        }));
    }
    inv.mobs_json ||= [];
    if (!PICK_TIERS.includes(inv.pickaxe_tier))
        inv.pickaxe_tier = 'wood';
    if (!ROD_TIERS.includes(inv.rod_tier))
        inv.rod_tier = 'wood';
    return inv;
}
/** One guaranteed drop per click. Better equipment unlocks rare drops. */
export function rollOre(tier, random = Math.random) {
    const weights = {
        wood: [85, 15, 0, 0, 0], stone: [65, 30, 5, 0, 0],
        iron: [48, 35, 14, 3, 0], diamond: [38, 35, 20, 6, 1], netherite: [28, 35, 25, 10, 2],
    };
    let roll = random() * 100;
    for (const [i, weight] of (weights[tier] || weights.wood).entries()) {
        roll -= weight;
        if (roll < 0)
            return Object.keys(ORE_SELL_PRICES)[i];
    }
    return 'coal';
}
export function planSale(raw, selection, quantity) {
    const inv = normalizeInventory(raw);
    const isItem = Object.hasOwn(SELL_PRICES, selection);
    if (!isItem && !['common', 'ores', 'fish', 'all'].includes(selection))
        throw new Error('Choose a valid material or category.');
    if (quantity != null && (!isItem || !Number.isSafeInteger(quantity) || quantity <= 0)) {
        throw new Error('Quantity must be a positive whole number for one specific material.');
    }
    const sold = [];
    for (const item of Object.keys(SELL_PRICES)) {
        const ore = Object.hasOwn(ORE_SELL_PRICES, item);
        const selected = isItem ? item === selection : selection === 'all' ||
            (selection === 'common' && ['coal', 'iron', 'gold'].includes(item)) ||
            (selection === 'ores' && ore) || (selection === 'fish' && !ore);
        if (!selected)
            continue;
        const bucket = (ore ? inv.ores_json : inv.fish_json);
        if (quantity != null && quantity > bucket[item])
            throw new Error(`You only have ${bucket[item]} ${item}.`);
        const tenths = Math.round(SELL_PRICES[item] * 10);
        // Sell whole-coin lots and keep all fractional leftovers in the backpack.
        const gcd = (a, b) => b ? gcd(b, a % b) : a;
        const lot = 10 / gcd(tenths, 10);
        const count = Math.floor((quantity ?? bucket[item]) / lot) * lot;
        if (!count)
            continue;
        bucket[item] -= count;
        sold.push({ item, count, coins: count * tenths / 10 });
    }
    const coins = sold.reduce((sum, row) => sum + row.coins, 0);
    if (!Number.isSafeInteger(coins) || coins <= 0)
        throw new Error('Not enough for a whole-coin sale. All materials were kept.');
    return { inventory: inv, sold, coins };
}
/** Largest remainder allocation: every coin comes from the advertised pool. */
export function bossRewards(boss) {
    const participants = Object.entries(boss.participants_json).filter(([, p]) => Number.isFinite(p.damage) && p.damage > 0);
    const total = participants.reduce((sum, [, p]) => sum + p.damage, 0);
    const pool = Math.max(0, Math.floor(boss.pool_coins));
    if (!total)
        return {};
    const rows = participants.map(([id, p]) => ({ id, coins: Math.floor(pool * p.damage / total), fraction: (pool * p.damage / total) % 1 }));
    rows.sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id));
    const remainder = pool - rows.reduce((sum, p) => sum + p.coins, 0);
    for (let i = 0; i < remainder; i++)
        rows[i].coins++;
    return Object.fromEntries(rows.map(p => [p.id, p.coins]));
}
