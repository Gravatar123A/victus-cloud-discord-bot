import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits, } from 'discord.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';
import { supabase } from './supabase.js';
import { forumDirectoryService } from './forumDirectoryService.js';
const LOCAL_CHANNELS_PATH = join(process.cwd(), 'data', 'modrinth-channels.json');
async function readLocalChannels() {
    try {
        const raw = await readFile(LOCAL_CHANNELS_PATH, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
async function writeLocalChannels(data) {
    try {
        await mkdir(dirname(LOCAL_CHANNELS_PATH), { recursive: true });
        await writeFile(LOCAL_CHANNELS_PATH, JSON.stringify(data, null, 2), 'utf8');
    }
    catch (err) {
        logger.warn('Failed to write local modrinth channels fallback:', err);
    }
}
import { builtbybitResourceService, } from './builtbybitResourceService.js';
const CATEGORY_DEFINITIONS = {
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
    progress = new Map();
    stopSignals = new Set();
    /**
     * Fetch top resources from Modrinth API for a given category.
     */
    async fetchTopResources(category, limit = 100) {
        const def = CATEGORY_DEFINITIONS[category];
        if (!def)
            return [];
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
            const data = (await res.json());
            if (!data?.hits || !Array.isArray(data.hits))
                return [];
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
                    source: 'modrinth',
                };
            });
        }
        catch (err) {
            logger.error(`[ModrinthService] Error fetching ${category}:`, err);
            return [];
        }
    }
    /**
     * Finds or creates all 6 dedicated Forum Channels under a category in the guild.
     */
    /**
     * Get saved category -> channelId mapping for a guild.
     */
    async getSavedChannelMap(guildId) {
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_modrinth_channels');
            if (embed?.description) {
                return JSON.parse(embed.description);
            }
        }
        catch {
            // fallback to local settings
        }
        const local = await readLocalChannels();
        return local[guildId] || {};
    }
    /**
     * Persist category -> channelId mapping for a guild.
     */
    async saveChannelMap(guildId, mapping) {
        try {
            await supabase.saveCustomEmbed(guildId, '_modrinth_channels', {
                description: JSON.stringify(mapping),
            });
        }
        catch {
            // fallback
        }
        const local = await readLocalChannels();
        local[guildId] = { ...(local[guildId] || {}), ...mapping };
        await writeLocalChannels(local);
    }
    /**
     * Explicitly bind a forum channel to a Modrinth category.
     */
    async setCategoryChannel(guildId, category, channelId) {
        const current = await this.getSavedChannelMap(guildId);
        current[category] = channelId;
        await this.saveChannelMap(guildId, current);
    }
    /**
     * Finds or creates all 6 dedicated Forum Channels under a category in the guild.
     * Fully rename-proof: resolves channels by saved Channel ID first.
     */
    async ensureForumChannels(guild, categoriesToEnsure = Object.keys(CATEGORY_DEFINITIONS)) {
        const botMember = guild.members.me;
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return {
                success: false,
                channels: {},
                createdCount: 0,
                reusedCount: 0,
                error: 'Bot lacks the **Manage Channels** permission required to create forum channels.',
            };
        }
        // 1. Locate or create parent category: 📦 FREE RESOURCES
        const categoryName = '📦 FREE RESOURCES';
        let parentCategory = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase());
        if (!parentCategory) {
            try {
                parentCategory = await guild.channels.create({
                    name: categoryName,
                    type: ChannelType.GuildCategory,
                    reason: 'Victus Cloud automated resource forum category',
                });
            }
            catch (err) {
                logger.warn(`Could not create category ${categoryName}, placing forums at root:`, err);
            }
        }
        const savedMap = await this.getSavedChannelMap(guild.id);
        const updatedMap = { ...savedMap };
        const results = {
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
            if (!def)
                continue;
            let channel;
            // Step 1: Check by persistent Channel ID (Rename-Proof!)
            if (savedMap[catKey]) {
                const candidate = guild.channels.cache.get(savedMap[catKey]) ||
                    (await guild.channels.fetch(savedMap[catKey]).catch(() => null));
                if (candidate && candidate.type === ChannelType.GuildForum) {
                    channel = candidate;
                }
            }
            // Step 2: If no saved ID or channel deleted, try finding by name, topic, or keyword
            if (!channel) {
                channel = guild.channels.cache.find((c) => c.type === ChannelType.GuildForum &&
                    (c.name.toLowerCase() === def.channelName.toLowerCase() ||
                        c.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(catKey.replace(/[^a-z0-9]/g, '')) ||
                        c.topic?.toLowerCase().includes(def.channelName.toLowerCase())));
            }
            // If found, register ID and reuse
            if (channel) {
                results[catKey] = channel;
                updatedMap[catKey] = channel.id;
                reusedCount++;
                continue;
            }
            // Step 3: Create new forum channel if none existed
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
                }));
                results[catKey] = channel;
                updatedMap[catKey] = channel.id;
                createdCount++;
                logger.info(`[ModrinthService] Created forum channel #${def.channelName} in ${guild.name}`);
            }
            catch (err) {
                logger.error(`[ModrinthService] Failed to create forum channel ${def.channelName}:`, err);
            }
        }
        await this.saveChannelMap(guild.id, updatedMap);
        return {
            success: true,
            channels: results,
            createdCount,
            reusedCount,
        };
    }
    /**
     * Post a single resource item as a thread into a ForumChannel.
     * Automatically handles Discord 429 rate limits with dynamic backoff and retries.
     */
    async publishItemToForum(channel, item, maxRetries = 3) {
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
        const isBuiltByBit = item.source === 'builtbybit';
        const brandColor = isBuiltByBit ? 0xF59E0B : 0x1bd96a; // BuiltByBit Amber vs Modrinth Emerald
        const brandSource = isBuiltByBit
            ? 'BuiltByBit community marketplace (Free Resource)'
            : 'Modrinth open-source repository';
        const brandButtonLabel = isBuiltByBit ? 'View on BuiltByBit' : 'Download on Modrinth';
        const embed = new EmbedBuilder()
            .setColor(brandColor)
            .setTitle(`📦 ${item.title}`)
            .setURL(item.url)
            .setDescription(`### 📖 About this Resource\n` +
            `${cleanDescription}\n\n` +
            `### 📊 Details & Metrics\n` +
            `› 📥 **Downloads:** **${item.downloads.toLocaleString()}**\n` +
            `› ⭐ **Followers / Stars:** **${item.follows.toLocaleString()}**\n` +
            `› 👤 **Author:** \`${item.author}\`\n` +
            `› ⚖️ **License:** \`${item.license}\`\n` +
            `› 🎮 **Latest Versions:** \`${versionsSnippet}\`\n` +
            `› 🏷️ **Categories:** ${tagsSnippet}\n\n` +
            `_Hosted & published via ${brandSource}._`)
            .setFooter({
            text: 'Victus Cloud Community Resource Hub • Free Minecraft Hosting at victuscloud.com/free',
        })
            .setTimestamp();
        if (item.iconUrl && item.iconUrl.startsWith('http')) {
            embed.setThumbnail(item.iconUrl);
        }
        const actionRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel(brandButtonLabel)
            .setURL(item.url)
            .setEmoji('📥'), new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel('Victus Cloud Free Hosting')
            .setURL('https://victuscloud.com/free')
            .setEmoji('⚡'));
        // Match applied tags from available forum tags
        const appliedTags = [];
        if (channel.availableTags && channel.availableTags.length > 0) {
            for (const t of channel.availableTags) {
                if (item.categories.some((c) => c.toLowerCase() === t.name.toLowerCase()) ||
                    item.title.toLowerCase().includes(t.name.toLowerCase())) {
                    appliedTags.push(t.id);
                    if (appliedTags.length >= 5)
                        break;
                }
            }
        }
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const thread = await channel.threads.create({
                    name: threadName,
                    appliedTags: appliedTags.length > 0 ? appliedTags : undefined,
                    message: {
                        embeds: [embed],
                        components: [actionRow],
                    },
                    reason: `Victus Cloud automated resource ingestion for ${item.title}`,
                });
                // Immediately archive static resource thread to conserve guild active thread limit (1,000 cap)
                await thread.setArchived(true).catch(() => { });
                return true;
            }
            catch (err) {
                const errMsg = err?.message || String(err);
                // Handle Discord 1,000 active thread limit
                if (err?.code === 160006 && attempt <= maxRetries) {
                    logger.warn(`[ModrinthService] Guild active thread ceiling (1,000) reached. Archiving older forum threads to free slots...`);
                    await forumDirectoryService.archiveExcessForumThreads(channel.guild, 150);
                    await new Promise((r) => setTimeout(r, 4000));
                    continue;
                }
                const isRateLimit = err?.status === 429 ||
                    err?.code === 429 ||
                    errMsg.toLowerCase().includes('rate limit') ||
                    errMsg.toLowerCase().includes('too many requests');
                if (isRateLimit && attempt <= maxRetries) {
                    let waitMs = 20000;
                    if (typeof err.retryAfter === 'number') {
                        waitMs = err.retryAfter > 1000 ? err.retryAfter : Math.ceil(err.retryAfter * 1000);
                    }
                    else if (typeof err.rawError?.retry_after === 'number') {
                        waitMs = Math.ceil(err.rawError.retry_after * 1000);
                    }
                    waitMs = Math.max(5000, waitMs) + 2000;
                    logger.warn(`[ModrinthService] Discord thread rate limit hit on "${item.title}". Waiting ${Math.ceil(waitMs / 1000)}s before retry (${attempt}/${maxRetries})...`);
                    await new Promise((r) => setTimeout(r, waitMs));
                    continue;
                }
                logger.warn(`[ModrinthService] Failed to post thread "${item.title}": ${errMsg}`);
                return false;
            }
        }
        return false;
    }
    /**
     * Start background pulling of 100 resources for specified categories.
     */
    async startIngestion(guild, selectedCategories = Object.keys(CATEGORY_DEFINITIONS), targetCount = 100, source = 'all') {
        this.stopSignals.delete(guild.id);
        // 1. Ensure forum channels are present
        const setup = await this.ensureForumChannels(guild, selectedCategories);
        const channels = setup.channels;
        const catProgress = {
            'mc-mods': { category: 'mc-mods', channelName: 'mc-mods', channelId: channels['mc-mods']?.id || null, totalFetched: 0, totalPosted: 0, completed: false, error: null },
            'mc-plugins': { category: 'mc-plugins', channelName: 'mc-plugins', channelId: channels['mc-plugins']?.id || null, totalFetched: 0, totalPosted: 0, completed: false, error: null },
            'mc-shaders': { category: 'mc-shaders', channelName: 'mc-shaders', channelId: channels['mc-shaders']?.id || null, totalFetched: 0, totalPosted: 0, completed: false, error: null },
            scripts: { category: 'scripts', channelName: 'scripts', channelId: channels.scripts?.id || null, totalFetched: 0, totalPosted: 0, completed: false, error: null },
            configs: { category: 'configs', channelName: 'configs', channelId: channels.configs?.id || null, totalFetched: 0, totalPosted: 0, completed: false, error: null },
            builds: { category: 'builds', channelName: 'builds', channelId: channels.builds?.id || null, totalFetched: 0, totalPosted: 0, completed: false, error: null },
        };
        const progress = {
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
            logger.info(`[ResourceService] Starting bulk ingestion of ${selectedCategories.length} categories (${targetCount} each, source: ${source}) for guild ${guild.name}...`);
            // Load existing published slugs to avoid re-posting
            const publishedSet = new Set();
            try {
                const embed = await supabase.getCustomEmbed(guild.id, '_modrinth_published');
                if (embed?.description) {
                    const parsed = JSON.parse(embed.description);
                    parsed.forEach((s) => publishedSet.add(s));
                }
            }
            catch {
                // Ignore
            }
            for (const catKey of selectedCategories) {
                if (this.stopSignals.has(guild.id))
                    break;
                const catStatus = progress.categories[catKey];
                const channel = channels[catKey];
                if (!channel) {
                    catStatus.error = 'Forum channel missing';
                    catStatus.completed = true;
                    continue;
                }
                // Scan active threads currently in the channel to prevent duplicates
                try {
                    const activeThreads = await channel.threads.fetchActive().catch(() => null);
                    if (activeThreads?.threads) {
                        for (const [_, th] of activeThreads.threads) {
                            publishedSet.add(`${catKey}:${th.name.toLowerCase()}`);
                        }
                    }
                }
                catch {
                    // Ignore
                }
                // Fetch top resources from selected source(s)
                let items = [];
                if (source === 'all') {
                    const bbbTarget = Math.max(5, Math.ceil(targetCount / 2));
                    const bbbItems = await builtbybitResourceService.fetchFreeResources(catKey, bbbTarget);
                    const modrinthTarget = Math.max(1, targetCount - bbbItems.length);
                    const modrinthItems = await this.fetchTopResources(catKey, modrinthTarget);
                    items = [...bbbItems, ...modrinthItems];
                }
                else if (source === 'builtbybit') {
                    items = await builtbybitResourceService.fetchFreeResources(catKey, targetCount);
                }
                else {
                    items = await this.fetchTopResources(catKey, targetCount);
                }
                catStatus.totalFetched = items.length;
                for (const item of items) {
                    if (this.stopSignals.has(guild.id))
                        break;
                    const dedupKeySlug = `${catKey}:${item.slug.toLowerCase()}`;
                    const dedupKeyTitle = `${catKey}:${item.title.toLowerCase()}`;
                    if (publishedSet.has(dedupKeySlug) || publishedSet.has(dedupKeyTitle)) {
                        catStatus.totalPosted++;
                        continue;
                    }
                    const ok = await this.publishItemToForum(channel, item);
                    if (ok) {
                        catStatus.totalPosted++;
                        publishedSet.add(dedupKeySlug);
                        publishedSet.add(dedupKeyTitle);
                        // Periodically persist progress every 5 posts
                        if (catStatus.totalPosted % 5 === 0) {
                            await supabase.saveCustomEmbed(guild.id, '_modrinth_published', {
                                description: JSON.stringify(Array.from(publishedSet)),
                            }).catch(() => null);
                        }
                    }
                    // Pacing delay: 3500ms between thread creates to stay under Discord rate limits
                    await new Promise((r) => setTimeout(r, 3500));
                }
                catStatus.completed = true;
                logger.info(`[ModrinthService] Finished category ${catKey}: ${catStatus.totalPosted}/${catStatus.totalFetched} published.`);
                // Save published set after each category
                await supabase.saveCustomEmbed(guild.id, '_modrinth_published', {
                    description: JSON.stringify(Array.from(publishedSet)),
                }).catch(() => null);
            }
            progress.isRunning = false;
            logger.info(`[ModrinthService] Bulk ingestion completed for guild ${guild.name}. Total tracked published: ${publishedSet.size}`);
        })().catch((err) => {
            logger.error(`[ModrinthService] Fatal ingestion error for guild ${guild.id}:`, err);
            progress.isRunning = false;
        });
        return progress;
    }
    /**
     * Stop ongoing ingestion for a guild.
     */
    stopIngestion(guildId) {
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
    getProgress(guildId) {
        return this.progress.get(guildId);
    }
}
export const modrinthResourceService = new ModrinthResourceService();
