import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    ForumChannel,
    Guild,
    PermissionFlagsBits,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { supabase } from './supabase.js';

export type ModrinthCategory =
    | 'mc-mods'
    | 'mc-plugins'
    | 'mc-shaders'
    | 'scripts'
    | 'configs'
    | 'builds';

export interface ModrinthItem {
    id: string;
    title: string;
    description: string;
    slug: string;
    projectType: string;
    author: string;
    downloads: number;
    follows: number;
    iconUrl: string | null;
    categories: string[];
    versions: string[];
    license: string;
    url: string;
}

export interface CategorySyncStatus {
    category: ModrinthCategory;
    channelName: string;
    channelId: string | null;
    totalFetched: number;
    totalPosted: number;
    completed: boolean;
    error: string | null;
}

export interface GuildSyncProgress {
    guildId: string;
    isRunning: boolean;
    isPaused: boolean;
    startedAt: number;
    totalCategories: number;
    categories: Record<ModrinthCategory, CategorySyncStatus>;
}

const CATEGORY_DEFINITIONS: Record<
    ModrinthCategory,
    {
        name: string;
        channelName: string;
        topic: string;
        tags: string[];
        fetchParams: {
            facets?: string;
            query?: string;
        };
    }
> = {
    'mc-mods': {
        name: 'Minecraft Mods',
        channelName: 'mc-mods',
        topic: 'Top 100 Most Popular Free Minecraft Mods from Modrinth. Powered by Victus Cloud.',
        tags: ['Fabric', 'Forge', 'NeoForge', 'Optimization', 'Popular'],
        fetchParams: {
            facets: '%5B%5B%22project_type%3Amod%22%5D%5D',
        },
    },
    'mc-plugins': {
        name: 'Minecraft Plugins',
        channelName: 'mc-plugins',
        topic: 'Top 100 Best Free Minecraft Server Plugins for Paper, Purpur, Spigot & Velocity.',
        tags: ['Paper', 'Spigot', 'Velocity', 'Admin', 'Economy'],
        fetchParams: {
            facets: '%5B%5B%22project_type%3Aplugin%22%5D%5D',
        },
    },
    'mc-shaders': {
        name: 'Minecraft Shaders',
        channelName: 'mc-shaders',
        topic: 'Top 100 Best Free Minecraft Shaders for Iris, OptiFine & Canvas.',
        tags: ['Ultra-Fast', 'Realistic', 'Cinematic', 'Low-End', 'Popular'],
        fetchParams: {
            facets: '%5B%5B%22project_type%3Ashader%22%5D%5D',
        },
    },
    scripts: {
        name: 'Scripts & Datapacks',
        channelName: 'scripts',
        topic: 'Top 100 Free Minecraft Server Datapacks, Mechanics & Custom Scripts.',
        tags: ['Datapack', 'Gameplay', 'Mechanics', 'Vanilla+', 'Scripts'],
        fetchParams: {
            facets: '%5B%5B%22project_type%3Adatapack%22%5D%5D',
        },
    },
    configs: {
        name: 'Server & Mod Configs',
        channelName: 'configs',
        topic: 'Top 100 Free Minecraft Server Optimization Configs, Presets & Config Libraries.',
        tags: ['Config', 'Optimization', 'Server-Setup', 'Performance', 'Presets'],
        fetchParams: {
            query: 'config',
        },
    },
    builds: {
        name: 'Builds & Worldgen',
        channelName: 'builds',
        topic: 'Top 100 Free Minecraft Builds, Dungeons, Structures, Spawns & World Templates.',
        tags: ['Structures', 'Spawns', 'Dungeons', 'Worldgen', 'Schematics'],
        fetchParams: {
            query: 'structure',
        },
    },
};

const MODRINTH_USER_AGENT = 'VictusCloudBot/2.0 (contact@victuscloud.com; discord-bot)';

class ModrinthResourceService {
    private progress = new Map<string, GuildSyncProgress>();
    private stopSignals = new Set<string>();

