import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} from 'discord.js';
import { ComponentsV2 } from './componentsV2.js';
import { config } from '../config.js';
import { actionLabel, getLevelProgress, progressBar } from '../utils/vccrs.js';

const HR = '━━━━━━━━━━━━━━━━━━';
export const ECONOMY_PAGE_SIZE = 10;

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
    return p?.display_name || p?.username || [p?.first_name, p?.last_name].filter(Boolean).join(' ') || 'Member';
}

// Unified navigation dropdown — present on every view so the whole economy is
// driven from one message.
function navRow(ownerId: string, current: string, isAdmin = false): ActionRowBuilder<StringSelectMenuBuilder> {
    const opts = [
        { label: 'Wallet', value: 'wallet', emoji: '💼', description: 'Coins, level & balances' },
        { label: 'Bank', value: 'bank', emoji: '🏦', description: 'Deposit / withdraw Coins' },
        { label: 'Transfer', value: 'transfer', emoji: '💸', description: 'Send Coins or credits' },
        { label: 'Convert', value: 'convert', emoji: '🔁', description: 'Swap between currencies' },
        { label: 'Leaderboard', value: 'leaderboard', emoji: '🏆', description: 'Top contributors' },
        { label: 'History', value: 'history', emoji: '🧾', description: 'Your transactions' },
    ];
    if (isAdmin) opts.push({ label: 'Admin Controls', value: 'admin', emoji: '🛠️', description: 'Adjust / freeze (staff)' });

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`econ:nav:${ownerId}`)
        .setPlaceholder('Manage your economy…')
        .addOptions(
            opts.map((o) => {
                const b = new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.value).setDescription(o.description).setEmoji(o.emoji);
                if (o.value === current) b.setDefault(true);
                return b;
            }),
        );
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function btnRow(...buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}

// ── Wallet / dashboard ──────────────────────────────────────────────────────
export interface DashboardOpts {
    discordId: string;
    profile: any;
    rank: number | null;
    credits: number | null;
    coins: number | null;
    recent: any[];
    isAdmin?: boolean;
}

export function cpDashboardContainer(o: DashboardOpts): ContainerBuilder {
    const cp = Number(o.profile?.total_cp ?? 0);
    const bank = Number(o.profile?.cp_bank ?? 0);
    const frozen = Boolean(o.profile?.economy_frozen);
    const lp = getLevelProgress(cp);
    const tier = lp.tier;

    const c = new ContainerBuilder()
        .setAccentColor(frozen ? ComponentsV2.Accents.danger : tier.color)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# ${tier.emoji} Victus Economy\n` +
                `<@${o.discordId}> · **${tier.name}** · Level **${lp.level}**${o.rank ? ` · Rank **#${o.rank}**` : ''}` +
                (frozen ? '  ·  🧊 **FROZEN**' : '') +
                `\n${HR}\n` +
                `### ⭐ Coins\n` +
                `**${fmt(cp)} Coins**  ·  🏦 Bank **${fmt(bank)} Coins**\n` +
                `${progressBar(lp.progress)}  \`${lp.progress.toFixed(0)}%\`\n` +
                `-# ${fmt(lp.cpToNext)} Coins to reach Level ${lp.level + 1}\n` +
                `${HR}\n` +
                `### 💼 Wallet\n` +
                `🟡 **Coins** — ${o.coins == null ? '`—`' : `**${fmt(o.coins)}**`}\n` +
                `💳 **Credits** — ${o.credits == null ? '`—`' : `**${fmt(o.credits)}**`}`,
            ),
        );

    if (o.recent?.length) {
        const lines = o.recent.slice(0, 5).map((t) => {
            const amt = Number(t.cp_earned);
            return `\`${amt >= 0 ? '+' : ''}${fmt(amt)} Coins\` · ${actionLabel(t.action_type)} · ${rel(t.created_at)}`;
        }).join('\n');
        c.addTextDisplayComponents(ComponentsV2.text(`### 🧾 Recent Activity\n${lines}`));
    }

    c.addTextDisplayComponents(ComponentsV2.text(`-# 🔄 Synced with victuscloud.com · updated ${clockNow()}`));
    c.addActionRowComponents(navRow(o.discordId, 'wallet', o.isAdmin));
    c.addActionRowComponents(btnRow(
        new ButtonBuilder().setCustomId(`econ:dash:${o.discordId}`).setLabel('Refresh').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
        new ButtonBuilder().setCustomId(`econ:nav2:${o.discordId}:transfer`).setLabel('Transfer').setStyle(ButtonStyle.Primary).setEmoji('💸'),
        new ButtonBuilder().setCustomId(`econ:nav2:${o.discordId}:convert`).setLabel('Convert').setStyle(ButtonStyle.Secondary).setEmoji('🔁'),
        new ButtonBuilder().setLabel('Open Web').setStyle(ButtonStyle.Link).setURL(`${config.branding.website}/dashboard/rank`).setEmoji('🌐'),
    ));
    return c;
}

