import {
    SlashCommandBuilder,
    ChannelType,
    PermissionFlagsBits,
    ChatInputCommandInteraction,
    MessageFlags,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { createTicketPanel, handlePanelSpawn, memberHasTicketStaffAccess } from './ticket.js';
import { logger } from '../utils/logger.js';

export async function executeTicketPanel(interaction: ChatInputCommandInteraction) {
    const targetChannel = interaction.options.getChannel('channel') as any;
    const isEphemeralRequested = interaction.options.getBoolean('ephemeral') || false;

    const guildId = interaction.guildId;
    if (!guildId) {
        await interaction.reply({
            content: 'This command can only be used inside a server.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const settings = await supabase.getBotSettings(guildId).catch(() => null);
    const isStaff = memberHasTicketStaffAccess(interaction, settings);

    // If a regular user runs this, or if explicitly requested as ephemeral
    if (!isStaff || isEphemeralRequested) {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral | (ComponentsV2 as any).IS_COMPONENTS_V2,
        });

        const categories = await supabase.getTicketCategories(guildId);
        if (!categories || categories.length === 0) {
            const errorBox = ComponentsV2.warningContainer(
                'No Categories Available',
                'No active ticket categories were found. Please notify a server administrator.'
            );
            await interaction.editReply({
                components: [errorBox],
                flags: (ComponentsV2 as any).IS_COMPONENTS_V2,
            });
            return;
        }

        const panel = createTicketPanel(categories);
        await interaction.editReply({
            components: [panel],
            flags: (ComponentsV2 as any).IS_COMPONENTS_V2,
        });
        return;
    }

    // Staff / Admin: Post or refresh the ticket panel in the designated channel
    await interaction.deferReply({
        flags: MessageFlags.Ephemeral | (ComponentsV2 as any).IS_COMPONENTS_V2,
    });

    const destination = targetChannel || interaction.channel;
    if (!destination || !destination.isTextBased?.()) {
        const errorBox = ComponentsV2.errorContainer(
            'Invalid Target Channel',
            'Please select a valid text channel where the ticket panel can be posted.'
        );
        await interaction.editReply({
            components: [errorBox],
            flags: (ComponentsV2 as any).IS_COMPONENTS_V2,
        });
        return;
    }

    try {
        await handlePanelSpawn(interaction, destination);
    } catch (err: any) {
        logger.error('Failed to spawn ticket panel via /ticketpanel:', err);
        const errorBox = ComponentsV2.errorContainer(
            'Panel Spawn Failed',
            'Could not post ticket panel: ' + (err?.message || 'Unknown error')
        );
        await interaction.editReply({
            components: [errorBox],
            flags: (ComponentsV2 as any).IS_COMPONENTS_V2,
        });
    }
}

export const ticketPanelCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('ticketpanel')
        .setDescription('Open or spawn the Victus Cloud ticket panel')
        .setDMPermission(false)
        .addChannelOption(opt =>
            opt
                .setName('channel')
                .setDescription('Text channel to post the official ticket panel into (Staff only)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false)
        )
        .addBooleanOption(opt =>
            opt
                .setName('ephemeral')
                .setDescription('View the ticket panel privately for yourself')
                .setRequired(false)
        ),

    cooldown: 5,

    async execute(interaction) {
        await executeTicketPanel(interaction);
    },
};

export const ticketPanelAliasCommand: Command = {
    ...ticketPanelCommand,
    data: new SlashCommandBuilder()
        .setName('ticektpanel')
        .setDescription('Alias for /ticketpanel — Open or spawn the Victus Cloud ticket panel')
        .setDMPermission(false)
        .addChannelOption(opt =>
            opt
                .setName('channel')
                .setDescription('Text channel to post the official ticket panel into (Staff only)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false)
        )
        .addBooleanOption(opt =>
            opt
                .setName('ephemeral')
                .setDescription('View the ticket panel privately for yourself')
                .setRequired(false)
        ),
};
