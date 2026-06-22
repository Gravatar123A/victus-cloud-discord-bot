import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { ButtonInteraction, ChatInputCommandInteraction, ContainerBuilder } from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { cpDashboardContainer, leaderboardContainer, historyContainer, ECONOMY_PAGE_SIZE } from '../embeds/economy.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;

function notLinkedContainer(): ContainerBuilder {
    return ComponentsV2.warningContainer(
        'Link your Victus Cloud account',
        'Connect your account to see your CP, level, coins and credits.\n\nRun `/link` to get started — it only takes a few seconds.',
    );
}

async function buildDashboard(discordId: string): Promise<ContainerBuilder | null> {
    const linked = await supabase.getLinkedAccount(discordId).catch(() => null);
    if (!linked?.user_id) return null;

    const userId = linked.user_id;
    const [profile, rank, recent] = await Promise.all([
        supabase.getUserProfile(userId).catch(() => null),
        supabase.getCpRank(userId).catch(() => null),
        supabase.getCpTransactions(userId, 5).catch(() => []),
    ]);
    if (!profile) return null;

    const coins = (profile as any).coins ?? (profile as any).free_credits ?? null;
    const credits = (profile as any).credits ?? null;

    return cpDashboardContainer({
        discordId,
        profile,
        rank,
        coins: coins == null ? null : Number(coins),
        credits: credits == null ? null : Number(credits),
        recent: recent || [],
    });
}

export const economyCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('economy')
        .setDescription('Your Victus economy dashboard — CP, level, wallet & leaderboard')
        .setDMPermission(false),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | V2 });
        const dash = await buildDashboard(interaction.user.id);
        await interaction.editReply({ components: [dash ?? notLinkedContainer()], flags: V2 });
    },

    async handleButton(interaction: ButtonInteraction) {
        const id = interaction.customId;
        if (!id.startsWith('econ:')) return;

        const [, view, ownerId, pageRaw] = id.split(':');
        if (ownerId && interaction.user.id !== ownerId) {
            await interaction.reply({
                content: 'That panel belongs to someone else — run `/economy` to open your own.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const discordId = interaction.user.id;
        const page = Math.max(0, parseInt(pageRaw || '0', 10) || 0);

        if (view === 'dash') {
            const dash = await buildDashboard(discordId);
            await interaction.update({ components: [dash ?? notLinkedContainer()], flags: V2 });
            return;
        }

        const linked = await supabase.getLinkedAccount(discordId).catch(() => null);
        if (!linked?.user_id) {
            await interaction.update({ components: [notLinkedContainer()], flags: V2 });
            return;
        }
        const userId = linked.user_id;

        if (view === 'lb') {
            const [rows, viewerRank, profile] = await Promise.all([
                supabase.getCpLeaderboard(ECONOMY_PAGE_SIZE, page * ECONOMY_PAGE_SIZE).catch(() => []),
                supabase.getCpRank(userId).catch(() => null),
                supabase.getUserProfile(userId).catch(() => null),
            ]);
            await interaction.update({
                components: [
                    leaderboardContainer({
                        discordId,
                        rows,
                        page,
                        viewerId: userId,
                        viewerRank,
                        viewerCp: Number((profile as any)?.total_cp ?? 0),
                    }),
                ],
                flags: V2,
            });
            return;
        }

        if (view === 'hist') {
            const [rows, total] = await Promise.all([
                supabase.getCpTransactions(userId, ECONOMY_PAGE_SIZE, page * ECONOMY_PAGE_SIZE).catch(() => []),
                supabase.getCpTransactionCount(userId).catch(() => 0),
            ]);
            await interaction.update({
                components: [historyContainer({ discordId, rows, page, total })],
                flags: V2,
            });
            return;
        }
    },
};
