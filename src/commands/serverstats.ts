import { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelSelectMenuBuilder, 
    ChannelType, 
    MessageFlags, 
    PermissionFlagsBits, 
    SlashCommandBuilder, 
    StringSelectMenuBuilder 
} from 'discord.js';
import type { Command } from '../types/index.js';
import { serverStatsSettings, ServerStatsConfig } from '../services/serverStatsSettings.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

const STATS_OPTIONS = [
    { label: 'Total Members', value: 'members', description: 'Show total member count' },
    { label: 'Online Members', value: 'online', description: 'Show online/dnd/idle member count' },
    { label: 'Boost Count', value: 'boosts', description: 'Show server boost count' },
    { label: 'Role Count', value: 'roles', description: 'Show total role count' },
    { label: 'Channel Count', value: 'channels', description: 'Show total channel count' }
];

function renderStatsDashboard(config: ServerStatsConfig): any {
    const c = ComponentsV2.baseContainer(config.enabled ? ComponentsV2.Accents.success : ComponentsV2.Accents.warning);

    const activeStatsList = config.stats && config.stats.length > 0
        ? config.stats.map(s => {
            const opt = STATS_OPTIONS.find(o => o.value === s);
            return `• **${opt?.label || s}**`;
        }).join('\n')
        : '_No statistics enabled_';

    const text = `# 📊 Server Statistics Channels\n` +
        `Create and maintain auto-updating voice channels showing server statistics.\n\n` +
        `› **Status:** ${config.enabled ? '🟢 **Enabled**' : '🔴 **Disabled**'}\n` +
        `› **Stats Category:** ${config.categoryId ? `<#${config.categoryId}>` : '*Not configured (Required)*'}\n\n` +
        `### Enabled Stats:\n${activeStatsList}`;

    c.addTextDisplayComponents(ComponentsV2.text(text))
     .addSeparatorComponents(ComponentsV2.separator());

    // Row 1: Category selection
    const categorySelect = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('serverstats:category')
            .setPlaceholder('Select stats parent category...')
            .addChannelTypes(ChannelType.GuildCategory)
    );

    // Row 2: Stats multi-select
    const statsSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('serverstats:options')
            .setPlaceholder('Select stats to display...')
            .setMinValues(1)
            .setMaxValues(STATS_OPTIONS.length)
            .addOptions(STATS_OPTIONS.map(opt => ({
                ...opt,
                default: config.stats.includes(opt.value)
            })))
    );

    // Row 3: Toggle and Force Update buttons
    const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('serverstats:toggle')
            .setLabel(config.enabled ? 'Disable Stats 🔴' : 'Enable Stats 🟢')
            .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('serverstats:update')
            .setLabel('Force Update Now 🔄')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!config.enabled)
    );

    c.addActionRowComponents(categorySelect);
    c.addActionRowComponents(statsSelect);
    c.addActionRowComponents(btnRow);

    return c;
}

