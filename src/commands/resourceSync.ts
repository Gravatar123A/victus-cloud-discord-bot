import {
    ChannelType,
    ChatInputCommandInteraction,
    EmbedBuilder,
    GuildMember,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../types/index.js';
import {
    modrinthResourceService,
    ModrinthCategory,
} from '../services/modrinthResourceService.js';
import { antigravityPipeline } from '../services/antigravityPipeline.js';
import { supabase } from '../services/supabase.js';
import { config } from '../config.js';
import { VICTUS_COLORS } from '../types/index.js';
import { logger } from '../utils/logger.js';

const PRIMARY_STAFF_ROLE_ID = '1340607428252794973';

const ALL_CATEGORIES: ModrinthCategory[] = [
    'mc-mods',
    'mc-plugins',
    'mc-shaders',
    'scripts',
    'configs',
    'builds',
];

const CATEGORY_LABELS: Record<ModrinthCategory, string> = {
    'mc-mods': 'Minecraft Mods',
    'mc-plugins': 'Minecraft Plugins',
    'mc-shaders': 'Minecraft Shaders',
    scripts: 'Scripts & Datapacks',
    configs: 'Configs & Presets',
    builds: 'Builds & Worldgen',
};

async function checkIsStaff(interaction: any): Promise<boolean> {
    if (!interaction.guildId) return false;

    const member =
        (interaction.member as GuildMember | null) ||
        (await interaction.guild?.members.fetch(interaction.user.id).catch(() => null));
    if (!member) return false;

    if (antigravityPipeline.isAuthorized(member)) return true;

    if (
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        member.permissions.has(PermissionFlagsBits.ManageGuild) ||
        member.permissions.has(PermissionFlagsBits.ManageChannels)
    ) {
        return true;
    }

    const settings = await supabase.getBotSettings(interaction.guildId).catch(() => null);
    const staffRoleIds = new Set<string>([
        PRIMARY_STAFF_ROLE_ID,
        ...(config.antigravity.staffRoleIds || []),
        ...(settings?.ticket_staff_role_ids || []),
        ...(settings?.ticket_admin_role_ids || []),
    ]);

    const rolesObj = (member as any).roles;
    if (rolesObj) {
        if (Array.isArray(rolesObj)) {
            if (rolesObj.some((id: string) => staffRoleIds.has(id))) return true;
        } else if (rolesObj.cache && typeof rolesObj.cache.has === 'function') {
            if (rolesObj.cache.some((r: any) => staffRoleIds.has(r.id))) return true;
        }
    }

    return false;
}

export const resourceSyncCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('resource-sync')
        .setDescription('Create Modrinth forum channels and pull top 100 free Minecraft resources')
        .setDMPermission(false)
        .addSubcommand((sub) =>
            sub
                .setName('setup')
                .setDescription('Create the 6 free resource Forum Channels under 📦 FREE RESOURCES')
        )
        .addSubcommand((sub) =>
            sub
                .setName('pull')
                .setDescription('Pull top 100 free resources from Modrinth and publish them to forum channels')
                .addStringOption((opt) =>
                    opt
                        .setName('category')
                        .setDescription('Select category to pull, or all categories')
                        .setRequired(false)
                        .addChoices(
                            { name: 'All Categories (600+ Resources)', value: 'all' },
                            { name: 'Minecraft Mods (mc-mods)', value: 'mc-mods' },
                            { name: 'Minecraft Plugins (mc-plugins)', value: 'mc-plugins' },
                            { name: 'Minecraft Shaders (mc-shaders)', value: 'mc-shaders' },
                            { name: 'Scripts & Datapacks (scripts)', value: 'scripts' },
                            { name: 'Configs & Optimizations (configs)', value: 'configs' },
                            { name: 'Builds & Worldgen (builds)', value: 'builds' }
                        )
                )
                .addIntegerOption((opt) =>
                    opt
                        .setName('count')
                        .setDescription('Number of resources to pull per category (default: 100, min: 10, max: 100)')
                        .setMinValue(10)
                        .setMaxValue(100)
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('bind')
                .setDescription('Bind a specific forum channel to a category (rename-friendly)')
                .addStringOption((opt) =>
                    opt
                        .setName('category')
                        .setDescription('The category to bind')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Minecraft Mods (mc-mods)', value: 'mc-mods' },
                            { name: 'Minecraft Plugins (mc-plugins)', value: 'mc-plugins' },
                            { name: 'Minecraft Shaders (mc-shaders)', value: 'mc-shaders' },
                            { name: 'Scripts & Datapacks (scripts)', value: 'scripts' },
                            { name: 'Configs & Presets (configs)', value: 'configs' },
                            { name: 'Builds & Worldgen (builds)', value: 'builds' }
                        )
                )
                .addChannelOption((opt) =>
                    opt
                        .setName('channel')
                        .setDescription('The Forum Channel to use for this category')
                        .addChannelTypes(ChannelType.GuildForum)
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('status')
                .setDescription('View live Modrinth resource ingestion progress and statistics')
        )
        .addSubcommand((sub) =>
            sub
                .setName('stop')
                .setDescription('Stop any ongoing Modrinth resource ingestion')
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guild) {
            await interaction.reply({
                content: '❌ This command can only be used inside a Discord server.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const isStaff = await checkIsStaff(interaction);
        if (!isStaff) {
            await interaction.reply({
                content: '⛔ **Access Denied**: You need **Manage Channels** or Staff permissions to manage resource forums.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        let subcommand: string | null = null;
        try {
            subcommand = interaction.options.getSubcommand(false);
        } catch {
            subcommand = null;
        }

        // Support prefix interaction fallback
        const rawMessage = (interaction as any).message;
        let prefixCategoryArg: string | null = null;
        let prefixCountArg: number | null = null;
        let prefixChannelArg: any = null;

        if (!subcommand && rawMessage?.content) {
            const parts = rawMessage.content.trim().split(/\s+/).slice(1);
            if (parts.length > 0) {
                const first = parts[0].toLowerCase();
                if (first === 'setup' || first === 'create' || first === 'init') {
                    subcommand = 'setup';
                } else if (first === 'pull' || first === 'sync' || first === 'start') {
                    subcommand = 'pull';
                    if (parts[1]) {
                        const target = parts[1].toLowerCase();
                        if (target === 'mods' || target === 'mc-mods') prefixCategoryArg = 'mc-mods';
                        else if (target === 'plugins' || target === 'mc-plugins') prefixCategoryArg = 'mc-plugins';
                        else if (target === 'shaders' || target === 'mc-shaders') prefixCategoryArg = 'mc-shaders';
                        else if (target === 'scripts' || target === 'datapacks') prefixCategoryArg = 'scripts';
                        else if (target === 'configs') prefixCategoryArg = 'configs';
                        else if (target === 'builds' || target === 'structures') prefixCategoryArg = 'builds';
                        else if (target === 'all') prefixCategoryArg = 'all';
                    }
                    if (parts[2] && /^\d+$/.test(parts[2])) {
                        prefixCountArg = parseInt(parts[2], 10);
                    }
                } else if (first === 'bind' || first === 'link' || first === 'setchannel') {
                    subcommand = 'bind';
                    if (parts[1]) {
                        const target = parts[1].toLowerCase();
                        if (target === 'mods' || target === 'mc-mods') prefixCategoryArg = 'mc-mods';
                        else if (target === 'plugins' || target === 'mc-plugins') prefixCategoryArg = 'mc-plugins';
                        else if (target === 'shaders' || target === 'mc-shaders') prefixCategoryArg = 'mc-shaders';
                        else if (target === 'scripts' || target === 'datapacks') prefixCategoryArg = 'scripts';
                        else if (target === 'configs') prefixCategoryArg = 'configs';
                        else if (target === 'builds' || target === 'structures') prefixCategoryArg = 'builds';
                    }
                    const channelMention = parts.find((p: string) => /<#(\d+)>/.test(p));
                    if (channelMention) {
                        const match = channelMention.match(/\d+/);
                        if (match) {
                            prefixChannelArg = interaction.guild.channels.cache.get(match[0]);
                        }
                    }
                } else if (first === 'status' || first === 'progress') {
                    subcommand = 'status';
                } else if (first === 'stop' || first === 'cancel') {
                    subcommand = 'stop';
                }
            } else {
                subcommand = 'status';
            }
        }

        // Default to status if no subcommand
        if (!subcommand) {
            subcommand = 'status';
        }

        // =========================================================================
        // SUBCOMMAND: BIND
        // =========================================================================
        if (subcommand === 'bind') {
            const rawCategory =
                interaction.options.getString?.('category') ?? prefixCategoryArg;
            const category = rawCategory as ModrinthCategory;

            if (!category || !ALL_CATEGORIES.includes(category)) {
                await interaction.reply({
                    content: '❌ Invalid or missing category. Valid choices: `mc-mods`, `mc-plugins`, `mc-shaders`, `scripts`, `configs`, `builds`.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            let targetChannel = interaction.options.getChannel?.('channel');
            if (!targetChannel && prefixChannelArg) {
                targetChannel = prefixChannelArg;
            }

            if (!targetChannel || targetChannel.type !== ChannelType.GuildForum) {
                await interaction.reply({
                    content: '❌ The selected channel must be a valid **Forum Channel**.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            await modrinthResourceService.setCategoryChannel(interaction.guild.id, category, targetChannel.id);

            const embed = new EmbedBuilder()
                .setColor(VICTUS_COLORS.primary)
                .setTitle('✅ Forum Channel Bound')
                .setDescription(
                    `Successfully linked **${CATEGORY_LABELS[category]}** to <#${targetChannel.id}> (\`#${targetChannel.name}\`)!\n\n` +
                    `• You can rename this channel, add emojis, customize permissions, or move it anywhere.\n` +
                    `• Running \`/resource-sync pull\` will now publish **${CATEGORY_LABELS[category]}** directly to this forum.`
                )
                .setFooter({ text: 'Victus Cloud Community Resource Hub' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            return;
        }

        // =========================================================================
        // SUBCOMMAND: SETUP
        // =========================================================================
        if (subcommand === 'setup') {
            await interaction.deferReply();

            const setupRes = await modrinthResourceService.ensureForumChannels(interaction.guild);
            if (!setupRes.success) {
                await interaction.editReply({
                    content: `❌ **Failed to create forum channels**: ${setupRes.error || 'Unknown permission error.'}`,
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setColor(VICTUS_COLORS.primary)
                .setTitle('📦 Free Resource Forum Channels Ready!')
                .setDescription(
                    `Successfully verified and prepared dedicated **Forum Channels** under **📦 FREE RESOURCES**.\n\n` +
                    `Each channel is configured with tags, reaction emojis, and structured for community resource sharing.`
                )
                .addFields(
                    ALL_CATEGORIES.map((catKey) => {
                        const ch = setupRes.channels[catKey];
                        const link = ch ? `<#${ch.id}> (\`#${ch.name}\`)` : '⚠️ *Creation failed*';
                        return {
                            name: `🏷️ ${CATEGORY_LABELS[catKey]}`,
                            value: `Channel: ${link}`,
                            inline: true,
                        };
                    })
                )
                .addFields({
                    name: '🚀 Next Steps',
                    value:
                        `• Run \`/resource-sync pull\` to fetch the top 100 free resources for each category from Modrinth.\n` +
                        `• Monitor progress at any time using \`/resource-sync status\`.\n` +
                        `• Users can also share their own resources using \`/share-resource\`.`,
                    inline: false,
                })
                .setFooter({
                    text: `Created: ${setupRes.createdCount} new forum(s) • Existing: ${setupRes.reusedCount} forum(s)`,
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        // =========================================================================
        // SUBCOMMAND: PULL
        // =========================================================================
        if (subcommand === 'pull') {
            const rawCategory =
                interaction.options.getString?.('category') ?? prefixCategoryArg ?? 'all';
            const rawCount =
                interaction.options.getInteger?.('count') ?? prefixCountArg ?? 100;
            const count = Math.min(100, Math.max(10, rawCount));

            // Check if already running
            const existingProgress = modrinthResourceService.getProgress(interaction.guild.id);
            if (existingProgress?.isRunning) {
                await interaction.reply({
                    content:
                        `⚠️ **Sync already in progress!**\n` +
                        `An ingestion process is currently running for this server. Use \`/resource-sync status\` to check its progress or \`/resource-sync stop\` to halt it.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            let categoriesToPull: ModrinthCategory[];
            if (rawCategory === 'all' || !ALL_CATEGORIES.includes(rawCategory as ModrinthCategory)) {
                categoriesToPull = ALL_CATEGORIES;
            } else {
                categoriesToPull = [rawCategory as ModrinthCategory];
            }

            await interaction.deferReply();

            // Start background ingestion
            const progress = await modrinthResourceService.startIngestion(
                interaction.guild,
                categoriesToPull,
                count
            );

            const totalTarget = categoriesToPull.length * count;
            const estimatedMinutes = Math.ceil((totalTarget * 2) / 60);

            const embed = new EmbedBuilder()
                .setColor(0x1bd96a) // Modrinth green
                .setTitle('🚀 Modrinth Resource Sync Launched!')
                .setDescription(
                    `Background ingestion of top free community resources has started from **Modrinth**.\n\n` +
                    `Each item will be posted as an informative thread with download links, version tags, and stats.`
                )
                .addFields(
                    {
                        name: '📊 Target Categories',
                        value: categoriesToPull
                            .map((c) => `• **${CATEGORY_LABELS[c]}** (\`${c}\`)`)
                            .join('\n'),
                        inline: true,
                    },
                    {
                        name: '📦 Volume & Pacing',
                        value:
                            `› **Per Category:** \`${count}\` resources\n` +
                            `› **Total Target:** \`~${totalTarget}\` resources\n` +
                            `› **Est. Time:** \`~${estimatedMinutes} mins\` (Discord safe pacing)`,
                        inline: true,
                    },
                    {
                        name: '⚙️ Controls',
                        value:
                            `• Check live progress: \`/resource-sync status\`\n` +
                            `• Stop ingestion: \`/resource-sync stop\``,
                        inline: false,
                    }
                )
                .setFooter({
                    text: 'Running in background • Channels: 📦 FREE RESOURCES',
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        // =========================================================================
        // SUBCOMMAND: STATUS
        // =========================================================================
        if (subcommand === 'status') {
            const progress = modrinthResourceService.getProgress(interaction.guild.id);

            if (!progress) {
                const embed = new EmbedBuilder()
                    .setColor(VICTUS_COLORS.primary)
                    .setTitle('📦 Modrinth Resource Sync Status')
                    .setDescription(
                        `No resource sync has been run on this server yet.\n\n` +
                        `### Getting Started:\n` +
                        `1. Run \`/resource-sync setup\` to create the 6 Forum Channels.\n` +
                        `2. Run \`/resource-sync pull\` to automatically pull 100 of each category from Modrinth.`
                    )
                    .setFooter({ text: 'Victus Cloud Community Resource Hub' })
                    .setTimestamp();

                await interaction.reply({ embeds: [embed] });
                return;
            }

            const isRunning = progress.isRunning;
            const statusEmoji = isRunning ? '🟢' : '✅';
            const statusText = isRunning ? 'In Progress (Running)' : 'Idle / Completed';

            const elapsedSec = Math.floor((Date.now() - progress.startedAt) / 1000);
            const elapsedMin = Math.floor(elapsedSec / 60);

            let totalPosted = 0;
            let totalFetched = 0;

            const categoryLines = ALL_CATEGORIES.map((catKey) => {
                const st = progress.categories[catKey];
                if (!st) return `• **${CATEGORY_LABELS[catKey]}:** _Not queued_`;

                totalPosted += st.totalPosted;
                totalFetched += st.totalFetched;

                const icon = st.completed
                    ? '✅'
                    : isRunning && st.totalFetched > 0 && st.totalPosted < st.totalFetched
                    ? '🔄'
                    : '⏳';

                const chMention = st.channelId ? `<#${st.channelId}>` : `\`#${st.channelName}\``;
                return `${icon} **${CATEGORY_LABELS[catKey]}** (${chMention})\n   └ Posted: **${st.totalPosted}** / **${st.totalFetched || 100}**${st.error ? ` ⚠️ *${st.error}*` : ''}`;
            });

            const embed = new EmbedBuilder()
                .setColor(isRunning ? 0x1bd96a : VICTUS_COLORS.primary)
                .setTitle('📊 Modrinth Resource Sync Progress')
                .setDescription(
                    `### Ingestion Status: ${statusEmoji} **${statusText}**\n` +
                    `› **Elapsed Time:** \`${elapsedMin}m ${elapsedSec % 60}s\`\n` +
                    `› **Total Resources Published:** **${totalPosted}** items\n\n` +
                    `### Category Breakdown:\n` +
                    categoryLines.join('\n\n')
                )
                .setFooter({
                    text: isRunning
                        ? 'Syncing in background • Use /resource-sync stop to cancel'
                        : 'Sync complete • Powered by Modrinth & Victus Cloud',
                })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            return;
        }

        // =========================================================================
        // SUBCOMMAND: STOP
        // =========================================================================
        if (subcommand === 'stop') {
            const stopped = modrinthResourceService.stopIngestion(interaction.guild.id);
            if (stopped) {
                await interaction.reply({
                    content: '🛑 **Resource sync stopped!** The current background ingestion process has been cancelled.',
                });
            } else {
                await interaction.reply({
                    content: 'ℹ️ **No active sync process found.** There is currently no ongoing resource sync to stop.',
                    flags: MessageFlags.Ephemeral,
                });
            }
            return;
        }
    },
};
