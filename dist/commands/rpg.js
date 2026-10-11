import { SlashCommandBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { rpgService } from '../services/rpgService.js';
import { RECIPES, SELL_PRICES } from '../services/gameRules.js';
import { viralExpansionService } from '../services/viralExpansionService.js';
import { rpgCard, sellMenu, upgradeProgress } from './rpgUi.js';
export { ORE_SELL_PRICES, FISH_SELL_PRICES } from '../services/gameRules.js';
async function render(interaction, task) {
    const component = interaction.isMessageComponent?.() ?? false;
    if (component)
        await interaction.deferUpdate();
    else
        await interaction.deferReply({ flags: ComponentsV2.IS_COMPONENTS_V2 });
    try {
        const card = await task();
        await interaction.editReply({ components: [card], flags: ComponentsV2.IS_COMPONENTS_V2, allowedMentions: { parse: [] } });
    }
    catch (error) {
        const message = error?.message || 'The game service is unavailable. Please try again.';
        if (component)
            await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
        else
            await interaction.editReply({ components: [rpgCard(interaction.user.id, 'Could not complete action', message, ComponentsV2.Accents.warning)], flags: ComponentsV2.IS_COMPONENTS_V2 });
    }
}
async function gather(interaction, kind) {
    return render(interaction, async () => {
        const { inventory, item, activityXp } = await rpgService.gather(interaction.user.id, kind);
        if (activityXp && interaction.guild) {
            void viralExpansionService.addGuildActivityXp(interaction.guild.id, activityXp, interaction.guild.ownerId).catch(() => { });
        }
        const count = inventory.ores_json[item] ?? inventory.fish_json[item];
        return rpgCard(interaction.user.id, kind === 'mine' ? 'Mining loot' : 'Fishing catch', `**+1 ${item}** ? you now have **${count}**.\n\n` +
            `Equipment: **${kind === 'mine' ? inventory.pickaxe_tier : inventory.rod_tier}**\n` +
            `${upgradeProgress(inventory)}\n\n` +
            (kind === 'mine' ? 'Press **Mine** for another instant drop. A one-second guard prevents duplicate clicks.' : 'Press **Fish** to cast again in 5 seconds.'));
    });
}
export async function handleMine(interaction) { return gather(interaction, 'mine'); }
export async function handleFish(interaction) { return gather(interaction, 'fish'); }
export async function handleInv(interaction) {
    return render(interaction, async () => {
        const inv = await rpgService.inventory(interaction.user.id);
        return rpgCard(interaction.user.id, 'Your RPG backpack', `**Pickaxe:** ${inv.pickaxe_tier} | **Rod:** ${inv.rod_tier}\n\n` +
            `**Ores**\n${Object.entries(inv.ores_json).map(([item, count]) => `${item}: **${count}**`).join(' ? ')}\n\n` +
            `**Fish**\n${Object.entries(inv.fish_json).map(([item, count]) => `${item}: **${count}**`).join(' ? ')}\n\n` +
            `${upgradeProgress(inv)}\nUse /craft to upgrade. Selling is always your choice.`);
    });
}
export async function handleSell(interaction, selectionOverride, quantityOverride) {
    return render(interaction, async () => {
        if (!selectionOverride && interaction.options?.getString?.('item') && interaction.options?.getString?.('category'))
            throw new Error('Choose either one material or a bulk category, not both.');
        const selection = selectionOverride || interaction.options?.getString?.('item') || interaction.options?.getString?.('category') || undefined;
        const quantity = quantityOverride ?? interaction.options?.getInteger?.('quantity');
        if (!selection && quantity != null)
            throw new Error('Select one material when providing a quantity.');
        const sale = await rpgService.sell(interaction.user.id, selection, quantity);
        if (!sale)
            return sellMenu(interaction.user.id, await rpgService.inventory(interaction.user.id));
        return rpgCard(interaction.user.id, 'Sale complete', `${sale.sold.map(row => `**${row.count} ${row.item}** ? ${row.coins} COINS`).join('\n')}\n\n` +
            `**Earned: ${sale.coins} COINS**\nBalance: **${sale.balance ?? 'synced'} COINS**\n\n` +
            'Unselected materials and fractional leftovers are still in your backpack.', ComponentsV2.Accents.success);
    });
}
export async function handleCraft(interaction, upgradeOverride) {
    return render(interaction, async () => {
        const recipe = await rpgService.craft(interaction.user.id, upgradeOverride || interaction.options.getString('upgrade', true));
        return rpgCard(interaction.user.id, 'Equipment upgraded', `Crafted a **${recipe.tier} ${recipe.equipment === 'pickaxe_tier' ? 'pickaxe' : 'fishing rod'}** using ${recipe.count} ${recipe.material}.\n\nTry it using the buttons below!`, ComponentsV2.Accents.success);
    });
}
function sellOptions(builder) {
    return builder
        .addStringOption((opt) => opt.setName('item').setDescription('Sell one material; all other materials stay in your backpack')
        .addChoices(...Object.keys(SELL_PRICES).map(item => ({ name: item, value: item }))))
        .addIntegerOption((opt) => opt.setName('quantity').setDescription('Maximum quantity of that item to sell; fractional leftovers are kept').setMinValue(1))
        .addStringOption((opt) => opt.setName('category').setDescription('Bulk sale; omit all options to open the material picker')
        .addChoices({ name: 'Common ores only (keep diamonds and netherite)', value: 'common' }, { name: 'Fish only (keep all ores)', value: 'fish' }, { name: 'All ores INCLUDING diamonds and netherite', value: 'ores' }, { name: 'Everything INCLUDING diamonds and netherite', value: 'all' }));
}
function craftOptions(builder) {
    return builder.addStringOption((opt) => opt.setName('upgrade').setDescription('Choose an equipment upgrade').setRequired(true)
        .addChoices(...Object.entries(RECIPES).map(([key, recipe]) => ({
        name: `${recipe.tier} ${recipe.equipment === 'pickaxe_tier' ? 'pickaxe' : 'rod'} (${recipe.count} ${recipe.material})`, value: key,
    }))));
}
async function ownsPanel(interaction, owner) {
    if (owner === interaction.user.id)
        return true;
    await interaction.reply({ content: 'This backpack belongs to someone else. Use /mine or /sell to open your own.', flags: MessageFlags.Ephemeral });
    return false;
}
export const rpgCommand = {
    data: new SlashCommandBuilder().setName('rpg').setDescription('Mine, fish, craft and sell your chosen resources')
        .addSubcommand(sub => sub.setName('mine').setDescription('Mine instantly and keep playing with one button'))
        .addSubcommand(sub => sub.setName('fish').setDescription('Catch fish and keep casting with one button'))
        .addSubcommand(sub => sub.setName('inv').setDescription('View materials and progress toward equipment upgrades'))
        .addSubcommand(sub => sellOptions(sub.setName('sell').setDescription('Choose what to sell and how much to keep')))
        .addSubcommand(sub => craftOptions(sub.setName('craft').setDescription('Upgrade your equipment'))),
    async execute(interaction) {
        const sub = interaction.options?.getSubcommand?.(false);
        if (sub === 'mine')
            return handleMine(interaction);
        if (sub === 'fish')
            return handleFish(interaction);
        if (sub === 'sell')
            return handleSell(interaction);
        if (sub === 'craft')
            return handleCraft(interaction);
        return handleInv(interaction);
    },
    async handleButton(interaction) {
        if (!interaction.customId.startsWith('rpg:'))
            return;
        const [, action, owner] = interaction.customId.split(':');
        if (!await ownsPanel(interaction, owner))
            return;
        if (action === 'mine')
            return handleMine(interaction);
        if (action === 'fish')
            return handleFish(interaction);
        if (action === 'inv')
            return handleInv(interaction);
        if (action === 'sell')
            return handleSell(interaction);
    },
    async handleSelectMenu(interaction) {
        if (!interaction.customId.startsWith('rpg:sellselect:'))
            return;
        const owner = interaction.customId.split(':')[2];
        if (!await ownsPanel(interaction, owner))
            return;
        const item = interaction.values[0];
        if (['common', 'fish'].includes(item))
            return handleSell(interaction, item);
        if (!Object.hasOwn(SELL_PRICES, item))
            return;
        const modal = new ModalBuilder().setCustomId(`rpg:sellmodal:${owner}:${item}`).setTitle(`Sell ${item}`)
            .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('quantity').setLabel('Quantity to sell (or all of this material)')
            .setPlaceholder('e.g. 10 or all').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(12)));
        await interaction.showModal(modal);
    },
    async handleModal(interaction) {
        if (!interaction.customId.startsWith('rpg:sellmodal:'))
            return;
        const [, , owner, item] = interaction.customId.split(':');
        if (!await ownsPanel(interaction, owner))
            return;
        const raw = interaction.fields.getTextInputValue('quantity').trim().toLowerCase();
        const quantity = raw === 'all' ? null : /^\d+$/.test(raw) ? Number(raw) : NaN;
        return handleSell(interaction, item, quantity);
    },
};
export const mineCommand = {
    data: new SlashCommandBuilder().setName('mine').setDescription('Get an instant drop and mine again with one button'), execute: handleMine,
};
export const fishCommand = {
    data: new SlashCommandBuilder().setName('fish').setDescription('Catch fish and keep casting with one button'), execute: handleFish,
};
export const sellCommand = {
    data: sellOptions(new SlashCommandBuilder().setName('sell').setDescription('Choose which materials and quantities to sell')), execute: handleSell,
};
export const craftCommand = {
    data: craftOptions(new SlashCommandBuilder().setName('craft').setDescription('Upgrade your pickaxe or fishing rod')), execute: handleCraft,
};