// ── Bank ────────────────────────────────────────────────────────────────────
export function bankContainer(discordId: string, profile: any, isAdmin = false): ContainerBuilder {
    const cp = Number(profile?.total_cp ?? 0);
    const bank = Number(profile?.cp_bank ?? 0);
    const c = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.primary)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# 🏦 Coins Bank\n` +
                `Keep your Coins safe in the bank — banked Coins are held separately from your spendable wallet.\n${HR}\n` +
                `💼 **Wallet:** ${fmt(cp)} Coins\n` +
                `🏦 **Bank:** ${fmt(bank)} Coins\n` +
                `🧮 **Total:** ${fmt(cp + bank)} Coins`,
            ),
        );
    c.addActionRowComponents(navRow(discordId, 'bank', isAdmin));
    c.addActionRowComponents(btnRow(
        new ButtonBuilder().setCustomId(`econ:bankdep:${discordId}`).setLabel('Deposit').setStyle(ButtonStyle.Success).setEmoji('📥').setDisabled(cp <= 0),
        new ButtonBuilder().setCustomId(`econ:bankwd:${discordId}`).setLabel('Withdraw').setStyle(ButtonStyle.Primary).setEmoji('📤').setDisabled(bank <= 0),
        new ButtonBuilder().setCustomId(`econ:dash:${discordId}`).setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji('🏠'),
    ));
    return c;
}

// ── Transfer ────────────────────────────────────────────────────────────────
export function transferContainer(discordId: string, profile: any, isAdmin = false): ContainerBuilder {
    const c = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.primary)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# 💸 Transfer\n` +
                `Send currency to another **linked** member. Pick what to send:\n${HR}\n` +
                `⭐ **Coins** — ${fmt(profile?.total_cp)} available · instant, on-platform\n` +
                `💳 **Credits** — billing credits, sent via Paymenter\n` +
                `-# Recipients must have linked their Victus Cloud account with /link.`,
            ),
        );
    c.addActionRowComponents(navRow(discordId, 'transfer', isAdmin));
    c.addActionRowComponents(btnRow(
        new ButtonBuilder().setCustomId(`econ:xfer:${discordId}:cp`).setLabel('Send Coins').setStyle(ButtonStyle.Primary).setEmoji('⭐'),
        new ButtonBuilder().setCustomId(`econ:xfer:${discordId}:credits`).setLabel('Send Credits').setStyle(ButtonStyle.Secondary).setEmoji('💳'),
        new ButtonBuilder().setCustomId(`econ:dash:${discordId}`).setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji('🏠'),
    ));
    return c;
}

