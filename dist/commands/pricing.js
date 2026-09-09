import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder, } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { fetchPricingCatalog } from '../services/pricingCatalog.js';
const V2 = ComponentsV2.IS_COMPONENTS_V2;
const SELECT_PREFIX = 'pricing:category:';
function categorySelect(catalog, selected) {
    return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(`${SELECT_PREFIX}${selected}`)
        .setPlaceholder('Choose a service category')
        .addOptions(catalog.categories.slice(0, 25).map((category) => ({
        label: category.name.slice(0, 100),
        value: category.id,
        description: category.description.slice(0, 100),
        default: category.id === selected,
    }))));
}
function renderPricing(catalog, category) {
    const selected = category ?? catalog.categories[0];
    const container = ComponentsV2.baseContainer(ComponentsV2.Accents.primary)
        .addTextDisplayComponents(ComponentsV2.text(`${ComponentsV2.panelTitle('Victus Cloud pricing', 'LIVE PRICING CATALOG')}\n\n` +
        `**${selected.name}**\n${selected.description}\n\n` +
        selected.plans.map((plan) => {
            const price = plan.priceUsd === null ? 'Contact us' : plan.priceUsd === 0 ? 'Free' : `$${plan.priceUsd.toFixed(2)} USD`;
            return `### ${plan.name} - ${price} ${plan.priceUsd ? `(${plan.billing})` : ''}\n${plan.features.slice(0, 7).map((feature) => `-# ✅ ${feature}`).join('\n')}`;
        }).join('\n\n')))
        .addSeparatorComponents(ComponentsV2.separator())
        .addActionRowComponents(categorySelect(catalog, selected.id))
        .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Open full pricing').setStyle(ButtonStyle.Link).setURL(`${catalog.source || 'https://victuscloud.com/pricing'}`)))
        .addTextDisplayComponents(ComponentsV2.footerNote(`Catalog ${catalog.version} • updated ${new Date(catalog.updatedAt).toLocaleDateString()}`));
    return container;
}
async function updatePricing(interaction, categoryId) {
    const catalog = await fetchPricingCatalog();
    const category = catalog.categories.find((item) => item.id === categoryId) || catalog.categories[0];
    await interaction.update({ components: [renderPricing(catalog, category)], flags: V2 });
}
export const pricingCommand = {
    data: new SlashCommandBuilder()
        .setName('pricing')
        .setDescription('View current Victus Cloud service pricing and features'),
    async execute(interaction) {
        const catalog = await fetchPricingCatalog();
        await interaction.reply({
            components: [renderPricing(catalog)],
            flags: MessageFlags.Ephemeral | V2,
        });
    },
    async handleSelectMenu(interaction) {
        if (!interaction.customId.startsWith(SELECT_PREFIX))
            return;
        const categoryId = interaction.values[0];
        await updatePricing(interaction, categoryId);
    },
};
