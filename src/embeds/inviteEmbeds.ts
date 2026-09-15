import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    Guild,
    User,
} from 'discord.js';
import { ComponentsV2 } from './componentsV2.js';
import { progressBar } from '../utils/vccrs.js';
import { UserInviteStats, InviteLeaderboardPage } from '../services/inviteService.js';
import { formatRank } from '../services/leaderboardService.js';

const HR = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

export class InviteEmbeds {
    /**
     * Builds the high-density Components V2 container for an individual user's invite intelligence card.
     */
    static buildUserInvitesCard(
        stats: UserInviteStats,
        guild: Guild,
        targetUser: User,
        requesterId: string
    ): { container: ContainerBuilder; actionRows: ActionRowBuilder<ButtonBuilder>[] } {
        const container = ComponentsV2.baseContainer(0x6366f1);

        // Header & Rank info
        const isSelf = targetUser.id === requesterId;
        const rankBadge = stats.rank
            ? `${formatRank(stats.rank)} **Rank #${stats.rank}** of ${stats.totalRanked} inviters`
            : '`Unranked` (No qualifying invites recorded)';

        const topPercent = stats.rank && stats.totalRanked > 0
            ? ` · Top ${Math.max(1, Math.round((stats.rank / stats.totalRanked) * 100))}%`
            : '';

        // Build active invite links summary
        let codesBlock = '';
        if (stats.activeCodes.length > 0) {
            const displayCodes = stats.activeCodes.slice(0, 3);
            const codesList = displayCodes
                .map((c) => {
                    const channelStr = c.channelName ? `· #${c.channelName}` : '';
                    const expiryStr = c.expiresAt
                        ? `· Exp <t:${Math.floor(new Date(c.expiresAt).getTime() / 1000)}:R>`
                        : '· Permanent';
                    return `• [\`discord.gg/${c.code}\`](${c.url}) — **${c.uses}** uses ${channelStr} ${expiryStr}`;
                })
                .join('\n');

            const moreStr = stats.activeCodes.length > 3
                ? `\n*+${stats.activeCodes.length - 3} more active invite link(s)*`
                : '';
            codesBlock = `\n**Active Invite Links**:\n${codesList}${moreStr}\n`;
        } else {
            codesBlock = `\n**Active Invite Links**:\n*No active invite codes found for this member.*\n`;
        }

        // Attribution
        let attributionLine = '';
        if (stats.invitedBy) {
            const joinedTs = Math.floor(new Date(stats.invitedBy.joinedAt).getTime() / 1000);
            attributionLine = `> 🔗 **Invited By**: <@${stats.invitedBy.inviterId}> via \`${stats.invitedBy.code || 'link'}\` (<t:${joinedTs}:R>)\n`;
        } else {
            attributionLine = `> 🔗 **Attribution**: *Direct Join / Server Discovery / Pre-bot Member*\n`;
        }

        // Rewards
        const coinsLine = stats.coins > 0
            ? `> 🪙 **Growth Rewards**: **+${stats.coins.toLocaleString('en-US')} COINS** credited\n`
            : `> 🪙 **Growth Rewards**: \`0 COINS\` (Link account via \`/link\` to earn COINS)\n`;

        const body =
            `# 📨 INVITATION INTELLIGENCE\n` +
            `**Member**: <@${targetUser.id}> (\`${targetUser.username}\`)\n` +
            `**Placement**: ${rankBadge}${topPercent}\n` +
            `${HR}\n\n` +
            `\`\`\`asciidoc\n` +
            `[ INVITATION BREAKDOWN ]\n` +
            `• TOTAL USES  :: ${stats.total.toString().padEnd(4)} [Gross joins via links]\n` +
            `• REGULAR     :: ${stats.regular.toString().padEnd(4)} [Retained & active members]\n` +
            `• PENDING     :: ${stats.pending.toString().padEnd(4)} [In qualification escrow]\n` +
            `• LEFT/VOID   :: ${stats.left.toString().padEnd(4)} [Departed before payout]\n` +
            `\`\`\`\n` +
            `> 📊 **Acquisition Quality**: ${progressBar(stats.retentionRate, 14)} **${stats.retentionRate}%**\n` +
            coinsLine +
            attributionLine +
            `${HR}\n` +
            codesBlock +
            `\n-# 🛡️ Powered by Victus Cloud Anti-Farm Escrow Engine • Live Data`;

        container.addTextDisplayComponents(ComponentsV2.text(body));

        // Interactive action row
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`inv:lb:1:${requesterId}`)
                .setLabel('Leaderboard')
                .setEmoji('🏆')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`inv:refresh:${targetUser.id}:${requesterId}`)
                .setLabel('Refresh')
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`inv:create:${targetUser.id}:${requesterId}`)
                .setLabel('Create Invite Link')
                .setEmoji('➕')
                .setStyle(ButtonStyle.Success)
        );

        return { container, actionRows: [row] };
    }

    /**
     * Builds the high-density Components V2 container for the guild's invite leaderboard.
     */
    static buildLeaderboardCard(
        data: InviteLeaderboardPage,
        guild: Guild,
        requesterId: string,
        userStats?: UserInviteStats
    ): { container: ContainerBuilder; actionRows: ActionRowBuilder<ButtonBuilder>[] } {
        const container = ComponentsV2.baseContainer(0x2b2d31);

        let listText = '';
        if (data.entries.length > 0) {
            listText = data.entries
                .map((e) => {
                    const medal = formatRank(e.rank);
                    const coinBadge = e.coins > 0 ? ` · 🪙 \`${e.coins.toLocaleString('en-US')}\`` : '';
                    return (
                        `${medal} <@${e.userId}> — **${e.total}** invites\n` +
                        `    └─ ✅ \`${e.regular}\` regular · ⏳ \`${e.pending}\` pending · 🚪 \`${e.left}\` left${coinBadge}`
                    );
                })
                .join('\n\n');
        } else {
            listText = '*No invite activity recorded in this server yet.*';
        }

        const userRankInfo = userStats?.rank
            ? `🎯 **Your Placement**: ${formatRank(userStats.rank)} with **${userStats.total}** invites (✅ \`${userStats.regular}\` regular)`
            : '🎯 **Your Placement**: `Unranked` (0 invites recorded)';

        const body =
            `# 🏆 INVITATION HALL OF FAME\n` +
            `Top community inviters in **${guild.name}** · **${data.totalEntries}** inviters tracked\n` +
            `${HR}\n\n` +
            `${listText}\n\n` +
            `${HR}\n` +
            `- 📄 **Page ${data.page} of ${data.totalPages}** (Showing ranks ${((data.page - 1) * data.pageSize) + 1}–${Math.min(data.page * data.pageSize, data.totalEntries)})\n` +
            `- ${userRankInfo}\n` +
            `- 🕒 *Real-time sync with Discord & Escrow ledger*`;

        container.addTextDisplayComponents(ComponentsV2.text(body));

        // Navigation controls
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`inv:page:${Math.max(1, data.page - 1)}:${requesterId}`)
                .setLabel('Previous')
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(data.page <= 1),
            new ButtonBuilder()
                .setCustomId(`inv:check:${requesterId}:${requesterId}`)
                .setLabel('My Invites')
                .setEmoji('👤')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`inv:page:${Math.min(data.totalPages, data.page + 1)}:${requesterId}`)
                .setLabel('Next')
                .setEmoji('▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(data.page >= data.totalPages),
            new ButtonBuilder()
                .setCustomId(`inv:refresh_lb:${data.page}:${requesterId}`)
                .setLabel('Refresh')
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Secondary)
        );

        return { container, actionRows: [row] };
    }
}
