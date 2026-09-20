import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types/index.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { viralExpansionStore, OreInventory, FishInventory } from '../services/viralExpansionStore.js';
import { CoinTransactionLock } from '../services/coinTransactionLock.js';
import { viralExpansionService } from '../services/viralExpansionService.js';

const MINE_COOLDOWN_MS = 25 * 1000; // 25 seconds
const FISH_COOLDOWN_MS = 25 * 1000; // 25 seconds

// Prices in real Victus COINS
export const ORE_SELL_PRICES: Record<keyof OreInventory, number> = {
    coal: 0.2,       // 5 coal = 1 coin
    iron: 0.5,       // 2 iron = 1 coin
    gold: 1.0,       // 1 gold = 1 coin
    diamond: 5.0,    // 1 diamond = 5 coins
    netherite: 25.0, // 1 netherite = 25 coins
};

export const FISH_SELL_PRICES: Record<keyof FishInventory, number> = {
    cod: 0.3,
    salmon: 0.6,
    tropical: 1.5,
    pufferfish: 3.0,
    treasure: 15.0,
};

export const rpgCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('rpg')
        .setDescription('Minecraft Text-RPG: mine, fish, craft, and sell materials for real Victus COINS')
        .addSubcommand((sub) =>
            sub
                .setName('mine')
                .setDescription('Mine underground for coal, iron, gold, diamonds, and netherite')
        )
        .addSubcommand((sub) =>
            sub
                .setName('fish')
                .setDescription('Cast your fishing line into the water to catch fish and sunken treasure')
        )
        .addSubcommand((sub) =>
            sub
                .setName('inv')
                .setDescription('View your RPG mining & fishing inventory, pickaxe, and rod tiers')
        )
        .addSubcommand((sub) =>
            sub
                .setName('sell')
                .setDescription('Sell your mined ores and fish for real Victus Cloud COINS')
                .addStringOption((opt) =>
                    opt
                        .setName('category')
                        .setDescription('What to sell')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Sell All Ores & Fish', value: 'all' },
                            { name: 'Sell Only Ores', value: 'ores' },
                            { name: 'Sell Only Fish', value: 'fish' }
                        )
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('craft')
                .setDescription('Upgrade your pickaxe or fishing rod to harvest rarer resources')
                .addStringOption((opt) =>
                    opt
                        .setName('upgrade')
                        .setDescription('Select equipment upgrade')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Stone Pickaxe (10 Coal)', value: 'pick_stone' },
                            { name: 'Iron Pickaxe (15 Iron)', value: 'pick_iron' },
                            { name: 'Diamond Pickaxe (20 Diamonds)', value: 'pick_diamond' },
                            { name: 'Netherite Pickaxe (10 Netherite)', value: 'pick_netherite' },
                            { name: 'Lucky Fishing Rod (10 Gold)', value: 'rod_lucky' },
                            { name: 'Sea Fishing Rod (15 Diamonds)', value: 'rod_sea' },
                            { name: 'Prismarine Fishing Rod (8 Netherite)', value: 'rod_prismarine' }
                        )
                )
        ),

