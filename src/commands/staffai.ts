import {
    GuildMember,
    MessageFlags,
    SlashCommandBuilder,
    ThreadAutoArchiveDuration,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { antigravityPipeline } from '../services/antigravityPipeline.js';
import {
    createProcessingEmbed,
    createResultEmbeds,
    createUnauthorizedEmbed,
} from '../embeds/antigravityEmbeds.js';
import { logger } from '../utils/logger.js';

export const staffaiCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('staffai')
        .setDescription('Execute tasks and interact with Antigravity AI (Staff only)')
        .addStringOption((opt) =>
            opt
                .setName('task')
                .setDescription('The instruction, code change, question, or workspace task for Antigravity')
                .setRequired(true)
                .setMaxLength(2000)
        )
        .addAttachmentOption((opt) =>
            opt
                .setName('attachment')
                .setDescription('Optional image, screenshot, or file to attach for Antigravity vision inspection')
                .setRequired(false)
        )
        .addBooleanOption((opt) =>
            opt
                .setName('thread')
                .setDescription('Create a dedicated thread for interactive conversation (default: true)')
                .setRequired(false)
        )
        .addBooleanOption((opt) =>
            opt
                .setName('new_session')
                .setDescription('Start a fresh Antigravity session and clear previous memory')
                .setRequired(false)
        ),

    cooldown: 3,

    async execute(interaction) {
        const member = interaction.member as GuildMember | null;

        // Verify Staff Authorization
        if (!antigravityPipeline.isAuthorized(member)) {
            await interaction.reply({
                embeds: [createUnauthorizedEmbed()],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const task = interaction.options.getString('task', true).trim();
        const attachment = interaction.options.getAttachment('attachment');
        const shouldCreateThread = interaction.options.getBoolean('thread') ?? true;
        const forceNewSession = interaction.options.getBoolean('new_session') ?? false;

        // Defer interaction
        await interaction.deferReply();

        const channel = interaction.channel;
        const isAlreadyThread = channel?.isThread() ?? false;

        let workingChannelId = interaction.channelId;
        let threadTarget: any = null;

        const processingEmbed = createProcessingEmbed(task, interaction.user.tag, !!attachment);
        const replyMsg = await interaction.editReply({
            embeds: [processingEmbed],
        });

        // If not already in a thread and thread option is true, create one for clean back-and-forth chat
        if (!isAlreadyThread && shouldCreateThread && 'startThread' in replyMsg) {
            try {
                const threadTitle = `staffai-${task.slice(0, 30).replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}` || 'staffai-task';
                threadTarget = await replyMsg.startThread({
                    name: threadTitle.slice(0, 95),
                    autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
                    reason: `Staff Antigravity interactive workspace pipeline by ${interaction.user.tag}`,
                });
                workingChannelId = threadTarget.id;
            } catch (threadErr) {
                logger.warn('[StaffAI] Could not create thread, falling back to channel:', threadErr);
            }
        }

        try {
            const result = await antigravityPipeline.executeTask({
                prompt: task,
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                channelOrThreadId: workingChannelId,
                attachments: attachment ? [attachment] : undefined,
                forceNewSession,
            });

            const { embeds, components } = createResultEmbeds(result, {
                task,
                userTag: interaction.user.tag,
            });

            // If we created a thread, send the result directly inside the thread and update the root message
            if (threadTarget) {
                await interaction.editReply({
                    content: `🧵 Antigravity pipeline thread created: <#${threadTarget.id}>`,
                    embeds: [
                        createProcessingEmbed(task, interaction.user.tag, !!attachment)
                            .setTitle('🟢 Thread Spawned')
                            .setDescription(`The task has been routed into <#${threadTarget.id}> for continuous work & questions.`),
                    ],
                });

                try {
                    await threadTarget.send({
                        embeds,
                        components,
                    });
                } catch (sendErr: any) {
                    logger.warn('[StaffAI] Could not post result in thread, falling back to main message:', sendErr);
                    await interaction.followUp({
                        embeds,
                        components,
                    });
                }
            } else {
                // Otherwise edit the main interaction reply
                await interaction.editReply({
                    embeds,
                    components,
                });
            }
        } catch (error: any) {
            logger.error('[StaffAI] Execution exception:', error);
            await interaction.editReply({
                content: `❌ **Antigravity Pipeline Error:** ${error?.message || 'An unexpected error occurred during execution.'}`,
            });
        }
    },

    async handleButton(interaction) {
        if (!['staffai_new_session', 'staffai_clear_session'].includes(interaction.customId)) {
            return;
        }

        const member = interaction.member as GuildMember | null;
        if (!antigravityPipeline.isAuthorized(member)) {
            await interaction.reply({
                embeds: [createUnauthorizedEmbed()],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        antigravityPipeline.clearSession(interaction.channelId);

        if (interaction.customId === 'staffai_new_session') {
            await interaction.reply({
                content: '🆕 **Antigravity Session Reset:** Memory cleared for this channel/thread. Next command or message will start a fresh session.',
                flags: MessageFlags.Ephemeral,
            });
        } else {
            await interaction.reply({
                content: '🧹 **Session Cleared:** Memory removed for this channel/thread.',
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};
