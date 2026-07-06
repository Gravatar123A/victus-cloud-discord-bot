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
    StringSelectMenuBuilder,
    TextInputBuilder, 
    TextInputStyle 
} from 'discord.js';
import type { Command } from '../types/index.js';
import { staffAppSettings, StaffAppConfig, StaffSubmission, StaffAppCategory } from '../services/staffAppSettings.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';
import { supabase } from '../services/supabase.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

function renderCategoriesDashboard(config: StaffAppConfig): any {
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
    const catKeys = Object.keys(config.categories);
    
    let text = `# 💼 Staff Recruitment Categories\n` +
        `Manage multiple recruitment tracks with separate roles and questions.\n\n`;
        
    if (catKeys.length === 0) {
        text += `*No categories configured. Click the button below to create one.*`;
    } else {
        text += `### Configured Positions:\n`;
        catKeys.forEach((key) => {
            const cat = config.categories[key];
            text += `› **${cat.displayName}** (\`${cat.id}\`)\n` +
                `  *Role:* ${cat.staffRoleId ? `<@&${cat.staffRoleId}>` : '*None*'}\n` +
                `  *Review:* ${cat.reviewerChannelId ? `<#${cat.reviewerChannelId}>` : '*None*'}\n\n`;
        });
    }
    
    c.addTextDisplayComponents(ComponentsV2.text(text))
     .addSeparatorComponents(ComponentsV2.separator());
     
    // Row 1: Select Category to Edit
    const catOptions = catKeys.map(key => ({
        label: config.categories[key].displayName,
        value: `staff_app_wiz:edit_cat:${key}`,
        description: `Configure settings for ${config.categories[key].displayName}`
    }));
    
    if (catOptions.length > 0) {
        const selectMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('staff_app_wiz:select_cat')
                .setPlaceholder('Select a position to configure...')
                .addOptions(catOptions)
        );
        c.addActionRowComponents(selectMenu);
    }
    
    // Row 2: Add Category & Publish Panel
    const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('staff_app_wiz:modal:create')
            .setLabel('Create Category ➕')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('staff_app_wiz:publish_unified')
            .setLabel('Publish Unified Panel 📣')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(catKeys.length === 0)
    );
    
    c.addActionRowComponents(btnRow);
    return c;
}

function renderCategorySubDashboard(cat: StaffAppCategory): any {
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.info);
    
    const text = `# ⚙️ Managing Position: ${cat.displayName}\n` +
        `› **Identifier Key:** \`${cat.id}\`\n` +
        `› **Description:** *${cat.description}*\n` +
        `› **Staff Role to Award:** ${cat.staffRoleId ? `<@&${cat.staffRoleId}>` : '*Not configured (Required)*'}\n` +
        `› **Reviewer Channel:** ${cat.reviewerChannelId ? `<#${cat.reviewerChannelId}>` : '*Not configured (Required)*'}\n\n` +
        `### ❓ Form Questions (Max 5)\n` +
        cat.questions.map((q, i) => `\`${i + 1}.\` ${q}`).join('\n');
        
    c.addTextDisplayComponents(ComponentsV2.text(text))
     .addSeparatorComponents(ComponentsV2.separator());
     
    // Row 1: Channel select menu for review
    const channelSelect = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId(`staff_app_wiz:channel:${cat.id}`)
            .setPlaceholder('Select review channel...')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    );
    
    // Row 2: Edit controls
    const editRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`staff_app_wiz:modal:role:${cat.id}`)
            .setLabel('Set Role ID')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`staff_app_wiz:modal:questions:${cat.id}`)
            .setLabel('Edit Questions')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`staff_app_wiz:modal:edit_details:${cat.id}`)
            .setLabel('Edit Details')
            .setStyle(ButtonStyle.Secondary)
    );

    // Row 3: Action controls
    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('staff_app_wiz:view_categories')
            .setLabel('⬅️ Back to List')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`staff_app_wiz:publish_specific:${cat.id}`)
            .setLabel('Publish Apply Panel 📣')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!cat.staffRoleId || !cat.reviewerChannelId),
        new ButtonBuilder()
            .setCustomId(`staff_app_wiz:delete:${cat.id}`)
            .setLabel('Delete Category 🗑️')
            .setStyle(ButtonStyle.Danger)
    );
    
    c.addActionRowComponents(channelSelect);
    c.addActionRowComponents(editRow);
    c.addActionRowComponents(actionRow);
    
    return c;
}

