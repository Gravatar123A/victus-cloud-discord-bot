import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    ContainerBuilder,
    TextChannel,
} from 'discord.js';
import { supabase } from './supabase.js';
import { memberStatsService } from './memberStatsService.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { getLevelProgress } from '../utils/vccrs.js';
import { logger } from '../utils/logger.js';

export type LeaderboardCategory = 'overview' | 'coins' | 'xp' | 'messages' | 'voice';

export interface LeaderboardConfig {
    guildId: string;
    channelId: string | null;
    messageId: string | null;
    view: LeaderboardCategory;
    page: number;
    lastUpdated: number;
}

const HR = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
const PAGE_SIZE = 10;

function fmt(n: number | null | undefined): string {
    return Number(n || 0).toLocaleString('en-US');
}

function fmtMinutes(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours === 0) return `${mins}m`;
    return `${hours}h ${mins}m`;
}

function resolveProfileName(p: any): string {
    return (
        p?.display_name ||
        p?.username ||
        [p?.first_name, p?.last_name].filter(Boolean).join(' ') ||
        'Anonymous Member'
    );
}

export function formatRank(rank: number): string {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    if (rank === 4) return '4️⃣';
    if (rank === 5) return '5️⃣';
    if (rank === 6) return '6️⃣';
    if (rank === 7) return '7️⃣';
    if (rank === 8) return '8️⃣';
    if (rank === 9) return '9️⃣';
    if (rank === 10) return '🔟';
    return `\`#${rank}\``;
}

class LeaderboardService {
    private configs = new Map<string, LeaderboardConfig>();
    private activeGuildIds = new Set<string>();

    /**
     * Get config for a guild
     */
    async getConfig(guildId: string): Promise<LeaderboardConfig> {
        if (this.configs.has(guildId)) {
            return this.configs.get(guildId)!;
        }

        const defaultConfig: LeaderboardConfig = {
            guildId,
            channelId: null,
            messageId: null,
            view: 'overview',
            page: 1,
            lastUpdated: 0,
        };

        try {
            const embed = await supabase.getCustomEmbed(guildId, '_leaderboard_config');
            if (embed?.description) {
                const parsed = JSON.parse(embed.description);
                const merged: LeaderboardConfig = { ...defaultConfig, ...parsed };
                this.configs.set(guildId, merged);
                if (merged.channelId && merged.messageId) {
                    this.activeGuildIds.add(guildId);
                }
                return merged;
            }
        } catch (error) {
            logger.warn(`Failed to fetch leaderboard config for guild ${guildId}:`, error);
        }

        this.configs.set(guildId, defaultConfig);
        return defaultConfig;
    }

    /**
     * Save config for a guild
     */
    async setConfig(guildId: string, updates: Partial<LeaderboardConfig>): Promise<LeaderboardConfig> {
        const current = await this.getConfig(guildId);
        const updated: LeaderboardConfig = { ...current, ...updates };
        this.configs.set(guildId, updated);

        if (updated.channelId && updated.messageId) {
            this.activeGuildIds.add(guildId);
        } else {
            this.activeGuildIds.delete(guildId);
        }

        try {
            await supabase.saveCustomEmbed(guildId, '_leaderboard_config', {
                description: JSON.stringify(updated),
            });
        } catch (error) {
            logger.warn(`Failed to save leaderboard config for guild ${guildId}:`, error);
        }

        return updated;
    }

    /**
     * Fetch leaderboard data up to 100 entries for pagination
     */
    private async fetchAllData(guildId: string) {
        // 1. Top Coins (up to 100 profiles)
        const { data: topCoinsRaw } = await supabase.client
            .from('profiles')
            .select('id, username, display_name, first_name, last_name, total_cp')
            .order('total_cp', { ascending: false })
            .limit(100);

        // 2. Top XP (up to 100 profiles)
        const { data: topXpRaw } = await supabase.client
            .from('profiles')
            .select('id, username, display_name, first_name, last_name, total_xp')
            .order('total_xp', { ascending: false })
            .limit(100);

        // 3. Top Messages (up to 100 active chatters)
        const topMessages = await memberStatsService.getTopMessages(guildId, 100);

        // 4. Top Voice (up to 100 active voice participants)
        const topVoice = await memberStatsService.getTopVoice(guildId, 100);

        return {
            coins: topCoinsRaw || [],
            xp: topXpRaw || [],
            messages: topMessages,
            voice: topVoice,
        };
    }

