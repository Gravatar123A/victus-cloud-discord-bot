import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ModalBuilder,
    ModalSubmitInteraction,
    MessageFlags,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const CURRENCY_BUTTON = 'currency:open';
const CURRENCY_MODAL = 'currency:convert';

function currencyModal(): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(CURRENCY_MODAL)
        .setTitle('Currency converter')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('amount')
                    .setLabel('Amount')
                    .setPlaceholder('100')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(20),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('from')
                    .setLabel('From currency (ISO code)')
                    .setPlaceholder('USD')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMinLength(3)
                    .setMaxLength(3),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId('to')
                    .setLabel('To currency (ISO code)')
                    .setPlaceholder('EUR')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMinLength(3)
                    .setMaxLength(3),
            ),
        );
}

async function fetchConversion(amount: number, from: string, to: string): Promise<number> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
        const response = await fetch(
            `https://api.frankfurter.app/latest?amount=${encodeURIComponent(amount)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
            { signal: controller.signal },
        );
        const payload = await response.json() as { rates?: Record<string, unknown> };
        if (!response.ok || typeof payload.rates?.[to] !== 'number') {
            throw new Error('Currency code is not supported by the exchange-rate provider.');
        }
        return payload.rates[to] as number;
    } finally {
        clearTimeout(timeout);
    }
}

function converterPanel(): any {
    const container = ComponentsV2.cleanContainer(
        ComponentsV2.Accents.info,
        'Currency converter',
        '**Convert between supported currencies with current reference rates.**\n\n' +
        'Enter any ISO 4217 currency codes such as `USD`, `EUR`, `GBP`, `AED`, `PKR`, or `JPY`.\n\n' +
        '-# Rates are provided by Frankfurter and are for estimates and discussion only.',
        'FINANCE UTILITY',
    );
    container.addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(CURRENCY_BUTTON)
                .setLabel('Open converter')
                .setStyle(ButtonStyle.Primary),
        ),
    );
    return container;
}

export const currencyCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('currency')
        .setDescription('Convert any supported currency using live reference rates'),

    async execute(interaction) {
        await interaction.reply({
            components: [converterPanel()],
            flags: MessageFlags.Ephemeral | V2,
        });
    },

    async handleButton(interaction: ButtonInteraction) {
        if (interaction.customId !== CURRENCY_BUTTON) return;
        await interaction.showModal(currencyModal());
    },

    async handleModal(interaction: ModalSubmitInteraction) {
        if (interaction.customId !== CURRENCY_MODAL) return;

        const amount = Number(interaction.fields.getTextInputValue('amount').replace(/,/g, '').trim());
        const from = interaction.fields.getTextInputValue('from').trim().toUpperCase();
        const to = interaction.fields.getTextInputValue('to').trim().toUpperCase();
        if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
            await interaction.reply({ content: 'Enter a valid amount between 0 and 1,000,000,000.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
            await interaction.reply({ content: 'Use three-letter ISO currency codes, for example `USD` or `AED`.', flags: MessageFlags.Ephemeral });
            return;
        }

        try {
            const converted = await fetchConversion(amount, from, to);
            await interaction.reply({
                components: [ComponentsV2.successContainer(
                    'Conversion complete',
                    `**${amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${from}** = **${converted.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${to}**\n\n` +
                    '-# This is a live reference rate and may differ from a payment provider or bank rate.',
                )],
                flags: MessageFlags.Ephemeral | V2,
            });
        } catch (error) {
            await interaction.reply({
                content: `Unable to convert those currencies: ${(error as Error).message}`,
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};