function buildUnifiedApplyPanel(config: StaffAppConfig): any {
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.purple);
    
    const description = `**We are looking for dedicated individuals to join our server staff team!**\n\n` +
        `### Requirements\n` +
        `› You must have your Discord account linked to Victus Cloud.\n` +
        `› Be active, helpful, and follow all server rules.\n\n` +
        `Select the position you want to apply for from the dropdown menu below.`;
        
    c.addTextDisplayComponents(ComponentsV2.text(`-# RECRUITMENT OPERATIONS\n# Join the Server Staff Team!\n\n${description}`))
     .addSeparatorComponents(ComponentsV2.separator());
     
    const options = Object.keys(config.categories).map((key) => {
        const cat = config.categories[key];
        return {
            label: cat.displayName,
            value: cat.id,
            description: cat.description.length > 50 ? `${cat.description.slice(0, 47)}...` : cat.description
        };
    });
     
    const selectMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('staff_app:select_apply')
            .setPlaceholder('Choose a position to apply for...')
            .addOptions(options)
    );
    
    c.addActionRowComponents(selectMenu);
    return c;
}

function buildSpecificApplyPanel(cat: StaffAppCategory): any {
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.purple);
    
    const description = `**We are looking for candidates for the ${cat.displayName} role!**\n\n` +
        `### Description\n` +
        `*${cat.description}*\n\n` +
        `### Requirements\n` +
        `› Discord account must be linked to Victus Cloud.\n` +
        `› Be active and follow server rules.\n\n` +
        `Click the **Apply** button below to open the application modal.`;
        
    c.addTextDisplayComponents(ComponentsV2.text(`-# RECRUITMENT OPERATIONS\n# Apply for ${cat.displayName}!\n\n${description}`))
     .addSeparatorComponents(ComponentsV2.separator());
     
    const applyButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`staff_app:apply:${cat.id}`)
            .setLabel(`Apply for ${cat.displayName} 💼`)
            .setStyle(ButtonStyle.Primary)
    );
    
    c.addActionRowComponents(applyButton);
    return c;
}

