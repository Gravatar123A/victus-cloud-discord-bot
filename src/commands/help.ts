import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types/index.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { config } from '../config.js';

export const helpCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Get help with Victus Cloud bot commands'),

    cooldown: 5,

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

        const container = ComponentsV2.helpMenuContainer(
            interaction.user.username,
            interaction.user.displayAvatarURL({ size: 128 }),
            interaction.client.commands.size
        );

        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    },

    async handleSelectMenu(interaction) {
        if (interaction.customId !== 'help_category') return;

        const category = interaction.values[0];
        let container;

        switch (category) {
            case 'account':
                container = ComponentsV2.infoContainer(
                    'Account Commands',
                    '**`/link account`** - Link Discord to Victus Cloud\n' +
                    '**`/link panel`** - Post the cinematic public link panel\n' +
                    '**`/account`** - View your Victus profile, credits, and services\n' +
                    '**`/preferences notifications`** - Manage Discord DM categories\n' +
                    '**`/unlink`** - Remove your account link\n\n' +
                    '_Linking unlocks account-aware commands and the website linked role._'
                );
                break;

            case 'servers':
                container = ComponentsV2.infoContainer(
                    'Server Commands',
                    '**`/servers list`** - View your server fleet\n' +
                    '**`/servers info`** - Inspect detailed server state\n' +
                    '**`/servers power`** - Start, stop, restart, or kill a server\n\n' +
                    '_Requires a linked Victus Cloud account._'
                );
                break;

            case 'billing':
                container = ComponentsV2.infoContainer(
                    'Billing Commands',
                    '**`/services`** - View active services\n' +
                    '**`/invoices`** - View invoice history\n' +
                    '**`/account`** - See synced credits and account readiness\n\n' +
                    '_Billing data is pulled from your linked Victus profile._'
                );
                break;

            case 'ai':
                container = ComponentsV2.infoContainer(
                    'AI Support',
                    '**`/ask question:<your question>`** - Ask the Victus Cloud AI assistant\n\n' +
                    '_Powered by Groq `llama-3.1-8b-instant` with Victus Cloud support rules for hosting, account linking, billing paths, file host behavior, and troubleshooting._'
                );
                break;

            case 'support':
                container = ComponentsV2.infoContainer(
                    'Support',
                    `Need help? Use the links below or open a ticket in the server.\n\n` +
                    `**Website:** ${config.branding.website}\n` +
                    `**Billing:** ${config.branding.billing}\n` +
                    `**Game Panel:** ${config.branding.panel}\n` +
                    `**Email:** support@victuscloud.com`
                );
                break;

            default:
                container = ComponentsV2.errorContainer(
                    'Unknown Category',
                    'Please select a valid category.'
                );
        }

        await interaction.update({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    },
};
