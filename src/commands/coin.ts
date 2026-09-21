import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
    ContainerBuilder,
} from 'discord.js';
import type { ChatInputCommandInteraction, ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';
import { VICTUS_COLORS } from '../types/index.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const PAGE_SIZE = 8;

function fmt(n: number | null | undefined): string {
    return Number(n || 0).toLocaleString('en-US');
}
function rel(ts: string | Date | null | undefined): string {
    if (!ts) return '—';
    const ms = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
    return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:R>` : '—';
}
function absFmt(ts: string | Date | null | undefined): string {
    if (!ts) return '—';
    const ms = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
    return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:f>` : '—';
}
function clockNow(): string {
    return `<t:${Math.floor(Date.now() / 1000)}:t>`;
}

const PERIODS = [
    { label: 'Last 7 days', value: '7d', days: 7 },
    { label: 'Last 30 days', value: '30d', days: 30 },
    { label: 'Last 90 days', value: '90d', days: 90 },
    { label: 'Last 180 days', value: '180d', days: 180 },
    { label: 'Last year', value: '1y', days: 365 },
    { label: 'All time', value: 'all', days: 9999 },
] as const;

const SOURCE_META: Record<string, { emoji: string; label: string; color: string }> = {
    daily_bonus: { emoji: '🎁', label: 'Daily Bonus', color: '#f59e0b' },
    referral: { emoji: '👥', label: 'Referral', color: '#8b5cf6' },
    ad: { emoji: '📺', label: 'Ad Reward', color: '#06b6d4' },
    direct_link: { emoji: '🔗', label: 'Direct Link', color: '#22c55e' },
    afk: { emoji: '⏳', label: 'AFK Reward', color: '#6366f1' },
    discord_link: { emoji: '💬', label: 'Discord Link', color: '#5865F2' },
    trustpilot_review: { emoji: '⭐', label: 'Trustpilot', color: '#00b67a' },
    redeem_code: { emoji: '🎫', label: 'Redeem Code', color: '#f6c244' },
    admin_give: { emoji: '👑', label: 'Admin Give', color: '#ef4444' },
    admin_adjust: { emoji: '⚖️', label: 'Admin Adjust', color: '#ef4444' },
    transfer_in: { emoji: '📥', label: 'Transfer In', color: '#22c55e' },
    transfer_out: { emoji: '📤', label: 'Transfer Out', color: '#ef4444' },
    bank_deposit: { emoji: '🏦', label: 'Bank Deposit', color: '#3b82f6' },
    bank_withdraw: { emoji: '🏦', label: 'Bank Withdraw', color: '#f59e0b' },
    renewal: { emoji: '🔄', label: 'Server Renewal', color: '#ef4444' },
    resource_upgrade: { emoji: '⬆️', label: 'Resource Upgrade', color: '#ef4444' },
    boost: { emoji: '🚀', label: 'Boost', color: '#a78bfa' },
    invite: { emoji: '✉️', label: 'Invite Reward', color: '#22c55e' },
    economy_ledger: { emoji: '🧾', label: 'Economy', color: '#6366f1' },
    cp: { emoji: '✨', label: 'XP', color: '#f59e0b' },
};

function sourceMeta(source: string) {
    return SOURCE_META[source] || { emoji: '•', label: source, color: '#6b7280' };
}

interface UnifiedTx {
    id: string;
    ts: string;
    amount: number;
    source: string;
    description: string;
    meta?: any;
    runningBalance?: number;
}

async function fetchAllCoinHistory(userId: string, email: string, periodDays: number): Promise<{ txs: UnifiedTx[]; currentBalance: number }> {
    const since = periodDays >= 9999 ? null : new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    // Fetch profile for current balance
    const profile = await supabase.getUserProfile(userId).catch(() => null);
    const currentBalance = Number((profile as any)?.total_cp ?? 0);

    // Fetch from multiple sources in parallel
    const [economyLedger, cpTxs, panelTxs] = await Promise.all([
        supabase.getEconomyLedger(userId, 100, 0).catch(() => [] as any[]),
        supabase.getCpTransactions(userId, 100, 0).catch(() => [] as any[]),
        fetchPanelCreditTransactions(userId, email, since),
    ]);

    const unified: UnifiedTx[] = [];

    // Economy ledger (Coins transfers, bank, admin adjusts, etc.)
    for (const r of economyLedger as any[]) {
        const ts = r.created_at || r.timestamp;
        if (since && new Date(ts) < since) continue;
        unified.push({
            id: `econ-${r.id}`,
            ts,
            amount: Number(r.amount ?? r.delta ?? 0),
            source: r.kind || r.type || 'economy_ledger',
            description: r.reason || r.description || r.kind || 'Economy transaction',
            meta: r,
        });
    }

    // CP transactions (XP, but also includes some coin-like rewards)
    for (const r of cpTxs as any[]) {
        const ts = r.created_at;
        if (since && new Date(ts) < since) continue;
        // Only include if it's coin-related (cp_earned can be XP, but we show it)
        unified.push({
            id: `cp-${r.id || r.action_type}-${ts}`,
            ts,
            amount: Number(r.cp_earned ?? 0),
            source: r.action_type || 'cp',
            description: r.action_type ? `${r.action_type} (XP)` : 'XP transaction',
            meta: r,
        });
    }

    // Panel credit_transactions (the main coin history)
    for (const r of panelTxs) {
        const ts = r.created_at;
        if (since && new Date(ts) < since) continue;
        unified.push({
            id: `panel-${r.id}`,
            ts,
            amount: Number(r.amount ?? 0),
            source: r.source || 'panel',
            description: r.description || r.source || 'Panel transaction',
            meta: r,
        });
    }

    // Sort by timestamp descending (newest first)
    unified.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

    // Calculate running balance leading up to current
    // We have current balance, and we have transactions sorted newest first
    // To get running balance, we need to work backwards: current - sum of all txs in period = balance at start of period
    // But we can also calculate forward if we had the starting balance
    // For now, we'll calculate running balance by starting from current and subtracting as we go backwards
    let running = currentBalance;
    const withRunning: UnifiedTx[] = [];
    // First, sort ascending (oldest first) to calculate forward
    const asc = [...unified].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    // Find starting balance: current - sum of all amounts in period
    const sumInPeriod = asc.reduce((s, t) => s + t.amount, 0);
    let balAtStart = currentBalance - sumInPeriod;
    for (const tx of asc) {
        balAtStart += tx.amount;
        withRunning.push({ ...tx, runningBalance: balAtStart });
    }
    // Return descending with running balance
    withRunning.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

    return { txs: withRunning, currentBalance };
}

async function fetchPanelCreditTransactions(userId: string, email: string, since: Date | null): Promise<any[]> {
    // Try to fetch from Supabase credit_transactions table directly
    // This is the panel's coin history (shared DB if using Supabase, or via Paymenter)
    try {
        // The panel's credit_transactions are in the Supabase `credit_transactions` table
        // or via the `profiles` -> `economy_ledger` is already covered
        // Let's try to fetch from credit_transactions if the table exists
        const client: any = (supabase as any).client;
        if (!client) return [];

        // Try credit_transactions table (panel's local coin history)
        let query = client.from('credit_transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100);
        if (since) query = query.gte('created_at', since.toISOString());
        const { data, error } = await query;
        if (!error && data && data.length > 0) {
            return data;
        }

        // Fallback: try via Paymenter API for panel transactions
        // The panel's transactions are also available via the economy_ledger, so this is supplementary
        return [];
    } catch {
        return [];
    }
}

function buildHistoryContainer(
    discordId: string,
    profile: any,
    period: string,
    txs: UnifiedTx[],
    currentBalance: number,
    page: number,
    hasNext: boolean,
    hasPrev: boolean
): ContainerBuilder {
    const periodLabel = PERIODS.find((p) => p.value === period)?.label || period;
    const userId = profile?.id || 'unknown';
    const totalGain = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const totalLoss = txs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const net = totalGain - totalLoss;

    const start = page * PAGE_SIZE;
    const pageTxs = txs.slice(start, start + PAGE_SIZE);
    const totalPages = Math.max(1, Math.ceil(txs.length / PAGE_SIZE));

    const header = new ContainerBuilder().setAccentColor(VICTUS_COLORS.primary);

    // Header with balance and period
    header.addTextDisplayComponents({
        type: 10 as any,
        content:
            `# 🧾 Coin History — ${periodLabel}\n` +
            `<@${discordId}> · **${profile?.username || profile?.email || 'Member'}**\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `### 💰 Current Balance: **${fmt(currentBalance)} Coins**\n` +
            `📈 **Gain:** \`+${fmt(totalGain)}\` · 📉 **Loss:** \`${fmt(totalLoss)}\` · ⚖️ **Net:** \`${net >= 0 ? '+' : ''}${fmt(net)}\`\n` +
            `📊 **Transactions:** \`${txs.length}\` in period · \`Page ${page + 1}/${totalPages}\`\n` +
            `-# Showing ${pageTxs.length} per page · updated ${clockNow()}`,
    } as any);

    if (pageTxs.length === 0) {
        header.addTextDisplayComponents({
            type: 10 as any,
            content: `*No coin transactions in this period.*\n\nTry a longer period or check \`/economy\` for your wallet.`,
        } as any);
    } else {
        const lines = pageTxs
            .map((tx) => {
                const meta = sourceMeta(tx.source);
                const sign = tx.amount >= 0 ? '+' : '';
                const amtStr = `\`${sign}${fmt(tx.amount)} Coins\``;
                const balStr = tx.runningBalance != null ? ` → \`${fmt(tx.runningBalance)} Coins\`` : '';
                const desc = tx.description.length > 80 ? tx.description.slice(0, 77) + '...' : tx.description;
                return `${meta.emoji} **${amtStr}** · ${meta.label}${balStr}\n-# ${desc} · ${rel(tx.ts)} · \`${absFmt(tx.ts)}\``;
            })
            .join('\n\n');

        header.addTextDisplayComponents({
            type: 10 as any,
            content: lines,
        } as any);

        // Summary footer for page
        const pageGain = pageTxs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
        const pageLoss = pageTxs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
        header.addTextDisplayComponents({
            type: 10 as any,
            content: `━━━━━━━━━━━━━━━━━━\n-# Page ${page + 1} · \`${pageGain >= 0 ? '+' : ''}${fmt(pageGain)} gain\` · \`${fmt(pageLoss)} loss\` · \`${pageTxs.length} transactions\``,
        } as any);
    }

    // Period selector
    const periodRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`coin:period:${discordId}`)
            .setPlaceholder('Select period')
            .addOptions(
                PERIODS.map((p) => {
                    const opt = new StringSelectMenuOptionBuilder().setLabel(p.label).setValue(p.value).setDescription(`${p.days >= 9999 ? 'All' : `${p.days} days`} of history`);
                    if (p.value === period) opt.setDefault(true);
                    return opt;
                })
            )
    );
    header.addActionRowComponents(periodRow as any);

    // Pagination
    const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`coin:hist:${discordId}:${period}:${Math.max(0, page - 1)}`)
            .setLabel('Prev')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('◀️')
            .setDisabled(!hasPrev),
        new ButtonBuilder().setCustomId(`coin:dash:${discordId}`).setLabel('Dashboard').setStyle(ButtonStyle.Secondary).setEmoji('🏠'),
        new ButtonBuilder()
            .setCustomId(`coin:hist:${discordId}:${period}:${page + 1}`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('▶️')
            .setDisabled(!hasNext),
        new ButtonBuilder().setCustomId(`coin:refresh:${discordId}:${period}:${page}`).setLabel('Refresh').setStyle(ButtonStyle.Primary).setEmoji('🔄')
    );
    header.addActionRowComponents(btnRow as any);

    // Quick filter buttons
    const filterRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`coin:filter:${discordId}:${period}:${page}:all`).setLabel('All').setStyle(ButtonStyle.Secondary).setEmoji('📋'),
        new ButtonBuilder().setCustomId(`coin:filter:${discordId}:${period}:${page}:gain`).setLabel('Gains').setStyle(ButtonStyle.Success).setEmoji('📈'),
        new ButtonBuilder().setCustomId(`coin:filter:${discordId}:${period}:${page}:loss`).setLabel('Losses').setStyle(ButtonStyle.Danger).setEmoji('📉'),
        new ButtonBuilder().setCustomId(`coin:export:${discordId}:${period}`).setLabel('Export CSV').setStyle(ButtonStyle.Secondary).setEmoji('📄')
    );
    header.addActionRowComponents(filterRow as any);

    return header;
}

