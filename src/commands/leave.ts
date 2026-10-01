import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { leaveSettings, LeaveApplication, LeaveConfig } from '../services/leaveSettings.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

const APPLY_BUTTON = 'afl:apply';
const APPLY_MODAL = 'afl_apply_modal';

// ============================================
// Card builders
// ============================================

function buildLeavePanel(): any {
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.purple);

    const body =
        `-# STAFF OPERATIONS • LEAVE DESK\n` +
        `# Apply for Leave\n\n` +
        `Planning time away? Submit a leave request and the review team will ` +
        `approve or reject it. You will receive a private DM with the decision ` +
        `and the reason provided.\n\n` +
        `### Before you apply\n` +
        `› Give your manager as much notice as possible.\n` +
        `› Make sure handovers are arranged for your active duties.\n` +
        `› You will be asked for your name, role, reason and duration.`;

    c.addTextDisplayComponents(ComponentsV2.text(body))
        .addSeparatorComponents(ComponentsV2.separator())
        .addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(APPLY_BUTTON)
                    .setLabel('Apply for Leave')
                    .setStyle(ButtonStyle.Primary),
            ),
        );

    return c;
}

function buildApplicationCard(app: LeaveApplication, config: LeaveConfig): any {
    const isPending = app.status === 'pending';
    const accent = app.status === 'approved'
        ? ComponentsV2.Accents.success
        : app.status === 'rejected'
            ? ComponentsV2.Accents.danger
            : ComponentsV2.Accents.primary;

    const c = ComponentsV2.baseContainer(accent);

    const statusLine = app.status === 'approved'
        ? '🟢 Approved'
        : app.status === 'rejected'
            ? '🔴 Rejected'
            : '🟡 Pending review';

    let body =
        `-# LEAVE APPLICATION • #${app.id}\n` +
        `# 🗓️ Leave Request\n\n` +
        `› **Applicant:** <@${app.userId}> (${app.userName})\n` +
        `› **Name:** ${app.name}\n` +
        `› **Role:** ${app.role}\n` +
        `› **Duration:** \`${app.days}\` day(s)\n` +
        `› **Submitted:** <t:${Math.floor(new Date(app.submittedAt).getTime() / 1000)}:R>\n` +
        `› **Status:** ${statusLine}\n`;

    if (!isPending && app.reviewedBy) {
        body += `› **Reviewed by:** <@${app.reviewedBy}>\n`;
        if (app.decisionReason) body += `› **Reason:** ${app.decisionReason}\n`;
    }

    body += `\n### Reason\n${app.reason}`;

    c.addTextDisplayComponents(ComponentsV2.text(body))
        .addSeparatorComponents(ComponentsV2.separator());

    if (isPending) {
        c.addActionRowComponents(
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`afl:approve:${app.id}`)
                    .setLabel('Approve')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`afl:reject:${app.id}`)
                    .setLabel('Reject')
                    .setStyle(ButtonStyle.Danger),
            ),
        );
    } else {
        const reviewers = config.adminRoleIds.map((id) => `<@&${id}>`).join(' ');
        c.addTextDisplayComponents(
            ComponentsV2.footerNote(reviewers ? `Review team: ${reviewers}` : 'Decision recorded by the review team.'),
        );
    }

    return c;
}

// ============================================
// Permission helpers
// ============================================

function hasManageGuild(interaction: any): boolean {
    try {
        return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
    } catch {
        return false;
    }
}

function isReviewer(interaction: any, config: LeaveConfig): boolean {
    if (hasManageGuild(interaction)) return true;
    if (config.adminUserIds.includes(interaction.user.id)) return true;

    const roles = (interaction.member as any)?.roles;
    if (Array.isArray(roles)) return config.adminRoleIds.some((id) => roles.includes(id));
    if (roles?.cache) return config.adminRoleIds.some((id) => roles.cache.has(id));
    return false;
}

// ============================================
// Decision handling
// ============================================