    /**
     * Render the Components V2 Leaderboard container with Top 10 per page and interactive pagination
     */
    async buildLeaderboardContainer(
        guildId: string,
        view: LeaderboardCategory = 'overview',
        page: number = 1
    ): Promise<ContainerBuilder> {
        const data = await this.fetchAllData(guildId);
        const container = ComponentsV2.baseContainer(0x2b2d31);
        const nowTs = Math.floor(Date.now() / 1000);

        let body = '';
        let totalPages = 1;
        let currentPage = Math.max(1, page);

        if (view === 'overview') {
            const maxOverviewCount = Math.max(
                data.coins.length,
                data.xp.length,
                data.messages.length,
                data.voice.length,
                1
            );
            totalPages = Math.max(1, Math.ceil(maxOverviewCount / PAGE_SIZE));
            currentPage = Math.min(currentPage, totalPages);
            const startIndex = (currentPage - 1) * PAGE_SIZE;
            const endIndex = startIndex + PAGE_SIZE;

            // 1. Coins (10 items on this page)
            const coinsSlice = data.coins.slice(startIndex, endIndex);
            const coinsList =
                coinsSlice.length > 0
                    ? coinsSlice
                          .map((p, i) => `${formatRank(startIndex + i + 1)} **${resolveProfileName(p)}** — \`${fmt(p.total_cp)}\` Coins`)
                          .join('\n')
                    : '*No coins records for this page.*';

            // 2. XP & Rank (10 items on this page)
            const xpSlice = data.xp.slice(startIndex, endIndex);
            const xpList =
                xpSlice.length > 0
                    ? xpSlice
                          .map((p, i) => {
                              const lp = getLevelProgress(Number(p.total_xp || 0));
                              return `${formatRank(startIndex + i + 1)} ${lp.tier.emoji} **${resolveProfileName(p)}** — Lv **${lp.level}** (\`${fmt(p.total_xp)}\` XP)`;
                          })
                          .join('\n')
                    : '*No XP records for this page.*';

            // 3. Most Active Chatters (10 items on this page)
            const messagesSlice = data.messages.slice(startIndex, endIndex);
            const messagesList =
                messagesSlice.length > 0
                    ? messagesSlice
                          .map((m, i) => `${formatRank(startIndex + i + 1)} <@${m.userId}> — \`${fmt(m.count)}\` msgs`)
                          .join('\n')
                    : '*No message activity for this page.*';

            // 4. Voice Airtime (10 items on this page)
            const voiceSlice = data.voice.slice(startIndex, endIndex);
            const voiceList =
                voiceSlice.length > 0
                    ? voiceSlice
                          .map((v, i) => `${formatRank(startIndex + i + 1)} <@${v.userId}> — \`${fmtMinutes(v.minutes)}\` in VC`)
                          .join('\n')
                    : '*No voice activity for this page.*';

            body =
                `# 🏆 VICTUS CLOUD LIVE LEADERBOARD\n` +
                `Real-time server & cloud leaderboards. **Updates automatically every 1 minute.**\n` +
                `${HR}\n\n` +
                `### 🪙 Top Coins (Economy) • Ranks ${startIndex + 1}–${startIndex + (coinsSlice.length || 1)}\n${coinsList}\n\n` +
                `### ⚡ Top XP & Contribution Ranks • Ranks ${startIndex + 1}–${startIndex + (xpSlice.length || 1)}\n${xpList}\n\n` +
                `### 💬 Most Active Chatters • Ranks ${startIndex + 1}–${startIndex + (messagesSlice.length || 1)}\n${messagesList}\n\n` +
                `### 🎙️ Top Voice Channel Airtime • Ranks ${startIndex + 1}–${startIndex + (voiceSlice.length || 1)}\n${voiceList}\n\n` +
                `${HR}\n` +
                `- 📄 **Page ${currentPage} of ${totalPages}** • 🕒 *Updated: <t:${nowTs}:R> • Next tick: <t:${nowTs + 60}:R> • ⚡ Live Sync*`;
        } else if (view === 'coins') {
            const total = Math.max(data.coins.length, 1);
            totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
            currentPage = Math.min(currentPage, totalPages);
            const startIndex = (currentPage - 1) * PAGE_SIZE;
            const slice = data.coins.slice(startIndex, startIndex + PAGE_SIZE);

            const list =
                slice.length > 0
                    ? slice
                          .map((p, i) => `${formatRank(startIndex + i + 1)} **${resolveProfileName(p)}** — \`${fmt(p.total_cp)}\` Coins`)
                          .join('\n')
                    : '*No coins data recorded yet.*';

            body =
                `# 🪙 TOP COINS LEADERBOARD\n` +
                `Highest coin balances across Victus Cloud.\n` +
                `${HR}\n\n` +
                `${list}\n\n` +
                `${HR}\n` +
                `- 📄 **Page ${currentPage} of ${totalPages}** (Showing ranks ${startIndex + 1}–${startIndex + slice.length} of ${data.coins.length})\n` +
                `- 🕒 *Last updated: <t:${nowTs}:R> • Auto-updates every 1 minute*`;
        } else if (view === 'xp') {
            const total = Math.max(data.xp.length, 1);
            totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
            currentPage = Math.min(currentPage, totalPages);
            const startIndex = (currentPage - 1) * PAGE_SIZE;
            const slice = data.xp.slice(startIndex, startIndex + PAGE_SIZE);

            const list =
                slice.length > 0
                    ? slice
                          .map((p, i) => {
                              const lp = getLevelProgress(Number(p.total_xp || 0));
                              return `${formatRank(startIndex + i + 1)} ${lp.tier.emoji} **${resolveProfileName(p)}** — **${lp.tier.name}** (Lv ${lp.level}) · \`${fmt(p.total_xp)}\` XP`;
                          })
                          .join('\n')
                    : '*No XP data recorded yet.*';

            body =
                `# ⚡ TOP XP & TIERS LEADERBOARD\n` +
                `Highest community rank and contribution points.\n` +
                `${HR}\n\n` +
                `${list}\n\n` +
                `${HR}\n` +
                `- 📄 **Page ${currentPage} of ${totalPages}** (Showing ranks ${startIndex + 1}–${startIndex + slice.length} of ${data.xp.length})\n` +
                `- 🕒 *Last updated: <t:${nowTs}:R> • Auto-updates every 1 minute*`;
        } else if (view === 'messages') {
            const total = Math.max(data.messages.length, 1);
            totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
            currentPage = Math.min(currentPage, totalPages);
            const startIndex = (currentPage - 1) * PAGE_SIZE;
            const slice = data.messages.slice(startIndex, startIndex + PAGE_SIZE);

            const list =
                slice.length > 0
                    ? slice
                          .map((m, i) => `${formatRank(startIndex + i + 1)} <@${m.userId}> — **${fmt(m.count)}** messages sent`)
                          .join('\n')
                    : '*No messages recorded yet.*';

            body =
                `# 💬 TOP MESSAGES LEADERBOARD\n` +
                `Most active chat contributors in this Discord server.\n` +
                `${HR}\n\n` +
                `${list}\n\n` +
                `${HR}\n` +
                `- 📄 **Page ${currentPage} of ${totalPages}** (Showing ranks ${startIndex + 1}–${startIndex + slice.length} of ${data.messages.length})\n` +
                `- 🕒 *Last updated: <t:${nowTs}:R> • Auto-updates every 1 minute*`;
        } else if (view === 'voice') {
            const total = Math.max(data.voice.length, 1);
            totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
            currentPage = Math.min(currentPage, totalPages);
            const startIndex = (currentPage - 1) * PAGE_SIZE;
            const slice = data.voice.slice(startIndex, startIndex + PAGE_SIZE);

            const list =
                slice.length > 0
                    ? slice
                          .map((v, i) => `${formatRank(startIndex + i + 1)} <@${v.userId}> — **${fmtMinutes(v.minutes)}** spent in VC`)
                          .join('\n')
                    : '*No voice activity recorded yet.*';

            body =
                `# 🎙️ TOP VOICE AIRTIME LEADERBOARD\n` +
                `Most dedicated voice channel participants in this Discord server.\n` +
                `${HR}\n\n` +
                `${list}\n\n` +
                `${HR}\n` +
                `- 📄 **Page ${currentPage} of ${totalPages}** (Showing ranks ${startIndex + 1}–${startIndex + slice.length} of ${data.voice.length})\n` +
                `- 🕒 *Last updated: <t:${nowTs}:R> • Auto-updates every 1 minute*`;
        }

        container.addTextDisplayComponents(ComponentsV2.text(body));

        // Row 1: Category Tab Buttons
        const tabRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`lb_tab:overview:${guildId}`)
                .setLabel('Overview')
                .setStyle(view === 'overview' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setEmoji('🏆'),
            new ButtonBuilder()
                .setCustomId(`lb_tab:coins:${guildId}`)
                .setLabel('Coins')
                .setStyle(view === 'coins' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setEmoji('🪙'),
            new ButtonBuilder()
                .setCustomId(`lb_tab:xp:${guildId}`)
                .setLabel('XP & Rank')
                .setStyle(view === 'xp' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setEmoji('⚡'),
            new ButtonBuilder()
                .setCustomId(`lb_tab:messages:${guildId}`)
                .setLabel('Messages')
                .setStyle(view === 'messages' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setEmoji('💬'),
            new ButtonBuilder()
                .setCustomId(`lb_tab:voice:${guildId}`)
                .setLabel('Voice')
                .setStyle(view === 'voice' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setEmoji('🎙️')
        );

        // Row 2: Page Navigation and Refresh Controls
        const prevPage = Math.max(1, currentPage - 1);
        const nextPage = Math.min(totalPages, currentPage + 1);

        const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`lb_page:${view}:${prevPage}:${guildId}`)
                .setLabel('◀ Prev')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage <= 1),
            new ButtonBuilder()
                .setCustomId(`lb_noop:${view}:${currentPage}:${guildId}`)
                .setLabel(`Page ${currentPage} / ${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`lb_page:${view}:${nextPage}:${guildId}`)
                .setLabel('Next ▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage >= totalPages),
            new ButtonBuilder()
                .setCustomId(`lb_refresh:${view}:${currentPage}:${guildId}`)
                .setLabel('Refresh 🔄')
                .setStyle(ButtonStyle.Success)
        );

        container.addActionRowComponents(tabRow);
        container.addActionRowComponents(navRow);

        return container;
    }

    /**
     * Update the persistent leaderboard message for a guild
     */
    async updateGuildLeaderboard(
        client: Client,
        guildId: string,
        explicitView?: LeaderboardCategory,
        explicitPage?: number
    ): Promise<boolean> {
        try {
            const config = await this.getConfig(guildId);
            if (!config.channelId) return false;

            const channel = client.channels.cache.get(config.channelId) as TextChannel | undefined;
            if (!channel || !channel.isTextBased()) {
                logger.warn(`Leaderboard channel ${config.channelId} not found in guild ${guildId}`);
                return false;
            }

            const currentView = explicitView || config.view || 'overview';
            const currentPage = explicitPage || config.page || 1;
            const container = await this.buildLeaderboardContainer(guildId, currentView, currentPage);

            // Attempt to edit existing message
            if (config.messageId) {
                try {
                    const existingMsg = await channel.messages.fetch(config.messageId).catch(() => null);
                    if (existingMsg) {
                        await existingMsg.edit({
                            components: [container],
                            flags: ComponentsV2.IS_COMPONENTS_V2,
                        });
                        await this.setConfig(guildId, {
                            view: currentView,
                            page: currentPage,
                            lastUpdated: Date.now(),
                        });
                        return true;
                    }
                } catch (editError) {
                    logger.warn(`Failed to edit existing leaderboard message, will post a fresh one:`, editError);
                }
            }

            // If message doesn't exist or was deleted, post fresh message
            const newMsg = await channel.send({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });

            await this.setConfig(guildId, {
                channelId: channel.id,
                messageId: newMsg.id,
                view: currentView,
                page: currentPage,
                lastUpdated: Date.now(),
            });

            return true;
        } catch (error) {
            logger.error(`Error updating leaderboard for guild ${guildId}:`, error);
            return false;
        }
    }

    /**
     * Periodic 1-minute ticker: updates leaderboards in all configured guilds
     */
    async updateAllLeaderboards(client: Client): Promise<void> {
        // Also check any guilds in client cache if not yet loaded
        for (const guild of client.guilds.cache.values()) {
            await this.getConfig(guild.id);
        }

        for (const guildId of this.activeGuildIds) {
            await this.updateGuildLeaderboard(client, guildId).catch((err) => {
                logger.error(`Failed 1-minute leaderboard update for guild ${guildId}:`, err);
            });
        }
    }
}

export const leaderboardService = new LeaderboardService();
