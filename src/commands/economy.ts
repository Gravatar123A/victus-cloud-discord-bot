import {
    ActionRowBuilder,
    MessageFlags,
    ModalBuilder,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import type {
    ButtonInteraction,
    ChatInputCommandInteraction,
    ContainerBuilder,
    ModalSubmitInteraction,
    StringSelectMenuInteraction,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import {
    ECONOMY_PAGE_SIZE,
    adminContainer,
    bankContainer,
    confirmContainer,
    convertContainer,
    cpDashboardContainer,
    historyContainer,
    leaderboardContainer,
    resultContainer,
    transferContainer,
} from '../embeds/economy.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;

// Short-lived pending operations awaiting a confirm click.
interface PendingOp {
    expiresAt: number;
    run: (ctx: Ctx) => Promise<{ ok: boolean; title: string; body: string }>;
}
const pending = new Map<string, PendingOp>();
const PENDING_TTL = 5 * 60_000;

function stashOp(run: PendingOp['run']): string {
    const now = Date.now();
    for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k);
    const token = Math.random().toString(36).slice(2, 10);
    pending.set(token, { expiresAt: now + PENDING_TTL, run });
    return token;
}

interface Ctx {
    discordId: string;
    userId: string;
    profile: any;
    isAdmin: boolean;
}

async function loadCtx(discordId: string): Promise<Ctx | null> {
    const linked = await supabase.getLinkedAccount(discordId).catch(() => null);
    if (!linked?.user_id) return null;
    const profile = await supabase.getUserProfile(linked.user_id).catch(() => null);
    if (!profile) return null;
    return { discordId, userId: linked.user_id, profile, isAdmin: Boolean((profile as any).is_admin) };
}

function notLinked(): ContainerBuilder {
    return ComponentsV2.warningContainer(
        'Link your Victus Cloud account',
        'Connect your account to use the economy.\n\nRun `/link` to get started — it only takes a few seconds.',
    );
}

function fmt(n: number | null | undefined): string {
    return Number(n || 0).toLocaleString('en-US');
}

function parseAmount(raw: string): number | null {
    const n = Math.floor(Number(String(raw).replace(/[, ]/g, '')));
    return Number.isFinite(n) && n > 0 ? n : null;
}

function parseDiscordId(raw: string): string | null {
    return (String(raw).match(/\d{15,20}/) || [])[0] || null;
}

// Build a view's container for the hub.
async function buildView(view: string, discordId: string, page = 0): Promise<ContainerBuilder> {
    const ctx = await loadCtx(discordId);
    if (!ctx) return notLinked();
    const { userId, profile, isAdmin } = ctx;

    const coins = (profile as any).coins ?? (profile as any).free_credits ?? null;
    const credits = (profile as any).credits ?? null;

    switch (view) {
        case 'bank':
            return bankContainer(discordId, profile, isAdmin);
        case 'transfer':
            return transferContainer(discordId, profile, isAdmin);
        case 'convert': {
            const rates = await supabase.getEconomyRates().catch(() => []);
            return convertContainer(discordId, rates, profile, credits == null ? null : Number(credits), isAdmin);
        }
        case 'admin':
            return isAdmin ? adminContainer(discordId) : resultContainer(discordId, false, 'Staff only', 'You do not have access to the admin economy controls.', false);
        case 'leaderboard': {
            const [rows, viewerRank] = await Promise.all([
                supabase.getCpLeaderboard(ECONOMY_PAGE_SIZE, page * ECONOMY_PAGE_SIZE).catch(() => []),
                supabase.getCpRank(userId).catch(() => null),
            ]);
            return leaderboardContainer({ discordId, rows, page, viewerId: userId, viewerRank, viewerCp: Number(profile.total_cp ?? 0), isAdmin });
        }
        case 'history': {
            const rows = await supabase.getEconomyLedger(userId, ECONOMY_PAGE_SIZE, page * ECONOMY_PAGE_SIZE).catch(() => []);
            return historyContainer({ discordId, rows, page, hasNext: rows.length >= ECONOMY_PAGE_SIZE, isAdmin });
        }
        case 'wallet':
        default: {
            const [rank, recent] = await Promise.all([
                supabase.getCpRank(userId).catch(() => null),
                supabase.getCpTransactions(userId, 5).catch(() => []),
            ]);
            return cpDashboardContainer({
                discordId,
                profile,
                rank,
                coins: coins == null ? null : Number(coins),
                credits: credits == null ? null : Number(credits),
                recent: recent || [],
                isAdmin,
            });
        }
    }
}

function amountModal(customId: string, title: string, label: string, placeholder = 'e.g. 500'): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title)
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId('amount').setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setRequired(true),
            ),
        );
}