async function finalizeDecision(
    client: any,
    decision: 'approved' | 'rejected',
    applicationId: string,
    reason: string,
    reviewerId: string,
): Promise<{ ok: boolean; message: string }> {
    const app = await leaveSettings.getApplication(applicationId);
    if (!app) return { ok: false, message: `Application \`${applicationId}\` was not found.` };
    if (app.status !== 'pending') return { ok: false, message: `Application \`${applicationId}\` has already been ${app.status}.` };

    const updated = await leaveSettings.updateApplication(applicationId, {
        status: decision,
        reviewedBy: reviewerId,
        reviewedAt: new Date().toISOString(),
        decisionReason: reason || undefined,
    });
    if (!updated) return { ok: false, message: 'Failed to save the decision.' };

    const config = await leaveSettings.getConfig(app.guildId);
    const card = buildApplicationCard(updated, config);

    // Update the review card in the log channel.
    if (app.channelId && app.messageId) {
        try {
            const channel = await client.channels.fetch(app.channelId).catch(() => null);
            if (channel && 'messages' in channel) {
                const message = await channel.messages.fetch(app.messageId).catch(() => null);
                if (message) await message.edit({ components: [card], flags: V2 }).catch(() => undefined);
            }
        } catch (error) {
            logger.debug('[AFL] Failed to update log card:', error);
        }
    }

    // DM the applicant with the decision.
    try {
        const user = await client.users.fetch(app.userId).catch(() => null);
        if (user) {
            const isApproved = decision === 'approved';
            const dmText =
                `# 🗓️ Leave Request ${isApproved ? 'Approved' : 'Rejected'}\n\n` +
                `Your leave application for **${app.days}** day(s) has been ` +
                `**${isApproved ? 'approved' : 'rejected'}**.\n\n` +
                `› **Name:** ${app.name}\n` +
                `› **Role:** ${app.role}\n` +
                `› **Reason given:** ${reason || 'No reason was provided.'}`;
            const dm = isApproved
                ? ComponentsV2.successContainer('Leave Request Approved', dmText.replace(/^# .*\n/, ''))
                : ComponentsV2.errorContainer('Leave Request Rejected', dmText.replace(/^# .*\n/, ''));
            await user.send({ components: [dm], flags: V2 }).catch(() => undefined);
        }
    } catch (error) {
        logger.debug('[AFL] Failed to DM applicant:', error);
    }

    return { ok: true, message: `Application \`${applicationId}\` has been ${decision}.` };
}

function openApplyModal(interaction: any): Promise<void> {
    const modal = new ModalBuilder().setCustomId(APPLY_MODAL).setTitle('Apply for Leave');
    modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
                .setCustomId('name')
                .setLabel('What is your Name?')
                .setPlaceholder('John Doe')
                .setStyle(TextInputStyle.Short)
                .setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
                .setCustomId('role')
                .setLabel('What is your Role?')
                .setPlaceholder('Support Staff')
                .setStyle(TextInputStyle.Short)
                .setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
                .setCustomId('reason')
                .setLabel('Why are you taking the leave?')
                .setPlaceholder('Family event out of town.')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
                .setCustomId('days')
                .setLabel('For how many days?')
                .setPlaceholder('3')
                .setStyle(TextInputStyle.Short)
                .setRequired(true),
        ),
    );
    return interaction.showModal(modal);
}

function openDecisionModal(interaction: any, decision: 'approve' | 'reject', applicationId: string): Promise<void> {
    const modal = new ModalBuilder()
        .setCustomId(`afl_decision:${decision}:${applicationId}`)
        .setTitle(decision === 'approve' ? 'Approve Leave — Add Reason' : 'Reject Leave — Add Reason');

    modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
                .setCustomId('reason')
                .setLabel(decision === 'approve' ? 'Reason for approval (optional)' : 'Reason for rejection (optional)')
                .setPlaceholder('Add a note that will be DM\'d to the applicant.')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false),
        ),
    );
    return interaction.showModal(modal);
}

// ============================================
// Command
// ============================================

