import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';
import { supabase } from './supabase.js';
import { localSettings } from './localSettings.js';
export const SUGGESTION_CATEGORIES = {
    control_panel: {
        id: 'control_panel',
        label: 'Control Panel',
        emoji: '🎛️',
        description: 'Pterodactyl panel, server console, backups, schedules & file manager',
        tagLabel: 'Control Panel',
    },
    website: {
        id: 'website',
        label: 'Website & Billing',
        emoji: '🌐',
        description: 'Paymenter client portal, billing store, checkout & knowledgebase',
        tagLabel: 'Website',
    },
    discord_server: {
        id: 'discord_server',
        label: 'Discord Server',
        emoji: '💬',
        description: 'Server channels, community events, roles, rules & booster perks',
        tagLabel: 'Discord Server',
    },
    discord_bot: {
        id: 'discord_bot',
        label: 'Discord Bot',
        emoji: '🤖',
        description: 'Bot commands, music, automation, ticketing & COINS economy',
        tagLabel: 'Discord Bot',
    },
    mc_free: {
        id: 'mc_free',
        label: 'Free Minecraft Hosting',
        emoji: '⛏️',
        description: 'Free tier allocations, nodes, memory/CPU quotas & server eggs',
        tagLabel: 'Free Minecraft',
    },
    mc_premium: {
        id: 'mc_premium',
        label: 'Premium Minecraft Hosting',
        emoji: '💎',
        description: 'Ryzen 9 nodes, extreme specs, dedicated IPs & NVMe performance',
        tagLabel: 'Premium MC',
    },
    bot_hosting: {
        id: 'bot_hosting',
        label: 'Discord Bot Hosting',
        emoji: '⚡',
        description: 'NodeJS, Python, Java bot hosting containers & background runtimes',
        tagLabel: 'Bot Hosting',
    },
    general: {
        id: 'general',
        label: 'General / Other',
        emoji: '📦',
        description: 'Infrastructure, network routing, partnerships & general feedback',
        tagLabel: 'General',
    },
};
export const STATUS_TAGS = {
    pending: { name: 'Pending', emoji: '⏳' },
    accepted: { name: 'Accepted', emoji: '✅' },
    rejected: { name: 'Rejected', emoji: '❌' },
    implemented: { name: 'Implemented', emoji: '🚀' },
};
const LOCAL_STORE_PATH = join(process.cwd(), 'data', 'suggestions.json');
class SuggestionService {
    localCache = null;
    async loadLocalStore() {
        if (this.localCache)
            return this.localCache;
        try {
            const raw = await readFile(LOCAL_STORE_PATH, 'utf8');
            this.localCache = JSON.parse(raw);
        }
        catch {
            this.localCache = {
                nextId: 100,
                suggestions: {},
                votes: {},
            };
        }
        return this.localCache;
    }
    async saveLocalStore() {
        if (!this.localCache)
            return;
        try {
            await mkdir(dirname(LOCAL_STORE_PATH), { recursive: true });
            await writeFile(LOCAL_STORE_PATH, JSON.stringify(this.localCache, null, 2), 'utf8');
        }
        catch (err) {
            logger.error('Failed to save local suggestions store:', err);
        }
    }
    /**
     * Get configured suggestions forum channel for a guild
     */
    async getForumChannel(guild) {
        const settings = await supabase.getBotSettings(guild.id).catch(() => null);
        const channelId = settings?.suggestion_channel_id || await localSettings.getSuggestionChannelId(guild.id);
        if (!channelId)
            return null;
        const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
        if (channel && channel.isThreadOnly()) {
            return channel;
        }
        return null;
    }
    /**
     * Reconcile forum tags (creates status tags and category tags if missing)
     */
    async reconcileForumTags(forumChannel) {
        const existingTags = [...forumChannel.availableTags];
        const tagMap = {};
        const tagsToAdd = [];
        // 1. Reconcile Status Tags (Pending, Accepted, Rejected, Implemented)
        for (const [statusKey, meta] of Object.entries(STATUS_TAGS)) {
            const found = existingTags.find((t) => t.name.trim().toLowerCase() === meta.name.toLowerCase() ||
                t.name.toLowerCase().includes(meta.name.toLowerCase()));
            if (found) {
                tagMap[statusKey] = found.id;
            }
            else {
                tagsToAdd.push({
                    name: meta.name.slice(0, 20),
                    emoji: { name: meta.emoji },
                    moderated: true, // Only staff can assign status tags manually
                });
            }
        }
        // 2. Reconcile Category Tags
        for (const [catKey, meta] of Object.entries(SUGGESTION_CATEGORIES)) {
            const found = existingTags.find((t) => t.name.trim().toLowerCase() === meta.tagLabel.toLowerCase() ||
                t.name.toLowerCase().includes(meta.tagLabel.toLowerCase()) ||
                t.name.toLowerCase().includes(catKey.toLowerCase()));
            if (found) {
                tagMap[catKey] = found.id;
            }
            else {
                tagsToAdd.push({
                    name: meta.tagLabel.slice(0, 20),
                    emoji: { name: meta.emoji },
                    moderated: false,
                });
            }
        }
        // Add missing tags up to Discord's 20-tag limit
        if (tagsToAdd.length > 0 && existingTags.length < 20) {
            const allowedToAdd = tagsToAdd.slice(0, 20 - existingTags.length);
            try {
                const updatedChannel = await forumChannel.setAvailableTags([
                    ...existingTags,
                    ...allowedToAdd,
                ]);
                // Map updated tags to keys
                for (const [statusKey, meta] of Object.entries(STATUS_TAGS)) {
                    if (!tagMap[statusKey]) {
                        const matched = updatedChannel.availableTags.find((t) => t.name.trim().toLowerCase() === meta.name.toLowerCase() ||
                            t.name.toLowerCase().includes(meta.name.toLowerCase()));
                        if (matched)
                            tagMap[statusKey] = matched.id;
                    }
                }
                for (const [catKey, meta] of Object.entries(SUGGESTION_CATEGORIES)) {
                    if (!tagMap[catKey]) {
                        const matched = updatedChannel.availableTags.find((t) => t.name.trim().toLowerCase() === meta.tagLabel.toLowerCase() ||
                            t.name.toLowerCase().includes(meta.tagLabel.toLowerCase()));
                        if (matched)
                            tagMap[catKey] = matched.id;
                    }
                }
                logger.info(`🏷️ Reconciled forum tags for suggestions channel #${forumChannel.name}: added ${allowedToAdd.length} tags.`);
            }
            catch (err) {
                logger.warn(`Could not update forum tags for #${forumChannel.name}:`, err);
            }
        }
        return tagMap;
    }
    /**
     * Create suggestion record in database and local cache
     */
    async createSuggestionRecord(guildId, channelId, threadId, messageId, userId, authorTag, title, content, impact, categories) {
        const store = await this.loadLocalStore();
        let suggestionId = ++store.nextId;
        let dbSuggestion = null;
        if (supabase.isAvailable()) {
            try {
                const { data, error } = await supabase.client
                    .from('suggestions')
                    .insert({
                    guild_id: guildId,
                    channel_id: channelId,
                    message_id: messageId,
                    user_id: userId,
                    author_tag: authorTag,
                    title: title,
                    content: impact ? `${content}\n\n**Expected Impact:**\n${impact}` : content,
                    status: 'pending',
                })
                    .select()
                    .single();
                if (!error && data) {
                    dbSuggestion = data;
                    suggestionId = dbSuggestion.id;
                }
            }
            catch (err) {
                logger.warn('Failed to insert suggestion into Supabase, utilizing local store:', err);
            }
        }
        const newSuggestion = {
            id: suggestionId,
            guild_id: guildId,
            channel_id: channelId,
            thread_id: threadId,
            message_id: messageId,
            user_id: userId,
            author_tag: authorTag,
            title,
            content,
            impact,
            categories: categories || ['general'],
            status: 'pending',
            locked: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        store.suggestions[suggestionId] = newSuggestion;
        await this.saveLocalStore();
        return newSuggestion;
    }
    /**
     * Retrieve suggestion by ID
     */
    async getSuggestion(id) {
        const store = await this.loadLocalStore();
        if (store.suggestions[id])
            return store.suggestions[id];
        if (supabase.isAvailable()) {
            const dbItem = await supabase.getSuggestion(id).catch(() => null);
            if (dbItem) {
                store.suggestions[id] = dbItem;
                await this.saveLocalStore();
                return dbItem;
            }
        }
        return null;
    }
    /**
     * Cast or toggle user vote
     */
    async voteSuggestion(suggestionId, user, voteType) {
        const store = await this.loadLocalStore();
        store.votes[suggestionId] ||= {};
        const existing = store.votes[suggestionId][user.id];
        let removed = false;
        let finalVote = voteType;
        if (existing && existing.vote_type === voteType) {
            // Toggle off
            delete store.votes[suggestionId][user.id];
            removed = true;
            finalVote = null;
            if (supabase.isAvailable()) {
                await supabase.removeSuggestionVote(suggestionId, user.id).catch(() => { });
            }
        }
        else {
            // Add or switch vote
            store.votes[suggestionId][user.id] = {
                username: user.tag || user.username,
                vote_type: voteType,
                created_at: new Date().toISOString(),
            };
            if (supabase.isAvailable()) {
                await supabase.addSuggestionVote(suggestionId, user.id, user.tag || user.username, voteType).catch(() => { });
            }
        }
        await this.saveLocalStore();
        // Calculate counts
        let up = 0;
        let down = 0;
        for (const v of Object.values(store.votes[suggestionId])) {
            if (v.vote_type === 'up')
                up++;
            else if (v.vote_type === 'down')
                down++;
        }
        return { up, down, userVote: finalVote, removed };
    }
    /**
     * Get vote counts for a suggestion
     */
    async getVoteCounts(suggestionId) {
        const store = await this.loadLocalStore();
        if (store.votes[suggestionId]) {
            let up = 0;
            let down = 0;
            for (const v of Object.values(store.votes[suggestionId])) {
                if (v.vote_type === 'up')
                    up++;
                else if (v.vote_type === 'down')
                    down++;
            }
            return { up, down };
        }
        if (supabase.isAvailable()) {
            return supabase.getSuggestionVoteCounts(suggestionId).catch(() => ({ up: 0, down: 0 }));
        }
        return { up: 0, down: 0 };
    }
    /**
     * Get full vote logs
     */
    async getVotes(suggestionId) {
        const store = await this.loadLocalStore();
        const localVotes = store.votes[suggestionId];
        if (localVotes && Object.keys(localVotes).length > 0) {
            return Object.entries(localVotes).map(([userId, val]) => ({
                id: `${suggestionId}_${userId}`,
                suggestion_id: suggestionId,
                user_id: userId,
                username: val.username,
                vote_type: val.vote_type,
                created_at: val.created_at,
            }));
        }
        if (supabase.isAvailable()) {
            return supabase.getSuggestionVotes(suggestionId).catch(() => []);
        }
        return [];
    }
    /**
     * Update suggestion status (Approved, Denied, Implemented)
     */
    async updateStatus(suggestionId, staffUser, status, reason) {
        const suggestion = await this.getSuggestion(suggestionId);
        if (!suggestion)
            return null;
        suggestion.status = status;
        suggestion.staff_reviewer_id = staffUser.id;
        suggestion.staff_response = reason || undefined;
        suggestion.updated_at = new Date().toISOString();
        const store = await this.loadLocalStore();
        store.suggestions[suggestionId] = suggestion;
        await this.saveLocalStore();
        if (supabase.isAvailable()) {
            await supabase.updateSuggestionStatus(suggestionId, status).catch(() => { });
        }
        return suggestion;
    }
    /**
     * Toggle suggestion lock
     */
    async toggleLock(suggestionId) {
        const suggestion = await this.getSuggestion(suggestionId);
        if (!suggestion)
            return null;
        suggestion.locked = !suggestion.locked;
        suggestion.updated_at = new Date().toISOString();
        const store = await this.loadLocalStore();
        store.suggestions[suggestionId] = suggestion;
        await this.saveLocalStore();
        if (supabase.isAvailable()) {
            await supabase.toggleSuggestionLock(suggestionId).catch(() => { });
        }
        return suggestion;
    }
    /**
     * Delete suggestion
     */
    async deleteSuggestion(suggestionId) {
        const store = await this.loadLocalStore();
        delete store.suggestions[suggestionId];
        delete store.votes[suggestionId];
        await this.saveLocalStore();
        if (supabase.isAvailable()) {
            await supabase.deleteSuggestion(suggestionId).catch(() => { });
        }
        return true;
    }
}
export const suggestionService = new SuggestionService();
