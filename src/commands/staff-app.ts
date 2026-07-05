import { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelSelectMenuBuilder, 
    ChannelType, 
    MessageFlags, 
    ModalBuilder, 
    PermissionFlagsBits, 
    SlashCommandBuilder, 
    TextInputBuilder, 
    TextInputStyle 
} from 'discord.js';
import type { Command } from '../types/index.js';
import { staffAppSettings, StaffAppConfig, StaffSubmission } from '../services/staffAppSettings.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';
import { supabase } from '../services/supabase.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

function renderStaffAppDashboard(config: StaffAppConfig): any {
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
    
    const text = `# 💼 Staff Application System\n` +
        `Configure the staff recruitment settings.\n\n` +
        `› **Reviewer Channel:** ${config.reviewerChannelId ? `<#${config.reviewerChannelId}>` : '*Not configured (Required)*'}\n` +
        `› **Staff Role to Award:** ${config.staffRoleId ? `<@&${config.staffRoleId}>` : '*Not configured (Required)*'}\n\n` +
        `### ❓ Configured Questions (Max 5)\n` +
        config.questions.map((q, i) => `\`${i + 1}.\` ${q}`).join('\n') + `\n\n` +
        `Use the controls below to configure channels, roles, and publish the recruitment panel.`;
        
    c.addTextDisplayComponents(ComponentsV2.text(text))
     .addSeparatorComponents(ComponentsV2.separator());
     
    // Row 1: Reviewer Channel (native Channel Select Menu)
    const channelSelect = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('staff_app_wiz:channel')
            .setPlaceholder('Select staff review channel...')
            .addChannelTypes(ChannelType.GuildText)
    );
    
    // Row 2: Configure Questions / Role ID / Publish Panel
    const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('staff_app_wiz:modal:role')
            .setLabel('Set Staff Role ID')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('staff_app_wiz:modal:questions')
            .setLabel('Configure Questions')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('staff_app_wiz:publish')
            .setLabel('Publish Apply Panel 📣')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!config.reviewerChannelId || !config.staffRoleId)
    );
    
    c.addActionRowComponents(channelSelect);
    c.addActionRowComponents(btnRow);
    
    return c;
}

function buildApplyPanel(): any {
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.purple);
    
    const description = `**We are looking for dedicated individuals to join our server staff team!**\n\n` +
        `### Requirements\n` +
        `› You must have your Discord account linked to Victus Cloud.\n` +
        `› Be active, helpful, and follow all server rules.\n\n` +
        `Click the **Apply Now** button below to open the application form. Make sure to answer all questions thoroughly!`;
        
    c.addTextDisplayComponents(ComponentsV2.text(`-# RECRUITMENT OPERATIONS\n# Join the Server Staff Team!\n\n${description}`))
     .addSeparatorComponents(ComponentsV2.separator());
     
    const applyButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('staff_app:apply')
            .setLabel('Apply Now 💼')
            .setStyle(ButtonStyle.Primary)
    );
    
    c.addActionRowComponents(applyButton);
    return c;
}

function buildReviewCard(submission: StaffSubmission): any {
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
    
    let body = `# 💼 New Staff Application Received\n` +
        `› **Applicant:** <@${submission.userId}> (${submission.userName})\n` +
        `› **Submission ID:** \`${submission.id}\`\n` +
        `› **Date:** <t:${Math.floor(new Date(submission.submittedAt).getTime() / 1000)}:R>\n\n` +
        `---`;
        
    submission.answers.forEach((ans) => {
        body += `\n\n**Q: ${ans.question}**\n*${ans.answer}*`;
    });
    
    c.addTextDisplayComponents(ComponentsV2.text(body))
     .addSeparatorComponents(ComponentsV2.separator());
     
    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`staff_app_action:approve:${submission.id}`)
            .setLabel('Approve ✅')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`staff_app_action:deny:${submission.id}`)
            .setLabel('Deny ❌')
            .setStyle(ButtonStyle.Danger)
    );
    
    c.addActionRowComponents(actionRow);
    return c;
}