function buildReviewCard(submission: StaffSubmission, cat: StaffAppCategory): any {
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
    
    let body = `# 💼 New Staff Application Received\n` +
        `› **Applicant:** <@${submission.userId}> (${submission.userName})\n` +
        `› **Position Applied:** **${cat.displayName}** (\`${cat.id}\`)\n` +
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

function buildReviewDecidedCard(submission: StaffSubmission, cat: StaffAppCategory): any {
    const isApproved = submission.status === 'approved';
    const c = ComponentsV2.baseContainer(isApproved ? ComponentsV2.Accents.success : ComponentsV2.Accents.danger);
    
    let body = `# 💼 Staff Application Decision\n` +
        `› **Applicant:** <@${submission.userId}> (${submission.userName})\n` +
        `› **Position:** **${cat.displayName}**\n` +
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

async function showFormModal(interaction: any, cat: StaffAppCategory) {
    const modal = new ModalBuilder()
        .setCustomId(`staff_app_modal:submit:${cat.id}`)
        .setTitle(`Apply: ${cat.displayName}`);

    cat.questions.slice(0, 5).forEach((q, idx) => {
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

export const staffAppCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('staff-app')
        .setDescription('Configure and deploy multiple staff recruitment application forms')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('setup').setDescription('Open the recruitment configuration categories manager')
        ),

    async execute(interaction) {
        const config = await staffAppSettings.get(interaction.guildId!);
        const dashboard = renderCategoriesDashboard(config);
        await interaction.reply({
            components: [dashboard],
            flags: V2 | EPH
        });
    },

    async handleButton(interaction) {
        const config = await staffAppSettings.get(interaction.guildId!);

        // Wizard routes
        if (interaction.customId.startsWith('staff_app_wiz:')) {
            const action = interaction.customId.split(':')[1];

            if (action === 'view_categories') {
                const dashboard = renderCategoriesDashboard(config);
                await interaction.update({ components: [dashboard] });
            }
            else if (action === 'publish_unified') {
                const panel = buildUnifiedApplyPanel(config);
                const channel = interaction.channel;
                if (channel && channel.isTextBased()) {
                    await (channel as any).send({
                        components: [panel],
                        flags: V2
                    });
                }
                await interaction.update({
                    components: [ComponentsV2.successContainer('Panel Posted', 'The unified recruitment panel has been posted to this channel.')]
                });
            }
            else if (action === 'publish_specific') {
                const catId = interaction.customId.split(':')[2];
                const cat = config.categories[catId];
                if (cat) {
                    const panel = buildSpecificApplyPanel(cat);
                    const channel = interaction.channel;
                    if (channel && channel.isTextBased()) {
                        await (channel as any).send({
                            components: [panel],
                            flags: V2
                        });
                    }
                    await interaction.update({
                        components: [ComponentsV2.successContainer('Panel Posted', `Recruitment panel for ${cat.displayName} posted.`)]
                    });
                }
            }
            else if (action === 'delete') {
                const catId = interaction.customId.split(':')[2];
                delete config.categories[catId];
                await staffAppSettings.set(interaction.guildId!, config);
                const dashboard = renderCategoriesDashboard(config);
                await interaction.update({ components: [dashboard] });
            }
            else if (action === 'modal') {
                const target = interaction.customId.split(':')[2];
                if (target === 'create') {
                    const modal = new ModalBuilder().setCustomId('staff_app_wiz_modal:create').setTitle('New Recruitment Track');
                    modal.addComponents(
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('catId')
                                .setLabel('Unique key (e.g. dev, moderator)')
                                .setPlaceholder('mod')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        ),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('displayName')
                                .setLabel('Display Label')
                                .setPlaceholder('Moderator')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        ),
                        new ActionRowBuilder<TextInputBuilder>().addComponents(
                            new TextInputBuilder()
                                .setCustomId('description')
                                .setLabel('Requirements/Description')
                                .setPlaceholder('Review logs, keep the server safe, help members.')
                                .setStyle(TextInputStyle.Paragraph)
                                .setRequired(true)
                        )
                    );
                    await interaction.showModal(modal);
                }
                else {
                    const catId = interaction.customId.split(':')[3];
                    const cat = config.categories[catId];
                    if (!cat) return;

                    if (target === 'role') {
                        const modal = new ModalBuilder().setCustomId(`staff_app_wiz_modal:role:${catId}`).setTitle('Award Staff Role ID');
                        modal.addComponents(
                            new ActionRowBuilder<TextInputBuilder>().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('roleId')
                                    .setLabel('Discord Role ID')
                                    .setPlaceholder('84729384729837482')
                                    .setValue(cat.staffRoleId || '')
                                    .setStyle(TextInputStyle.Short)
                                    .setRequired(true)
                            )
                        );
                        await interaction.showModal(modal);
                    }
                    else if (target === 'questions') {
                        const modal = new ModalBuilder().setCustomId(`staff_app_wiz_modal:questions:${catId}`).setTitle('Edit Track Questions');
                        modal.addComponents(
                            new ActionRowBuilder<TextInputBuilder>().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('qList')
                                    .setLabel('Questions (one per line, max 5)')
                                    .setPlaceholder('Question 1\nQuestion 2')
                                    .setValue(cat.questions.join('\n'))
                                    .setStyle(TextInputStyle.Paragraph)
                                    .setRequired(true)
                            )
                        );
                        await interaction.showModal(modal);
                    }
                    else if (target === 'edit_details') {
                        const modal = new ModalBuilder().setCustomId(`staff_app_wiz_modal:edit_details:${catId}`).setTitle('Edit Track Information');
                        modal.addComponents(
                            new ActionRowBuilder<TextInputBuilder>().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('displayName')
                                    .setLabel('Display Label')
                                    .setValue(cat.displayName)
                                    .setStyle(TextInputStyle.Short)
                                    .setRequired(true)
                            ),
                            new ActionRowBuilder<TextInputBuilder>().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('description')
                                    .setLabel('Requirements/Description')
                                    .setValue(cat.description)
                                    .setStyle(TextInputStyle.Paragraph)
                                    .setRequired(true)
                            )
                        );
                        await interaction.showModal(modal);
                    }
                }
            }
        }
        
        // Candidate specific apply button action
        else if (interaction.customId.startsWith('staff_app:apply:')) {
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

            const catId = interaction.customId.split(':')[2];
            const cat = config.categories[catId];
            if (!cat || !cat.reviewerChannelId) {
                await interaction.reply({ content: '❌ This position is currently not open or misconfigured.', flags: EPH });
                return;
            }

            await showFormModal(interaction, cat);
        }

        // Decision routes (Approve/Deny)
        else if (interaction.customId.startsWith('staff_app_action:')) {
            const [, action, submissionId] = interaction.customId.split(':');
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

            const cat = config.categories[submission.categoryId];
            if (!cat) {
                await interaction.followUp({ content: '❌ The recruitment track for this application no longer exists.', flags: EPH });
                return;
            }

            const targetMember = await interaction.guild?.members.fetch(submission.userId).catch(() => null);

            if (action === 'approve') {
                submission.status = 'approved';
                submission.reviewerId = interaction.user.id;
                submission.reviewedAt = new Date().toISOString();
                await staffAppSettings.updateSubmission(submissionId, submission);

                if (cat.staffRoleId && targetMember) {
                    await targetMember.roles.add(cat.staffRoleId).catch((err) => {
                        logger.error(`Failed to assign role ${cat.staffRoleId} to ${submission.userId}:`, err);
                    });
                }

                if (targetMember) {
                    await targetMember.send({
                        components: [ComponentsV2.successContainer('Application Approved', `Congratulations! Your staff application for **${cat.displayName}** on **${interaction.guild?.name}** was approved.`)]
                    }).catch(() => {});
                }

                await interaction.editReply({ components: [buildReviewDecidedCard(submission, cat)] });
            }
            else if (action === 'deny') {
                submission.status = 'denied';
                submission.reviewerId = interaction.user.id;
                submission.reviewedAt = new Date().toISOString();
                await staffAppSettings.updateSubmission(submissionId, submission);

                if (targetMember) {
                    await targetMember.send({
                        components: [ComponentsV2.errorContainer('Application Denied', `Thank you for your interest. Unfortunately, your staff application for **${cat.displayName}** on **${interaction.guild?.name}** was denied.`)]
                    }).catch(() => {});
                }

                await interaction.editReply({ components: [buildReviewDecidedCard(submission, cat)] });
            }
        }
    },

    async handleSelectMenu(interaction) {
        const config = await staffAppSettings.get(interaction.guildId!);

        if (interaction.customId === 'staff_app_wiz:select_cat') {
            const [, , catId] = interaction.values[0].split(':');
            const cat = config.categories[catId];
            if (cat) {
                await interaction.update({ components: [renderCategorySubDashboard(cat)] });
            }
        }
        else if (interaction.customId.startsWith('staff_app_wiz:channel:')) {
            const catId = interaction.customId.split(':')[2];
            const cat = config.categories[catId];
            if (cat) {
                cat.reviewerChannelId = interaction.values[0];
                await staffAppSettings.set(interaction.guildId!, config);
                await interaction.update({ components: [renderCategorySubDashboard(cat)] });
            }
        }
        
        // Candidate unified selection action
        else if (interaction.customId === 'staff_app:select_apply') {
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

            const catId = interaction.values[0];
            const cat = config.categories[catId];
            if (!cat || !cat.reviewerChannelId) {
                await interaction.reply({ content: '❌ This position is currently not open or misconfigured.', flags: EPH });
                return;
            }

            await showFormModal(interaction, cat);
        }
    },

    async handleModal(interaction) {
        const config = await staffAppSettings.get(interaction.guildId!);

        if (interaction.customId === 'staff_app_wiz_modal:create') {
            const catId = interaction.fields.getTextInputValue('catId').trim().toLowerCase();
            const displayName = interaction.fields.getTextInputValue('displayName').trim();
            const description = interaction.fields.getTextInputValue('description').trim();

            if (config.categories[catId]) {
                await interaction.reply({ content: '❌ A category with that ID already exists.', flags: EPH });
                return;
            }

            config.categories[catId] = {
                id: catId,
                displayName,
                description,
                questions: [
                    'How old are you?',
                    'What is your timezone?',
                    'Why apply?'
                ],
                staffRoleId: null,
                reviewerChannelId: null
            };

            await staffAppSettings.set(interaction.guildId!, config);
            const dashboard = renderCategoriesDashboard(config);
            await (interaction as any).update({ components: [dashboard] });
        }
        else if (interaction.customId.startsWith('staff_app_wiz_modal:')) {
            const [, type, catId] = interaction.customId.split(':');
            const cat = config.categories[catId];
            if (!cat) return;

            if (type === 'role') {
                cat.staffRoleId = interaction.fields.getTextInputValue('roleId').trim();
            }
            else if (type === 'questions') {
                const qRaw = interaction.fields.getTextInputValue('qList').trim();
                cat.questions = qRaw.split('\n').map(q => q.trim()).filter(q => q.length > 0);
            }
            else if (type === 'edit_details') {
                cat.displayName = interaction.fields.getTextInputValue('displayName').trim();
                cat.description = interaction.fields.getTextInputValue('description').trim();
            }

            await staffAppSettings.set(interaction.guildId!, config);
            await (interaction as any).update({ components: [renderCategorySubDashboard(cat)] });
        }
        
        // Candidate submitting application modal
        else if (interaction.customId.startsWith('staff_app_modal:submit:')) {
            const catId = interaction.customId.split(':')[2];
            const cat = config.categories[catId];
            if (!cat || !cat.reviewerChannelId) return;

            const answers: Array<{ question: string; answer: string }> = [];
            cat.questions.slice(0, 5).forEach((q, idx) => {
                const val = interaction.fields.getTextInputValue(`q_${idx}`).trim();
                answers.push({ question: q, answer: val });
            });

            const submissionId = Math.random().toString(36).slice(2, 10);
            const submission: StaffSubmission = {
                id: submissionId,
                userId: interaction.user.id,
                userName: interaction.user.username,
                guildId: interaction.guildId!,
                categoryId: catId,
                status: 'pending',
                answers: answers,
                submittedAt: new Date().toISOString()
            };

            await staffAppSettings.createSubmission(submission);

            const reviewerChannel = interaction.guild?.channels.cache.get(cat.reviewerChannelId);
            if (reviewerChannel && reviewerChannel.isTextBased()) {
                const card = buildReviewCard(submission, cat);
                await (reviewerChannel as any).send({
                    components: [card],
                    flags: V2
                }).catch((err: any) => logger.error('Failed to send review card to staff channel:', err));
            }

            await interaction.reply({
                components: [ComponentsV2.successContainer('Application Submitted', `Your application for ${cat.displayName} has been submitted. You will be notified of the decision in Direct Messages.`)],
                flags: V2 | EPH
            });
        }
    }
};
