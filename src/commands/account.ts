import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { requireLinkedAccount } from '../middleware/requireLinked.js';
import { config } from '../config.js';
import { Icons } from '../utils/premium.js';
import { logger } from '../utils/logger.js';

export const accountCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('account')
        .setDescription('View your Victus Cloud account, credits, services, and server status'),

    requiresLink: true,
    cooldown: 10,

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

        const linked = await requireLinkedAccount(interaction);
        if (!linked) return;

        try {
            const profile = await supabase.getUserProfile(linked.userId);
            const [creditBalance, servers, history] = await Promise.all([
                supabase.getCreditBalance(profile),
                profile?.email ? supabase.getUserServers(profile.email) : Promise.resolve([]),
                supabase.getUserHistory(linked.userId),
            ]);

            const container = ComponentsV2.userInfoContainer(
                interaction.user.tag,
                interaction.user.id,
                true,
                profile,
                servers,
                history,
                creditBalance
            );

            const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setLabel('Billing')
                    .setStyle(ButtonStyle.Link)
                    .setURL(config.branding.billing)
                    .setEmoji(Icons.credits),
                new ButtonBuilder()
                    .setLabel('Game Panel')
                    .setStyle(ButtonStyle.Link)
                    .setURL(config.branding.panel)
                    .setEmoji(Icons.panel),
                new ButtonBuilder()
                    .setLabel('Website')
                    .setStyle(ButtonStyle.Link)
                    .setURL(config.branding.website)
                    .setEmoji(Icons.brand)
            );

            container.addActionRowComponents(buttons);

            await interaction.editReply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        } catch (error) {
            logger.error('Account command error:', error);
            await interaction.editReply({
                components: [ComponentsV2.errorContainer('Account Sync Failed', 'Could not load your Victus account right now.')],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        }
    },
};
