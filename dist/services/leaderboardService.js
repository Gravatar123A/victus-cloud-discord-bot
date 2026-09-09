import { ActionRowBuilder, ButtonBuilder, ButtonStyle, } from 'discord.js';
import { supabase } from './supabase.js';
import { memberStatsService } from './memberStatsService.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { getLevelProgress } from '../utils/vccrs.js';
import { logger } from '../utils/logger.js';
const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const HR = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
function fmt(n) {
    return Number(n || 0).toLocaleString('en-US');
}
function fmtMinutes(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours === 0)
        return `${mins}m`;
    return `${hours}h ${mins}m`;
}
function resolveProfileName(p) {
    return (p?.display_name ||
        p?.username ||
        [p?.first_name, p?.last_name].filter(Boolean).join(' ') ||
        'Anonymous Member');
}
class LeaderboardService {
    configs = new Map();
    activeGuildIds = new Set();
    /**
     * Get config for a guild
     */
    async getConfig(guildId) {
        if (this.configs.has(guildId)) {
            return this.configs.get(guildId);
        }
        const defaultConfig = {
            guildId,
            channelId: null,
            messageId: null,
            view: 'overview',
            lastUpdated: 0,
        };
        try {
            const embed = await supabase.getCustomEmbed(guildId, '_leaderboard_config');
            if (embed?.description) {
                const parsed = JSON.parse(embed.description);
                const merged = { ...defaultConfig, ...parsed };
                this.configs.set(guildId, merged);
                if (merged.channelId && merged.messageId) {
                    this.activeGuildIds.add(guildId);
                }
                return merged;
            }
        }
        catch (error) {
            logger.warn(`Failed to fetch leaderboard config for guild ${guildId}:`, error);
        }
        this.configs.set(guildId, defaultConfig);
        return defaultConfig;
    }
    /**
     * Save config for a guild
     */
    async setConfig(guildId, updates) {
        const current = await this.getConfig(guildId);
        const updated = { ...current, ...updates };
        this.configs.set(guildId, updated);
        if (updated.channelId && updated.messageId) {
            this.activeGuildIds.add(guildId);
        }
        else {
            this.activeGuildIds.delete(guildId);
        }
        try {
            await supabase.saveCustomEmbed(guildId, '_leaderboard_config', {
                description: JSON.stringify(updated),
            });
        }
        catch (error) {
            logger.warn(`Failed to save leaderboard config for guild ${guildId}:`, error);
        }
        return updated;
    }
    /**
     * Fetch all leaderboard data
     */
    async fetchAllData(guildId) {
        // 1. Top Coins
        const { data: topCoinsRaw } = await supabase.client
            .from('profiles')
            .select('id, username, display_name, first_name, last_name, total_cp')
            .order('total_cp', { ascending: false })
            .limit(10);
        // 2. Top XP
        const { data: topXpRaw } = await supabase.client
            .from('profiles')
            .select('id, username, display_name, first_name, last_name, total_xp')
            .order('total_xp', { ascending: false })
            .limit(10);
        // 3. Top Messages
        const topMessages = await memberStatsService.getTopMessages(guildId, 10);
        // 4. Top Voice
        const topVoice = await memberStatsService.getTopVoice(guildId, 10);
        return {
            coins: topCoinsRaw || [],
            xp: topXpRaw || [],
            messages: topMessages,
            voice: topVoice,
        };
    }
    /**
     * Render the Components V2 Leaderboard container
     */
    async buildLeaderboardContainer(guildId, view) {
        const data = await this.fetchAllData(guildId);
        const container = ComponentsV2.baseContainer(0x2b2d31);
        const nowTs = Math.floor(Date.now() / 1000);
        let body = '';
        if (view === 'overview') {
            // Overview view: Top 3 of every category
            const coinsPodium = data.coins
                .slice(0, 3)
                .map((p, i) => `${MEDALS[i]} **${resolveProfileName(p)}** — \`${fmt(p.total_cp)}\` Coins`)
                .join('\n') || '*No records yet.*';
            const xpPodium = data.xp
                .slice(0, 3)
                .map((p, i) => {
                const lp = getLevelProgress(Number(p.total_xp || 0));
                return `${MEDALS[i]} ${lp.tier.emoji} **${resolveProfileName(p)}** — Lv **${lp.level}** (\`${fmt(p.total_xp)}\` XP)`;
            })
                .join('\n') || '*No records yet.*';
            const messagesPodium = data.messages
                .slice(0, 3)
                .map((m, i) => `${MEDALS[i]} <@${m.userId}> — \`${fmt(m.count)}\` msgs`)
                .join('\n') || '*No message activity recorded yet.*';
            const voicePodium = data.voice
                .slice(0, 3)
                .map((v, i) => `${MEDALS[i]} <@${v.userId}> — \`${fmtMinutes(v.minutes)}\` in VC`)
                .join('\n') || '*No voice activity recorded yet.*';
            body =
                `# 🏆 VICTUS CLOUD LIVE LEADERBOARD\n` +
                    `Real-time server & cloud leaderboards. **Updates automatically every 1 minute.**\n` +
                    `${HR}\n\n` +
                    `### 🪙 Top Coins (Economy)\n${coinsPodium}\n\n` +
                    `### ⚡ Top XP & Contribution Ranks\n${xpPodium}\n\n` +
                    `### 💬 Most Active Chatters\n${messagesPodium}\n\n` +
                    `### 🎙️ Top Voice Channel Airtime\n${voicePodium}\n\n` +
                    `${HR}\n` +
                    `- 🕒 *Last updated: <t:${nowTs}:R> • Next tick: <t:${nowTs + 60}:R> • ⚡ Live Sync*`;
        }
        else if (view === 'coins') {
            const list = data.coins
                .map((p, i) => `${MEDALS[i]} **${resolveProfileName(p)}** — \`${fmt(p.total_cp)}\` Coins`)
                .join('\n') || '*No coins data recorded yet.*';
            body =
                `# 🪙 TOP COINS LEADERBOARD\n` +
                    `Highest coin balances across Victus Cloud.\n` +
                    `${HR}\n\n` +
                    `${list}\n\n` +
                    `${HR}\n` +
                    `- 🕒 *Last updated: <t:${nowTs}:R> • Auto-updates every 1 minute*`;
        }
        else if (view === 'xp') {
            const list = data.xp
                .map((p, i) => {
                const lp = getLevelProgress(Number(p.total_xp || 0));
                return `${MEDALS[i]} ${lp.tier.emoji} **${resolveProfileName(p)}** — **${lp.tier.name}** (Lv ${lp.level}) · \`${fmt(p.total_xp)}\` XP`;
            })
                .join('\n') || '*No XP data recorded yet.*';
            body =
                `# ⚡ TOP XP & TIERS LEADERBOARD\n` +
                    `Highest community rank and contribution points.\n` +
                    `${HR}\n\n` +
                    `${list}\n\n` +
                    `${HR}\n` +
                    `- 🕒 *Last updated: <t:${nowTs}:R> • Auto-updates every 1 minute*`;
        }
        else if (view === 'messages') {
            const list = data.messages
                .map((m, i) => `${MEDALS[i]} <@${m.userId}> — **${fmt(m.count)}** messages sent`)
                .join('\n') || '*No messages recorded yet.*';
            body =
                `# 💬 TOP MESSAGES LEADERBOARD\n` +
                    `Most active chat contributors in this Discord server.\n` +
                    `${HR}\n\n` +
                    `${list}\n\n` +
                    `${HR}\n` +
                    `- 🕒 *Last updated: <t:${nowTs}:R> • Auto-updates every 1 minute*`;
        }
        else if (view === 'voice') {
            const list = data.voice
                .map((v, i) => `${MEDALS[i]} <@${v.userId}> — **${fmtMinutes(v.minutes)}** spent in VC`)
                .join('\n') || '*No voice activity recorded yet.*';
            body =
                `# 🎙️ TOP VOICE AIRTIME LEADERBOARD\n` +
                    `Most dedicated voice channel participants in this Discord server.\n` +
                    `${HR}\n\n` +
                    `${list}\n\n` +
                    `${HR}\n` +
                    `- 🕒 *Last updated: <t:${nowTs}:R> • Auto-updates every 1 minute*`;
        }
        container.addTextDisplayComponents(ComponentsV2.text(body));
        // Category Tab Buttons
        const tabRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(`lb_tab:overview:${guildId}`)
            .setLabel('Overview')
            .setStyle(view === 'overview' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setEmoji('🏆'), new ButtonBuilder()
            .setCustomId(`lb_tab:coins:${guildId}`)
            .setLabel('Coins')
            .setStyle(view === 'coins' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setEmoji('🪙'), new ButtonBuilder()
            .setCustomId(`lb_tab:xp:${guildId}`)
            .setLabel('XP & Rank')
            .setStyle(view === 'xp' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setEmoji('⚡'), new ButtonBuilder()
            .setCustomId(`lb_tab:messages:${guildId}`)
            .setLabel('Messages')
            .setStyle(view === 'messages' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setEmoji('💬'), new ButtonBuilder()
            .setCustomId(`lb_tab:voice:${guildId}`)
            .setLabel('Voice')
            .setStyle(view === 'voice' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setEmoji('🎙️'));
        // Control Button
        const refreshRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(`lb_refresh:${guildId}`)
            .setLabel('Refresh Live Board 🔄')
            .setStyle(ButtonStyle.Success));
        container.addActionRowComponents(tabRow);
        container.addActionRowComponents(refreshRow);
        return container;
    }
    /**
     * Update the persistent leaderboard message for a guild
     */
    async updateGuildLeaderboard(client, guildId, explicitView) {
        try {
            const config = await this.getConfig(guildId);
            if (!config.channelId)
                return false;
            const channel = client.channels.cache.get(config.channelId);
            if (!channel || !channel.isTextBased()) {
                logger.warn(`Leaderboard channel ${config.channelId} not found in guild ${guildId}`);
                return false;
            }
            const currentView = explicitView || config.view || 'overview';
            const container = await this.buildLeaderboardContainer(guildId, currentView);
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
                            lastUpdated: Date.now(),
                        });
                        return true;
                    }
                }
                catch (editError) {
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
                lastUpdated: Date.now(),
            });
            return true;
        }
        catch (error) {
            logger.error(`Error updating leaderboard for guild ${guildId}:`, error);
            return false;
        }
    }
    /**
     * Periodic 1-minute ticker: updates leaderboards in all configured guilds
     */
    async updateAllLeaderboards(client) {
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