    /**
     * Fetch top resources from Modrinth API for a given category.
     */
    async fetchTopResources(category: ModrinthCategory, limit = 100): Promise<ModrinthItem[]> {
        const def = CATEGORY_DEFINITIONS[category];
        if (!def) return [];

        const targetLimit = Math.min(100, Math.max(1, limit));
        let url = `https://api.modrinth.com/v2/search?limit=${targetLimit}&index=downloads`;

        if (def.fetchParams.facets) {
            url += `&facets=${def.fetchParams.facets}`;
        }
        if (def.fetchParams.query) {
            url += `&query=${encodeURIComponent(def.fetchParams.query)}`;
        }

        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': MODRINTH_USER_AGENT,
                },
            });

            if (!res.ok) {
                throw new Error(`Modrinth API error: ${res.status} ${res.statusText}`);
            }

            const data = (await res.json()) as { hits: any[] };
            if (!data?.hits || !Array.isArray(data.hits)) return [];

            return data.hits.map((hit) => {
                const projectType = hit.project_type || 'mod';
                const slug = hit.slug || hit.project_id;
                return {
                    id: String(hit.project_id),
                    title: String(hit.title || slug).trim(),
                    description: String(hit.description || 'No description provided.').trim(),
                    slug: String(slug),
                    projectType: String(projectType),
                    author: String(hit.author || 'Community Creator'),
                    downloads: Number(hit.downloads || 0),
                    follows: Number(hit.follows || 0),
                    iconUrl: hit.icon_url ? String(hit.icon_url) : null,
                    categories: Array.isArray(hit.categories) ? hit.categories.map(String) : [],
                    versions: Array.isArray(hit.versions) ? hit.versions.map(String) : [],
                    license: String(hit.license || 'Free / Open-Source'),
                    url: `https://modrinth.com/${projectType}/${slug}`,
                };
            });
        } catch (err) {
            logger.error(`[ModrinthService] Error fetching ${category}:`, err);
            return [];
        }
    }

    /**
     * Finds or creates all 6 dedicated Forum Channels under a category in the guild.
     */
    async ensureForumChannels(
        guild: Guild,
        categoriesToEnsure: ModrinthCategory[] = Object.keys(CATEGORY_DEFINITIONS) as ModrinthCategory[]
    ): Promise<{
        success: boolean;
        channels: Record<ModrinthCategory, ForumChannel | null>;
        createdCount: number;
        reusedCount: number;
        error?: string;
    }> {
        const botMember = guild.members.me;
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return {
                success: false,
                channels: {} as any,
                createdCount: 0,
                reusedCount: 0,
                error: 'Bot lacks the **Manage Channels** permission required to create forum channels.',
            };
        }

        // 1. Locate or create parent category: 📦 FREE RESOURCES
        const categoryName = '📦 FREE RESOURCES';
        let parentCategory = guild.channels.cache.find(
            (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase()
        );

        if (!parentCategory) {
            try {
                parentCategory = await guild.channels.create({
                    name: categoryName,
                    type: ChannelType.GuildCategory,
                    reason: 'Victus Cloud automated resource forum category',
                });
            } catch (err: any) {
                logger.warn(`Could not create category ${categoryName}, placing forums at root:`, err);
            }
        }

        const results: Record<ModrinthCategory, ForumChannel | null> = {
            'mc-mods': null,
            'mc-plugins': null,
            'mc-shaders': null,
            scripts: null,
            configs: null,
            builds: null,
        };

        let createdCount = 0;
        let reusedCount = 0;

        for (const catKey of categoriesToEnsure) {
            const def = CATEGORY_DEFINITIONS[catKey];
            if (!def) continue;

            // Check if existing forum channel matches name
            let channel = guild.channels.cache.find(
                (c) => c.type === ChannelType.GuildForum && c.name.toLowerCase() === def.channelName.toLowerCase()
            ) as ForumChannel | undefined;

            if (channel) {
                results[catKey] = channel;
                reusedCount++;
                continue;
            }

            // Create new forum channel
            try {
                const availableTags = def.tags.map((tag, idx) => ({
                    name: tag,
                    moderated: false,
                    emoji: { id: null, name: idx === 0 ? '⭐' : '📦' },
                }));

                channel = (await guild.channels.create({
                    name: def.channelName,
                    type: ChannelType.GuildForum,
                    parent: parentCategory?.id,
                    topic: def.topic,
                    availableTags,
                    defaultReactionEmoji: { id: null, name: '📥' },
                    reason: `Victus Cloud automated forum setup for ${def.name}`,
                })) as ForumChannel;

                results[catKey] = channel;
                createdCount++;
                logger.info(`[ModrinthService] Created forum channel #${def.channelName} in ${guild.name}`);
            } catch (err: any) {
                logger.error(`[ModrinthService] Failed to create forum channel ${def.channelName}:`, err);
            }
        }

        return {
            success: true,
            channels: results,
            createdCount,
            reusedCount,
        };
    }

    /**
     * Post a single resource item as a thread into a ForumChannel.
     */
    async publishItemToForum(channel: ForumChannel, item: ModrinthItem): Promise<boolean> {
        try {
            // Trim title to Discord 100 character thread name limit
            let threadName = `${item.title}`.trim();
            if (threadName.length > 95) {
                threadName = `${threadName.slice(0, 92)}...`;
            }

            const cleanDescription = item.description.length > 600
                ? `${item.description.slice(0, 590)}...`
                : item.description;

            const versionsSnippet = item.versions.length > 0
                ? item.versions.slice(-6).reverse().join(', ')
                : 'All versions';

            const tagsSnippet = item.categories.length > 0
                ? item.categories.slice(0, 6).map((c) => `\`${c}\``).join(' ')
                : '`General`';

            const embed = new EmbedBuilder()
                .setColor(0x1bd96a) // Modrinth Emerald Green
                .setTitle(`📦 ${item.title}`)
                .setURL(item.url)
                .setDescription(
                    `### 📖 About this Resource\n` +
                    `${cleanDescription}\n\n` +
                    `### 📊 Details & Metrics\n` +
                    `› 📥 **Downloads:** **${item.downloads.toLocaleString()}**\n` +
                    `› ⭐ **Followers:** **${item.follows.toLocaleString()}**\n` +
                    `› 👤 **Author:** \`${item.author}\`\n` +
                    `› ⚖️ **License:** \`${item.license}\`\n` +
                    `› 🎮 **Latest Versions:** \`${versionsSnippet}\`\n` +
                    `› 🏷️ **Categories:** ${tagsSnippet}\n\n` +
                    `_Hosted & published via Modrinth open-source repository._`
                )
                .setFooter({
                    text: 'Victus Cloud Community Resource Hub • Free Minecraft Hosting at victuscloud.com/free',
                })
                .setTimestamp();

            if (item.iconUrl && item.iconUrl.startsWith('http')) {
                embed.setThumbnail(item.iconUrl);
            }

            const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setLabel('Download on Modrinth')
                    .setURL(item.url)
                    .setEmoji('📥'),
                new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setLabel('Victus Cloud Free Hosting')
                    .setURL('https://victuscloud.com/free')
                    .setEmoji('⚡')
            );

            // Match applied tags from available forum tags
            const appliedTags: string[] = [];
            if (channel.availableTags && channel.availableTags.length > 0) {
                for (const t of channel.availableTags) {
                    if (
                        item.categories.some((c) => c.toLowerCase() === t.name.toLowerCase()) ||
                        item.title.toLowerCase().includes(t.name.toLowerCase())
                    ) {
                        appliedTags.push(t.id);
                        if (appliedTags.length >= 5) break;
                    }
                }
            }

            await channel.threads.create({
                name: threadName,
                appliedTags: appliedTags.length > 0 ? appliedTags : undefined,
                message: {
                    embeds: [embed],
                    components: [actionRow],
                },
                reason: `Victus Cloud automated resource ingestion for ${item.title}`,
            });

            return true;
        } catch (err: any) {
            logger.warn(`[ModrinthService] Failed to post thread "${item.title}":`, err?.message || err);
            return false;
        }
    }

    /**
     * Start background pulling of 100 resources for specified categories.
     */
    async startIngestion(
        guild: Guild,
        selectedCategories: ModrinthCategory[] = Object.keys(CATEGORY_DEFINITIONS) as ModrinthCategory[],
        targetCount = 100
    ): Promise<GuildSyncProgress> {
        this.stopSignals.delete(guild.id);

        // 1. Ensure forum channels are present
        const setup = await this.ensureForumChannels(guild, selectedCategories);
        const channels = setup.channels;

        const catProgress: Record<ModrinthCategory, CategorySyncStatus> = {
            'mc-mods': { category: 'mc-mods', channelName: 'mc-mods', channelId: channels['mc-mods']?.id || null, totalFetched: 0, totalPosted: 0, completed: false, error: null },
            'mc-plugins': { category: 'mc-plugins', channelName: 'mc-plugins', channelId: channels['mc-plugins']?.id || null, totalFetched: 0, totalPosted: 0, completed: false, error: null },
            'mc-shaders': { category: 'mc-shaders', channelName: 'mc-shaders', channelId: channels['mc-shaders']?.id || null, totalFetched: 0, totalPosted: 0, completed: false, error: null },
            scripts: { category: 'scripts', channelName: 'scripts', channelId: channels.scripts?.id || null, totalFetched: 0, totalPosted: 0, completed: false, error: null },
            configs: { category: 'configs', channelName: 'configs', channelId: channels.configs?.id || null, totalFetched: 0, totalPosted: 0, completed: false, error: null },
            builds: { category: 'builds', channelName: 'builds', channelId: channels.builds?.id || null, totalFetched: 0, totalPosted: 0, completed: false, error: null },
        };

        const progress: GuildSyncProgress = {
            guildId: guild.id,
            isRunning: true,
            isPaused: false,
            startedAt: Date.now(),
            totalCategories: selectedCategories.length,
            categories: catProgress,
        };

        this.progress.set(guild.id, progress);

        // Run background pipeline
        (async () => {
            logger.info(`[ModrinthService] Starting bulk ingestion of ${selectedCategories.length} categories (${targetCount} each) for guild ${guild.name}...`);

            // Load existing published slugs to avoid re-posting
            const publishedSet = new Set<string>();
            try {
                const embed = await supabase.getCustomEmbed(guild.id, '_modrinth_published');
                if (embed?.description) {
                    const parsed: string[] = JSON.parse(embed.description);
                    parsed.forEach((s) => publishedSet.add(s));
                }
            } catch {
                // Ignore
            }

            for (const catKey of selectedCategories) {
                if (this.stopSignals.has(guild.id)) break;

                const catStatus = progress.categories[catKey];
                const channel = channels[catKey];
                if (!channel) {
                    catStatus.error = 'Forum channel missing';
                    catStatus.completed = true;
                    continue;
                }

                // Fetch top resources
                const items = await this.fetchTopResources(catKey, targetCount);
                catStatus.totalFetched = items.length;

                for (const item of items) {
                    if (this.stopSignals.has(guild.id)) break;

                    const dedupKey = `${catKey}:${item.slug}`;
                    if (publishedSet.has(dedupKey)) {
                        catStatus.totalPosted++;
                        continue;
                    }

                    const ok = await this.publishItemToForum(channel, item);
                    if (ok) {
                        catStatus.totalPosted++;
                        publishedSet.add(dedupKey);
                    }

                    // Pacing delay: 1800ms between forum thread creates to comfortably stay under Discord rate limits
                    await new Promise((r) => setTimeout(r, 1800));
                }

                catStatus.completed = true;
                logger.info(`[ModrinthService] Finished category ${catKey}: ${catStatus.totalPosted}/${catStatus.totalFetched} published.`);
            }

            progress.isRunning = false;
            logger.info(`[ModrinthService] Bulk ingestion completed for guild ${guild.name}. Total published: ${publishedSet.size}`);

            // Save published set
            try {
                await supabase.saveCustomEmbed(guild.id, '_modrinth_published', {
                    description: JSON.stringify(Array.from(publishedSet)),
                });
            } catch {
                // Ignore
            }
        })().catch((err) => {
            logger.error(`[ModrinthService] Fatal ingestion error for guild ${guild.id}:`, err);
            progress.isRunning = false;
        });

        return progress;
    }

    /**
     * Stop ongoing ingestion for a guild.
     */
    stopIngestion(guildId: string): boolean {
        this.stopSignals.add(guildId);
        const p = this.progress.get(guildId);
        if (p) {
            p.isRunning = false;
            return true;
        }
        return false;
    }

    /**
     * Get current ingestion progress for a guild.
     */
    getProgress(guildId: string): GuildSyncProgress | undefined {
        return this.progress.get(guildId);
    }
}

export const modrinthResourceService = new ModrinthResourceService();
