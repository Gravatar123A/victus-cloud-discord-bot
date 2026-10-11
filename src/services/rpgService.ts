import { randomUUID } from 'node:crypto';
import { viralExpansionStore } from './viralExpansionStore.js';
import { CoinTransactionLock } from './coinTransactionLock.js';
import { withGameLock } from './gameLock.js';
import { MINE_COOLDOWN_MS, FISH_COOLDOWN_MS, normalizeInventory, planSale, rollOre, RECIPES, PICK_TIERS, ROD_TIERS } from './gameRules.js';

export class RpgService {
    constructor(private store = viralExpansionStore, private coins = CoinTransactionLock, private now = Date.now, private random = Math.random) {}

    private async finishSale(id: string) {
        const sale = await this.store.getPendingSale(id);
        if (!sale) return null;
        // The journal reserves the exact inventory and stable payment reference.
        // Retrying after a crash cannot sell the same materials twice.
        await this.store.saveInventory(sale.inventory);
        const payout = await this.coins.grantCoins(id, sale.coins, 'rpg_market_sell', sale.reference, `Sold RPG resources for ${sale.coins} COINS`);
        if (!payout.success) throw new Error('Your sale is reserved while the coin service is unavailable. Use /sell again to retry; it will not charge twice.');
        await this.store.savePendingSale(id, null);
        return { ...sale, balance: payout.newBalance };
    }

    async inventory(id: string) {
        return withGameLock(`inventory:${id}`, async () => {
            await this.finishSale(id);
            return normalizeInventory(await this.store.getInventory(id));
        });
    }

    async mutateInventory<T>(id: string, change: (inventory: Awaited<ReturnType<typeof this.inventory>>) => T) {
        return withGameLock(`inventory:${id}`, async () => {
            await this.finishSale(id);
            const inv = normalizeInventory(await this.store.getInventory(id));
            const result = change(inv);
            await this.store.saveInventory(inv);
            return result;
        });
    }

    async gather(id: string, kind: 'mine' | 'fish') {
        return withGameLock(`inventory:${id}`, async () => {
            await this.finishSale(id);
            const inv = normalizeInventory(await this.store.getInventory(id));
            const field = kind === 'mine' ? 'last_mine_at' : 'last_fish_at';
            const now = this.now();
            const cooldown = kind === 'mine' ? MINE_COOLDOWN_MS : FISH_COOLDOWN_MS;
            const previous = Date.parse(inv[field] || '') || 0;
            const ready = previous + cooldown;
            if (now < ready) throw new Error(`Ready in ${Math.ceil((ready - now) / 1000)}s. Use the same button again.`);
            let item: string;
            if (kind === 'mine') {
                item = rollOre(inv.pickaxe_tier, this.random);
                inv.ores_json[item as keyof typeof inv.ores_json]++;
            } else {
                const luck = ({ wood: .05, lucky: .15, sea: .28, prismarine: .45 })[inv.rod_tier];
                const roll = this.random();
                const fish = roll < luck * .2 ? 'treasure' : roll < luck * .5 ? 'pufferfish' : roll < luck ? 'tropical' : roll < .6 ? 'salmon' : 'cod';
                item = fish;
                inv.fish_json[fish]++;
            }
            inv[field] = new Date(now).toISOString();
            await this.store.saveInventory(inv);
            const activityXp = Math.floor(now / 25_000) > Math.floor(previous / 25_000) ? 5 : 0;
            return { inventory: inv, item, activityXp };
        });
    }

    async sell(id: string, selection?: string, quantity?: number | null) {
        return withGameLock(`inventory:${id}`, async () => {
            const recovered = await this.finishSale(id);
            if (recovered) return recovered;
            if (!selection) return null;
            if (!await this.coins.resolveLinkedUser(id)) throw new Error('Use /link before selling. Your materials have been kept.');
            const plan = planSale(await this.store.getInventory(id), selection, quantity);
            if (plan.coins > 10_000) throw new Error('Sell up to 10,000 COINS per transaction. Choose one material and a smaller quantity.');
            await this.store.savePendingSale(id, { ...plan, reference: `sell:${id}:${randomUUID()}` });
            return this.finishSale(id);
        });
    }

    async craft(id: string, upgrade: string) {
        return withGameLock(`inventory:${id}`, async () => {
            await this.finishSale(id);
            const inv = normalizeInventory(await this.store.getInventory(id));
            if (!Object.hasOwn(RECIPES, upgrade)) throw new Error('Choose a valid equipment upgrade.');
            const recipe = RECIPES[upgrade as keyof typeof RECIPES];
            const tiers = recipe.equipment === 'pickaxe_tier' ? PICK_TIERS : ROD_TIERS;
            if (tiers.indexOf(recipe.tier) <= tiers.indexOf(inv[recipe.equipment])) throw new Error('You already own this tier or better. No materials were used.');
            if (inv.ores_json[recipe.material] < recipe.count) throw new Error(`You need ${recipe.count} ${recipe.material}; you have ${inv.ores_json[recipe.material]}.`);
            inv.ores_json[recipe.material] -= recipe.count;
            (inv as any)[recipe.equipment] = recipe.tier;
            await this.store.saveInventory(inv);
            return recipe;
        });
    }
}

export const rpgService = new RpgService();