// ── Convert ─────────────────────────────────────────────────────────────────
export function convertContainer(discordId: string, rates: any[], profile: any, credits: number | null, isAdmin = false): ContainerBuilder {
    const rate = (from: string, to: string) => rates.find((r) => r.from_currency === from && r.to_currency === to);
    const cpToCredits = rate('cp', 'credits');
    const creditsToCp = rate('credits', 'cp');

    const rateLine = (r: any, fromLabel: string, toLabel: string) =>
        r ? `• 1 ${fromLabel} = **${r.rate}** ${toLabel} (min ${fmt(r.min_amount)})` : `• ${fromLabel} → ${toLabel}: \`unavailable\``;

    const c = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.info)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# 🔁 Convert Currency\n` +
                `Swap between Coins and billing Credits at the live rate.\n${HR}\n` +
                `⭐ **You have:** ${fmt(profile?.total_cp)} Coins · 💳 ${credits == null ? '—' : fmt(credits)} Credits\n${HR}\n` +
                `### 📈 Live Rates\n` +
                `${rateLine(cpToCredits, 'Coins', 'Credit')}\n` +
                `${rateLine(creditsToCp, 'Credit', 'Coins')}\n` +
                `-# 🟡 Coins conversions are coming soon.`,
            ),
        );
    c.addActionRowComponents(navRow(discordId, 'convert', isAdmin));
    c.addActionRowComponents(btnRow(
        new ButtonBuilder().setCustomId(`econ:conv:${discordId}:cp_credits`).setLabel('Coins → Credits').setStyle(ButtonStyle.Primary).setEmoji('💳').setDisabled(!cpToCredits),
        new ButtonBuilder().setCustomId(`econ:conv:${discordId}:credits_cp`).setLabel('Credits → Coins').setStyle(ButtonStyle.Secondary).setEmoji('⭐').setDisabled(!creditsToCp),
        new ButtonBuilder().setCustomId(`econ:dash:${discordId}`).setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji('🏠'),
    ));
    return c;
}

// ── Admin ───────────────────────────────────────────────────────────────────
export function adminContainer(discordId: string): ContainerBuilder {
    const c = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.warning)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# 🛠️ Admin Economy Controls\n` +
                `Staff-only tools. Every action is written to the economy audit ledger.\n${HR}\n` +
                `• **Adjust Coins** — add or remove Coins from a member.\n` +
                `• **Freeze / Unfreeze** — block or restore a member's economy actions.`,
            ),
        );
    c.addActionRowComponents(navRow(discordId, 'admin', true));
    c.addActionRowComponents(btnRow(
        new ButtonBuilder().setCustomId(`econ:adjadj:${discordId}`).setLabel('Adjust Coins').setStyle(ButtonStyle.Primary).setEmoji('⚖️'),
        new ButtonBuilder().setCustomId(`econ:adjfreeze:${discordId}:1`).setLabel('Freeze').setStyle(ButtonStyle.Danger).setEmoji('🧊'),
        new ButtonBuilder().setCustomId(`econ:adjfreeze:${discordId}:0`).setLabel('Unfreeze').setStyle(ButtonStyle.Success).setEmoji('🔥'),
        new ButtonBuilder().setCustomId(`econ:dash:${discordId}`).setLabel('Back').setStyle(ButtonStyle.Secondary).setEmoji('🏠'),
    ));
    return c;
}

