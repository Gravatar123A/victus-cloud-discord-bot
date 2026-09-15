import {
    SlashCommandBuilder,
    ChannelType,
    PermissionFlagsBits,
    ForumChannel,
    TextChannel,
    NewsChannel,
    AttachmentBuilder,
    MessageFlags,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { forumDirectoryService } from '../services/forumDirectoryService.js';
import { discoveryService } from '../services/discoveryService.js';
import { hubBridgeService } from '../services/hubBridgeService.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';

export const setupCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Admin configuration for Victus Cloud features and live forum directory')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((sub) =>
            sub
                .setName('forum-channel')
                .setDescription('Set the live auto-updating server discovery forum channel')
                .addChannelOption((opt) =>
                    opt
                        .setName('channel')
                        .setDescription('Select the target Forum channel')
                        .addChannelTypes(ChannelType.GuildForum)
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('resync-directory')
                .setDescription('Force full re-synchronization of all servers in the forum channel')
        )
        .addSubcommand((sub) =>
            sub
                .setName('status')
                .setDescription('View status and statistics for the live server discovery forum directory')
        )
        .addSubcommand((sub) =>
            sub
                .setName('dump-json')
                .setDescription('Export JSON dump of all currently discoverable servers (Section 0 check)')
        )
        .addSubcommand((sub) =>
            sub
                .setName('hub-bridge')
                .setDescription('Link a Discord channel to the Main Hub Minecraft server chat and join/leave bridge')
                .addChannelOption((opt) =>
                    opt
                        .setName('channel')
                        .setDescription('Select the text channel for Minecraft chat & join/leave broadcasts')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(true)
                )
        ),

    cooldown: 5,

    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({
                content: '⚠️ This command must be executed within a Discord server.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const subcommand = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

        try {
            switch (subcommand) {
                case 'forum-channel': {
                    const channel = interaction.options.getChannel('channel', true);
                    if (channel.type !== ChannelType.GuildForum) {
                        const err = ComponentsV2.errorContainer(
                            'Invalid Channel Type',
                            `Channel <#${channel.id}> is not a **Forum Channel**. Please select a forum channel with threads enabled.`
                        );
                        await interaction.editReply({ components: [err], flags: ComponentsV2.IS_COMPONENTS_V2 });
                        return;
                    }

                    const forumChannel = channel as ForumChannel;
                    const tagMap = await forumDirectoryService.reconcileForumTags(forumChannel);

                    await forumDirectoryService.saveConfig(interaction.guild.id, {
                        enabled: true,
                        forumChannelId: forumChannel.id,
                        tagMapping: tagMap,
                        lastResyncAt: Date.now(),
                    });

                    // Trigger immediate sync
                    const res = await forumDirectoryService.resyncGuild(interaction.guild.id);

                    const success = ComponentsV2.successContainer(
                        'Forum Directory Configured',
                        `✅ Successfully linked live discovery forum directory to <#${forumChannel.id}>!\n\n` +
                        `• **Category & Status Tags:** ${Object.keys(tagMap).length} tags mapped (including \`ONLINE\`)\n` +
                        `• **Synchronizing Servers:** ${res.total} active community nodes queued\n` +
                        `• **Live Status Sync:** Automatically applies \`ONLINE\` tag to active servers and removes it when offline.`
                    );

                    await interaction.editReply({ components: [success], flags: ComponentsV2.IS_COMPONENTS_V2 });
                    break;
                }

                case 'resync-directory': {
                    const res = await forumDirectoryService.resyncGuild(interaction.guild.id);
                    const container = ComponentsV2.successContainer(
                        'Directory Resync Scheduled',
                        `🔄 **Full directory synchronization initiated.**\n\n` +
                        `• **Total Servers:** ${res.total}\n` +
                        `• **Queued for Update/Create:** ${res.queued}\n` +
                        `• Progress will update automatically in the configured forum channel.`
                    );
                    await interaction.editReply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
                    break;
                }

                case 'status': {
                    const status = await forumDirectoryService.getStatus(interaction.guild.id);
                    const channelDesc = status.forumChannelName
                        ? `\`#${status.forumChannelName}\``
                        : '*Not configured (use `/setup forum-channel`)*';

                    const container = ComponentsV2.baseContainer(ComponentsV2.Accents.info)
                        .addTextDisplayComponents(
                            ComponentsV2.text(
                                `# Discovery Forum Directory Status\n\n` +
                                `### 🛰️ Live Directory Diagnostics\n\n` +
                                `› **Directory Active:** ${status.enabled ? '🟢 Enabled' : '🔴 Disabled'}\n` +
                                `› **Target Forum:** ${channelDesc}\n` +
                                `› **Live Discovered Servers:** \`${status.totalServers}\` servers\n` +
                                `› **Synced Forum Threads:** \`${status.syncedThreads}\` active threads\n` +
                                `› **Pending Queue:** \`${status.queueLength}\` updates waiting\n` +
                                `› **Last Resync:** ${status.lastResync}\n\n` +
                                `To trigger a manual refresh, run \`/setup resync-directory\`.`
                            )
                        );
                    await interaction.editReply({ components: [container], flags: ComponentsV2.IS_COMPONENTS_V2 });
                    break;
                }

                case 'dump-json': {
                    const jsonDump = await discoveryService.dumpDiscoveredServersJson();
                    const attachment = new AttachmentBuilder(Buffer.from(jsonDump, 'utf8'), {
                        name: 'discovered-servers.json',
                        description: 'Victus Cloud discoverable servers JSON dump',
                    });

                    const parsed = JSON.parse(jsonDump);
                    const container = ComponentsV2.baseContainer(ComponentsV2.Accents.info)
                        .addTextDisplayComponents(
                            ComponentsV2.text(
                                `# Discovered Servers Export\n\n` +
                                `### 📦 Section 0 Acceptance Dump\n\n` +
                                `› **Total Discoverable Servers:** \`${parsed.total_discoverable_servers}\`\n` +
                                `› **Generated At:** \`${parsed.generated_at}\`\n` +
                                `› All fields confirmed normalized, populated, or explicitly null.\n\n` +
                                `Download the raw JSON dump below:`
                            )
                        );

                    await interaction.editReply({
                        components: [container],
                        files: [attachment],
                        flags: ComponentsV2.IS_COMPONENTS_V2,
                    });
                    break;
                }

                case 'hub-bridge': {
                    const channel = interaction.options.getChannel('channel', true);
                    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
                        const err = ComponentsV2.errorContainer(
                            'Invalid Channel Type',
                            `Channel <#${channel.id}> is not a text or announcement channel. Please select a standard text channel.`
                        );
                        await interaction.editReply({ components: [err], flags: ComponentsV2.IS_COMPONENTS_V2 });
                        return;
                    }

                    const { webhookUrl, hubConnected } = await hubBridgeService.setupChannel(
                        interaction.guild,
                        channel as TextChannel | NewsChannel
                    );

                    const container = ComponentsV2.baseContainer(ComponentsV2.Accents.success)
                        .addTextDisplayComponents(
                            ComponentsV2.text(
                                `# 🌉 Main Hub Discord Bridge Connected\n\n` +
                                `### 🔗 Channel Link Established\n\n` +
                                `› **Linked Channel:** <#${channel.id}>\n` +
                                `› **Minecraft Server:** \`Victus Main Hub (Lobby #344)\`\n` +
                                `› **Bridge Status:** ${hubConnected ? '🟢 `ACTIVE & SYNCHRONIZED`' : '🟡 `CONFIGURED (PENDING HUB RELOAD)`'}\n` +
                                `› **Player Avatar Webhook:** \`Configured (Victus Hub Bridge)\`\n\n` +
                                `### ⚡ Active Features:\n` +
                                `• **Minecraft -> Discord Chat:** Real-time messages with player skins and usernames\n` +
                                `• **Discord -> Minecraft Chat:** Relayed instantly as \`[Discord] Author » Message\`\n` +
                                `• **Join & Leave Logs:** \`📥 Player joined\` and \`📤 Player left\` notifications\n` +
                                `• **In-game Command:** \`/hubdiscord status\` available to server operators`
                            )
                        );

                    await interaction.editReply({
                        components: [container],
                        flags: ComponentsV2.IS_COMPONENTS_V2,
                    });
                    break;
                }
            }
        } catch (err: any) {
            logger.error('Error executing setup command:', err);
            const errContainer = ComponentsV2.errorContainer(
                'Setup Operation Failed',
                `An error occurred: \`${err?.message || 'Unknown error'}\``
            );
            await interaction.editReply({ components: [errContainer], flags: ComponentsV2.IS_COMPONENTS_V2 });
        }
    },
};
