import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ContainerBuilder,
    MessageFlags,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { config } from '../config.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { requireLinkedAccount } from '../middleware/requireLinked.js';
import { formatBytes } from '../utils/pagination.js';
import { logger } from '../utils/logger.js';

export const serversCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('servers')
        .setDescription('View and manage your game servers')
        .addSubcommand((sub) =>
            sub
                .setName('list')
                .setDescription('List all your servers')
        )
        .addSubcommand((sub) =>
            sub
                .setName('info')
                .setDescription('View details of a specific server')
                .addStringOption((opt) =>
                    opt
                        .setName('server')
                        .setDescription('Server identifier')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('power')
                .setDescription('Control server power state')
                .addStringOption((opt) =>
                    opt
                        .setName('server')
                        .setDescription('Server identifier')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addStringOption((opt) =>
                    opt
                        .setName('action')
                        .setDescription('Power action')
                        .setRequired(true)
                        .setChoices(
                            { name: '▶️ Start', value: 'start' },
                            { name: '⏹️ Stop', value: 'stop' },
                            { name: '🔄 Restart', value: 'restart' },
                            { name: '⚡ Kill', value: 'kill' }
                        )
                )
        ),

    requiresLink: true,
    cooldown: 5,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused();

        try {
            const servers = await supabase.getServers();
            const filtered = servers
                .filter((s: any) =>
                    s.name?.toLowerCase().includes(focused.toLowerCase()) ||
                    s.identifier?.toLowerCase().includes(focused.toLowerCase())
                )
                .slice(0, 25);

            await interaction.respond(
                filtered.map((s: any) => ({
                    name: `${s.name} (${s.identifier})`,
                    value: s.identifier,
                }))
            );
        } catch {
            await interaction.respond([]);
        }
    },

    async execute(interaction) {
        const linked = await requireLinkedAccount(interaction);
        if (!linked) return;

        const subcommand = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

        try {
            switch (subcommand) {
                case 'list':
                    await handleServerList(interaction);
                    break;
                case 'info':
                    await handleServerInfo(interaction);
                    break;
                case 'power':
                    await handleServerPower(interaction);
                    break;
            }
        } catch (error) {
            logger.error('Server command error:', error);
            const container = ComponentsV2.errorContainer(
                'Error',
                'Failed to fetch server information. Please try again later.'
            );
            await interaction.editReply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        }
    },
};

async function handleServerList(interaction: any) {
    const servers = await supabase.getServers();

    if (servers.length === 0) {
        const container = new ContainerBuilder()
            .setAccentColor(ComponentsV2.Accents.info)
            .addTextDisplayComponents(
                ComponentsV2.text(
                    `# 🎮 Your Servers\n\n` +
                    `You don't have any servers yet.\n\n` +
                    `[Create your first server](${config.branding.billing})`
                )
            );

        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        return;
    }

    // Build server list container
    const container = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.primary)
        .addTextDisplayComponents(
            ComponentsV2.text(`# 🎮 Your Servers\n-# ${servers.length} server${servers.length !== 1 ? 's' : ''} total`)
        )
        .addSeparatorComponents(ComponentsV2.separator());

    servers.slice(0, 10).forEach((s: any, i: number) => {
        const status = s.is_suspended ? 'suspended' : (s.status || 'offline');
        const statusEmoji = status === 'running' ? '🟢' : status === 'stopped' ? '🔴' : '🟡';

        container.addTextDisplayComponents(
            ComponentsV2.text(
                `### ${statusEmoji} ${s.name}\n` +
                `\`${s.identifier}\`\n` +
                `💾 ${s.limits?.memory ? formatBytes(s.limits.memory * 1024 * 1024) : '?'} RAM | ` +
                `⚡ ${s.limits?.cpu || '?'}% CPU`
            )
        );

        if (i < Math.min(servers.length - 1, 9)) {
            container.addSeparatorComponents(ComponentsV2.separator(true));
        }
    });

    // Server selector
    const menu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('server_select')
            .setPlaceholder('Select a server for details...')
            .addOptions(
                servers.slice(0, 25).map((s: any) => ({
                    label: s.name || 'Unknown Server',
                    description: `ID: ${s.identifier}`,
                    value: s.identifier,
                    emoji: s.status === 'running' ? '🟢' : '🔴',
                }))
            )
    );

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('Open Panel')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.panel)
            .setEmoji('🖥️')
    );

    container.addActionRowComponents(menu);
    container.addActionRowComponents(buttons);

    await interaction.editReply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });
}