export const leaveCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('afl')
        .setDescription('Apply-for-leave system for staff')
        .setDMPermission(false)
        .addSubcommand((sub) =>
            sub.setName('panel').setDescription('Post the leave application panel with an Apply button'),
        )
        .addSubcommand((sub) =>
            sub
                .setName('approve')
                .setDescription('Approve a pending leave application')
                .addStringOption((o) => o.setName('id').setDescription('Application ID').setRequired(true))
                .addStringOption((o) => o.setName('reason').setDescription('Reason shared with the applicant').setRequired(false)),
        )
        .addSubcommand((sub) =>
            sub
                .setName('reject')
                .setDescription('Reject a pending leave application')
                .addStringOption((o) => o.setName('id').setDescription('Application ID').setRequired(true))
                .addStringOption((o) => o.setName('reason').setDescription('Reason shared with the applicant').setRequired(false)),
        )
        .addSubcommand((sub) =>
            sub
                .setName('check')
                .setDescription('Check the status of a leave application')
                .addStringOption((o) => o.setName('id').setDescription('Application ID').setRequired(true)),
        )
        .addSubcommand((sub) =>
            sub
                .setName('log')
                .setDescription('Set the channel that receives leave applications')
                .addChannelOption((o) =>
                    o.setName('channel').setDescription('Review/log channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName('admin')
                .setDescription('Add a role or user allowed to review leave applications')
                .addRoleOption((o) => o.setName('role').setDescription('Add a reviewer role').setRequired(false))
                .addUserOption((o) => o.setName('user').setDescription('Add a reviewer user').setRequired(false)),
        ),

    cooldown: 3,

    async execute(interaction) {
        const sub = interaction.options.getSubcommand(true);
        const guildId = interaction.guildId!;
        const config = await leaveSettings.getConfig(guildId);

        if (sub === 'panel') {
            await interaction.reply({ components: [buildLeavePanel()], flags: V2 });
            return;
        }

        if (sub === 'log') {
            if (!hasManageGuild(interaction)) {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Permission Denied', 'You need **Manage Server** to configure the leave log channel.')],
                    flags: V2 | EPH,
                });
                return;
            }
            const channel = interaction.options.getChannel('channel', true);
            const updated = await leaveSettings.setConfig(guildId, { logChannelId: channel.id });
            await interaction.reply({
                components: [ComponentsV2.successContainer('Leave Log Set', `New leave applications will be posted to <#${updated.logChannelId}>.`)],
                flags: V2 | EPH,
            });
            return;
        }

        if (sub === 'admin') {
            if (!hasManageGuild(interaction)) {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Permission Denied', 'You need **Manage Server** to configure leave reviewers.')],
                    flags: V2 | EPH,
                });
                return;
            }
            const role = interaction.options.getRole('role');
            const user = interaction.options.getUser('user');

            if (!role && !user) {
                const roles = config.adminRoleIds.map((id) => `<@&${id}>`).join(', ') || '_none_';
                const users = config.adminUserIds.map((id) => `<@${id}>`).join(', ') || '_none_';
                await interaction.reply({
                    components: [ComponentsV2.infoContainer(
                        'Leave Reviewers',
                        `› **Roles:** ${roles}\n› **Users:** ${users}\n\nAdd one with \`/afl admin role:@Role\` or \`/afl admin user:@User\`.`,
                    )],
                    flags: V2 | EPH,
                });
                return;
            }

            const adminRoleIds = [...config.adminRoleIds];
            const adminUserIds = [...config.adminUserIds];
            if (role && !adminRoleIds.includes(role.id)) adminRoleIds.push(role.id);
            if (user && !adminUserIds.includes(user.id)) adminUserIds.push(user.id);

            const updated = await leaveSettings.setConfig(guildId, { adminRoleIds, adminUserIds });
            await interaction.reply({
                components: [ComponentsV2.successContainer(
                    'Reviewers Updated',
                    `› **Roles:** ${updated.adminRoleIds.map((id) => `<@&${id}>`).join(', ') || '_none_'}\n` +
                    `› **Users:** ${updated.adminUserIds.map((id) => `<@${id}>`).join(', ') || '_none_'}`,
                )],
                flags: V2 | EPH,
            });
            return;
        }

        // Remaining subcommands operate on applications.
        const id = interaction.options.getString('id', true).trim();

        if (sub === 'check') {
            if (!isReviewer(interaction, config)) {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Permission Denied', 'Only configured leave reviewers can inspect applications.')],
                    flags: V2 | EPH,
                });
                return;
            }
            const app = await leaveSettings.getApplication(id);
            if (!app) {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Not Found', `No leave application matches \`${id}\`.`)],
                    flags: V2 | EPH,
                });
                return;
            }
            await interaction.reply({ components: [buildApplicationCard(app, config)], flags: V2 | EPH });
            return;
        }

        if (sub === 'approve' || sub === 'reject') {
            if (!isReviewer(interaction, config)) {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Permission Denied', 'Only configured leave reviewers can decide applications.')],
                    flags: V2 | EPH,
                });
                return;
            }
            await interaction.deferReply({ flags: EPH });
            const reason = interaction.options.getString('reason') || '';
            const result = await finalizeDecision(
                interaction.client,
                sub === 'approve' ? 'approved' : 'rejected',
                id,
                reason,
                interaction.user.id,
            );
            const container = result.ok
                ? ComponentsV2.successContainer('Decision Saved', result.message)
                : ComponentsV2.errorContainer('Action Failed', result.message);
            await interaction.editReply({ components: [container] });
        }
    },

    async handleButton(interaction) {
        const customId = interaction.customId;

        if (customId === APPLY_BUTTON) {
            await openApplyModal(interaction);
            return;
        }

        if (customId.startsWith('afl:approve:') || customId.startsWith('afl:reject:')) {
            const [prefix, action, applicationId] = customId.split(':');
            if (prefix !== 'afl' || !applicationId) return;

            const config = await leaveSettings.getConfig(interaction.guildId!);
            if (!isReviewer(interaction, config)) {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Permission Denied', 'Only configured leave reviewers can decide applications.')],
                    flags: V2 | EPH,
                });
                return;
            }
            const app = await leaveSettings.getApplication(applicationId);
            if (!app || app.status !== 'pending') {
                await interaction.reply({
                    components: [ComponentsV2.warningContainer('Already Decided', 'This application is no longer pending.')],
                    flags: V2 | EPH,
                });
                return;
            }
            await openDecisionModal(interaction, action === 'approve' ? 'approve' : 'reject', applicationId);
        }
    },

    async handleModal(interaction) {
        const customId = interaction.customId;

        if (customId === APPLY_MODAL) {
            if (!interaction.guildId) {
                await interaction.reply({ content: '❌ This can only be used inside a server.', flags: EPH });
                return;
            }
            const config = await leaveSettings.getConfig(interaction.guildId);

            if (!config.logChannelId) {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Not Configured', 'Leave applications are not open yet. An administrator must run `/afl log` first.')],
                    flags: V2 | EPH,
                });
                return;
            }

            const name = interaction.fields.getTextInputValue('name').trim();
            const role = interaction.fields.getTextInputValue('role').trim();
            const reason = interaction.fields.getTextInputValue('reason').trim();
            const days = interaction.fields.getTextInputValue('days').trim();

            const applicationId = Math.random().toString(36).slice(2, 8).toUpperCase();
            const application: LeaveApplication = {
                id: applicationId,
                guildId: interaction.guildId,
                channelId: null,
                messageId: null,
                userId: interaction.user.id,
                userName: interaction.user.username,
                name,
                role,
                reason,
                days,
                status: 'pending',
                submittedAt: new Date().toISOString(),
            };

            const logChannel = await interaction.guild?.channels.fetch(config.logChannelId).catch(() => null);
            if (!logChannel || !logChannel.isTextBased()) {
                await interaction.reply({
                    components: [ComponentsV2.errorContainer('Channel Missing', 'The configured leave log channel is unavailable. Please contact an administrator.')],
                    flags: V2 | EPH,
                });
                return;
            }

            await leaveSettings.createApplication(application);

            try {
                const message = await (logChannel as any).send({
                    components: [buildApplicationCard(application, config)],
                    flags: V2,
                });
                await leaveSettings.updateApplication(applicationId, {
                    channelId: logChannel.id,
                    messageId: message.id,
                });
            } catch (error) {
                logger.error('[AFL] Failed to post leave application card:', error);
            }

            await interaction.reply({
                components: [ComponentsV2.successContainer(
                    'Leave Request Submitted',
                    `Your application \`${applicationId}\` has been sent to the review team. ` +
                    `You will receive a private DM once it is approved or rejected.`,
                )],
                flags: V2 | EPH,
            });
            return;
        }

        if (customId.startsWith('afl_decision:')) {
            const [, decision, applicationId] = customId.split(':');
            if (!applicationId) return;

            const config = await leaveSettings.getConfig(interaction.guildId!);
            if (!isReviewer(interaction, config)) {
                await interaction.reply({ content: '❌ Only configured leave reviewers can decide applications.', flags: EPH });
                return;
            }

            await interaction.deferUpdate().catch(() => undefined);
            const reason = interaction.fields.getTextInputValue('reason').trim();
            const result = await finalizeDecision(
                interaction.client,
                decision === 'approve' ? 'approved' : 'rejected',
                applicationId,
                reason,
                interaction.user.id,
            );

            if (!result.ok) {
                await interaction.followUp({
                    components: [ComponentsV2.errorContainer('Action Failed', result.message)],
                    flags: V2 | EPH,
                }).catch(() => undefined);
                return;
            }

            await interaction.followUp({
                components: [ComponentsV2.successContainer('Decision Recorded', result.message)],
                flags: V2 | EPH,
            }).catch(() => undefined);
        }
    },
};
