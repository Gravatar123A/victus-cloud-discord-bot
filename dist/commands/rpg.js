import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { viralExpansionStore } from '../services/viralExpansionStore.js';
import { CoinTransactionLock } from '../services/coinTransactionLock.js';
import { viralExpansionService } from '../services/viralExpansionService.js';
const MINE_COOLDOWN_MS = 25 * 1000; // 25 seconds
const FISH_COOLDOWN_MS = 25 * 1000; // 25 seconds
// Prices in real Victus COINS
export const ORE_SELL_PRICES = {
    coal: 0.2, // 5 coal = 1 coin
    iron: 0.5, // 2 iron = 1 coin
    gold: 1.0, // 1 gold = 1 coin
    diamond: 5.0, // 1 diamond = 5 coins
    netherite: 25.0, // 1 netherite = 25 coins
};
export const FISH_SELL_PRICES = {
    cod: 0.3,
    salmon: 0.6,
    tropical: 1.5,
    pufferfish: 3.0,
    treasure: 15.0,
};
export const rpgCommand = {
    data: new SlashCommandBuilder()
        .setName('rpg')
        .setDescription('Minecraft Text-RPG: mine, fish, craft, and sell materials for real Victus COINS')
        .addSubcommand((sub) => sub
        .setName('mine')
        .setDescription('Mine underground for coal, iron, gold, diamonds, and netherite'))
        .addSubcommand((sub) => sub
        .setName('fish')
        .setDescription('Cast your fishing line into the water to catch fish and sunken treasure'))
        .addSubcommand((sub) => sub
        .setName('inv')
        .setDescription('View your RPG mining & fishing inventory, pickaxe, and rod tiers'))
        .addSubcommand((sub) => sub
        .setName('sell')
        .setDescription('Sell your mined ores and fish for real Victus Cloud COINS')
        .addStringOption((opt) => opt
        .setName('category')
        .setDescription('What to sell')
        .setRequired(true)
        .addChoices({ name: 'Sell All Ores & Fish', value: 'all' }, { name: 'Sell Only Ores', value: 'ores' }, { name: 'Sell Only Fish', value: 'fish' })))
        .addSubcommand((sub) => sub
        .setName('craft')
        .setDescription('Upgrade your pickaxe or fishing rod to harvest rarer resources')
        .addStringOption((opt) => opt
        .setName('upgrade')
        .setDescription('Select equipment upgrade')
        .setRequired(true)
        .addChoices({ name: 'Stone Pickaxe (10 Coal)', value: 'pick_stone' }, { name: 'Iron Pickaxe (15 Iron)', value: 'pick_iron' }, { name: 'Diamond Pickaxe (20 Diamonds)', value: 'pick_diamond' }, { name: 'Netherite Pickaxe (10 Netherite)', value: 'pick_netherite' }, { name: 'Lucky Fishing Rod (10 Gold)', value: 'rod_lucky' }, { name: 'Sea Fishing Rod (15 Diamonds)', value: 'rod_sea' }, { name: 'Prismarine Fishing Rod (8 Netherite)', value: 'rod_prismarine' }))),
    cooldown: 2,
    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const inv = await viralExpansionStore.getInventory(userId);
        if (sub === 'mine') {
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
            const maxYield = tierMultipliers[inv.pickaxe_tier];
            const gained = {
                coal: Math.floor(Math.random() * maxYield.coal) + 1,
                iron: maxYield.iron > 0 ? Math.floor(Math.random() * (maxYield.iron + 1)) : 0,
                gold: maxYield.gold > 0 ? Math.floor(Math.random() * (maxYield.gold + 1)) : 0,
                diamond: maxYield.diamond > 0 ? (Math.random() < 0.4 ? 1 : 0) : 0,
                netherite: maxYield.netherite > 0 ? (Math.random() < 0.15 ? 1 : 0) : 0,
            };
            inv.ores_json.coal += gained.coal || 0;
            inv.ores_json.iron += gained.iron || 0;
            inv.ores_json.gold += gained.gold || 0;
            inv.ores_json.diamond += gained.diamond || 0;
            inv.ores_json.netherite += gained.netherite || 0;
            inv.last_mine_at = new Date().toISOString();
            await viralExpansionStore.saveInventory(inv);
            // Award server battle pass XP (+5 XP)
            if (interaction.guild) {
                await viralExpansionService.addGuildActivityXp(interaction.guild.id, 5, interaction.guild.ownerId);
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
            return;
        }
        if (sub === 'fish') {
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
            const luck = rodLuck[inv.rod_tier];
            const roll = Math.random();
            let caught = 'cod';
            if (roll < luck * 0.2)
                caught = 'treasure';
            else if (roll < luck * 0.5)
                caught = 'pufferfish';
            else if (roll < luck)
                caught = 'tropical';
            else if (roll < 0.6)
                caught = 'salmon';
            else
                caught = 'cod';
            inv.fish_json[caught] = (inv.fish_json[caught] || 0) + 1;
            inv.last_fish_at = new Date().toISOString();
            await viralExpansionStore.saveInventory(inv);
            if (interaction.guild) {
                await viralExpansionService.addGuildActivityXp(interaction.guild.id, 5, interaction.guild.ownerId);
            }
            const c = ComponentsV2.baseContainer(ComponentsV2.Accents.info);
            const catchLabels = {
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
            return;
        }
        if (sub === 'inv') {
            const c = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
            const text = `# 🎒 RPG Inventory: ${interaction.user.username}\n\n` +
                `### ⚔️ Equipment Tiers\n` +
                `› **Pickaxe:** \`${inv.pickaxe_tier.toUpperCase()}\` (Upgrade with \`/rpg craft\`)\n` +
                `› **Fishing Rod:** \`${inv.rod_tier.toUpperCase()}\`\n\n` +
                `### ⛏️ Mined Ores\n` +
                `› ⬛ Coal: \`${inv.ores_json.coal}\`\n` +
                `› ⬜ Iron: \`${inv.ores_json.iron}\`\n` +
                `› 🟨 Gold: \`${inv.ores_json.gold}\`\n` +
                `› 💎 Diamonds: \`${inv.ores_json.diamond}\`\n` +
                `› 🌌 Netherite: \`${inv.ores_json.netherite}\`\n\n` +
                `### 🎣 Fish & Marine Catches\n` +
                `› 🐟 Cod: \`${inv.fish_json.cod}\`\n` +
                `› 🍣 Salmon: \`${inv.fish_json.salmon}\`\n` +
                `› 🐠 Tropical: \`${inv.fish_json.tropical}\`\n` +
                `› 🐡 Pufferfish: \`${inv.fish_json.pufferfish}\`\n` +
                `› 📦 Treasures: \`${inv.fish_json.treasure}\`\n\n` +
                `-# Run \`/rpg sell\` to cash out your materials into real Victus COINS!`;
            c.addTextDisplayComponents(ComponentsV2.text(text));
            await interaction.reply({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 });
            return;
        }
        if (sub === 'sell') {
            const cat = interaction.options.getString('category', true);
            let totalCoins = 0;
            const soldItems = [];
            if (cat === 'all' || cat === 'ores') {
                for (const [ore, count] of Object.entries(inv.ores_json)) {
                    if (count > 0) {
                        const val = count * ORE_SELL_PRICES[ore];
                        totalCoins += val;
                        soldItems.push(`\`${count}\` ${ore} (+${val.toFixed(1)} COINS)`);
                        inv.ores_json[ore] = 0;
                    }
                }
            }
            if (cat === 'all' || cat === 'fish') {
                for (const [fish, count] of Object.entries(inv.fish_json)) {
                    if (count > 0) {
                        const val = count * FISH_SELL_PRICES[fish];
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
            const grantRes = await CoinTransactionLock.grantCoins(userId, roundedCoins, 'rpg_market_sell', `sell:${userId}:${Date.now()}`, `Sold RPG resources for ${roundedCoins} COINS`);
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
            return;
        }
        if (sub === 'craft') {
            const upgrade = interaction.options.getString('upgrade', true);
            let success = false;
            let msg = '';
            switch (upgrade) {
                case 'pick_stone':
                    if (inv.ores_json.coal >= 10) {
                        inv.ores_json.coal -= 10;
                        inv.pickaxe_tier = 'stone';
                        success = true;
                        msg = 'Forged a **Stone Pickaxe**! Iron and gold can now be harvested.';
                    }
                    else
                        msg = 'You need at least **10 Coal** to forge a Stone Pickaxe.';
                    break;
                case 'pick_iron':
                    if (inv.ores_json.iron >= 15) {
                        inv.ores_json.iron -= 15;
                        inv.pickaxe_tier = 'iron';
                        success = true;
                        msg = 'Forged an **Iron Pickaxe**! Diamonds are now within reach.';
                    }
                    else
                        msg = 'You need at least **15 Iron** to forge an Iron Pickaxe.';
                    break;
                case 'pick_diamond':
                    if (inv.ores_json.diamond >= 20) {
                        inv.ores_json.diamond -= 20;
                        inv.pickaxe_tier = 'diamond';
                        success = true;
                        msg = 'Forged a **Diamond Pickaxe**! Netherite and massive yields unlocked!';
                    }
                    else
                        msg = 'You need at least **20 Diamonds** to forge a Diamond Pickaxe.';
                    break;
                case 'pick_netherite':
                    if (inv.ores_json.netherite >= 10) {
                        inv.ores_json.netherite -= 10;
                        inv.pickaxe_tier = 'netherite';
                        success = true;
                        msg = 'Forged a **Netherite Pickaxe**! Maximum mining speed and World Boss raid power!';
                    }
                    else
                        msg = 'You need at least **10 Netherite** to forge a Netherite Pickaxe.';
                    break;
                case 'rod_lucky':
                    if (inv.ores_json.gold >= 10) {
                        inv.ores_json.gold -= 10;
                        inv.rod_tier = 'lucky';
                        success = true;
                        msg = 'Crafted a **Lucky Fishing Rod**! Higher chance of rare sea creatures.';
                    }
                    else
                        msg = 'You need at least **10 Gold** to craft a Lucky Fishing Rod.';
                    break;
                case 'rod_sea':
                    if (inv.ores_json.diamond >= 15) {
                        inv.ores_json.diamond -= 15;
                        inv.rod_tier = 'sea';
                        success = true;
                        msg = 'Crafted a **Sea Fishing Rod**! Pufferfish and tropical catches boosted.';
                    }
                    else
                        msg = 'You need at least **15 Diamonds** to craft a Sea Fishing Rod.';
                    break;
                case 'rod_prismarine':
                    if (inv.ores_json.netherite >= 8) {
                        inv.ores_json.netherite -= 8;
                        inv.rod_tier = 'prismarine';
                        success = true;
                        msg = 'Crafted a **Prismarine Fishing Rod**! Maximum chance for enchanted Sunken Treasure!';
                    }
                    else
                        msg = 'You need at least **8 Netherite** to craft a Prismarine Rod.';
                    break;
            }
            if (success) {
                await viralExpansionStore.saveInventory(inv);
                const c = ComponentsV2.baseContainer(ComponentsV2.Accents.success);
                c.addTextDisplayComponents(ComponentsV2.text(`# 🔨 Blacksmith Forge\n\n${msg}`));
                await interaction.reply({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 });
            }
            else {
                await interaction.reply({ content: `❌ ${msg}`, flags: MessageFlags.Ephemeral });
            }
        }
    },
};
// Aliases for user convenience: /mine, /fish, /sell, /craft
export const mineCommand = {
    data: new SlashCommandBuilder()
        .setName('mine')
        .setDescription('Mine underground for coal, iron, gold, diamonds, and netherite'),
    cooldown: 2,
    async execute(interaction) {
        // Forward to rpg mine
        interaction.options.data = [{ name: 'mine', type: 1 }];
        interaction.options.getSubcommand = () => 'mine';
        return rpgCommand.execute(interaction);
    },
};
export const fishCommand = {
    data: new SlashCommandBuilder()
        .setName('fish')
        .setDescription('Cast your fishing line into the water to catch fish and sunken treasure'),
    cooldown: 2,
    async execute(interaction) {
        interaction.options.data = [{ name: 'fish', type: 1 }];
        interaction.options.getSubcommand = () => 'fish';
        return rpgCommand.execute(interaction);
    },
};
export const sellCommand = {
    data: new SlashCommandBuilder()
        .setName('sell')
        .setDescription('Sell all your mined ores and fish for real Victus Cloud COINS'),
    cooldown: 2,
    async execute(interaction) {
        interaction.options.getSubcommand = () => 'sell';
        interaction.options.getString = (name) => name === 'category' ? 'all' : null;
        return rpgCommand.execute(interaction);
    },
};
export const craftCommand = {
    data: new SlashCommandBuilder()
        .setName('craft')
        .setDescription('Open the crafting workshop to upgrade your pickaxe or fishing rod')
        .addStringOption((opt) => opt
        .setName('upgrade')
        .setDescription('Select equipment upgrade')
        .setRequired(true)
        .addChoices({ name: 'Stone Pickaxe (10 Coal)', value: 'pick_stone' }, { name: 'Iron Pickaxe (15 Iron)', value: 'pick_iron' }, { name: 'Diamond Pickaxe (20 Diamonds)', value: 'pick_diamond' }, { name: 'Netherite Pickaxe (10 Netherite)', value: 'pick_netherite' }, { name: 'Lucky Fishing Rod (10 Gold)', value: 'rod_lucky' }, { name: 'Sea Fishing Rod (15 Diamonds)', value: 'rod_sea' }, { name: 'Prismarine Fishing Rod (8 Netherite)', value: 'rod_prismarine' })),
    cooldown: 2,
    async execute(interaction) {
        interaction.options.getSubcommand = () => 'craft';
        return rpgCommand.execute(interaction);
    },
};