export async function updateServerStats(guild: any): Promise<void> {
    try {
        const config = await serverStatsSettings.get(guild.id);
        if (!config.enabled || !config.categoryId) return;

        const category = guild.channels.cache.get(config.categoryId);
        if (!category || category.type !== ChannelType.GuildCategory) return;

        // Fetch members to get accurate counts (especially for online count)
        await guild.members.fetch().catch(() => {});

        const statsMap: Record<string, string> = {
            members: `📊 Members: ${guild.memberCount.toLocaleString()}`,
            online: `🟢 Online: ${guild.members.cache.filter((m: any) => m.presence && m.presence.status !== 'offline').size.toLocaleString()}`,
            boosts: `⚡ Boosts: ${guild.premiumSubscriptionCount || 0}`,
            roles: `🎭 Roles: ${guild.roles.cache.size}`,
            channels: `📁 Channels: ${guild.channels.cache.size}`
        };

        const updatedChannelIds = { ...config.channelIds };
        let changed = false;

        for (const stat of config.stats) {
            const name = statsMap[stat];
            if (!name) continue;

            const existingChannelId = config.channelIds[stat];
            let channel = existingChannelId ? guild.channels.cache.get(existingChannelId) : null;

            if (channel) {
                if (channel.name !== name) {
                    await channel.setName(name).catch(() => {});
                }
            } else {
                // Create new locked voice channel under category
                channel = await guild.channels.create({
                    name,
                    type: ChannelType.GuildVoice,
                    parent: config.categoryId,
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone.id,
                            deny: [PermissionFlagsBits.Connect]
                        }
                    ]
                }).catch(() => null);

                if (channel) {
                    updatedChannelIds[stat] = channel.id;
                    changed = true;
                }
            }
        }

        // Clean up disabled stats channels
        for (const key of Object.keys(config.channelIds)) {
            if (!config.stats.includes(key)) {
                const channelId = config.channelIds[key];
                const channel = guild.channels.cache.get(channelId);
                if (channel) {
                    await channel.delete().catch(() => {});
                }
                delete updatedChannelIds[key];
                changed = true;
            }
        }

        if (changed) {
            await serverStatsSettings.set(guild.id, { channelIds: updatedChannelIds });
        }
    } catch (err) {
        logger.error(`Error updating server stats for guild ${guild.id}:`, err);
    }
}

export const serverStatsCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('serverstats')
        .setDescription('Create and manage auto-updating voice server statistics channels')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Open the server statistics config wizard')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand(true);
        if (sub === 'setup') {
            const config = await serverStatsSettings.get(interaction.guildId!);
            const dashboard = renderStatsDashboard(config);
            await interaction.reply({
                components: [dashboard],
                flags: V2 | EPH
            });
        }
    },

    async handleButton(interaction) {
        const config = await serverStatsSettings.get(interaction.guildId!);
        const action = interaction.customId.split(':')[1];

        if (action === 'toggle') {
            const updated = await serverStatsSettings.set(interaction.guildId!, { enabled: !config.enabled });
            if (updated.enabled) {
                await updateServerStats(interaction.guild);
            } else {
                // Delete all channels on disable
                for (const id of Object.values(config.channelIds)) {
                    const channel = interaction.guild?.channels.cache.get(id);
                    if (channel) {
                        await channel.delete().catch(() => {});
                    }
                }
                await serverStatsSettings.set(interaction.guildId!, { channelIds: {} });
            }

            const refreshed = await serverStatsSettings.get(interaction.guildId!);
            await interaction.update({
                components: [renderStatsDashboard(refreshed)],
                embeds: []
            });
        } else if (action === 'update') {
            await interaction.deferUpdate();
            await updateServerStats(interaction.guild);
            const refreshed = await serverStatsSettings.get(interaction.guildId!);
            await interaction.editReply({
                components: [renderStatsDashboard(refreshed)],
                embeds: [],
                flags: V2
            });
        }
    },

    async handleSelectMenu(interaction) {
        if (!interaction.customId.startsWith('serverstats:')) return;
        const action = interaction.customId.split(':')[1];
        const config = await serverStatsSettings.get(interaction.guildId!);

        if (action === 'category') {
            const val = interaction.values[0];
            const updated = await serverStatsSettings.set(interaction.guildId!, { categoryId: val });
            if (updated.enabled) {
                await updateServerStats(interaction.guild);
            }
            const refreshed = await serverStatsSettings.get(interaction.guildId!);
            await interaction.update({
                components: [renderStatsDashboard(refreshed)],
                embeds: []
            });
        } else if (action === 'options') {
            const val = interaction.values;
            const updated = await serverStatsSettings.set(interaction.guildId!, { stats: val });
            if (updated.enabled) {
                await updateServerStats(interaction.guild);
            }
            const refreshed = await serverStatsSettings.get(interaction.guildId!);
            await interaction.update({
                components: [renderStatsDashboard(refreshed)],
                embeds: []
            });
        }
    }
};
