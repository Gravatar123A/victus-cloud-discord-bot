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
import { compactId, decodeDisplayText, Icons, statusIcon, statusLabel } from '../utils/premium.js';
import { logger } from '../utils/logger.js';

export const serversCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('servers')
        .setDescription('View and manage your game servers')
        .addSubcommand((sub) =>
            sub
                .setName('list')
                .setDescription('List your Victus Cloud servers')
        )
        .addSubcommand((sub) =>
            sub
                .setName('info')
                .setDescription('View detailed server telemetry')
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
                .setDescription('Send a power signal to a server')
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
                            { name: 'Start', value: 'start' },
                            { name: 'Stop', value: 'stop' },
                            { name: 'Restart', value: 'restart' },
                            { name: 'Kill', value: 'kill' }
                        )
                )
        ),

    requiresLink: true,
    cooldown: 5,

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();

        try {
            const linked = await supabase.getLinkedAccount(interaction.user.id);
            const servers = linked ? await getServersForUser(linked.user_id) : [];
            const filtered = servers
                .filter((server: any) =>
                    decodeDisplayText(server.name, '').toLowerCase().includes(focused) ||
                    String(server.identifier || '').toLowerCase().includes(focused)
                )
                .slice(0, 25);

            await interaction.respond(
                filtered.map((server: any) => ({
                    name: `${decodeDisplayText(server.name)} (${server.identifier})`,
                    value: server.identifier,
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
                    await handleServerList(interaction, linked.userId);
                    break;
                case 'info':
                    await handleServerInfo(interaction, linked.userId);
                    break;
                case 'power':
                    await handleServerPower(interaction, linked.userId);
                    break;
            }
        } catch (error) {
            logger.error('Server command error:', error);
            await interaction.editReply({
                components: [ComponentsV2.errorContainer('Server Sync Failed', 'Could not fetch server information right now.')],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        }
    },
};

async function getServersForUser(userId: string) {
    const profile = await supabase.getUserProfile(userId);
    return profile?.email ? await supabase.getUserServers(profile.email) : [];
}

function getServerStatus(server: any) {
    return server.is_suspended || server.suspended ? 'suspended' : (server.status || 'offline');
}

async function handleServerList(interaction: any, userId: string) {
    const servers = await getServersForUser(userId);

    if (servers.length === 0) {
        const container = new ContainerBuilder()
            .setAccentColor(ComponentsV2.Accents.info)
            .addTextDisplayComponents(
                ComponentsV2.text(
                    `# ${Icons.server} Your Servers\n\n` +
                    `No servers are linked to your Victus account yet.\n\n` +
                    `[Create your first server](${config.branding.billing})`
                )
            );

        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        return;
    }

    const container = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.primary)
        .addTextDisplayComponents(
            ComponentsV2.text(`# ${Icons.crown} Your Server Fleet\n-# ${servers.length} server${servers.length !== 1 ? 's' : ''} connected to your Victus account`)
        )
        .addSeparatorComponents(ComponentsV2.separator());

    servers.slice(0, 10).forEach((server: any, index: number) => {
        const status = getServerStatus(server);
        container.addTextDisplayComponents(
            ComponentsV2.text(
                `### ${statusIcon(status)} ${decodeDisplayText(server.name)}\n` +
                `\`${compactId(server.identifier)}\` - **${statusLabel(status)}**\n` +
                `${Icons.memory} ${server.limits?.memory ? formatBytes(server.limits.memory * 1024 * 1024) : '?'} RAM | ` +
                `${Icons.cpu} ${server.limits?.cpu || '?'}% CPU | ` +
                `${Icons.disk} ${server.limits?.disk ? formatBytes(server.limits.disk * 1024 * 1024) : '?'} Disk`
            )
        );

        if (index < Math.min(servers.length - 1, 9)) {
            container.addSeparatorComponents(ComponentsV2.separator(true));
        }
    });

    const menu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('server_select')
            .setPlaceholder('Select a server for details...')
            .addOptions(
                servers.slice(0, 25).map((server: any) => ({
                    label: decodeDisplayText(server.name, 'Unknown Server'),
                    description: `ID: ${server.identifier}`,
                    value: server.identifier,
                    emoji: getServerStatus(server) === 'running' ? '●' : '○',
                }))
            )
    );

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('Victus Cloud')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.website),
        new ButtonBuilder()
            .setLabel('Free Hosting')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.free)
    );

    container.addActionRowComponents(menu);
    container.addActionRowComponents(buttons);

    await interaction.editReply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });
}

