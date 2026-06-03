import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { requireLinkedAccount } from '../middleware/requireLinked.js';
import { logger } from '../utils/logger.js';

export const invoicesCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('invoices')
        .setDescription('View your Victus Cloud invoice history'),

    cooldown: 10,

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

        const linked = await requireLinkedAccount(interaction);
        if (!linked) return;

        try {
            const profile = await supabase.getUserProfile(linked.userId);
            const invoicesData = await supabase.getInvoices();
            const email = profile?.email?.toLowerCase();
            const billingUser = email ? await supabase.getBillingUserByEmail(email) : null;
            const billingUserId = String(billingUser?.id || billingUser?.attributes?.id || '');
            const userInvoices = email
                ? invoicesData.filter((invoice: any) => {
                    const invoiceEmail = String(invoice.user?.email || invoice.email || invoice.customer_email || '').toLowerCase();
                    const userId = String(invoice.user_id || invoice.customer_id || invoice.user?.id || '');
                    return invoiceEmail === email || (billingUserId && userId === billingUserId);
                })
                : [];

            const invoices = userInvoices.slice(0, 8).map((invoice: any) => ({
                id: invoice.id?.toString() || '-',
                amount: `$${invoice.total || invoice.amount || '0.00'}`,
                status: invoice.status || 'pending',
                date: invoice.created_at ? new Date(invoice.created_at).toLocaleDateString() : 'Unknown',
            }));

            await interaction.editReply({
                components: [ComponentsV2.invoiceListContainer(invoices)],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        } catch (error) {
            logger.error('Failed to fetch invoices:', error);
            await interaction.editReply({
                components: [ComponentsV2.errorContainer('Invoice Sync Failed', 'Could not fetch your invoices right now.')],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        }
    },
};
