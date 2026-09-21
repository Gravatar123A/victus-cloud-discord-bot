import { ChannelType, } from 'discord.js';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
import { discoveryService, KNOWN_CATEGORIES } from './discoveryService.js';
import { DiscoveryEmbeds } from '../embeds/discoveryEmbeds.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
const DEFAULT_CONFIG = {
    enabled: false,
    forumChannelId: null,
    autoSync: true,
    tagMapping: {},
};
export class ForumDirectoryService {
    client = null;
    syncTimer = null;
    isSyncing = false;
    queue = []; // serverIds pending sync
    queuedSet = new Set();
    isProcessingQueue = false;
    /**
     * Start the background forum directory synchronizer
     */
    start(client) {
        this.client = client;
        logger.info('🚀 ForumDirectoryService initialized.');
        // Initial sync check after 30 seconds
        setTimeout(() => {
            this.runPeriodicSync().catch((err) => logger.error('Initial forum directory sync failed:', err));
        }, 30 * 1000);
        // Initial thread capacity check: if active threads > 600, automatically archive excess forum threads
        setTimeout(async () => {
            if (!this.client)
                return;
            for (const guild of this.client.guilds.cache.values()) {
                try {
                    const active = await guild.channels.fetchActiveThreads().catch(() => null);
                    if (active && active.threads.size > 600) {
                        logger.info(`🧹 Guild "${guild.name}" has ${active.threads.size}/1000 active threads. Archiving excess forum threads to stay under limit...`);
                        await this.archiveExcessForumThreads(guild, active.threads.size - 300);
                    }
                }
                catch { }
            }
        }, 10 * 1000);
        // Run sync loop every 90 seconds
        this.syncTimer = setInterval(() => {
            this.runPeriodicSync().catch((err) => logger.error('Periodic forum directory sync failed:', err));
        }, 90 * 1000);
    }
    /**
     * Stop the background synchronizer
     */
    stop() {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
        }
    }
    /**
     * Retrieve forum directory configuration for a guild
     */
    async getConfig(guildId) {
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_forum_directory_settings');
            if (embed?.description) {
                const parsed = JSON.parse(embed.description);
                return { ...DEFAULT_CONFIG, ...parsed };
            }
        }
        catch (err) {
            logger.error(`Failed to get forum directory config for guild ${guildId}:`, err);
        }
        return DEFAULT_CONFIG;
    }
    /**
     * Save forum directory configuration for a guild
     */
    async saveConfig(guildId, updates) {
        const current = await this.getConfig(guildId);
        const updated = { ...current, ...updates };
        try {
            await supabase.saveCustomEmbed(guildId, '_forum_directory_settings', {
                description: JSON.stringify(updated),
            });
        }
        catch (err) {
            logger.error(`Failed to save forum directory config for guild ${guildId}:`, err);
        }
        return updated;
    }
    /**
     * Auto-reconcile forum category tags and ONLINE status tag without deleting existing tags
     */
    async reconcileForumTags(forumChannel) {
        const existingTags = [...forumChannel.availableTags];
        const tagMap = {};
        const tagsToAdd = [];
        // 1. Reconcile ONLINE status tag (highest priority so it is always present)
        const existingOnlineTag = existingTags.find((t) => t.name.trim().toUpperCase() === 'ONLINE' || t.name.toLowerCase().includes('online'));
        if (existingOnlineTag) {
            tagMap['online'] = existingOnlineTag.id;
        }
        else {
            tagsToAdd.push({
                name: 'ONLINE',
                emoji: { name: '🟢' },
                moderated: false,
            });
        }
        // 2. Match existing category tags
        for (const [catKey, meta] of Object.entries(KNOWN_CATEGORIES)) {
            const found = existingTags.find((t) => t.name.toLowerCase() === meta.label.toLowerCase() ||
                t.name.toLowerCase() === catKey.toLowerCase() ||
                t.name.toLowerCase().includes(catKey.toLowerCase()));
            if (found) {
                tagMap[catKey] = found.id;
            }
            else {
                tagsToAdd.push({
                    name: meta.label.slice(0, 20),
                    emoji: { name: meta.emoji },
                    moderated: false,
                });
            }
        }
        // Add any missing tags (max 20 tags allowed per forum channel in Discord)
        if (tagsToAdd.length > 0 && existingTags.length < 20) {
            const allowedToAdd = tagsToAdd.slice(0, 20 - existingTags.length);
            try {
                const updatedChannel = await forumChannel.setAvailableTags([
                    ...existingTags,
                    ...allowedToAdd,
                ]);
                // Match online tag from updated available tags
                if (!tagMap['online']) {
                    const matchedOnline = updatedChannel.availableTags.find((t) => t.name.trim().toUpperCase() === 'ONLINE' || t.name.toLowerCase().includes('online'));
                    if (matchedOnline)
                        tagMap['online'] = matchedOnline.id;
                }
                // Match newly created category tags
                for (const [catKey, meta] of Object.entries(KNOWN_CATEGORIES)) {
                    if (!tagMap[catKey]) {
                        const matched = updatedChannel.availableTags.find((t) => t.name.toLowerCase() === meta.label.toLowerCase() ||
                            t.name.toLowerCase() === catKey.toLowerCase() ||
                            t.name.toLowerCase().includes(catKey.toLowerCase()));
                        if (matched)
                            tagMap[catKey] = matched.id;
                    }
                }
                logger.info(`🏷️ Reconciled forum tags for #${forumChannel.name}: added ${allowedToAdd.length} tags (including ONLINE status tag).`);
            }
            catch (err) {
                logger.warn(`Could not update forum tags for #${forumChannel.name}:`, err);
            }
        }
        return tagMap;
    }
    /**
     * Compute a state hash to detect if server details changed
     */
    computeServerHash(server) {
        return `v2:${server.status}:${server.currentPlayerCount}:${server.maxPlayers}:${server.category}:${server.serverName}:${server.ip}:${server.ratingAvg}:${server.ratingCount}:${server.description.slice(0, 50)}`;
    }
    /**
     * Queue a server for sync to prevent hammering Discord API
     */
    queueServer(serverId) {
        if (!this.queuedSet.has(serverId)) {
            this.queuedSet.add(serverId);
            this.queue.push(serverId);
            this.processQueue();
        }
    }
    /**
     * Archive active forum threads to stay well below the 1,000 active thread limit per guild.
     * In Discord, archived forum threads remain completely visible, searchable, and interactive.
     */
    async archiveExcessForumThreads(guild, maxToArchive = 250) {
        try {
            const active = await guild.channels.fetchActiveThreads().catch(() => null);
            if (!active?.threads || active.threads.size === 0)
                return 0;
            let archivedCount = 0;
            for (const [_, thread] of active.threads) {
                if (archivedCount >= maxToArchive)
                    break;
                // Only archive forum threads (keep support tickets & text channel threads active)
                if (thread.parent?.type === ChannelType.GuildForum) {
                    await thread.setArchived(true).catch(() => { });
                    archivedCount++;
                    if (archivedCount % 10 === 0) {
                        await new Promise((r) => setTimeout(r, 600));
                    }
                }
            }
            if (archivedCount > 0) {
                logger.info(`🧹 Archived ${archivedCount} active forum threads in "${guild.name}" (Active before: ${active.threads.size}/1000).`);
            }
            return archivedCount;
        }
        catch (err) {
            logger.warn(`Failed to archive excess forum threads in ${guild.name}:`, err);
            return 0;
        }
    }
    /**
     * Rate-limited queue processor
     */
    async processQueue() {
        if (this.isProcessingQueue || !this.client)
            return;
        this.isProcessingQueue = true;
        while (this.queue.length > 0) {
            const serverId = this.queue.shift();
            this.queuedSet.delete(serverId);
            try {
                await this.syncSingleServer(serverId);
            }
            catch (err) {
                if (err?.code === 160006) {
                    logger.warn(`[ForumDirectoryService] Active thread cap reached (1000). Pausing queue 15s to free slots...`);
                    await new Promise((resolve) => setTimeout(resolve, 15000));
                }
                else {
                    logger.error(`Error processing forum sync for server ${serverId}:`, err);
                }
            }
            // Global rate limiting delay: 2.5 seconds between thread updates
            await new Promise((resolve) => setTimeout(resolve, 2500));
        }
        this.isProcessingQueue = false;
    }
    /**
     * Sync single server to its forum thread (create, edit-in-place, or archive)
     */
    async syncSingleServer(serverId) {
        if (!this.client)
            return false;
        let { exact: server } = await discoveryService.getServer(serverId);
        if (!server)
            return false;
        // Live SLP ping check if server is marked online
        if (server.discoveryEnabled && !server.suspended && server.status === 'online') {
            await discoveryService.refreshServerLiveStatus(serverId).catch(() => { });
            const refreshed = await discoveryService.getServer(serverId);
            if (refreshed.exact)
                server = refreshed.exact;
        }
        // Find which guilds have forum directory enabled
        for (const guild of this.client.guilds.cache.values()) {
            const cfg = await this.getConfig(guild.id);
            if (!cfg.enabled || !cfg.forumChannelId)
                continue;
            try {
                const channel = await guild.channels.fetch(cfg.forumChannelId).catch(() => null);
                if (!channel || channel.type !== ChannelType.GuildForum)
                    continue;
                const forumChannel = channel;
                const statusDot = server.status === 'online' ? '🟢' : '🔴';
                const threadTitle = `[${statusDot}] ${server.serverName}`.slice(0, 100);
                // Auto-heal / fetch ONLINE tag ID in guild config
                let onlineTagId = cfg.tagMapping['online'] || null;
                if (!onlineTagId) {
                    const existingOnlineTag = forumChannel.availableTags.find((t) => t.name.trim().toUpperCase() === 'ONLINE' || t.name.toLowerCase().includes('online'));
                    if (existingOnlineTag) {
                        onlineTagId = existingOnlineTag.id;
                        cfg.tagMapping['online'] = onlineTagId;
                        await this.saveConfig(guild.id, { tagMapping: cfg.tagMapping }).catch(() => { });
                    }
                    else if (forumChannel.availableTags.length < 20) {
                        const updatedMap = await this.reconcileForumTags(forumChannel);
                        onlineTagId = updatedMap['online'] || null;
                        cfg.tagMapping = { ...cfg.tagMapping, ...updatedMap };
                        await this.saveConfig(guild.id, { tagMapping: cfg.tagMapping }).catch(() => { });
                    }
                }
                // Check category tag ID
                const categoryTagId = cfg.tagMapping[server.category] || null;
                // Tags for new threads: category tag + ONLINE tag (if currently online)
                const appliedTags = [];
                if (categoryTagId)
                    appliedTags.push(categoryTagId);
                if (server.status === 'online' && onlineTagId) {
                    appliedTags.push(onlineTagId);
                }
                const { container, actionRows } = DiscoveryEmbeds.buildServerStatusCard(server);
                const currentHash = this.computeServerHash(server);
                // Case 1: Server has discovery enabled
                if (server.discoveryEnabled && !server.suspended) {
                    let existingThread = null;
                    if (server.forumThreadId) {
                        existingThread = await guild.channels
                            .fetch(server.forumThreadId)
                            .then((c) => (c?.isThread() ? c : null))
                            .catch(() => null);
                    }
                    if (existingThread) {
                        // Calculate target tags preserving any non-bot custom tags
                        let targetTags = [];
                        if (existingThread.appliedTags && existingThread.appliedTags.length > 0) {
                            // Strip any existing online tag
                            targetTags = existingThread.appliedTags.filter((id) => id !== onlineTagId);
                            // Ensure category tag is included if mapped
                            if (categoryTagId && !targetTags.includes(categoryTagId)) {
                                targetTags.push(categoryTagId);
                            }
                            // Add ONLINE tag if currently online
                            if (server.status === 'online' && onlineTagId && !targetTags.includes(onlineTagId)) {
                                targetTags.push(onlineTagId);
                            }
                        }
                        else {
                            targetTags = [...appliedTags];
                        }
                        targetTags = targetTags.slice(0, 5);
                        const currentTagsSorted = [...(existingThread.appliedTags || [])].sort().join(',');
                        const targetTagsSorted = [...targetTags].sort().join(',');
                        const tagsDiffer = currentTagsSorted !== targetTagsSorted;
                        const nameDiffers = existingThread.name !== threadTitle;
                        // Thread exists — check if state changed, tags need updating, or title changed
                        if (server.lastLiveUpdateHash !== currentHash || tagsDiffer || nameDiffers) {
                            // 1. Unarchive if was archived
                            if (existingThread.archived) {
                                await existingThread.setArchived(false).catch(() => { });
                            }
                            // 2. Update thread title if needed
                            if (nameDiffers) {
                                await existingThread.setName(threadTitle).catch(() => { });
                            }
                            // 3. Update applied tags (adds ONLINE tag when online, removes when turned off)
                            if (tagsDiffer) {
                                await existingThread.setAppliedTags(targetTags).catch((err) => {
                                    logger.warn(`Failed to set applied tags on thread #${existingThread.name}:`, err);
                                });
                            }
                            // 4. Edit starter post in-place
                            try {
                                const starterMessage = await existingThread.fetchStarterMessage();
                                if (starterMessage) {
                                    await starterMessage.edit({
                                        components: [container, ...actionRows],
                                        flags: ComponentsV2.IS_COMPONENTS_V2,
                                    });
                                }
                            }
                            catch (msgErr) {
                                logger.warn(`Failed to edit starter post for thread ${existingThread.id}:`, msgErr);
                            }
                            await discoveryService.updateForumMetadata(server.serverId, {
                                forumGuildId: guild.id,
                                forumThreadId: existingThread.id,
                                assignedTagIds: targetTags,
                                lastLiveUpdateHash: currentHash,
                            });
                        }
                    }
                    else {
                        // Thread does not exist — create new thread with category & ONLINE tag!
                        const newThread = await forumChannel.threads.create({
                            name: threadTitle,
                            message: {
                                components: [container, ...actionRows],
                                flags: ComponentsV2.IS_COMPONENTS_V2,
                            },
                            appliedTags: appliedTags.slice(0, 5),
                        });
                        // Auto-archive offline servers immediately to conserve guild active thread limit (1,000 cap)
                        if (server.status !== 'online') {
                            await newThread.setArchived(true).catch(() => { });
                        }
                        const starterMessage = await newThread.fetchStarterMessage().catch(() => null);
                        await discoveryService.updateForumMetadata(server.serverId, {
                            forumGuildId: guild.id,
                            forumThreadId: newThread.id,
                            forumMessageId: starterMessage?.id ?? null,
                            assignedTagIds: appliedTags.slice(0, 5),
                            lastLiveUpdateHash: currentHash,
                        });
                        logger.info(`✨ Created directory forum thread for server ${server.serverName} (#${newThread.name}).`);
                    }
                }
                else {
                    // Case 2: Server disabled discovery or removed -> Archive thread & remove ONLINE tag!
                    if (server.forumThreadId) {
                        const existingThread = await guild.channels
                            .fetch(server.forumThreadId)
                            .then((c) => (c?.isThread() ? c : null))
                            .catch(() => null);
                        if (existingThread && !existingThread.archived) {
                            if (onlineTagId && existingThread.appliedTags.includes(onlineTagId)) {
                                const remainingTags = existingThread.appliedTags.filter((id) => id !== onlineTagId);
                                await existingThread.setAppliedTags(remainingTags).catch(() => { });
                            }
                            await existingThread.send({
                                content: `⚠️ **This server is no longer publicly listed in the Victus Cloud directory.**\nThis thread has been archived.`,
                            }).catch(() => { });
                            await existingThread.setArchived(true).catch(() => { });
                            logger.info(`📦 Archived directory forum thread for unlisted server ${server.serverName}.`);
                        }
                    }
                }
            }
            catch (err) {
                if (err?.code === 160006) {
                    logger.warn(`[ForumDirectoryService] Active thread limit (1000) reached in guild "${guild.name}". Archiving inactive forum threads...`);
                    await this.archiveExcessForumThreads(guild, 150);
                }
                else {
                    logger.error(`Failed to sync server ${server.serverName} to guild ${guild.id}:`, err);
                }
            }
        }
        return true;
    }
    /**
     * Run periodic synchronization across all discoverable servers
     */
    async runPeriodicSync() {
        if (this.isSyncing || !this.client)
            return;
        this.isSyncing = true;
        try {
            const servers = await discoveryService.fetchServers();
            const sorted = [...servers].sort((a, b) => {
                if (a.featured !== b.featured)
                    return a.featured ? -1 : 1;
                if (a.status === 'online' && b.status !== 'online')
                    return -1;
                if (a.status !== 'online' && b.status === 'online')
                    return 1;
                if (b.ratingAvg !== a.ratingAvg)
                    return b.ratingAvg - a.ratingAvg;
                if (b.ratingCount !== a.ratingCount)
                    return b.ratingCount - a.ratingCount;
                return b.currentPlayerCount - a.currentPlayerCount;
            });
            for (const server of sorted) {
                const hash = this.computeServerHash(server);
                // If never synced or hash changed, queue update
                if (!server.forumThreadId || server.lastLiveUpdateHash !== hash) {
                    this.queueServer(server.serverId);
                }
            }
        }
        catch (err) {
            logger.error('Error in periodic forum sync runner:', err);
        }
        finally {
            this.isSyncing = false;
        }
    }
    /**
     * Trigger a full reconciliation for a specific guild
     */
    async resyncGuild(guildId) {
        if (!this.client)
            throw new Error('Discord client is not ready');
        const cfg = await this.getConfig(guildId);
        if (!cfg.enabled || !cfg.forumChannelId) {
            return {
                total: 0,
                queued: 0,
                message: 'Forum directory is not enabled or configured for this guild. Use `/setup forum-channel` first.',
            };
        }
        const guild = await this.client.guilds.fetch(guildId).catch(() => null);
        if (!guild)
            throw new Error('Guild not found');
        const channel = await guild.channels.fetch(cfg.forumChannelId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildForum) {
            throw new Error('Configured channel is not a valid Forum Channel.');
        }
        // Reconcile tags first
        const tagMap = await this.reconcileForumTags(channel);
        await this.saveConfig(guildId, { tagMapping: tagMap, lastResyncAt: Date.now() });
        // Force fetch discovery servers
        const servers = await discoveryService.fetchServers(true);
        const active = servers.filter((s) => s.discoveryEnabled && !s.suspended);
        // Prioritize online servers and top rated servers first in queue
        active.sort((a, b) => {
            if (a.featured !== b.featured)
                return a.featured ? -1 : 1;
            if (a.status === 'online' && b.status !== 'online')
                return -1;
            if (a.status !== 'online' && b.status === 'online')
                return 1;
            if (b.ratingAvg !== a.ratingAvg)
                return b.ratingAvg - a.ratingAvg;
            if (b.ratingCount !== a.ratingCount)
                return b.ratingCount - a.ratingCount;
            return b.currentPlayerCount - a.currentPlayerCount;
        });
        for (const s of active) {
            // Invalidate hash to force re-render
            s.lastLiveUpdateHash = undefined;
            this.queueServer(s.serverId);
        }
        return {
            total: active.length,
            queued: this.queue.length,
            message: `Successfully scheduled full resync of ${active.length} servers into #${channel.name}.`,
        };
    }
    /**
     * Get live health status of the forum directory
     */
    async getStatus(guildId) {
        const cfg = await this.getConfig(guildId);
        const allServers = await discoveryService.fetchServers();
        const active = allServers.filter((s) => s.discoveryEnabled && !s.suspended);
        const synced = active.filter((s) => s.forumThreadId).length;
        let channelName = null;
        if (this.client && cfg.forumChannelId) {
            const ch = await this.client.channels.fetch(cfg.forumChannelId).catch(() => null);
            if (ch && 'name' in ch)
                channelName = ch.name;
        }
        return {
            enabled: cfg.enabled,
            forumChannelName: channelName,
            totalServers: active.length,
            syncedThreads: synced,
            queueLength: this.queue.length,
            lastResync: cfg.lastResyncAt ? `<t:${Math.floor(cfg.lastResyncAt / 1000)}:R>` : 'Never',
        };
    }
}
export const forumDirectoryService = new ForumDirectoryService();
