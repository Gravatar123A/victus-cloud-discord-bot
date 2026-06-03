import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { requireLinkedAccount } from '../middleware/requireLinked.js';
import { logger } from '../utils/logger.js';

export const servicesCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('services')
        .setDescription('View your active Victus Cloud services'),

    cooldown: 10,

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

        const linked = await requireLinkedAccount(interaction);
        if (!linked) return;

        try {
            const profile = await supabase.getUserProfile(linked.userId);
            const orders = await supabase.getOrders();
            const email = profile?.email?.toLowerCase();
            const billingUser = email ? await supabase.getBillingUserByEmail(email) : null;
            const billingUserId = String(billingUser?.id || billingUser?.attributes?.id || '');
            const userOrders = email
                ? orders.filter((order: any) => {
                    const orderEmail = String(order.user?.email || order.email || order.customer_email || '').toLowerCase();
                    const userId = String(order.user_id || order.customer_id || order.user?.id || '');
                    return orderEmail === email || (billingUserId && userId === billingUserId);
                })
                : [];

            const services = userOrders.slice(0, 8).map((order: any) => ({
                name: order.product?.name || order.product_name || `Service #${order.id}`,
                status: order.status || 'active',
                price: `$${order.price || order.total || '0.00'}/mo`,
                renewsAt: order.renewal_date || order.due_date
                    ? new Date(order.renewal_date || order.due_date).toLocaleDateString()
                    : undefined,
            }));

            await interaction.editReply({
                components: [ComponentsV2.servicesListContainer(services)],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        } catch (error) {
            logger.error('Failed to fetch services:', error);
            await interaction.editReply({
                components: [ComponentsV2.errorContainer('Service Sync Failed', 'Could not fetch your services right now.')],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        }
    },
};
