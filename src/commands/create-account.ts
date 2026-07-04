import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { config } from '../config.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { generateLinkToken, getExpiryTime } from '../utils/tokens.js';
import { Icons } from '../utils/premium.js';
import { logger } from '../utils/logger.js';

export const createAccountCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('create-account')
        .setDescription('Create a Victus Cloud account with Discord and auto-link it'),

    cooldown: 30,

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });

        const existingLink = await supabase.getLinkedAccount(interaction.user.id);
        if (existingLink) {
            await interaction.editReply({
                components: [
                    ComponentsV2.infoContainer(
                        'Account Already Connected',
                        'Your Discord account is already linked to Victus Cloud.\n\nUse `/account` to view your linked profile.'
                    ),
                ],
                flags: ComponentsV2.IS_COMPONENTS_V2,
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
            await interaction.editReply({
                components: [
                    ComponentsV2.errorContainer(
                        'Signup Link Failed',
                        'Could not create your secure signup link. Please try again in a moment.'
                    ),
                ],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        const signupUrl = `${config.branding.website}/discord-signup?token=${token}`;
        const expiryTimestamp = Math.floor(expiresAt.getTime() / 1000);
        const container = ComponentsV2.linkAccountContainer(
            interaction.user.tag,
            interaction.user.displayAvatarURL({ size: 128 }),
            expiryTimestamp,
            signupUrl
        );

        container.addTextDisplayComponents(
            ComponentsV2.text(
                `\n${Icons.spark} **New account flow:** Discord OAuth creates your Victus Cloud account, links it to this Discord user, then sends you to finish the normal profile details.`
            )
        );

        await interaction.editReply({
            components: [container],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        });

        logger.info(`Discord signup token generated for ${interaction.user.tag} (${interaction.user.id})`);
    },
};