export const coinCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('coin')
        .setDescription('View your coin transaction history')
        .setDMPermission(false)
        .addSubcommand((sub) =>
            sub
                .setName('history')
                .setDescription('Show detailed coin history for a period')
                .addStringOption((opt) =>
                    opt
                        .setName('period')
                        .setDescription('Time period to show')
                        .addChoices(
                            { name: 'Last 7 days', value: '7d' },
                            { name: 'Last 30 days', value: '30d' },
                            { name: 'Last 90 days', value: '90d' },
                            { name: 'Last 180 days', value: '180d' },
                            { name: 'Last year', value: '1y' },
                            { name: 'All time', value: 'all' }
                        )
                        .setRequired(false)
                )
                .addStringOption((opt) =>
                    opt.setName('type').setDescription('Filter by type').addChoices({ name: 'All', value: 'all' }, { name: 'Gains only', value: 'gain' }, { name: 'Losses only', value: 'loss' }).setRequired(false)
                )
                .addUserOption((opt) => opt.setName('user').setDescription('View another user (admin only)').setRequired(false))
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub !== 'history') return;

        const period = (interaction.options.getString('period') as any) || '30d';
        const typeFilter = (interaction.options.getString('type') as any) || 'all';
        const targetUser = interaction.options.getUser('user');

        // Check if trying to view another user
        let discordId = interaction.user.id;
        let profile: any = null;
        let userId: string | null = null;

        if (targetUser) {
            // Admin check for viewing others
            const requesterLinked = await supabase.getLinkedAccount(interaction.user.id).catch(() => null);
            const requesterProfile = requesterLinked ? await supabase.getUserProfile(requesterLinked.user_id).catch(() => null) : null;
            const isAdmin = Boolean((requesterProfile as any)?.is_admin);
            if (!isAdmin) {
                await interaction.reply({
                    components: [new ContainerBuilder().setAccentColor(VICTUS_COLORS.error).addTextDisplayComponents({ type: 10 as any, content: `# ⛔ Admin only\nYou can only view your own coin history. Admins can view others.` } as any)],
                    flags: V2,
                    ephemeral: true,
                } as any);
                return;
            }
            discordId = targetUser.id;
        }

        await interaction.deferReply({ flags: V2, ephemeral: true } as any);

        try {
            const linked = await supabase.getLinkedAccount(discordId).catch(() => null);
            if (!linked?.user_id) {
                const container = new ContainerBuilder()
                    .setAccentColor(VICTUS_COLORS.warning)
                    .addTextDisplayComponents({
                        type: 10 as any,
                        content: `# 🔗 Link Required\n<@${discordId}> has not linked their Victus Cloud account.\n\nRun \`/link\` to connect and view coin history.`,
                    } as any);
                await interaction.editReply({ components: [container], flags: V2 } as any);
                return;
            }
            userId = linked.user_id;
            profile = await supabase.getUserProfile(userId).catch(() => null);
            if (!profile) {
                await interaction.editReply({
                    components: [
                        new ContainerBuilder().setAccentColor(VICTUS_COLORS.error).addTextDisplayComponents({ type: 10 as any, content: `# ❌ Profile not found\nCould not load profile for <@${discordId}>.` } as any),
                    ],
                    flags: V2,
                } as any);
                return;
            }

            const periodDays = PERIODS.find((p) => p.value === period)?.days ?? 30;
            const { txs, currentBalance } = await fetchAllCoinHistory(userId, profile.email, periodDays);

            // Apply type filter
            let filtered = txs;
            if (typeFilter === 'gain') filtered = txs.filter((t) => t.amount > 0);
            else if (typeFilter === 'loss') filtered = txs.filter((t) => t.amount < 0);

            const hasNext = filtered.length > PAGE_SIZE;
            const hasPrev = false;
            const container = buildHistoryContainer(discordId, profile, period, filtered, currentBalance, 0, hasNext, hasPrev);

            await interaction.editReply({ components: [container], flags: V2 } as any);
        } catch (error) {
            logger.error('Coin history command error:', error);
            const msg = error instanceof Error ? error.message : 'An error occurred while fetching coin history.';
            await interaction.editReply({
                components: [new ContainerBuilder().setAccentColor(VICTUS_COLORS.error).addTextDisplayComponents({ type: 10 as any, content: `# ❌ Error\n${msg.slice(0, 2000)}` } as any)],
                flags: V2,
            } as any);
        }
    },

    async handleButton(interaction) {
        const id = interaction.customId;
        if (!id.startsWith('coin:')) return;

        const parts = id.split(':');
        const action = parts[1];
        const owner = parts[2];
        if (owner && interaction.user.id !== owner) {
            await interaction.reply({ content: 'That panel belongs to someone else — run `/coin history` to open your own.', flags: MessageFlags.Ephemeral as any } as any);
            return;
        }

        const discordId = interaction.user.id;

        if (action === 'dash') {
            // Go back to economy dashboard
            const { economyCommand } = await import('./economy.js');
            // Simulate economy dash
            await interaction.update({ components: [new ContainerBuilder().setAccentColor(VICTUS_COLORS.primary).addTextDisplayComponents({ type: 10 as any, content: `# 🏠 Back to Economy\nRun \`/economy\` for your full dashboard.` } as any)], flags: V2 } as any);
            return;
        }

        if (action === 'hist') {
            const period = parts[3] || '30d';
            const page = Math.max(0, parseInt(parts[4] || '0', 10) || 0);
            await interaction.deferUpdate();
            try {
                const linked = await supabase.getLinkedAccount(discordId).catch(() => null);
                if (!linked?.user_id) {
                    await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(VICTUS_COLORS.warning).addTextDisplayComponents({ type: 10 as any, content: `# 🔗 Link Required\nRun \`/link\` to view history.` } as any)], flags: V2 } as any);
                    return;
                }
                const profile = await supabase.getUserProfile(linked.user_id).catch(() => null);
                const periodDays = PERIODS.find((p) => p.value === period)?.days ?? 30;
                const { txs, currentBalance } = await fetchAllCoinHistory(linked.user_id, (profile as any)?.email || '', periodDays);
                const start = page * PAGE_SIZE;
                const hasPrev = page > 0;
                const hasNext = start + PAGE_SIZE < txs.length;
                const container = buildHistoryContainer(discordId, profile, period, txs, currentBalance, page, hasNext, hasPrev);
                await interaction.editReply({ components: [container], flags: V2 } as any);
            } catch (e) {
                logger.error('Coin hist pagination error:', e);
                await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(VICTUS_COLORS.error).addTextDisplayComponents({ type: 10 as any, content: `# ❌ Error\n${(e as Error).message}` } as any)], flags: V2 } as any);
            }
            return;
        }

        if (action === 'refresh') {
            const period = parts[3] || '30d';
            const page = Math.max(0, parseInt(parts[4] || '0', 10) || 0);
            await interaction.deferUpdate();
            try {
                const linked = await supabase.getLinkedAccount(discordId).catch(() => null);
                if (!linked?.user_id) {
                    await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(VICTUS_COLORS.warning).addTextDisplayComponents({ type: 10 as any, content: `# 🔗 Link Required\nRun \`/link\` to view history.` } as any)], flags: V2 } as any);
                    return;
                }
                const profile = await supabase.getUserProfile(linked.user_id).catch(() => null);
                const periodDays = PERIODS.find((p) => p.value === period)?.days ?? 30;
                const { txs, currentBalance } = await fetchAllCoinHistory(linked.user_id, (profile as any)?.email || '', periodDays);
                const start = page * PAGE_SIZE;
                const hasPrev = page > 0;
                const hasNext = start + PAGE_SIZE < txs.length;
                const container = buildHistoryContainer(discordId, profile, period, txs, currentBalance, page, hasNext, hasPrev);
                await interaction.editReply({ components: [container], flags: V2 } as any);
            } catch (e) {
                await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(VICTUS_COLORS.error).addTextDisplayComponents({ type: 10 as any, content: `# ❌ Error\n${(e as Error).message}` } as any)], flags: V2 } as any);
            }
            return;
        }

        if (action === 'filter') {
            const period = parts[3] || '30d';
            const page = Math.max(0, parseInt(parts[4] || '0', 10) || 0);
            const filter = parts[5] || 'all';
            await interaction.deferUpdate();
            try {
                const linked = await supabase.getLinkedAccount(discordId).catch(() => null);
                if (!linked?.user_id) {
                    await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(VICTUS_COLORS.warning).addTextDisplayComponents({ type: 10 as any, content: `# 🔗 Link Required\nRun \`/link\` to view history.` } as any)], flags: V2 } as any);
                    return;
                }
                const profile = await supabase.getUserProfile(linked.user_id).catch(() => null);
                const periodDays = PERIODS.find((p) => p.value === period)?.days ?? 30;
                const { txs, currentBalance } = await fetchAllCoinHistory(linked.user_id, (profile as any)?.email || '', periodDays);
                let filtered = txs;
                if (filter === 'gain') filtered = txs.filter((t) => t.amount > 0);
                else if (filter === 'loss') filtered = txs.filter((t) => t.amount < 0);
                const hasPrev = page > 0;
                const hasNext = page * PAGE_SIZE + PAGE_SIZE < filtered.length;
                const container = buildHistoryContainer(discordId, profile, period, filtered, currentBalance, page, hasNext, hasPrev);
                // Update to show filtered
                // For simplicity, we rebuild with filtered txs but keep period
                await interaction.editReply({ components: [container], flags: V2 } as any);
            } catch (e) {
                await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(VICTUS_COLORS.error).addTextDisplayComponents({ type: 10 as any, content: `# ❌ Error\n${(e as Error).message}` } as any)], flags: V2 } as any);
            }
            return;
        }

        if (action === 'export') {
            const period = parts[3] || '30d';
            await interaction.deferUpdate();
            try {
                const linked = await supabase.getLinkedAccount(discordId).catch(() => null);
                if (!linked?.user_id) {
                    await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(VICTUS_COLORS.warning).addTextDisplayComponents({ type: 10 as any, content: `# 🔗 Link Required\nRun \`/link\` to export history.` } as any)], flags: V2 } as any);
                    return;
                }
                const profile = await supabase.getUserProfile(linked.user_id).catch(() => null);
                const periodDays = PERIODS.find((p) => p.value === period)?.days ?? 30;
                const { txs } = await fetchAllCoinHistory(linked.user_id, (profile as any)?.email || '', periodDays);
                const csv = [
                    'id,timestamp,amount,source,description,running_balance',
                    ...txs.map((t) => `${t.id},${t.ts},${t.amount},${t.source},"${t.description.replace(/"/g, '""')}",${t.runningBalance ?? ''}`),
                ].join('\n');
                const buffer = Buffer.from(csv, 'utf-8');
                await interaction.editReply({
                    components: [new ContainerBuilder().setAccentColor(VICTUS_COLORS.success).addTextDisplayComponents({ type: 10 as any, content: `# 📄 Export Ready\nExported **${txs.length}** transactions for **${period}** as CSV.` } as any)],
                    files: [{ attachment: buffer, name: `coin-history-${period}-${Date.now()}.csv` }],
                    flags: V2,
                } as any);
            } catch (e) {
                await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(VICTUS_COLORS.error).addTextDisplayComponents({ type: 10 as any, content: `# ❌ Export failed\n${(e as Error).message}` } as any)], flags: V2 } as any);
            }
            return;
        }
    },

    async handleSelectMenu(interaction) {
        const id = interaction.customId;
        if (!id.startsWith('coin:period:')) return;
        const owner = id.split(':')[2];
        if (interaction.user.id !== owner) {
            await interaction.reply({ content: 'That panel belongs to someone else — run `/coin history` to open your own.', flags: MessageFlags.Ephemeral as any } as any);
            return;
        }
        const period = interaction.values[0] || '30d';
        await interaction.deferUpdate();
        try {
            const discordId = owner;
            const linked = await supabase.getLinkedAccount(discordId).catch(() => null);
            if (!linked?.user_id) {
                await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(VICTUS_COLORS.warning).addTextDisplayComponents({ type: 10 as any, content: `# 🔗 Link Required\nRun \`/link\` to view history.` } as any)], flags: V2 } as any);
                return;
            }
            const profile = await supabase.getUserProfile(linked.user_id).catch(() => null);
            const periodDays = PERIODS.find((p) => p.value === period)?.days ?? 30;
            const { txs, currentBalance } = await fetchAllCoinHistory(linked.user_id, (profile as any)?.email || '', periodDays);
            const hasNext = txs.length > PAGE_SIZE;
            const container = buildHistoryContainer(discordId, profile, period, txs, currentBalance, 0, hasNext, false);
            await interaction.editReply({ components: [container], flags: V2 } as any);
        } catch (e) {
            logger.error('Coin period select error:', e);
            await interaction.editReply({ components: [new ContainerBuilder().setAccentColor(VICTUS_COLORS.error).addTextDisplayComponents({ type: 10 as any, content: `# ❌ Error\n${(e as Error).message}` } as any)], flags: V2 } as any);
        }
    },
};
