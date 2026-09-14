import {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
    StringSelectMenuInteraction,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { discoveryService } from '../services/discoveryService.js';
import { DiscoveryEmbeds } from '../embeds/discoveryEmbeds.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';

export const statusCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Look up live telemetry, player count, and IP for a Minecraft server')
        .addStringOption((opt) =>
            opt
                .setName('server')
                .setDescription('Server name, backend ID, or connect hostname')
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addBooleanOption((opt) =>
            opt.setName('ephemeral').setDescription('Make the response visible only to you (default: false)')
        ),

    cooldown: 3,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused();
        const choices = await discoveryService.autocompleteServer(focused);
        await interaction.respond(choices);
    },

    async execute(interaction) {
        const query = interaction.options.getString('server', true).trim();
        const isEphemeral = interaction.options.getBoolean('ephemeral') ?? false;

        const flags = ComponentsV2.IS_COMPONENTS_V2 | (isEphemeral ? MessageFlags.Ephemeral : 0);
        await interaction.deferReply({ flags });

        const { exact, matches } = await discoveryService.getServer(query);

        if (exact) {
            const { container, actionRows } = DiscoveryEmbeds.buildServerStatusCard(exact);
            await interaction.editReply({
                components: [container, ...actionRows],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        if (matches.length > 1) {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('status_disambiguate')
                .setPlaceholder('Select the matching server...');

            for (const s of matches.slice(0, 25)) {
                const statusDot = s.status === 'online' ? '🟢' : '🔴';
                selectMenu.addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(`${statusDot} ${s.serverName}`.slice(0, 100))
                        .setValue(s.serverId)
                        .setDescription(`${s.categoryLabel} • ${s.currentPlayerCount}/${s.maxPlayers} players • ${s.ip}`.slice(0, 100))
                );
            }

            const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
            const container = ComponentsV2.baseContainer(ComponentsV2.Accents.info)
                .addTextDisplayComponents(
                    ComponentsV2.text(
                        `# Multiple Servers Found\n\n` +
                        `We found **${matches.length}** community servers matching \`${query}\`.\n\nPlease pick the server you want to inspect below:`
                    )
                );

            await interaction.editReply({
                components: [container, row],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        // 0 matches
        const container = ComponentsV2.warningContainer(
            'Server Not Found',
            `No public server could be found matching **"${query}"**.\n\n` +
            `• Check if the server has **Discovery / Browser** enabled in the Victus panel\n` +
            `• Use \`/browse\` to view the entire live server catalog\n` +
            `• Make sure you entered the correct server name or ID`
        );

        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    },

    async handleSelectMenu(interaction: StringSelectMenuInteraction) {
        if (interaction.customId !== 'status_disambiguate') return;

        const serverId = interaction.values[0];
        const { exact } = await discoveryService.getServer(serverId);

        if (!exact) {
            await interaction.reply({
                content: '⚠️ Server could not be retrieved.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const { container, actionRows } = DiscoveryEmbeds.buildServerStatusCard(exact);
        await interaction.update({
            components: [container, ...actionRows],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    },
};
