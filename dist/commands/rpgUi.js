import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { RECIPES, SELL_PRICES, PICK_TIERS, ROD_TIERS } from '../services/gameRules.js';
export function rpgCard(id, title, body, color = ComponentsV2.Accents.primary) {
    const c = ComponentsV2.baseContainer(color);
    c.addTextDisplayComponents(ComponentsV2.text(`# ${title}\n\n${body}`));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(...[['mine', 'Mine', ButtonStyle.Primary], ['fish', 'Fish', ButtonStyle.Secondary],
        ['inv', 'Inventory', ButtonStyle.Secondary], ['sell', 'Sell materials', ButtonStyle.Success]].map(([action, label, style]) => new ButtonBuilder().setCustomId(`rpg:${action}:${id}`).setLabel(String(label)).setStyle(style))));
    return c;
}
export function upgradeProgress(inv) {
    return ['pickaxe_tier', 'rod_tier'].map(equipment => {
        const tiers = equipment === 'pickaxe_tier' ? PICK_TIERS : ROD_TIERS;
        const next = tiers[tiers.indexOf(inv[equipment]) + 1];
        const recipe = Object.values(RECIPES).find(r => r.equipment === equipment && r.tier === next);
        return recipe ? `Next ${equipment === 'pickaxe_tier' ? 'pickaxe' : 'rod'}: **${next}** — ${inv.ores_json[recipe.material]}/${recipe.count} ${recipe.material}` : `${equipment === 'pickaxe_tier' ? 'Pickaxe' : 'Rod'} fully upgraded!`;
    }).join('\n');
}
export function sellMenu(id, inv) {
    const c = rpgCard(id, 'Choose what to sell', 'Choose one material, then enter how much to sell. Diamonds and netherite stay safe unless you select them.\n\nWhole-coin lots only: any fractional leftovers stay in your backpack.\n\n' + upgradeProgress(inv));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`rpg:sellselect:${id}`).setPlaceholder('Choose a material or a safe bulk sale')
        .addOptions({ label: 'Sell common ores (coal, iron, gold)', value: 'common', description: 'Keep all diamonds, netherite and fish' }, { label: 'Sell fish only', value: 'fish', description: 'Keep every ore for crafting' }, ...Object.entries(SELL_PRICES).map(([item, price]) => ({ label: `${item} (${inv.ores_json[item] ?? inv.fish_json[item]})`, value: item, description: `${price} COINS each — choose a quantity` })))));
    return c;
}