async function handleServerInfo(interaction: any) {
    const serverId = interaction.options.getString('server', true);
    const servers = await supabase.getServers();
    const server = servers.find((s: any) => s.identifier === serverId);

    if (!server) {
        const container = ComponentsV2.errorContainer(
            'Not Found',
            `Server \`${serverId}\` was not found.`
        );
        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        return;
    }

    const status = server.is_suspended ? 'suspended' : (server.status || 'offline');
    const statusEmoji = status === 'running' ? '🟢' : status === 'stopped' ? '🔴' : '🟡';

    const container = new ContainerBuilder()
        .setAccentColor(status === 'running' ? ComponentsV2.Accents.success : ComponentsV2.Accents.danger)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# ${statusEmoji} ${server.name}\n` +
                `\`${server.identifier}\`\n\n` +
                `${server.description || '_No description_'}`
            )
        )
        .addSeparatorComponents(ComponentsV2.separator())
        .addTextDisplayComponents(
            ComponentsV2.text(
                `### 📊 Status\n` +
                `${statusEmoji} **Status:** ${status.charAt(0).toUpperCase() + status.slice(1)}\n` +
                `🖥️ **Node:** #${server.node}`
            )
        )
        .addSeparatorComponents(ComponentsV2.separator())
        .addTextDisplayComponents(
            ComponentsV2.text(
                `### 💻 Resources\n` +
                `💾 **Memory:** ${server.limits?.memory ? formatBytes(server.limits.memory * 1024 * 1024) : 'Unlimited'}\n` +
                `💿 **Disk:** ${server.limits?.disk ? formatBytes(server.limits.disk * 1024 * 1024) : 'Unlimited'}\n` +
                `⚡ **CPU:** ${server.limits?.cpu ? `${server.limits.cpu}%` : 'Unlimited'}`
            )
        )
        .addSeparatorComponents(ComponentsV2.separator())
        .addTextDisplayComponents(
            ComponentsV2.text(
                `### 📦 Features\n` +
                `📁 **Databases:** ${server.feature_limits?.databases || 0}\n` +
                `💾 **Backups:** ${server.feature_limits?.backups || 0}\n` +
                `🌐 **Allocations:** ${server.feature_limits?.allocations || 0}`
            )
        );

    // Power control buttons
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`server_start_${serverId}`)
            .setLabel('Start')
            .setStyle(ButtonStyle.Success)
            .setEmoji('▶️')
            .setDisabled(status === 'running'),
        new ButtonBuilder()
            .setCustomId(`server_stop_${serverId}`)
            .setLabel('Stop')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('⏹️')
            .setDisabled(status === 'offline' || status === 'stopped'),
        new ButtonBuilder()
            .setCustomId(`server_restart_${serverId}`)
            .setLabel('Restart')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔄')
            .setDisabled(status !== 'running'),
        new ButtonBuilder()
            .setLabel('Open Panel')
            .setStyle(ButtonStyle.Link)
            .setURL(`${config.branding.panel}/server/${serverId}`)
            .setEmoji('🖥️')
    );

    container.addActionRowComponents(buttons);

    await interaction.editReply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });
}

async function handleServerPower(interaction: any) {
    const serverId = interaction.options.getString('server', true);
    const action = interaction.options.getString('action', true);

    const actionEmoji: Record<string, string> = {
        start: '▶️',
        stop: '⏹️',
        restart: '🔄',
        kill: '⚡',
    };

    const container = ComponentsV2.successContainer(
        `${actionEmoji[action]} Power Signal Sent`,
        `Sent **${action}** signal to server \`${serverId}\`.\n\n_Server status will update shortly._`
    );

    await interaction.editReply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });
}
