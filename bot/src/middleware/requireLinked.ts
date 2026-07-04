import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Check if user has a linked Victus Cloud account
 * Returns the linked account data if found, null otherwise
 */
export async function requireLinkedAccount(
    interaction: ChatInputCommandInteraction
): Promise<{ userId: string; discordId: string } | null> {
    const linkedAccount = await supabase.getLinkedAccount(interaction.user.id);

    if (!linkedAccount) {
        const container = ComponentsV2.warningContainer(
            'Account Not Linked',
            'You need to link your Discord account to Victus Cloud first.\n\n' +
            'Use `/link` to connect your account.'
        );

        if (interaction.deferred) {
            await interaction.editReply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        } else {
            await interaction.reply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2 | MessageFlags.Ephemeral,
            });
        }
        return null;
    }

    return {
        userId: linkedAccount.user_id,
        discordId: linkedAccount.discord_id,
    };
}

/**
 * Simple requireLinked check (returns boolean)
 */
export async function requireLinked(
    interaction: ChatInputCommandInteraction
): Promise<boolean> {
    const linkedAccount = await supabase.getLinkedAccount(interaction.user.id);

    if (!linkedAccount) {
        const container = ComponentsV2.warningContainer(
            'Account Not Linked',
            'You need to link your Discord account to Victus Cloud first.\n\n' +
            'Use `/link` to connect your account.'
        );

        if (interaction.deferred) {
            await interaction.editReply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        } else {
            await interaction.reply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2 | MessageFlags.Ephemeral,
            });
        }
        return false;
    }

    return true;
}

/**
 * Check if user is an admin
 */
export async function requireAdmin(
    interaction: ChatInputCommandInteraction
): Promise<boolean> {
    const linkedAccount = await requireLinkedAccount(interaction);
    if (!linkedAccount) return false;

    const isAdmin = await supabase.isUserAdmin(linkedAccount.userId);

    if (!isAdmin) {
        const container = ComponentsV2.errorContainer(
            'Permission Denied',
            'You do not have permission to use this command.\n\n' +
            'This command is restricted to administrators.'
        );

        if (interaction.deferred) {
            await interaction.editReply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        } else {
            await interaction.reply({
                components: [container],
                flags: ComponentsV2.IS_COMPONENTS_V2 | MessageFlags.Ephemeral,
            });
        }
        return false;
    }

    return true;
}

/**
 * Get linked account or null (without responding)
 */
export async function getLinkedAccount(
    discordId: string
): Promise<{ userId: string; discordId: string } | null> {
    const linkedAccount = await supabase.getLinkedAccount(discordId);
    if (!linkedAccount) return null;

    return {
        userId: linkedAccount.user_id,
        discordId: linkedAccount.discord_id,
    };
}
