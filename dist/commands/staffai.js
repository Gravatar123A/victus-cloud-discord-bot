import { MessageFlags, SlashCommandBuilder, ThreadAutoArchiveDuration, } from 'discord.js';
import { antigravityPipeline } from '../services/antigravityPipeline.js';
import { createProcessingEmbed, createResultEmbeds, createUnauthorizedEmbed, } from '../embeds/antigravityEmbeds.js';
import { logger } from '../utils/logger.js';
import { isVictusStaffOrAdmin } from '../utils/staffAuth.js';
export const staffaiCommand = {
    data: new SlashCommandBuilder()
        .setName('staffai')
        .setDescription('Execute tasks and interact with Antigravity AI (Staff only)')
        .addStringOption((opt) => opt
        .setName('task')
        .setDescription('The instruction, code change, question, or workspace task for Antigravity')
        .setRequired(true)
        .setMaxLength(2000))
        .addAttachmentOption((opt) => opt
        .setName('attachment')
        .setDescription('Optional image, screenshot, or file to attach for Antigravity vision inspection')
        .setRequired(false))
        .addBooleanOption((opt) => opt
        .setName('thread')
        .setDescription('Create a dedicated thread for interactive conversation (default: true)')
        .setRequired(false))
        .addBooleanOption((opt) => opt
        .setName('new_session')
        .setDescription('Start a fresh Antigravity session and clear previous memory')
        .setRequired(false)),
    cooldown: 3,
    adminOnly: true,
    async execute(interaction) {
        const member = interaction.member;
        // Verify Staff Authorization (strictly isolated to Victus Staff)
        const authorized = (await isVictusStaffOrAdmin(interaction.user, interaction.client)) || antigravityPipeline.isAuthorized(member);
        if (!authorized) {
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
        let threadTarget = null;
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
            }
            catch (threadErr) {
                logger.warn('[StaffAI] Could not create thread, falling back to channel:', threadErr);
            }
        }
        let threadProgressMsg = null;
        if (threadTarget) {
            try {
                threadProgressMsg = await threadTarget.send({
                    embeds: [
                        createProcessingEmbed(task, interaction.user.tag, !!attachment)
                            .setTitle('⏳ Antigravity Pipeline Executing')
                            .setDescription('Antigravity agent runtime has accepted the task and is working...'),
                    ],
                });
            }
            catch (initErr) {
                logger.warn('[StaffAI] Could not send initial progress message in thread:', initErr);
            }
        }
        try {
            let lastProgressUpdate = 0;
            const result = await antigravityPipeline.executeTask({
                prompt: task,
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                channelOrThreadId: workingChannelId,
                attachments: attachment ? [attachment] : undefined,
                forceNewSession,
                onProgress: async (prog) => {
                    const now = Date.now();
                    if (now - lastProgressUpdate < 10000)
                        return;
                    lastProgressUpdate = now;
                    const mins = Math.floor(prog.elapsedSeconds / 60);
                    const secs = prog.elapsedSeconds % 60;
                    const timeStr = `${mins}m ${secs.toString().padStart(2, '0')}s`;
                    const updatedEmbed = createProcessingEmbed(task, interaction.user.tag, !!attachment)
                        .setTitle('🔄 Antigravity Working...')
                        .setDescription(`⏱️ **Elapsed:** \`${timeStr}\`${prog.stepIndex ? ` • **Step:** \`${prog.stepIndex}\`` : ''}\n` +
                        `⚡ **Activity:** \`${(prog.statusMessage || 'Executing steps...').slice(0, 100)}\`\n\n` +
                        `*(Session running live on developer PC)*`);
                    try {
                        if (threadProgressMsg) {
                            await threadProgressMsg.edit({ embeds: [updatedEmbed] });
                        }
                        else if (!threadTarget) {
                            await interaction.editReply({ embeds: [updatedEmbed] });
                        }
                    }
                    catch { }
                },
            });
            const { embeds, components } = createResultEmbeds(result, {
                task,
                userTag: interaction.user.tag,
            });
            // If we created a thread, send or edit the result directly inside the thread and update the root message
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
                    if (threadProgressMsg) {
                        await threadProgressMsg.edit({
                            embeds,
                            components,
                        });
                    }
                    else {
                        await threadTarget.send({
                            embeds,
                            components,
                        });
                    }
                }
                catch (sendErr) {
                    logger.warn('[StaffAI] Could not post result in thread, falling back to main message:', sendErr);
                    await interaction.followUp({
                        embeds,
                        components,
                    });
                }
            }
            else {
                // Otherwise edit the main interaction reply
                await interaction.editReply({
                    embeds,
                    components,
                });
            }
        }
        catch (error) {
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
        const member = interaction.member;
        const authorized = (await isVictusStaffOrAdmin(interaction.user, interaction.client)) || antigravityPipeline.isAuthorized(member);
        if (!authorized) {
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
        }
        else {
            await interaction.reply({
                content: '🧹 **Session Cleared:** Memory removed for this channel/thread.',
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};