export const economyCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('economy')
        .setDescription('Manage your Victus economy — CP, bank, transfers, conversions, leaderboard & more')
        .setDMPermission(false),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | V2 });
        await interaction.editReply({ components: [await buildView('wallet', interaction.user.id)], flags: V2 });
    },

    async handleSelectMenu(interaction: StringSelectMenuInteraction) {
        const id = interaction.customId;
        if (!id.startsWith('econ:nav:')) return;
        const owner = id.split(':')[2];
        if (interaction.user.id !== owner) {
            await interaction.reply({ content: 'That panel belongs to someone else — run `/economy`.', flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.update({ components: [await buildView(interaction.values[0], owner)], flags: V2 });
    },

    async handleButton(interaction: ButtonInteraction) {
        const id = interaction.customId;
        if (!id.startsWith('econ:')) return;

        const parts = id.split(':');
        const action = parts[1];
        const owner = parts[2];
        if (owner && interaction.user.id !== owner) {
            await interaction.reply({ content: 'That panel belongs to someone else — run `/economy` to open your own.', flags: MessageFlags.Ephemeral });
            return;
        }
        const discordId = interaction.user.id;

        // Navigation / pagination
        if (action === 'dash') return void (await interaction.update({ components: [await buildView('wallet', discordId)], flags: V2 }));
        if (action === 'nav2') return void (await interaction.update({ components: [await buildView(parts[3], discordId)], flags: V2 }));
        if (action === 'lb') return void (await interaction.update({ components: [await buildView('leaderboard', discordId, Math.max(0, parseInt(parts[3] || '0', 10) || 0))], flags: V2 }));
        if (action === 'hist') return void (await interaction.update({ components: [await buildView('history', discordId, Math.max(0, parseInt(parts[3] || '0', 10) || 0))], flags: V2 }));

        // Bank
        if (action === 'bankdep') return interaction.showModal(amountModal(`econ:m:bankdep:${discordId}`, 'Deposit CP', 'Amount of CP to deposit'));
        if (action === 'bankwd') return interaction.showModal(amountModal(`econ:m:bankwd:${discordId}`, 'Withdraw CP', 'Amount of CP to withdraw'));

        // Transfer → modal (recipient + amount + reason)
        if (action === 'xfer') {
            const cur = parts[3];
            const modal = new ModalBuilder()
                .setCustomId(`econ:m:xfer:${discordId}:${cur}`)
                .setTitle(cur === 'cp' ? 'Send CP' : 'Send Credits')
                .addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('to').setLabel('Recipient (@mention or user ID)').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('Amount').setPlaceholder('e.g. 250').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason (optional)').setStyle(TextInputStyle.Short).setRequired(false)),
                );
            return interaction.showModal(modal);
        }

        // Convert → modal (amount)
        if (action === 'conv') return interaction.showModal(amountModal(`econ:m:conv:${discordId}:${parts[3]}`, 'Convert', 'Amount to convert'));

        // Admin
        if (action === 'adjadj') {
            const modal = new ModalBuilder()
                .setCustomId(`econ:m:adjadj:${discordId}`)
                .setTitle('Adjust CP (admin)')
                .addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('to').setLabel('Member (@mention or user ID)').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('delta').setLabel('CP change (e.g. 500 or -200)').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Short).setRequired(false)),
                );
            return interaction.showModal(modal);
        }
        if (action === 'adjfreeze') {
            const freeze = parts[3] === '1';
            const modal = new ModalBuilder()
                .setCustomId(`econ:m:adjfreeze:${discordId}:${freeze ? 1 : 0}`)
                .setTitle(freeze ? 'Freeze account (admin)' : 'Unfreeze account (admin)')
                .addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('to').setLabel('Member (@mention or user ID)').setStyle(TextInputStyle.Short).setRequired(true)),
                );
            return interaction.showModal(modal);
        }

        // Confirm a stashed op
        if (action === 'cfm') {
            const token = parts[3];
            const op = pending.get(token);
            pending.delete(token);
            const ctx = await loadCtx(discordId);
            if (!ctx) return void (await interaction.update({ components: [notLinked()], flags: V2 }));
            if (!op || op.expiresAt < Date.now()) {
                return void (await interaction.update({ components: [resultContainer(discordId, false, 'Expired', 'That confirmation expired — please start again.', ctx.isAdmin)], flags: V2 }));
            }
            const res = await op.run(ctx);
            return void (await interaction.update({ components: [resultContainer(discordId, res.ok, res.title, res.body, ctx.isAdmin)], flags: V2 }));
        }
    },

    async handleModal(interaction: ModalSubmitInteraction) {
        const id = interaction.customId;
        if (!id.startsWith('econ:m:')) return;
        // Our modals are always opened from a message component, so we can update it.
        if (!interaction.isFromMessage()) return;

        const parts = id.split(':');
        const op = parts[2];
        const owner = parts[3];
        if (interaction.user.id !== owner) return;
        const discordId = owner;
        const ctx = await loadCtx(discordId);
        if (!ctx) return void (await interaction.update({ components: [notLinked()], flags: V2 }));

        const val = (key: string) => {
            try { return interaction.fields.getTextInputValue(key); } catch { return ''; }
        };

        // ── Bank deposit / withdraw (direct, low-risk) ──
        if (op === 'bankdep' || op === 'bankwd') {
            const amount = parseAmount(val('amount'));
            if (!amount) return void (await interaction.update({ components: [resultContainer(discordId, false, 'Invalid amount', 'Enter a positive whole number of CP.', ctx.isAdmin)], flags: V2 }));
            const r = await supabase.econBank(ctx.userId, op === 'bankdep' ? 'deposit' : 'withdraw', amount);
            const ok = !!r?.ok;
            const body = ok
                ? `${op === 'bankdep' ? '📥 Deposited' : '📤 Withdrew'} **${fmt(amount)} CP**.\n💼 Wallet: **${fmt(r.wallet)} CP** · 🏦 Bank: **${fmt(r.bank)} CP**`
                : (r?.error || 'Something went wrong.');
            return void (await interaction.update({ components: [resultContainer(discordId, ok, ok ? 'Bank updated' : 'Bank action failed', body, ctx.isAdmin)], flags: V2 }));
        }

        // ── Transfer (confirm) ──
        if (op === 'xfer') {
            const cur = parts[4];
            const amount = parseAmount(val('amount'));
            const toDiscordId = parseDiscordId(val('to'));
            const reason = val('reason')?.slice(0, 140) || undefined;
            if (!amount || !toDiscordId) return void (await interaction.update({ components: [resultContainer(discordId, false, 'Invalid input', 'Enter a valid recipient (@mention or ID) and a positive amount.', ctx.isAdmin)], flags: V2 }));
            if (toDiscordId === discordId) return void (await interaction.update({ components: [resultContainer(discordId, false, 'Invalid recipient', 'You cannot send to yourself.', ctx.isAdmin)], flags: V2 }));
            const toLinked = await supabase.getLinkedAccount(toDiscordId).catch(() => null);
            if (!toLinked?.user_id) return void (await interaction.update({ components: [resultContainer(discordId, false, 'Recipient not linked', `<@${toDiscordId}> has not linked their Victus Cloud account, so they can't receive transfers yet.`, ctx.isAdmin)], flags: V2 }));

            const toUserId = toLinked.user_id;
            const curLabel = cur === 'cp' ? 'CP' : 'Credits';
            const token = stashOp(async () => {
                if (cur === 'cp') {
                    const r = await supabase.econTransferCp(ctx.userId, toUserId, amount, reason);
                    return r?.ok
                        ? { ok: true, title: 'Transfer complete', body: `⭐ Sent **${fmt(amount)} CP** to <@${toDiscordId}>.\nNew balance: **${fmt(r.from_balance)} CP**.` }
                        : { ok: false, title: 'Transfer failed', body: r?.error || 'Something went wrong.' };
                }
                // Credits via Paymenter — debit sender, credit receiver, refund on failure.
                try {
                    await supabase.adjustPaymenterCredits({ user_id: ctx.userId, mode: 'remove', amount });
                } catch (e) {
                    return { ok: false, title: 'Transfer failed', body: (e as Error).message || 'Could not debit your credits.' };
                }
                try {
                    await supabase.adjustPaymenterCredits({ user_id: toUserId, mode: 'add', amount });
                } catch (e) {
                    await supabase.adjustPaymenterCredits({ user_id: ctx.userId, mode: 'add', amount }).catch(() => undefined);
                    return { ok: false, title: 'Transfer failed', body: `Could not credit the recipient — your credits were refunded. (${(e as Error).message})` };
                }
                return { ok: true, title: 'Transfer complete', body: `💳 Sent **${fmt(amount)} Credits** to <@${toDiscordId}>.` };
            });

            return void (await interaction.update({
                components: [confirmContainer(discordId, token, `Send ${fmt(amount)} ${curLabel}?`, `To <@${toDiscordId}>${reason ? `\nReason: ${reason}` : ''}`)],
                flags: V2,
            }));
        }

        // ── Convert (confirm) ──
        if (op === 'conv') {
            const pair = parts[4]; // cp_credits | credits_cp
            const [from, to] = pair.split('_');
            const amount = parseAmount(val('amount'));
            if (!amount) return void (await interaction.update({ components: [resultContainer(discordId, false, 'Invalid amount', 'Enter a positive whole number.', ctx.isAdmin)], flags: V2 }));
            const rates = await supabase.getEconomyRates().catch(() => []);
            const rate = rates.find((r: any) => r.from_currency === from && r.to_currency === to);
            if (!rate) return void (await interaction.update({ components: [resultContainer(discordId, false, 'Unavailable', 'That conversion is not available right now.', ctx.isAdmin)], flags: V2 }));
            if (amount < Number(rate.min_amount)) return void (await interaction.update({ components: [resultContainer(discordId, false, 'Below minimum', `Minimum to convert is **${fmt(rate.min_amount)} ${from.toUpperCase()}**.`, ctx.isAdmin)], flags: V2 }));
            const out = Math.floor(amount * Number(rate.rate));
            if (out <= 0) return void (await interaction.update({ components: [resultContainer(discordId, false, 'Too small', 'That amount converts to 0 — try a larger amount.', ctx.isAdmin)], flags: V2 }));

            const token = stashOp(async () => {
                if (from === 'cp' && to === 'credits') {
                    const spent = await supabase.econSpendCp(ctx.userId, amount, `Convert ${amount} CP → ${out} credits`, { to: 'credits', out });
                    if (!spent?.ok) return { ok: false, title: 'Conversion failed', body: spent?.error || 'Could not deduct CP.' };
                    try {
                        await supabase.adjustPaymenterCredits({ user_id: ctx.userId, mode: 'add', amount: out });
                    } catch (e) {
                        await supabase.econGrantCp(ctx.userId, amount, 'convert_in', 'Refund failed credit conversion').catch(() => undefined);
                        return { ok: false, title: 'Conversion failed', body: `Could not add credits — your CP was refunded. (${(e as Error).message})` };
                    }
                    return { ok: true, title: 'Converted', body: `🔁 **${fmt(amount)} CP → ${fmt(out)} Credits**.\nNew CP balance: **${fmt(spent.balance)} CP**.` };
                }
                // credits → cp
                try {
                    await supabase.adjustPaymenterCredits({ user_id: ctx.userId, mode: 'remove', amount });
                } catch (e) {
                    return { ok: false, title: 'Conversion failed', body: (e as Error).message || 'Could not deduct credits.' };
                }
                const granted = await supabase.econGrantCp(ctx.userId, out, 'convert_in', `Convert ${amount} credits → ${out} CP`, { from: 'credits' });
                if (!granted?.ok) {
                    await supabase.adjustPaymenterCredits({ user_id: ctx.userId, mode: 'add', amount }).catch(() => undefined);
                    return { ok: false, title: 'Conversion failed', body: 'Could not grant CP — your credits were refunded.' };
                }
                return { ok: true, title: 'Converted', body: `🔁 **${fmt(amount)} Credits → ${fmt(out)} CP**.\nNew CP balance: **${fmt(granted.balance)} CP**.` };
            });

            return void (await interaction.update({
                components: [confirmContainer(discordId, token, 'Confirm conversion?', `**${fmt(amount)} ${from.toUpperCase()}** → **${fmt(out)} ${to.toUpperCase()}**\n-# Rate: 1 ${from.toUpperCase()} = ${rate.rate} ${to.toUpperCase()}`)],
                flags: V2,
            }));
        }

        // ── Admin: adjust CP (confirm) ──
        if (op === 'adjadj') {
            if (!ctx.isAdmin) return void (await interaction.update({ components: [resultContainer(discordId, false, 'Staff only', 'You are not an admin.', false)], flags: V2 }));
            const targetDiscordId = parseDiscordId(val('to'));
            const delta = Math.floor(Number(String(val('delta')).replace(/[, ]/g, '')));
            const reason = val('reason')?.slice(0, 140) || undefined;
            if (!targetDiscordId || !Number.isFinite(delta) || delta === 0) {
                return void (await interaction.update({ components: [resultContainer(discordId, false, 'Invalid input', 'Enter a member and a non-zero CP change (e.g. 500 or -200).', true)], flags: V2 }));
            }
            const targetLinked = await supabase.getLinkedAccount(targetDiscordId).catch(() => null);
            if (!targetLinked?.user_id) return void (await interaction.update({ components: [resultContainer(discordId, false, 'Member not linked', `<@${targetDiscordId}> has not linked their account.`, true)], flags: V2 }));
            const targetUserId = targetLinked.user_id;
            const token = stashOp(async () => {
                const r = await supabase.econAdminAdjustCp(ctx.userId, targetUserId, delta, reason);
                return r?.ok
                    ? { ok: true, title: 'Adjustment applied', body: `⚖️ ${delta >= 0 ? 'Added' : 'Removed'} **${fmt(Math.abs(delta))} CP** ${delta >= 0 ? 'to' : 'from'} <@${targetDiscordId}>.\nTheir new balance: **${fmt(r.balance)} CP**.` }
                    : { ok: false, title: 'Adjustment failed', body: r?.error || 'Something went wrong.' };
            });
            return void (await interaction.update({
                components: [confirmContainer(discordId, token, 'Confirm CP adjustment?', `${delta >= 0 ? '➕' : '➖'} **${fmt(Math.abs(delta))} CP** ${delta >= 0 ? 'to' : 'from'} <@${targetDiscordId}>${reason ? `\nReason: ${reason}` : ''}`)],
                flags: V2,
            }));
        }

        // ── Admin: freeze / unfreeze (direct) ──
        if (op === 'adjfreeze') {
            if (!ctx.isAdmin) return void (await interaction.update({ components: [resultContainer(discordId, false, 'Staff only', 'You are not an admin.', false)], flags: V2 }));
            const freeze = parts[4] === '1';
            const targetDiscordId = parseDiscordId(val('to'));
            if (!targetDiscordId) return void (await interaction.update({ components: [resultContainer(discordId, false, 'Invalid input', 'Enter a member (@mention or ID).', true)], flags: V2 }));
            const targetLinked = await supabase.getLinkedAccount(targetDiscordId).catch(() => null);
            if (!targetLinked?.user_id) return void (await interaction.update({ components: [resultContainer(discordId, false, 'Member not linked', `<@${targetDiscordId}> has not linked their account.`, true)], flags: V2 }));
            const r = await supabase.econAdminSetFrozen(ctx.userId, targetLinked.user_id, freeze);
            const ok = !!r?.ok;
            return void (await interaction.update({
                components: [resultContainer(discordId, ok, ok ? (freeze ? 'Account frozen' : 'Account unfrozen') : 'Action failed', ok ? `${freeze ? '🧊 Froze' : '🔥 Unfroze'} <@${targetDiscordId}>'s economy account.` : (r?.error || 'Something went wrong.'), true)],
                flags: V2,
            }));
        }
    },
};
