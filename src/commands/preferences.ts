/**
 * Victus Cloud user notification preferences.
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

const CUSTOM_IDS = {
    TOGGLE_MAINTENANCE: 'pref_toggle_maintenance',
    TOGGLE_BILLING: 'pref_toggle_billing',
    TOGGLE_SECURITY: 'pref_toggle_security',
    TOGGLE_PROMOTIONS: 'pref_toggle_promotions',
} as const;

const DEFAULT_PREFS = {
    dm_maintenance: true,
    dm_billing: true,
    dm_security: true,
    dm_promotions: true,
};

type PreferenceCategory = 'maintenance' | 'billing' | 'security' | 'promotions';

export const preferencesCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('preferences')
        .setDescription('Manage your notification preferences')
        .addSubcommand(sub =>
            sub
                .setName('notifications')
                .setDescription('Manage Discord DM notification preferences')
        ),

    requiresLink: true,
    cooldown: 10,

    async execute(interaction) {
        const linked = await requireLinkedAccount(interaction);
        if (!linked) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

        try {
            await showNotificationPreferences(interaction, linked);
        } catch (error) {
            logger.error('Preferences command error:', error);
            await interaction.editReply({
                components: [ComponentsV2.errorContainer('Error', 'Failed to load your preferences.')],
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
            const category = customId.replace('pref_toggle_', '') as PreferenceCategory;
            const prefs = await supabase.getUserPreferences(interaction.user.id);
            const resolvedPrefs = { ...DEFAULT_PREFS, ...(prefs || {}) };
            const key = `dm_${category}` as keyof typeof DEFAULT_PREFS;

            await supabase.upsertUserPreferences(interaction.user.id, linked.userId, {
                ...resolvedPrefs,
                [key]: !resolvedPrefs[key],
            });

            await showNotificationPreferences(interaction as any, linked, true);
        } catch (error) {
            logger.error('Preference toggle error:', error);
        }
    },
};

async function showNotificationPreferences(interaction: any, linked: any, isUpdate = false) {
    let prefs = await supabase.getUserPreferences(interaction.user.id);

    if (!prefs) {
        await supabase.upsertUserPreferences(interaction.user.id, linked.userId, DEFAULT_PREFS);
        prefs = await supabase.getUserPreferences(interaction.user.id);
    }

    const resolvedPrefs = { ...DEFAULT_PREFS, ...(prefs || {}) };
    const getStatus = (enabled: boolean) => enabled ? 'Enabled' : 'Disabled';
    const getButtonStyle = (enabled: boolean) => enabled ? ButtonStyle.Success : ButtonStyle.Secondary;

    const container = new ContainerBuilder()
        .setAccentColor(ComponentsV2.Accents.info)
        .addTextDisplayComponents(
            ComponentsV2.text(
                `# Notification Preferences\n\n` +
                `Choose which Victus Cloud notifications you want in Discord DMs.\n\n` +
                `### DM Categories\n\n` +
                `**Maintenance Alerts**\n` +
                `Server maintenance, outages, node updates, and service-impact notices.\n` +
                `Status: **${getStatus(resolvedPrefs.dm_maintenance)}**\n\n` +
                `**Billing Notifications**\n` +
                `New invoices, pending invoices, payment reminders, and payment confirmations.\n` +
                `Status: **${getStatus(resolvedPrefs.dm_billing)}**\n\n` +
                `**Security Alerts**\n` +
                `Account linking, unlinking, role sync, login/security warnings, and account changes.\n` +
                `Status: **${getStatus(resolvedPrefs.dm_security)}**\n\n` +
                `**Promotions & Updates**\n` +
                `Special offers, new features, events, and community updates.\n` +
                `Status: **${getStatus(resolvedPrefs.dm_promotions)}**\n\n` +
                `Default: every category is enabled until you turn it off.`
            )
        );

    const buttons1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.TOGGLE_MAINTENANCE)
            .setLabel('Maintenance')
            .setStyle(getButtonStyle(resolvedPrefs.dm_maintenance)),
        new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.TOGGLE_BILLING)
            .setLabel('Billing')
            .setStyle(getButtonStyle(resolvedPrefs.dm_billing))
    );

    const buttons2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.TOGGLE_SECURITY)
            .setLabel('Security')
            .setStyle(getButtonStyle(resolvedPrefs.dm_security)),
        new ButtonBuilder()
            .setCustomId(CUSTOM_IDS.TOGGLE_PROMOTIONS)
            .setLabel('Promotions')
            .setStyle(getButtonStyle(resolvedPrefs.dm_promotions))
    );

    container.addActionRowComponents(buttons1);
    container.addActionRowComponents(buttons2);

    await interaction.editReply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2,
    });
}
