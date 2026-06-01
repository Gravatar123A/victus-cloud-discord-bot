import { SlashCommandBuilder, MessageFlags } from 'discord.js';
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

        const commandCount = interaction.client.commands.size;

        const container = ComponentsV2.helpMenuContainer(
            interaction.user.username,
            interaction.user.displayAvatarURL({ size: 128 }),
            commandCount
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
                    '👤 Account Commands',
                    '**`/link`** - Link your Discord to Victus Cloud\n' +
                    '**`/unlink`** - Remove account link\n\n' +
                    '_Link your account to manage servers and view billing from Discord!_'
                );
                break;

            case 'servers':
                container = ComponentsV2.infoContainer(
                    '🖥️ Server Commands',
                    '**`/servers list`** - View all your servers\n' +
                    '**`/servers info`** - Get detailed server info\n' +
                    '**`/servers power`** - Start/stop/restart a server\n\n' +
                    '_Requires linked account_'
                );
                break;

            case 'billing':
                container = ComponentsV2.infoContainer(
                    '💳 Billing Commands',
                    '**`/services`** - View your active services\n' +
                    '**`/invoices`** - View your invoice history\n\n' +
                    '_Requires linked account_'
                );
                break;

            case 'support':
                container = ComponentsV2.infoContainer(
                    '🎫 Support',
                    `Need help? Contact us!\n\n` +
                    `🌐 **Website:** ${config.branding.website}\n` +
                    `💬 **Discord:** Ask in our support channels\n` +
                    `📧 **Email:** support@victuscloud.com`
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
