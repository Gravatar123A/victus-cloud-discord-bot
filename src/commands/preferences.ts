/**
 * Victus Cloud — User Preferences Command
 * Manage notification preferences for DMs
 */

import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { requireLinkedAccount } from '../middleware/requireLinked.js';
import { logger } from '../utils/logger.js';

// Custom IDs
const CUSTOM_IDS = {
    TOGGLE_MAINTENANCE: 'pref_toggle_maintenance',
    TOGGLE_BILLING: 'pref_toggle_billing',
    TOGGLE_SECURITY: 'pref_toggle_security',
    TOGGLE_PROMOTIONS: 'pref_toggle_promotions',
} as const;

export const preferencesCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('preferences')
        .setDescription('Manage your notification preferences')
        .addSubcommand(sub =>
            sub
                .setName('notifications')
                .setDescription('Manage DM notification preferences')
        ),

    requiresLink: true,
    cooldown: 10,

    async execute(interaction) {
        const linked = await requireLinkedAccount(interaction);
        if (!linked) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'notifications') {
                await showNotificationPreferences(interaction, linked);
            }
        } catch (error) {
            logger.error('Preferences command error:', error);
            const container = ComponentsV2.errorContainer(
                'Error',
                'Failed to load your preferences.'
            );
            await interaction.editReply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        }
    },

    async handleButton(interaction) {
        const customId = interaction.customId;

        if (!customId.startsWith('pref_toggle_')) return;

        const linked = await requireLinkedAccount(interaction as any);
        if (!linked) return;

        await interaction.deferUpdate();

        try {
            const category = customId.replace('pref_toggle_', '') as 'maintenance' | 'billing' | 'security' | 'promotions';

            // Get current preferences
            let prefs = await supabase.getUserPreferences(interaction.user.id);

            // Toggle the preference
            const currentValue = prefs?.[`dm_${category}`] ?? false;
            const newValue = !currentValue;

            // Update preferences
            await supabase.upsertUserPreferences(interaction.user.id, linked.userId, {
                [`dm_${category}`]: newValue,
            } as any);

            // Refresh display
            await showNotificationPreferences(interaction as any, linked, true);
        } catch (error) {
            logger.error('Preference toggle error:', error);
        }
    },
};

async function showNotificationPreferences(interaction: any, linked: any, isUpdate = false) {
    // Get current preferences
    let prefs = await supabase.getUserPreferences(interaction.user.id);

    // Create default if none exist
    if (!prefs) {
        await supabase.upsertUserPreferences(interaction.user.id, linked.userId, {
            dm_maintenance: false,
            dm_billing: false,
            dm_security: true,
            dm_promotions: false,
        });
        prefs = await supabase.getUserPreferences(interaction.user.id);
    }

    const getStatus = (enabled: boolean) => enabled ? '🟢 Enabled' : '🔴 Disabled';
    const getButtonStyle = (enabled: boolean) => enabled ? ButtonStyle.Success : ButtonStyle.Secondary;

    const container = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.info)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# 🔔 Notification Preferences\n\n` +
                `Manage which types of DM notifications you want to receive from Victus Cloud.\n\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `### 📬 DM Categories\n\n` +
                `🔧 **Maintenance Alerts**\n` +
                `-# Server maintenance, outages, and updates\n` +
                `Status: ${getStatus(prefs?.dm_maintenance)}\n\n` +
                `💳 **Billing Notifications**\n` +
                `-# Invoice reminders, payment confirmations\n` +
                `Status: ${getStatus(prefs?.dm_billing)}\n\n` +
                `🔐 **Security Alerts**\n` +
                `-# Login notifications, security warnings\n` +
                `Status: ${getStatus(prefs?.dm_security)}\n\n` +
                `🎁 **Promotions**\n` +
                `-# Special offers, new features, events\n` +
                `Status: ${getStatus(prefs?.dm_promotions)}\n` +
                `━━━━━━━━━━━━━━━━━━\n\n` +
                `-# Click the buttons below to toggle each category.`
            )
        );

    const buttons1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.TOGGLE_MAINTENANCE)
            .setLabel('Maintenance')
            .setStyle(getButtonStyle(prefs?.dm_maintenance))
            .setEmoji('🔧'),
        new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.TOGGLE_BILLING)
            .setLabel('Billing')
            .setStyle(getButtonStyle(prefs?.dm_billing))
            .setEmoji('💳')
    );

    const buttons2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.TOGGLE_SECURITY)
            .setLabel('Security')
            .setStyle(getButtonStyle(prefs?.dm_security))
            .setEmoji('🔐'),
        new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.TOGGLE_PROMOTIONS)
            .setLabel('Promotions')
            .setStyle(getButtonStyle(prefs?.dm_promotions))
            .setEmoji('🎁')
    );

    container.addActionRowComponents(buttons1);
    container.addActionRowComponents(buttons2);

    if (isUpdate) {
        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    } else {
        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });
    }
}
