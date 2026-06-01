import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { requireLinked } from '../middleware/requireLinked.js';
import { logger } from '../utils/logger.js';

export const invoicesCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('invoices')
        .setDescription('View your invoice history'),

    cooldown: 10,

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

        // Check if linked
        const isLinked = await requireLinked(interaction);
        if (!isLinked) return;

        try {
            // Fetch invoices (placeholder - would use actual Paymenter API)
            const invoicesData = await supabase.getInvoices();

            // Transform to invoice format
            const invoices = invoicesData.slice(0, 5).map((inv: any) => ({
                id: inv.id?.toString() || '—',
                amount: `$${inv.total || inv.amount || '0.00'}`,
                status: inv.status || 'pending',
                date: inv.created_at ? new Date(inv.created_at).toLocaleDateString() : 'Unknown',
            }));

            const container = ComponentsV2.invoiceListContainer(invoices);

            await interaction.editReply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        } catch (error) {
            logger.error('Failed to fetch invoices:', error);
            const container = ComponentsV2.errorContainer(
                'Error',
                'Failed to fetch your invoices. Please try again later.'
            );
            await interaction.editReply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        }
    },
};
