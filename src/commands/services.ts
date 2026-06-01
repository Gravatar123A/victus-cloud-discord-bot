import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { requireLinked } from '../middleware/requireLinked.js';
import { logger } from '../utils/logger.js';

export const servicesCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('services')
        .setDescription('View your active services'),

    cooldown: 10,

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

        // Check if linked
        const isLinked = await requireLinked(interaction);
        if (!isLinked) return;

        try {
            // Fetch services (placeholder - would use actual Paymenter API)
            const orders = await supabase.getOrders();

            // Transform to service format
            const services = orders.slice(0, 5).map((order: any) => ({
                name: order.product?.name || `Service #${order.id}`,
                status: order.status || 'active',
                price: `$${order.price || '0.00'}/mo`,
                renewsAt: order.renewal_date ? new Date(order.renewal_date).toLocaleDateString() : undefined,
            }));

            const container = ComponentsV2.servicesListContainer(services);

            await interaction.editReply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        } catch (error) {
            logger.error('Failed to fetch services:', error);
            const container = ComponentsV2.errorContainer(
                'Error',
                'Failed to fetch your services. Please try again later.'
            );
            await interaction.editReply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        }
    },
};
