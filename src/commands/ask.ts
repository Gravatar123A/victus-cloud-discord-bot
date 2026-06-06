import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types/index.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { supabase } from '../services/supabase.js';
import { groqAi } from '../services/groqAi.js';
import { logger } from '../utils/logger.js';

export const askCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('ask')
        .setDescription('Ask the Victus Cloud AI assistant a hosting/support question')
        .addStringOption((option) =>
            option
                .setName('question')
                .setDescription('What do you want to ask Victus Cloud AI?')
                .setRequired(true)
                .setMaxLength(1500)
        )
        .addBooleanOption((option) =>
            option
                .setName('public')
                .setDescription('Share the answer in the channel instead of privately')
                .setRequired(false)
        ),

    cooldown: 12,

    async execute(interaction) {
        const question = interaction.options.getString('question', true).trim();
        const publicReply = interaction.options.getBoolean('public') ?? false;
        const flags = publicReply
            ? ComponentsV2.IS_COMPONENTS_V2
            : ComponentsV2.IS_COMPONENTS_V2 | MessageFlags.Ephemeral;

        await interaction.deferReply({ flags });

        if (!groqAi.isEnabled()) {
            await interaction.editReply({
                components: [
                    ComponentsV2.warningContainer(
                        'AI Chat Not Configured',
                        'Groq AI is not enabled yet. Set `GROQ_API_KEY` in the bot environment, then restart and register commands.'
                    ),
                ],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        try {
            const linked = await supabase.getLinkedAccount(interaction.user.id).catch(() => null);
            const profile = linked ? await supabase.getUserProfile(linked.user_id).catch(() => null) : null;
            const answer = await groqAi.askVictus(question, {
                discordTag: interaction.user.tag,
                discordId: interaction.user.id,
                linked: !!linked,
                profile,
                publicReply,
            });

            await interaction.editReply({
                components: [
                    ComponentsV2.aiChatContainer(question, answer, groqAi.model, !!linked),
                ],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        } catch (error) {
            logger.error('Ask command failed:', error);
            await interaction.editReply({
                components: [
                    ComponentsV2.errorContainer(
                        'AI Chat Failed',
                        'The Victus AI assistant could not answer right now. Check the Groq API key, model, base URL, or try again in a moment.'
                    ),
                ],
                flags: ComponentsV2.IS_COMPONENTS_V2,
            });
        }
    },
};