export async function handleMine(interaction: any) {
    const userId = interaction.user.id;
    const inv = await viralExpansionStore.getInventory(userId);

    // Normalize inventory in case DB returned raw strings or undefined
    if (typeof inv.ores_json === 'string') {
        try { inv.ores_json = JSON.parse(inv.ores_json); } catch { inv.ores_json = { coal: 0, iron: 0, gold: 0, diamond: 0, netherite: 0 }; }
    }
    inv.ores_json = inv.ores_json || { coal: 0, iron: 0, gold: 0, diamond: 0, netherite: 0 };
    inv.pickaxe_tier = inv.pickaxe_tier || 'wood';

    const now = Date.now();
    const lastMine = inv.last_mine_at ? new Date(inv.last_mine_at).getTime() : 0;
    const diff = now - lastMine;
    if (diff < MINE_COOLDOWN_MS) {
        const waitSec = Math.ceil((MINE_COOLDOWN_MS - diff) / 1000);
        await interaction.reply({
            content: `⏳ Your pickaxe is cooling down! Wait **${waitSec}s** before mining again.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // Yields based on pickaxe tier
    const tierMultipliers = {
        wood: { coal: 3, iron: 1, gold: 0, diamond: 0, netherite: 0 },
        stone: { coal: 5, iron: 3, gold: 1, diamond: 0, netherite: 0 },
        iron: { coal: 7, iron: 5, gold: 2, diamond: 1, netherite: 0 },
        diamond: { coal: 10, iron: 8, gold: 4, diamond: 2, netherite: 1 },
        netherite: { coal: 15, iron: 12, gold: 6, diamond: 4, netherite: 2 },
    };

    const maxYield = tierMultipliers[inv.pickaxe_tier as keyof typeof tierMultipliers] || tierMultipliers.wood;
    const gained: Partial<OreInventory> = {
        coal: Math.floor(Math.random() * maxYield.coal) + 1,
        iron: maxYield.iron > 0 ? Math.floor(Math.random() * (maxYield.iron + 1)) : 0,
        gold: maxYield.gold > 0 ? Math.floor(Math.random() * (maxYield.gold + 1)) : 0,
        diamond: maxYield.diamond > 0 ? (Math.random() < 0.4 ? 1 : 0) : 0,
        netherite: maxYield.netherite > 0 ? (Math.random() < 0.15 ? 1 : 0) : 0,
    };

    inv.ores_json.coal = (inv.ores_json.coal || 0) + (gained.coal || 0);
    inv.ores_json.iron = (inv.ores_json.iron || 0) + (gained.iron || 0);
    inv.ores_json.gold = (inv.ores_json.gold || 0) + (gained.gold || 0);
    inv.ores_json.diamond = (inv.ores_json.diamond || 0) + (gained.diamond || 0);
    inv.ores_json.netherite = (inv.ores_json.netherite || 0) + (gained.netherite || 0);
    inv.last_mine_at = new Date().toISOString();

    await viralExpansionStore.saveInventory(inv);

    // Award server battle pass XP (+5 XP)
    if (interaction.guild) {
        await viralExpansionService.addGuildActivityXp(interaction.guild.id, 5, interaction.guild.ownerId).catch(() => {});
    }

    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
    let minedText = `# ⛏️ Mining Expedition Results\n\n` +
        `You swung your **${inv.pickaxe_tier.toUpperCase()} Pickaxe** deep into the subterranean caverns!\n\n` +
        `### 🪨 Ores Extracted:\n` +
        `› ⬛ **+${gained.coal} Coal**\n` +
        (gained.iron ? `› ⬜ **+${gained.iron} Iron**\n` : '') +
        (gained.gold ? `› 🟨 **+${gained.gold} Gold**\n` : '') +
        (gained.diamond ? `› 💎 **+${gained.diamond} Diamond!**\n` : '') +
        (gained.netherite ? `› 🌌 **+${gained.netherite} Ancient Debris / Netherite!**\n` : '') +
        `\n-# Convert your ores into real Victus COINS with \`/rpg sell\`!`;

    c.addTextDisplayComponents(ComponentsV2.text(minedText));
    await interaction.reply({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 });
}

export async function handleFish(interaction: any) {
    const userId = interaction.user.id;
    const inv = await viralExpansionStore.getInventory(userId);

    if (typeof inv.fish_json === 'string') {
        try { inv.fish_json = JSON.parse(inv.fish_json); } catch { inv.fish_json = { cod: 0, salmon: 0, tropical: 0, pufferfish: 0, treasure: 0 }; }
    }
    inv.fish_json = inv.fish_json || { cod: 0, salmon: 0, tropical: 0, pufferfish: 0, treasure: 0 };
    inv.rod_tier = inv.rod_tier || 'wood';

    const now = Date.now();
    const lastFish = inv.last_fish_at ? new Date(inv.last_fish_at).getTime() : 0;
    const diff = now - lastFish;
    if (diff < FISH_COOLDOWN_MS) {
        const waitSec = Math.ceil((FISH_COOLDOWN_MS - diff) / 1000);
        await interaction.reply({
            content: `⏳ You cast ripples into the water! Wait **${waitSec}s** before fishing again.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const rodLuck = {
        wood: 0.05,
        lucky: 0.15,
        sea: 0.28,
        prismarine: 0.45,
    };

    const luck = rodLuck[inv.rod_tier as keyof typeof rodLuck] || rodLuck.wood;
    const roll = Math.random();

    let caught = 'cod';
    if (roll < luck * 0.2) caught = 'treasure';
    else if (roll < luck * 0.5) caught = 'pufferfish';
    else if (roll < luck) caught = 'tropical';
    else if (roll < 0.6) caught = 'salmon';
    else caught = 'cod';

    inv.fish_json[caught as keyof FishInventory] = (inv.fish_json[caught as keyof FishInventory] || 0) + 1;
    inv.last_fish_at = new Date().toISOString();
    await viralExpansionStore.saveInventory(inv);

    if (interaction.guild) {
        await viralExpansionService.addGuildActivityXp(interaction.guild.id, 5, interaction.guild.ownerId).catch(() => {});
    }

    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.info);
    const catchLabels: Record<string, string> = {
        cod: '🐟 Raw Cod',
        salmon: '🍣 Raw Salmon',
        tropical: '🐠 Tropical Clownfish',
        pufferfish: '🐡 Pufferfish (Deadly Spike)',
        treasure: '📦 Sunken Treasure Chest (Enchanted Nautilus Shell!)',
    };

    const text = `# 🎣 Fishing Cast Results\n\n` +
        `You cast your **${inv.rod_tier.toUpperCase()} Fishing Rod** into the deep ocean!\n\n` +
        `### 🌊 Your Catch:\n` +
        `› **${catchLabels[caught]}**\n\n` +
        `-# Sell your sea bounty for real Victus COINS with \`/rpg sell\`!`;

    c.addTextDisplayComponents(ComponentsV2.text(text));
    await interaction.reply({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 });
}

export async function handleInv(interaction: any) {
    const userId = interaction.user.id;
    const inv = await viralExpansionStore.getInventory(userId);

    if (typeof inv.ores_json === 'string') {
        try { inv.ores_json = JSON.parse(inv.ores_json); } catch { inv.ores_json = { coal: 0, iron: 0, gold: 0, diamond: 0, netherite: 0 }; }
    }
    if (typeof inv.fish_json === 'string') {
        try { inv.fish_json = JSON.parse(inv.fish_json); } catch { inv.fish_json = { cod: 0, salmon: 0, tropical: 0, pufferfish: 0, treasure: 0 }; }
    }
    inv.ores_json = inv.ores_json || { coal: 0, iron: 0, gold: 0, diamond: 0, netherite: 0 };
    inv.fish_json = inv.fish_json || { cod: 0, salmon: 0, tropical: 0, pufferfish: 0, treasure: 0 };
    inv.pickaxe_tier = inv.pickaxe_tier || 'wood';
    inv.rod_tier = inv.rod_tier || 'wood';

    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
    const text = `# 🎒 RPG Inventory: ${interaction.user.username}\n\n` +
        `### ⚔️ Equipment Tiers\n` +
        `› **Pickaxe:** \`${inv.pickaxe_tier.toUpperCase()}\` (Upgrade with \`/rpg craft\`)\n` +
        `› **Fishing Rod:** \`${inv.rod_tier.toUpperCase()}\`\n\n` +
        `### ⛏️ Mined Ores\n` +
        `› ⬛ Coal: \`${inv.ores_json.coal || 0}\`\n` +
        `› ⬜ Iron: \`${inv.ores_json.iron || 0}\`\n` +
        `› 🟨 Gold: \`${inv.ores_json.gold || 0}\`\n` +
        `› 💎 Diamonds: \`${inv.ores_json.diamond || 0}\`\n` +
        `› 🌌 Netherite: \`${inv.ores_json.netherite || 0}\`\n\n` +
        `### 🎣 Fish & Marine Catches\n` +
        `› 🐟 Cod: \`${inv.fish_json.cod || 0}\`\n` +
        `› 🍣 Salmon: \`${inv.fish_json.salmon || 0}\`\n` +
        `› 🐠 Tropical: \`${inv.fish_json.tropical || 0}\`\n` +
        `› 🐡 Pufferfish: \`${inv.fish_json.pufferfish || 0}\`\n` +
        `› 📦 Treasures: \`${inv.fish_json.treasure || 0}\`\n\n` +
        `-# Run \`/rpg sell\` to cash out your materials into real Victus COINS!`;

    c.addTextDisplayComponents(ComponentsV2.text(text));
    await interaction.reply({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 });
}

export async function handleSell(interaction: any, categoryOverride?: string) {
    const userId = interaction.user.id;
    const inv = await viralExpansionStore.getInventory(userId);

    if (typeof inv.ores_json === 'string') {
        try { inv.ores_json = JSON.parse(inv.ores_json); } catch { inv.ores_json = { coal: 0, iron: 0, gold: 0, diamond: 0, netherite: 0 }; }
    }
    if (typeof inv.fish_json === 'string') {
        try { inv.fish_json = JSON.parse(inv.fish_json); } catch { inv.fish_json = { cod: 0, salmon: 0, tropical: 0, pufferfish: 0, treasure: 0 }; }
    }
    inv.ores_json = inv.ores_json || { coal: 0, iron: 0, gold: 0, diamond: 0, netherite: 0 };
    inv.fish_json = inv.fish_json || { cod: 0, salmon: 0, tropical: 0, pufferfish: 0, treasure: 0 };

    const cat = categoryOverride || interaction.options?.getString?.('category') || 'all';
    let totalCoins = 0;
    const soldItems: string[] = [];

    if (cat === 'all' || cat === 'ores') {
        for (const [ore, count] of Object.entries(inv.ores_json) as [keyof OreInventory, number][]) {
            if (count > 0) {
                const val = count * (ORE_SELL_PRICES[ore] || 0);
                totalCoins += val;
                soldItems.push(`\`${count}\` ${ore} (+${val.toFixed(1)} COINS)`);
                inv.ores_json[ore] = 0;
            }
        }
    }

    if (cat === 'all' || cat === 'fish') {
        for (const [fish, count] of Object.entries(inv.fish_json) as [keyof FishInventory, number][]) {
            if (count > 0) {
                const val = count * (FISH_SELL_PRICES[fish] || 0);
                totalCoins += val;
                soldItems.push(`\`${count}\` ${fish} (+${val.toFixed(1)} COINS)`);
                inv.fish_json[fish] = 0;
            }
        }
    }

    const roundedCoins = Math.floor(totalCoins);
    if (roundedCoins <= 0) {
        await interaction.reply({
            content: 'You do not have enough items in that category to sell for at least 1 COIN.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: ComponentsV2.IS_COMPONENTS_V2 });

    // Atomic payout of real Victus COINS
    const grantRes = await CoinTransactionLock.grantCoins(
        userId,
        roundedCoins,
        'rpg_market_sell',
        `sell:${userId}:${Date.now()}`,
        `Sold RPG resources for ${roundedCoins} COINS`
    );

    if (grantRes.unlinked) {
        await interaction.editReply({
            content: '⚠️ **Account Not Linked!** You must link your Victus Cloud account using `/link` so we can deposit your real COINS!',
        });
        return;
    }

    if (!grantRes.success) {
        await interaction.editReply({
            content: `❌ Error depositing coins: ${grantRes.error}`,
        });
        return;
    }

    await viralExpansionStore.saveInventory(inv);

    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.success);
    const text = `# 💰 Market Sale Successful!\n\n` +
        `You traded your gathered resources at the Victus Marketplace!\n\n` +
        `### 📦 Items Sold:\n` +
        soldItems.map((s) => `› ${s}`).join('\n') + `\n\n` +
        `### 🪙 Payout Summary:\n` +
        `› **Earned:** **+${roundedCoins} COINS**\n` +
        `› **New Balance:** **${grantRes.newBalance} COINS** (Synced live with [victuscloud.com](https://victuscloud.com))\n`;

    c.addTextDisplayComponents(ComponentsV2.text(text));
    await interaction.editReply({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 });
}

export async function handleCraft(interaction: any, upgradeOverride?: string) {
    const userId = interaction.user.id;
    const inv = await viralExpansionStore.getInventory(userId);

    if (typeof inv.ores_json === 'string') {
        try { inv.ores_json = JSON.parse(inv.ores_json); } catch { inv.ores_json = { coal: 0, iron: 0, gold: 0, diamond: 0, netherite: 0 }; }
    }
    inv.ores_json = inv.ores_json || { coal: 0, iron: 0, gold: 0, diamond: 0, netherite: 0 };
    inv.pickaxe_tier = inv.pickaxe_tier || 'wood';
    inv.rod_tier = inv.rod_tier || 'wood';

    const upgrade = upgradeOverride || interaction.options?.getString?.('upgrade', true);
    let success = false;
    let msg = '';

    switch (upgrade) {
        case 'pick_stone':
            if ((inv.ores_json.coal || 0) >= 10) {
                inv.ores_json.coal -= 10;
                inv.pickaxe_tier = 'stone';
                success = true;
                msg = 'Forged a **Stone Pickaxe**! Iron and gold can now be harvested.';
            } else msg = 'You need at least **10 Coal** to forge a Stone Pickaxe.';
            break;
        case 'pick_iron':
            if ((inv.ores_json.iron || 0) >= 15) {
                inv.ores_json.iron -= 15;
                inv.pickaxe_tier = 'iron';
                success = true;
                msg = 'Forged an **Iron Pickaxe**! Diamonds are now within reach.';
            } else msg = 'You need at least **15 Iron** to forge an Iron Pickaxe.';
            break;
        case 'pick_diamond':
            if ((inv.ores_json.diamond || 0) >= 20) {
                inv.ores_json.diamond -= 20;
                inv.pickaxe_tier = 'diamond';
                success = true;
                msg = 'Forged a **Diamond Pickaxe**! Netherite and massive yields unlocked!';
            } else msg = 'You need at least **20 Diamonds** to forge a Diamond Pickaxe.';
            break;
        case 'pick_netherite':
            if ((inv.ores_json.netherite || 0) >= 10) {
                inv.ores_json.netherite -= 10;
                inv.pickaxe_tier = 'netherite';
                success = true;
                msg = 'Forged a **Netherite Pickaxe**! Maximum mining speed and World Boss raid power!';
            } else msg = 'You need at least **10 Netherite** to forge a Netherite Pickaxe.';
            break;
        case 'rod_lucky':
            if ((inv.ores_json.gold || 0) >= 10) {
                inv.ores_json.gold -= 10;
                inv.rod_tier = 'lucky';
                success = true;
                msg = 'Crafted a **Lucky Fishing Rod**! Higher chance of rare sea creatures.';
            } else msg = 'You need at least **10 Gold** to craft a Lucky Fishing Rod.';
            break;
        case 'rod_sea':
            if ((inv.ores_json.diamond || 0) >= 15) {
                inv.ores_json.diamond -= 15;
                inv.rod_tier = 'sea';
                success = true;
                msg = 'Crafted a **Sea Fishing Rod**! Pufferfish and tropical catches boosted.';
            } else msg = 'You need at least **15 Diamonds** to craft a Sea Fishing Rod.';
            break;
        case 'rod_prismarine':
            if ((inv.ores_json.netherite || 0) >= 8) {
                inv.ores_json.netherite -= 8;
                inv.rod_tier = 'prismarine';
                success = true;
                msg = 'Crafted a **Prismarine Fishing Rod**! Maximum chance for enchanted Sunken Treasure!';
            } else msg = 'You need at least **8 Netherite** to craft a Prismarine Rod.';
            break;
    }

    if (success) {
        await viralExpansionStore.saveInventory(inv);
        const c = ComponentsV2.baseContainer(ComponentsV2.Accents.success);
        c.addTextDisplayComponents(ComponentsV2.text(`# 🔨 Blacksmith Forge\n\n${msg}`));
        await interaction.reply({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 });
    } else {
        await interaction.reply({ content: `❌ ${msg}`, flags: MessageFlags.Ephemeral });
    }
}

export const rpgCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('rpg')
        .setDescription('Minecraft Text-RPG: mine, fish, craft, and sell materials for real Victus COINS')
        .addSubcommand((sub) =>
            sub
                .setName('mine')
                .setDescription('Mine underground for coal, iron, gold, diamonds, and netherite')
        )
        .addSubcommand((sub) =>
            sub
                .setName('fish')
                .setDescription('Cast your fishing line into the water to catch fish and sunken treasure')
        )
        .addSubcommand((sub) =>
            sub
                .setName('inv')
                .setDescription('View your RPG mining & fishing inventory, pickaxe, and rod tiers')
        )
        .addSubcommand((sub) =>
            sub
                .setName('sell')
                .setDescription('Sell your mined ores and fish for real Victus Cloud COINS')
                .addStringOption((opt) =>
                    opt
                        .setName('category')
                        .setDescription('What to sell')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Sell All Ores & Fish', value: 'all' },
                            { name: 'Sell Only Ores', value: 'ores' },
                            { name: 'Sell Only Fish', value: 'fish' }
                        )
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('craft')
                .setDescription('Upgrade your pickaxe or fishing rod to harvest rarer resources')
                .addStringOption((opt) =>
                    opt
                        .setName('upgrade')
                        .setDescription('Select equipment upgrade')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Stone Pickaxe (10 Coal)', value: 'pick_stone' },
                            { name: 'Iron Pickaxe (15 Iron)', value: 'pick_iron' },
                            { name: 'Diamond Pickaxe (20 Diamonds)', value: 'pick_diamond' },
                            { name: 'Netherite Pickaxe (10 Netherite)', value: 'pick_netherite' },
                            { name: 'Lucky Fishing Rod (10 Gold)', value: 'rod_lucky' },
                            { name: 'Sea Fishing Rod (15 Diamonds)', value: 'rod_sea' },
                            { name: 'Prismarine Fishing Rod (8 Netherite)', value: 'rod_prismarine' }
                        )
                )
        ),

    cooldown: 2,

    async execute(interaction) {
        const sub = interaction.options?.getSubcommand?.(false);
        if (sub === 'mine') return handleMine(interaction);
        if (sub === 'fish') return handleFish(interaction);
        if (sub === 'inv') return handleInv(interaction);
        if (sub === 'sell') return handleSell(interaction);
        if (sub === 'craft') return handleCraft(interaction);
        return handleInv(interaction);
    },
};

// Aliases for user convenience: /mine, /fish, /sell, /craft
export const mineCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('mine')
        .setDescription('Mine underground for coal, iron, gold, diamonds, and netherite'),
    cooldown: 2,
    async execute(interaction) {
        return handleMine(interaction);
    },
};

export const fishCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('fish')
        .setDescription('Cast your fishing line into the water to catch fish and sunken treasure'),
    cooldown: 2,
    async execute(interaction) {
        return handleFish(interaction);
    },
};

export const sellCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('sell')
        .setDescription('Sell all your mined ores and fish for real Victus Cloud COINS'),
    cooldown: 2,
    async execute(interaction) {
        return handleSell(interaction, 'all');
    },
};

export const craftCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('craft')
        .setDescription('Open the crafting workshop to upgrade your pickaxe or fishing rod')
        .addStringOption((opt) =>
            opt
                .setName('upgrade')
                .setDescription('Select equipment upgrade')
                .setRequired(true)
                .addChoices(
                    { name: 'Stone Pickaxe (10 Coal)', value: 'pick_stone' },
                    { name: 'Iron Pickaxe (15 Iron)', value: 'pick_iron' },
                    { name: 'Diamond Pickaxe (20 Diamonds)', value: 'pick_diamond' },
                    { name: 'Netherite Pickaxe (10 Netherite)', value: 'pick_netherite' },
                    { name: 'Lucky Fishing Rod (10 Gold)', value: 'rod_lucky' },
                    { name: 'Sea Fishing Rod (15 Diamonds)', value: 'rod_sea' },
                    { name: 'Prismarine Fishing Rod (8 Netherite)', value: 'rod_prismarine' }
                )
        ),
    cooldown: 2,
    async execute(interaction) {
        return handleCraft(interaction);
    },
};
