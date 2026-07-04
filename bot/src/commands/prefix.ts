import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;

export const prefixCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('prefix')
        .setDescription('View the current command prefix for this server')
        .setDMPermission(false),

    async execute(interaction) {
        await interaction.deferReply();
        const settings = await supabase.getBotSettings(interaction.guildId!).catch(() => null);
        const prefix = settings?.prefix || '!';

        const container = ComponentsV2.infoContainer(
            'Server Prefix',
            `The command prefix for this server is: **\`${prefix}\`**\n\nYou can also mention me (e.g., <@${interaction.client.user?.id}>) to run commands!`
        );

        await interaction.editReply({
            components: [container],
            flags: V2,
        });
    },
};

export const setprefixCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('setprefix')
        .setDescription('Set the command prefix for this server')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption((o) =>
            o.setName('prefix')
                .setDescription('The new prefix (1 to 5 characters, e.g., ?, !, $, v!)')
                .setRequired(true)
                .setMaxLength(5)
        ),

    async execute(interaction) {
        const newPrefix = interaction.options.getString('prefix', true).trim();

        if (newPrefix.length < 1 || newPrefix.length > 5) {
            const container = ComponentsV2.warningContainer(
                'Invalid Prefix',
                'The prefix must be between 1 and 5 characters long.'
            );
            await interaction.reply({
                components: [container],
                flags: V2 | MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply();

        try {
            const success = await supabase.updateBotSettings(interaction.guildId!, {
                prefix: newPrefix,
            });

            if (success) {
                const container = ComponentsV2.successContainer(
                    'Prefix Updated',
                    `The command prefix for this server has been set to: **\`${newPrefix}\`**`
                );
                await interaction.editReply({
                    components: [container],
                    flags: V2,
                });
            } else {
                const container = ComponentsV2.errorContainer(
                    'System Error',
                    'Failed to update prefix settings. Please check database configuration.'
                );
                await interaction.editReply({
                    components: [container],
                    flags: V2,
                });
            }
        } catch (error) {
            logger.error('Failed to set prefix:', error);
            const container = ComponentsV2.errorContainer(
                'System Error',
                'An error occurred while saving the prefix settings.'
            );
            await interaction.editReply({
                components: [container],
                flags: V2,
            });
        }
    },
};