function buildReviewDecidedCard(submission: StaffSubmission): any {
    const isApproved = submission.status === 'approved';
    const c = ComponentsV2.baseContainer(isApproved ? ComponentsV2.Accents.success : ComponentsV2.Accents.danger);
    
    let body = `# 💼 Staff Application Decision\n` +
        `› **Applicant:** <@${submission.userId}> (${submission.userName})\n` +
        `› **Submission ID:** \`${submission.id}\`\n` +
        `› **Status:** ${isApproved ? '🟢 **Approved**' : '🔴 **Denied**'}\n` +
        `› **Reviewed By:** <@${submission.reviewerId}>\n` +
        `› **Reviewed On:** <t:${Math.floor(new Date(submission.reviewedAt!).getTime() / 1000)}:D>\n\n` +
        `---`;
        
    submission.answers.forEach((ans) => {
        body += `\n\n**Q: ${ans.question}**\n*${ans.answer}*`;
    });
    
    c.addTextDisplayComponents(ComponentsV2.text(body));
    return c;
}

export const staffAppCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('staff-app')
        .setDescription('Configure and deploy the staff application system')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('setup').setDescription('Open the staff application setup wizard')
        ),

    async execute(interaction) {
        const config = await staffAppSettings.get(interaction.guildId!);
        const dashboard = renderStaffAppDashboard(config);
        await interaction.reply({
            components: [dashboard],
            flags: V2 | EPH
        });
    },

    async handleButton(interaction) {
        // Handle setup wizard actions
        if (interaction.customId.startsWith('staff_app_wiz:')) {
            const config = await staffAppSettings.get(interaction.guildId!);
            const action = interaction.customId.split(':')[1];

            if (action === 'publish') {
                const panel = buildApplyPanel();
                const channel = interaction.channel;
                if (channel && channel.isTextBased()) {
                    await (channel as any).send({
                        components: [panel],
                        flags: V2
                    });
                }

                await interaction.update({
                    components: [ComponentsV2.successContainer('Panel Published', 'The staff recruitment card has been posted to this channel.')]
                });
            }
            else if (action === 'modal') {
                const target = interaction.customId.split(':')[2];
                if (target === 'role') {
                    const modal = new ModalBuilder().setCustomId('staff_app_wiz_modal:role').setTitle('Set Staff Role ID');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('roleId')
                                .setLabel('Discord Role ID')
                                .setPlaceholder('84729384729837482')
                                .setValue(config.staffRoleId || '')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        )
                    );
                    await interaction.showModal(modal);
                }
                else if (target === 'questions') {
                    const modal = new ModalBuilder().setCustomId('staff_app_wiz_modal:questions').setTitle('Configure Form Questions');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('qList')
                                .setLabel('Questions (one per line, max 5)')
                                .setPlaceholder('How old are you?\nWhat is your timezone?\nWhy apply?')
                                .setValue(config.questions.join('\n'))
                                .setStyle(TextInputStyle.Paragraph)
                                .setRequired(true)
                        )
                    );
                    await interaction.showModal(modal);
                }
            }
        }
        
        // Handle candidate applying button
        else if (interaction.customId === 'staff_app:apply') {
            // 1. Mandatory Account Link Check
            const linked = await supabase.getLinkedAccount(interaction.user.id).catch(() => null);
            if (!linked) {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer(
                        'Account Link Required',
                        'You must link your Discord account to Victus Cloud to apply for staff. Use the link panel or `/account` to link your profile first.'
                    )],
                    flags: V2 | EPH
                });
                return;
            }

            const config = await staffAppSettings.get(interaction.guildId!);
            if (!config.reviewerChannelId) {
                await interaction.reply({ content: '❌ The staff application system is currently offline (no reviewer channel configured).', flags: EPH });
                return;
            }

            const modal = new ModalBuilder()
                .setCustomId('staff_app_modal:submit')
                .setTitle('Staff Application Form');

            config.questions.slice(0, 5).forEach((q, idx) => {
                modal.addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(
                        new TextInputBuilder()
                            .setCustomId(`q_${idx}`)
                            .setLabel(q.length > 45 ? `${q.slice(0, 42)}...` : q)
                            .setPlaceholder('Type your response here...')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(true)
                    )
                );
            });

            await interaction.showModal(modal);
        }

        // Handle staff reviewer decisions (Approve/Deny)
        else if (interaction.customId.startsWith('staff_app_action:')) {
            const [, action, submissionId] = interaction.customId.split(':');
            
            // Verify reviewer is admin or has Manage Guild permissions
            const isManager = (interaction.member?.permissions as any)?.has(PermissionFlagsBits.ManageGuild);
            if (!isManager) {
                await interaction.reply({ content: '❌ You must have `Manage Server` permissions to review staff applications.', flags: EPH });
                return;
            }

            await interaction.deferUpdate().catch(() => {});
            
            const submission = await staffAppSettings.getSubmission(submissionId);
            if (!submission || submission.status !== 'pending') {
                await interaction.followUp({ content: '❌ This application has already been decided or does not exist.', flags: EPH });
                return;
            }

            const config = await staffAppSettings.get(interaction.guildId!);
            const targetMember = await interaction.guild?.members.fetch(submission.userId).catch(() => null);

            if (action === 'approve') {
                submission.status = 'approved';
                submission.reviewerId = interaction.user.id;
                submission.reviewedAt = new Date().toISOString();
                await staffAppSettings.updateSubmission(submissionId, submission);

                // Try to award role
                if (config.staffRoleId && targetMember) {
                    await targetMember.roles.add(config.staffRoleId).catch((err) => {
                        logger.error(`Failed to assign staff role ${config.staffRoleId} to ${submission.userId}:`, err);
                    });
                }

                // Notify candidate
                if (targetMember) {
                    await targetMember.send({
                        components: [ComponentsV2.successContainer('Staff Application Approved', `Congratulations! Your staff application on **${interaction.guild?.name}** has been approved. You have been awarded the staff role.`)]
                    }).catch(() => {});
                }

                // Update review card
                const updatedCard = buildReviewDecidedCard(submission);
                await interaction.editReply({ components: [updatedCard] });
            } 
            else if (action === 'deny') {
                submission.status = 'denied';
                submission.reviewerId = interaction.user.id;
                submission.reviewedAt = new Date().toISOString();
                await staffAppSettings.updateSubmission(submissionId, submission);

                // Notify candidate
                if (targetMember) {
                    await targetMember.send({
                        components: [ComponentsV2.errorContainer('Staff Application Denied', `Thank you for your interest. Unfortunately, your staff application on **${interaction.guild?.name}** has been denied at this time.`)]
                    }).catch(() => {});
                }

                // Update review card
                const updatedCard = buildReviewDecidedCard(submission);
                await interaction.editReply({ components: [updatedCard] });
            }
        }
    },

    async handleSelectMenu(interaction) {
        if (interaction.customId !== 'staff_app_wiz:channel') return;
        const reviewerChannelId = interaction.values[0];
        const updated = await staffAppSettings.set(interaction.guildId!, { reviewerChannelId });
        await interaction.update({ components: [renderStaffAppDashboard(updated)] });
    },

    async handleModal(interaction) {
        if (interaction.customId.startsWith('staff_app_wiz_modal:')) {
            const config = await staffAppSettings.get(interaction.guildId!);
            const type = interaction.customId.split(':')[1];

            if (type === 'role') {
                const staffRoleId = interaction.fields.getTextInputValue('roleId').trim();
                const updated = await staffAppSettings.set(interaction.guildId!, { staffRoleId });
                await (interaction as any).update({ components: [renderStaffAppDashboard(updated)] });
            }
            else if (type === 'questions') {
                const qListRaw = interaction.fields.getTextInputValue('qList').trim();
                const questions = qListRaw.split('\n').map(q => q.trim()).filter(q => q.length > 0);
                const updated = await staffAppSettings.set(interaction.guildId!, { questions });
                await (interaction as any).update({ components: [renderStaffAppDashboard(updated)] });
            }
        }
        
        else if (interaction.customId === 'staff_app_modal:submit') {
            const config = await staffAppSettings.get(interaction.guildId!);
            if (!config.reviewerChannelId) return;

            const answers: Array<{ question: string; answer: string }> = [];
            config.questions.slice(0, 5).forEach((q, idx) => {
                const val = interaction.fields.getTextInputValue(`q_${idx}`).trim();
                answers.push({ question: q, answer: val });
            });

            const submissionId = Math.random().toString(36).slice(2, 10);
            const submission: StaffSubmission = {
                id: submissionId,
                userId: interaction.user.id,
                userName: interaction.user.username,
                guildId: interaction.guildId!,
                status: 'pending',
                answers: answers,
                submittedAt: new Date().toISOString()
            };

            await staffAppSettings.createSubmission(submission);

            // Send card to reviewers channel
            const reviewerChannel = interaction.guild?.channels.cache.get(config.reviewerChannelId);
            if (reviewerChannel && reviewerChannel.isTextBased()) {
                const card = buildReviewCard(submission);
                await (reviewerChannel as any).send({
                    components: [card],
                    flags: V2
                }).catch((err: any) => logger.error('Failed to send review card to staff channel:', err));
            }

            await interaction.reply({
                components: [ComponentsV2.successContainer('Application Submitted', 'Your application has been submitted and is now under review. You will be notified of the decision via Direct Messages.')],
                flags: V2 | EPH
            });
        }
    }
};