// ── Confirmation ────────────────────────────────────────────────────────────
export function confirmContainer(discordId: string, token: string, title: string, summary: string): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.warning)
        .addTextDisplayComponents(ComponentsV2.text(`# ⚠️ ${title}\n${summary}\n${HR}\n-# Please confirm to continue.`))
        .addActionRowComponents(btnRow(
            new ButtonBuilder().setCustomId(`econ:cfm:${discordId}:${token}`).setLabel('Confirm').setStyle(ButtonStyle.Success).setEmoji('✅'),
            new ButtonBuilder().setCustomId(`econ:dash:${discordId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
        ));
}

// ── Result ──────────────────────────────────────────────────────────────────
export function resultContainer(discordId: string, ok: boolean, title: string, body: string, isAdmin = false): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(ok ? ComponentsV2.Accents.success : ComponentsV2.Accents.danger)
        .addTextDisplayComponents(ComponentsV2.text(`# ${ok ? '✅' : '⛔'} ${title}\n${body}`))
        .addActionRowComponents(navRow(discordId, 'wallet', isAdmin))
        .addActionRowComponents(btnRow(
            new ButtonBuilder().setCustomId(`econ:dash:${discordId}`).setLabel('Back to Dashboard').setStyle(ButtonStyle.Primary).setEmoji('🏠'),
        ));
}

// ── Leaderboard ─────────────────────────────────────────────────────────────
export interface LeaderboardOpts {
    discordId: string;
    rows: any[];
    page: number;
    viewerId?: string | null;
    viewerRank?: number | null;
    viewerCp?: number | null;
    isAdmin?: boolean;
}
export function leaderboardContainer(o: LeaderboardOpts): ContainerBuilder {
    const start = o.page * ECONOMY_PAGE_SIZE;
    const medals = ['🥇', '🥈', '🥉'];
    const lines = o.rows.map((p, i) => {
        const pos = start + i + 1;
        const badge = pos <= 3 && o.page === 0 ? medals[pos - 1] : `\`#${pos}\``;
        const lp = getLevelProgress(Number(p.total_cp ?? 0));
        const me = o.viewerId && p.id === o.viewerId ? ' ⬅️ **you**' : '';
        return `${badge} ${lp.tier.emoji} **${profileName(p)}** — ${fmt(p.total_cp)} Coins · Lv ${lp.level}${me}`;
    }).join('\n') || '*No ranked members yet.*';

    const c = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.primary)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# 🏆 Coins Leaderboard\nTop contributors across Victus Cloud.\n${HR}\n${lines}\n${HR}\n` +
                (o.viewerRank ? `Your position — **#${o.viewerRank}** · ${fmt(o.viewerCp)} Coins\n` : '') +
                `-# Page ${o.page + 1}`,
            ),
        );
    c.addActionRowComponents(navRow(o.discordId, 'leaderboard', o.isAdmin));
    c.addActionRowComponents(btnRow(
        new ButtonBuilder().setCustomId(`econ:lb:${o.discordId}:${Math.max(0, o.page - 1)}`).setLabel('Prev').setStyle(ButtonStyle.Secondary).setEmoji('◀️').setDisabled(o.page <= 0),
        new ButtonBuilder().setCustomId(`econ:dash:${o.discordId}`).setLabel('Dashboard').setStyle(ButtonStyle.Secondary).setEmoji('🏠'),
        new ButtonBuilder().setCustomId(`econ:lb:${o.discordId}:${o.page + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setEmoji('▶️').setDisabled(o.rows.length < ECONOMY_PAGE_SIZE),
    ));
    return c;
}

// ── History (unified economy ledger) ────────────────────────────────────────
const LEDGER_KIND: Record<string, { emoji: string; label: string }> = {
    transfer_in: { emoji: '📥', label: 'Received' },
    transfer_out: { emoji: '📤', label: 'Sent' },
    bank_deposit: { emoji: '🏦', label: 'Bank deposit' },
    bank_withdraw: { emoji: '🏦', label: 'Bank withdraw' },
    convert_out: { emoji: '🔁', label: 'Converted out' },
    convert_in: { emoji: '🔁', label: 'Converted in' },
    admin_adjust: { emoji: '⚖️', label: 'Admin adjustment' },
};
export interface HistoryOpts {
    discordId: string;
    rows: any[];
    page: number;
    hasNext: boolean;
    isAdmin?: boolean;
}
export function historyContainer(o: HistoryOpts): ContainerBuilder {
    const lines = o.rows.map((t) => {
        const meta = LEDGER_KIND[t.kind] || { emoji: '•', label: t.kind };
        const amt = Number(t.amount);
        const cur = String(t.currency || 'cp').toLowerCase() === 'cp' ? 'Coins' : String(t.currency).toUpperCase();
        return `${meta.emoji} **\`${amt >= 0 ? '+' : ''}${fmt(amt)} ${cur}\`** · ${meta.label}${t.reason ? ` — ${t.reason}` : ''}\n-# ${rel(t.created_at)}`;
    }).join('\n') || '*No economy activity yet.*';

    const c = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.info)
        .addTextDisplayComponents(ComponentsV2.text(`# 🧾 Economy History\n${HR}\n${lines}\n${HR}\n-# Page ${o.page + 1}`));
    c.addActionRowComponents(navRow(o.discordId, 'history', o.isAdmin));
    c.addActionRowComponents(btnRow(
        new ButtonBuilder().setCustomId(`econ:hist:${o.discordId}:${Math.max(0, o.page - 1)}`).setLabel('Prev').setStyle(ButtonStyle.Secondary).setEmoji('◀️').setDisabled(o.page <= 0),
        new ButtonBuilder().setCustomId(`econ:dash:${o.discordId}`).setLabel('Dashboard').setStyle(ButtonStyle.Secondary).setEmoji('🏠'),
        new ButtonBuilder().setCustomId(`econ:hist:${o.discordId}:${o.page + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setEmoji('▶️').setDisabled(!o.hasNext),
    ));
    return c;
}
