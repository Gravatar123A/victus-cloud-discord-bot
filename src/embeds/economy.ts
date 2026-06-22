import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder } from 'discord.js';
import { ComponentsV2 } from './componentsV2.js';
import { config } from '../config.js';
import { actionLabel, getLevelProgress, progressBar } from '../utils/vccrs.js';

const HR = '━━━━━━━━━━━━━━━━━━';

function fmt(n: number | null | undefined): string {
    return Number(n || 0).toLocaleString('en-US');
}

function rel(ts: string | Date | null | undefined): string {
    if (!ts) return '—';
    const ms = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
    return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:R>` : '—';
}

function clockNow(): string {
    return `<t:${Math.floor(Date.now() / 1000)}:t>`;
}

function profileName(p: any): string {
    return (
        p?.display_name ||
        p?.username ||
        [p?.first_name, p?.last_name].filter(Boolean).join(' ') ||
        'Member'
    );
}

export const ECONOMY_PAGE_SIZE = 10;

export interface DashboardOpts {
    discordId: string;
    profile: any;
    rank: number | null;
    credits: number | null;
    coins: number | null;
    recent: any[];
}

/** The headline CP / economy dashboard. */
export function cpDashboardContainer(opts: DashboardOpts): ContainerBuilder {
    const { discordId, profile, rank, credits, coins, recent } = opts;
    const cp = Number(profile?.total_cp ?? 0);
    const lp = getLevelProgress(cp);
    const tier = lp.tier;

    const container = new ContainerBuilder()
        .setAccentColor(tier.color)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# ${tier.emoji} Victus Economy\n` +
                `<@${discordId}> · **${tier.name}** · Level **${lp.level}**${rank ? ` · Rank **#${rank}**` : ''}\n` +
                `${HR}\n` +
                `### ⭐ Contribution Points\n` +
                `**${fmt(cp)} CP**\n` +
                `${progressBar(lp.progress)}  \`${lp.progress.toFixed(0)}%\`\n` +
                `-# ${fmt(lp.cpToNext)} CP to reach Level ${lp.level + 1}\n` +
                `${HR}\n` +
                `### 💼 Wallet\n` +
                `🟡 **Coins** — ${coins == null ? '`—`' : `**${fmt(coins)}**`}\n` +
                `💳 **Credits** — ${credits == null ? '`—`' : `**${fmt(credits)}**`}`,
            ),
        );

    if (recent?.length) {
        const lines = recent
            .slice(0, 5)
            .map((t) => {
                const amt = Number(t.cp_earned);
                return `\`${amt >= 0 ? '+' : ''}${fmt(amt)} CP\` · ${actionLabel(t.action_type)} · ${rel(t.created_at)}`;
            })
            .join('\n');
        container.addTextDisplayComponents(ComponentsV2.text(`### 🧾 Recent Activity\n${lines}`));
    }

    container.addTextDisplayComponents(
        ComponentsV2.text(`-# 🔄 Synced with victuscloud.com · updated ${clockNow()}`),
    );

    container.addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`econ:dash:${discordId}`).setLabel('Refresh').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
            new ButtonBuilder().setCustomId(`econ:lb:${discordId}:0`).setLabel('Leaderboard').setStyle(ButtonStyle.Primary).setEmoji('🏆'),
            new ButtonBuilder().setCustomId(`econ:hist:${discordId}:0`).setLabel('History').setStyle(ButtonStyle.Secondary).setEmoji('🧾'),
            new ButtonBuilder().setLabel('Open Web').setStyle(ButtonStyle.Link).setURL(`${config.branding.website}/dashboard/rank`).setEmoji('🌐'),
        ),
    );

    return container;
}

export interface LeaderboardOpts {
    discordId: string;
    rows: any[];
    page: number;
    viewerId?: string | null;
    viewerRank?: number | null;
    viewerCp?: number | null;
}

export function leaderboardContainer(opts: LeaderboardOpts): ContainerBuilder {
    const { discordId, rows, page, viewerId, viewerRank, viewerCp } = opts;
    const start = page * ECONOMY_PAGE_SIZE;
    const medals = ['🥇', '🥈', '🥉'];

    const lines =
        rows
            .map((p, i) => {
                const pos = start + i + 1;
                const badge = pos <= 3 && page === 0 ? medals[pos - 1] : `\`#${pos}\``;
                const lp = getLevelProgress(Number(p.total_cp ?? 0));
                const me = viewerId && p.id === viewerId ? ' ⬅️ **you**' : '';
                return `${badge} ${lp.tier.emoji} **${profileName(p)}** — ${fmt(p.total_cp)} CP · Lv ${lp.level}${me}`;
            })
            .join('\n') || '*No ranked members yet.*';

    const container = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.primary)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# 🏆 CP Leaderboard\n` +
                `Top contributors across Victus Cloud.\n` +
                `${HR}\n${lines}\n${HR}\n` +
                (viewerRank ? `Your position — **#${viewerRank}** · ${fmt(viewerCp)} CP\n` : '') +
                `-# Page ${page + 1}`,
            ),
        );

    container.addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`econ:lb:${discordId}:${Math.max(0, page - 1)}`).setLabel('Prev').setStyle(ButtonStyle.Secondary).setEmoji('◀️').setDisabled(page <= 0),
            new ButtonBuilder().setCustomId(`econ:dash:${discordId}`).setLabel('Dashboard').setStyle(ButtonStyle.Secondary).setEmoji('🏠'),
            new ButtonBuilder().setCustomId(`econ:lb:${discordId}:${page + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setEmoji('▶️').setDisabled(rows.length < ECONOMY_PAGE_SIZE),
        ),
    );

    return container;
}

export interface HistoryOpts {
    discordId: string;
    rows: any[];
    page: number;
    total: number;
}

export function historyContainer(opts: HistoryOpts): ContainerBuilder {
    const { discordId, rows, page, total } = opts;
    const totalPages = Math.max(1, Math.ceil(total / ECONOMY_PAGE_SIZE));

    const lines =
        rows
            .map((t) => {
                const amt = Number(t.cp_earned);
                const dot = amt >= 0 ? '🟢' : '🔴';
                return `${dot} **\`${amt >= 0 ? '+' : ''}${fmt(amt)} CP\`** · ${actionLabel(t.action_type)}\n-# ${rel(t.created_at)}`;
            })
            .join('\n') || '*No CP activity yet — start contributing on victuscloud.com.*';

    const container = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.info)
        .addTextDisplayComponents(
            ComponentsV2.text(`# 🧾 CP Transaction History\n${HR}\n${lines}\n${HR}\n-# Page ${page + 1} / ${totalPages}`),
        );

    container.addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`econ:hist:${discordId}:${Math.max(0, page - 1)}`).setLabel('Prev').setStyle(ButtonStyle.Secondary).setEmoji('◀️').setDisabled(page <= 0),
            new ButtonBuilder().setCustomId(`econ:dash:${discordId}`).setLabel('Dashboard').setStyle(ButtonStyle.Secondary).setEmoji('🏠'),
            new ButtonBuilder().setCustomId(`econ:hist:${discordId}:${page + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setEmoji('▶️').setDisabled(page + 1 >= totalPages),
        ),
    );

    return container;
}
