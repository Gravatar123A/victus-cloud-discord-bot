import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { config } from '../config.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { generateLinkToken, getExpiryTime } from '../utils/tokens.js';
import { logger } from '../utils/logger.js';

const LINK_PANEL_BUTTON = 'victus_link_panel_start';

function canManageLinkPanel(interaction: { memberPermissions: any }) {
    return Boolean(
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    );
}

async function createPersonalLinkReply(interaction: ButtonInteraction) {
    const existingLink = await supabase.getLinkedAccount(interaction.user.id);
    if (existingLink) {
        await interaction.reply({
            components: [
                ComponentsV2.infoContainer(
                    'Already Connected',
                    'Your Discord account is already linked to a Victus Cloud account.\n\nUse `/account` to view your account status.'
                ),
            ],
            flags: ComponentsV2.IS_COMPONENTS_V2 | MessageFlags.Ephemeral,
        });
        return;
    }

    const token = generateLinkToken();
    const expiresAt = getExpiryTime(config.bot.linkTokenExpiryMinutes);
    const linkToken = await supabase.createLinkToken(
        interaction.user.id,
        interaction.user.tag,
        token,
        expiresAt
    );

    if (!linkToken) {
        await interaction.reply({
            components: [
                ComponentsV2.errorContainer(
                    'Link Token Failed',
                    'Could not create your secure link token. Please try again in a moment.'
                ),
            ],
            flags: ComponentsV2.IS_COMPONENTS_V2 | MessageFlags.Ephemeral,
        });
        return;
    }

    const linkUrl = `${config.branding.website}/discord-link?token=${token}`;
    const expiryTimestamp = Math.floor(expiresAt.getTime() / 1000);
    const container = ComponentsV2.linkAccountContainer(
        interaction.user.tag,
        interaction.user.displayAvatarURL({ size: 128 }),
        expiryTimestamp,
        linkUrl
    );

    await interaction.reply({
        components: [container],
        flags: ComponentsV2.IS_COMPONENTS_V2 | MessageFlags.Ephemeral,
    });

    logger.info(`Link panel token generated for ${interaction.user.tag} (${interaction.user.id})`);
}

export async function postLinkPanel(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!canManageLinkPanel(interaction)) {
        await interaction.editReply({
            content: 'You need the **Manage Server** permission to post the Victus Cloud link panel.',
        });
        return;
    }

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(LINK_PANEL_BUTTON)
            .setLabel('Link Victus Account')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setLabel('Open Victus Cloud')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.website)
    );

    if (!interaction.channel || !('send' in interaction.channel)) {
        await interaction.editReply({
            content: 'I cannot post a link panel in this channel.',
        });
        return;
    }

    const panelEmbed = new EmbedBuilder()
        .setColor(ComponentsV2.Accents.primary)
        .setTitle('Link Your Victus Cloud Account')
        .setDescription(
            'Connect your Discord account to Victus Cloud to unlock account commands, server access, billing visibility, support tickets, and private notifications.\n\n' +
            '**How it works**\n' +
            '1. Click **Link Victus Account** below\n' +
            '2. Log in to the Victus Cloud website\n' +
            '3. Confirm the Discord connection\n\n' +
            'Each click creates a private, expiring link just for that Discord user.'
        )
        .setThumbnail(config.branding.logo)
        .setFooter({ text: 'Victus Cloud' });

    try {
        await interaction.channel.send({ embeds: [panelEmbed], components: [buttons] });
    } catch (error: any) {
        logger.error('Failed to send link panel:', error);
        if (error?.errors) logger.error('Validation details:', JSON.stringify(error.errors, null, 2));
        await interaction.editReply('Discord rejected the link panel message. Please check my channel permissions and try again.');
        return;
    }

    await interaction.editReply({
        content: 'Link panel posted in this channel.',
    });
}

export const linkPanelCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('link-panel')
        .setDescription('Post a Victus Cloud account-linking panel with a one-click link button')
        .setDMPermission(false),

    cooldown: 20,

    async execute(interaction) {
        await postLinkPanel(interaction);
    },

    async handleButton(interaction) {
        if (interaction.customId !== LINK_PANEL_BUTTON) return;
        await createPersonalLinkReply(interaction);
    },
};

export const linkPanelAliasCommand: Command = {
    ...linkPanelCommand,
    data: new SlashCommandBuilder()
        .setName('linkpanel')
        .setDescription('Alias for /link-panel, posts the Victus Cloud account-linking panel')
        .setDMPermission(false),
};