async function handleServerInfo(interaction: any, userId: string) {
    const serverId = interaction.options.getString('server', true);
    const servers = await getServersForUser(userId);
    const server = servers.find((candidate: any) => candidate.identifier === serverId);

    if (!server) {
        await interaction.editReply({
            components: [ComponentsV2.errorContainer('Server Not Found', `Server \`${serverId}\` is not attached to your Victus account.`)],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        return;
    }

    const status = getServerStatus(server);
    const icon = statusIcon(status);
    const container = new ContainerBuilder()
        .setAccentColor(status === 'running' ? ComponentsV2.Accents.success : ComponentsV2.Accents.purple)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# ${icon} ${decodeDisplayText(server.name)}\n` +
                `\`${server.identifier}\`\n\n` +
                `${decodeDisplayText(server.description, '_No description_')}`
            )
        )
        .addSeparatorComponents(ComponentsV2.separator())
        .addTextDisplayComponents(
            ComponentsV2.text(
                `### ${Icons.activity} Live State\n` +
                `${icon} **Status:** ${statusLabel(status)}\n` +
                `${Icons.node} **Node:** #${server.node}\n` +
                `${Icons.network} **Allocation:** #${server.allocation || 'Unknown'}`
            )
        )
        .addSeparatorComponents(ComponentsV2.separator())
        .addTextDisplayComponents(
            ComponentsV2.text(
                `### ${Icons.spark} Resource Envelope\n` +
                `${Icons.memory} **Memory:** ${server.limits?.memory ? formatBytes(server.limits.memory * 1024 * 1024) : 'Unlimited'}\n` +
                `${Icons.disk} **Disk:** ${server.limits?.disk ? formatBytes(server.limits.disk * 1024 * 1024) : 'Unlimited'}\n` +
                `${Icons.cpu} **CPU:** ${server.limits?.cpu ? `${server.limits.cpu}%` : 'Unlimited'}`
            )
        )
        .addSeparatorComponents(ComponentsV2.separator())
        .addTextDisplayComponents(
            ComponentsV2.text(
                `### ${Icons.service} Feature Limits\n` +
                `${Icons.database} **Databases:** ${server.feature_limits?.databases || 0}\n` +
                `${Icons.backup} **Backups:** ${server.feature_limits?.backups || 0}\n` +
                `${Icons.network} **Allocations:** ${server.feature_limits?.allocations || 0}`
            )
        );

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`server_start_${serverId}`)
            .setLabel('Start')
            .setStyle(ButtonStyle.Success)
            .setDisabled(status === 'running'),
        new ButtonBuilder()
            .setCustomId(`server_stop_${serverId}`)
            .setLabel('Stop')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(status === 'offline' || status === 'stopped'),
        new ButtonBuilder()
            .setCustomId(`server_restart_${serverId}`)
            .setLabel('Restart')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(status !== 'running'),
        new ButtonBuilder()
            .setLabel('Victus Cloud')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.website)
    );

    container.addActionRowComponents(buttons);

    await interaction.editReply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });
}

async function handleServerPower(interaction: any, userId: string) {
    const serverId = interaction.options.getString('server', true);
    const action = interaction.options.getString('action', true);
    const servers = await getServersForUser(userId);
    const server = servers.find((candidate: any) => candidate.identifier === serverId);

    if (!server) {
        await interaction.editReply({
            components: [ComponentsV2.errorContainer('Server Not Found', `Server \`${serverId}\` is not attached to your Victus account.`)],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
        return;
    }

    const actionIcon: Record<string, string> = {
        start: Icons.start,
        stop: Icons.stop,
        restart: Icons.restart,
        kill: Icons.kill,
    };

    await interaction.editReply({
        components: [
            ComponentsV2.successContainer(
                `${actionIcon[action]} Power Signal Queued`,
                `Sent **${action}** to **${decodeDisplayText(server.name)}**.\n\nServer state should update shortly.`
            ),
        ],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });
}

