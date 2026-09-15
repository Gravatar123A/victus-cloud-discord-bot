import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
class InviteService {
    cache = new Map();
    CACHE_TTL_MS = 30_000; // 30 seconds
    /**
     * Invalidate cached invite stats for a guild (e.g. after joins or creations)
     */
    invalidateCache(guildId) {
        this.cache.delete(guildId);
    }
    /**
     * Fetch and compute all invite data for a guild, combining live Discord invites
     * with persistent Supabase credit records.
     */
    async getGuildInvitesData(guild, forceFresh = false) {
        const cached = this.cache.get(guild.id);
        const now = Date.now();
        if (!forceFresh && cached && now - cached.timestamp < this.CACHE_TTL_MS) {
            return cached;
        }
        // 1. Fetch live Discord invites from the guild
        const liveCodesByUser = new Map();
        const liveUsesByUser = new Map();
        try {
            const fetched = await guild.invites.fetch().catch((err) => {
                logger.warn(`[InviteService] Could not fetch live guild invites for ${guild.id}: ${err.message}`);
                return null;
            });
            if (fetched) {
                for (const inv of fetched.values()) {
                    const inviterId = inv.inviter?.id || inv.inviterId;
                    if (!inviterId)
                        continue;
                    const uses = inv.uses ?? 0;
                    liveUsesByUser.set(inviterId, (liveUsesByUser.get(inviterId) ?? 0) + uses);
                    const channelName = inv.channel?.name || null;
                    const codeInfo = {
                        code: inv.code,
                        url: inv.url,
                        uses,
                        channelId: inv.channelId,
                        channelName,
                        maxUses: inv.maxUses ?? 0,
                        expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null,
                        createdAt: inv.createdAt ? inv.createdAt.toISOString() : null,
                    };
                    const existingCodes = liveCodesByUser.get(inviterId) || [];
                    existingCodes.push(codeInfo);
                    liveCodesByUser.set(inviterId, existingCodes);
                }
            }
        }
        catch (error) {
            logger.warn(`[InviteService] Live invite fetch error: ${error?.message || error}`);
        }
        // 2. Fetch database tracked joins from Supabase
        const dbConfirmedByUser = new Map();
        const dbPendingByUser = new Map();
        const dbLeftByUser = new Map();
        const dbCoinsByUser = new Map();
        const credits = await supabase.getGuildInviteCredits(guild.id).catch(() => []);
        for (const credit of credits) {
            const inviterId = credit.inviter_discord_id;
            if (!inviterId)
                continue;
            if (credit.status === 'confirmed') {
                dbConfirmedByUser.set(inviterId, (dbConfirmedByUser.get(inviterId) ?? 0) + 1);
                dbCoinsByUser.set(inviterId, (dbCoinsByUser.get(inviterId) ?? 0) + (credit.coins ?? 0));
            }
            else if (credit.status === 'pending') {
                dbPendingByUser.set(inviterId, (dbPendingByUser.get(inviterId) ?? 0) + 1);
            }
            else if (credit.status === 'voided' || credit.status === 'clawed_back' || credit.left_at) {
                dbLeftByUser.set(inviterId, (dbLeftByUser.get(inviterId) ?? 0) + 1);
            }
        }
        // 3. Merge all known inviter IDs
        const allInviterIds = new Set([
            ...liveUsesByUser.keys(),
            ...dbConfirmedByUser.keys(),
            ...dbPendingByUser.keys(),
            ...dbLeftByUser.keys(),
        ]);
        const invitersMap = new Map();
        const unrankedList = [];
        for (const inviterId of allInviterIds) {
            const liveUses = liveUsesByUser.get(inviterId) ?? 0;
            const confirmed = dbConfirmedByUser.get(inviterId) ?? 0;
            const pending = dbPendingByUser.get(inviterId) ?? 0;
            const left = dbLeftByUser.get(inviterId) ?? 0;
            const coins = dbCoinsByUser.get(inviterId) ?? 0;
            const codes = (liveCodesByUser.get(inviterId) || []).sort((a, b) => b.uses - a.uses);
            // Compute unified metrics
            // Total is at least live uses, or confirmed + pending + left
            const total = Math.max(liveUses, confirmed + pending + left);
            // Regular (confirmed / active members):
            const regular = Math.max(confirmed, total - left - pending);
            const retentionRate = total > 0 ? Math.round(((regular + pending) / total) * 100) : 100;
            invitersMap.set(inviterId, {
                total,
                regular,
                pending,
                left,
                coins,
                retentionRate,
                codes,
            });
            if (total > 0) {
                unrankedList.push({
                    userId: inviterId,
                    total,
                    regular,
                    pending,
                    left,
                    coins,
                    codeCount: codes.length,
                });
            }
        }
        // 4. Sort leaderboard: total desc -> regular desc -> coins desc
        unrankedList.sort((a, b) => {
            if (b.total !== a.total)
                return b.total - a.total;
            if (b.regular !== a.regular)
                return b.regular - a.regular;
            return b.coins - a.coins;
        });
        const leaderboard = unrankedList.map((entry, idx) => ({
            rank: idx + 1,
            ...entry,
        }));
        const snapshot = {
            timestamp: now,
            invitersMap,
            leaderboard,
        };
        this.cache.set(guild.id, snapshot);
        return snapshot;
    }
    /**
     * Get complete stats for a specific user in a guild
     */
    async getUserStats(guild, userId, forceFresh = false) {
        const data = await this.getGuildInvitesData(guild, forceFresh);
        const userEntry = data.invitersMap.get(userId);
        const rankedEntry = data.leaderboard.find((e) => e.userId === userId);
        const rank = rankedEntry ? rankedEntry.rank : null;
        // Check who invited this user
        let invitedBy = null;
        try {
            const credit = await supabase.getInviteCreditByInvitee(userId);
            if (credit && credit.inviter_discord_id) {
                invitedBy = {
                    inviterId: credit.inviter_discord_id,
                    code: credit.invite_code,
                    joinedAt: credit.joined_at || credit.created_at || new Date().toISOString(),
                    status: credit.status,
                };
            }
        }
        catch (err) {
            logger.debug(`[InviteService] Error checking inviter attribution for ${userId}:`, err);
        }
        return {
            userId,
            guildId: guild.id,
            total: userEntry?.total ?? 0,
            regular: userEntry?.regular ?? 0,
            pending: userEntry?.pending ?? 0,
            left: userEntry?.left ?? 0,
            coins: userEntry?.coins ?? 0,
            retentionRate: userEntry?.retentionRate ?? 100,
            rank,
            totalRanked: data.leaderboard.length,
            activeCodes: userEntry?.codes ?? [],
            invitedBy,
        };
    }
    /**
     * Get paginated leaderboard entries for a guild
     */
    async getLeaderboardPage(guild, page = 1, pageSize = 10, forceFresh = false) {
        const data = await this.getGuildInvitesData(guild, forceFresh);
        const totalEntries = data.leaderboard.length;
        const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize));
        const currentPage = Math.min(Math.max(1, page), totalPages);
        const startIndex = (currentPage - 1) * pageSize;
        const entries = data.leaderboard.slice(startIndex, startIndex + pageSize);
        return {
            page: currentPage,
            pageSize,
            totalPages,
            totalEntries,
            entries,
        };
    }
    /**
     * Create a fresh invite code for a user in a guild
     */
    async createInvite(guild, user, targetChannelId) {
        try {
            let channel = null;
            if (targetChannelId) {
                const found = guild.channels.cache.get(targetChannelId);
                if (found && found.isTextBased() && 'createInvite' in found) {
                    channel = found;
                }
            }
            if (!channel) {
                // Find public system or first viewable text channel
                if (guild.systemChannel && 'createInvite' in guild.systemChannel) {
                    channel = guild.systemChannel;
                }
                else {
                    const candidate = guild.channels.cache.find((c) => c.isTextBased() && 'createInvite' in c);
                    if (candidate)
                        channel = candidate;
                }
            }
            if (!channel)
                return null;
            const invite = await channel.createInvite({
                maxAge: 0, // Permanent
                maxUses: 0, // Unlimited
                reason: `Created for ${user.tag} (${user.id}) via /invites`,
            });
            this.invalidateCache(guild.id);
            return { code: invite.code, url: invite.url };
        }
        catch (err) {
            logger.error(`[InviteService] Failed to create invite in guild ${guild.id}:`, err);
            return null;
        }
    }
}
export const inviteService = new InviteService();
