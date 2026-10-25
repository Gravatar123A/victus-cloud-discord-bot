import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { groqAi } from '../services/groqAi.js';
import { loadAiImages } from '../services/aiImages.js';
import { victusAiActions } from '../services/victusAiActions.js';
import { logger } from '../utils/logger.js';
import { formatAiMessage } from '../utils/aiMessages.js';
import { aiConversationMemory } from '../services/aiConversationMemory.js';
import { getAiMemory, recordAiTurn } from '../services/victusAiContext.js';
import { victusAiConfigured } from '../services/victusAiCompletion.js';
import { config } from '../config.js';

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
        .addAttachmentOption((option) =>
            option
                .setName('image')
                .setDescription('Optional screenshot or image for Victus AI to inspect')
                .setRequired(false)
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
        const attachment = interaction.options.getAttachment('image');

        if (publicReply) {
            await interaction.deferReply();
        } else {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }

        if (!victusAiConfigured()) {
            await interaction.editReply({
                content: 'AI chat is not configured yet. Set `OPENROUTER_API_KEY` in the bot environment.',
            });
            return;
        }

        try {
            const images = attachment ? await loadAiImages([attachment]) : [];
            if (attachment && !images.length) throw new Error('Use a PNG, JPG, or WebP image for AI support.');
            const actionResult = images.length ? { handled: false as const } : await victusAiActions.tryHandle(question, {
                discordId: interaction.user.id,
                publicReply,
            });

            if (actionResult.handled) {
                let content = actionResult.content;
                if (publicReply && actionResult.dmContent) {
                    const dmSent = await interaction.user.send({
                        content: formatAiMessage(actionResult.dmContent),
                    }).then(() => true).catch(() => false);

                    if (!dmSent) {
                        content = 'That is private account info, so DM me for the answer. I could not open DMs with you from here.';
                    }
                } else if (!publicReply && actionResult.dmContent) {
                    content = actionResult.dmContent;
                }

                await interaction.editReply({
                    content: formatAiMessage(content),
                });
                const actionSession = aiConversationMemory.getSessionId(
                    interaction.channelId || interaction.user.id, interaction.user.id, !interaction.guildId, false);
                const actionScope = publicReply ? 'public' : 'private';
                void recordAiTurn(interaction.user.id, actionSession, actionScope, 'user', question).catch((error) =>
                    logger.warn('Victus AI memory write failed:', error));
                void recordAiTurn(interaction.user.id, actionSession, actionScope, 'assistant', content).catch((error) =>
                    logger.warn('Victus AI memory write failed:', error));
                return;
            }

            const isDm = !interaction.guildId;
            const channelId = interaction.channelId || interaction.user.id;
            const sessionId = aiConversationMemory.getSessionId(channelId, interaction.user.id, isDm, false);
            const history = aiConversationMemory.getHistory(sessionId);
            const scope = publicReply ? 'public' : 'private';
            const memory = await getAiMemory(interaction.user.id, sessionId, scope, question).catch(() => '');

            const linked = await supabase.getLinkedAccount(interaction.user.id).catch(() => null);
            const profile = linked ? await supabase.getUserProfile(linked.user_id).catch(() => null) : null;
            const answer = await groqAi.askVictus(question, {
                discordTag: interaction.user.tag,
                discordId: interaction.user.id,
                linked: !!linked,
                profile,
                publicReply,
                channelName: (interaction.channel as any)?.name,
                guildName: interaction.guild?.name,
                guildId: interaction.guildId || config.bot.supportGuildId,
                history,
                memory,
                images,
            });

            aiConversationMemory.addTurn(sessionId, 'user', question);
            aiConversationMemory.addTurn(sessionId, 'assistant', answer);
            await recordAiTurn(interaction.user.id, sessionId, scope, 'user', question).catch((error) =>
                logger.warn('Victus AI memory write failed:', error));
            await recordAiTurn(interaction.user.id, sessionId, scope, 'assistant', answer).catch((error) =>
                logger.warn('Victus AI memory write failed:', error));

            await interaction.editReply({
                content: formatAiMessage(answer),
            });
        } catch (error) {
            logger.error('Ask command failed:', error);
            const reason = error instanceof Error ? error.message : '';
            await interaction.editReply({
                content: /^(Use a PNG|Each AI image|The image must|Could not download an attached image|Could not read an attached image|An attached image)/.test(reason)
                    ? reason
                    : 'AI chat failed right now. Please try again or open a support ticket.',
            });
        }
    },
};
