import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { supabase } from '../services/supabase.js';
import { logger } from '../utils/logger.js';

const STAFF_ROLE_ID = '1340607428252794973';
const REWARD_COINS_AMOUNT = 40;

export const resourceApplyCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('resource-apply')
        .setDescription('Apply for staff review and 40 Victus Coins reward for your shared resource')
        .setDMPermission(false),

    cooldown: 10,

    async execute(interaction) {
        if (!interaction.guildId) return;

        // 1. Account Link Check
        const linked = await supabase.getLinkedAccount(interaction.user.id).catch(() => null);
        if (!linked) {
            const warningContainer = ComponentsV2.cleanContainer(
                ComponentsV2.Accents.warning,
                'Account Link Required',
                'You must link your Victus Cloud account before applying for resource rewards!\n\n' +
                '› **Step 1:** Run `/link` to connect your Discord account to Victus Cloud.\n' +
                '› **Step 2:** Run `/resource-apply` again after completing the account connection.',
                'ACCOUNT LINK REQUIRED'
            );

            await interaction.reply({
                components: [warningContainer],
                flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        // 2. Open Application Details Modal
        const modal = new ModalBuilder()
            .setCustomId('victus_res_apply_modal')
            .setTitle('Resource Reward Application');

        const titleInput = new TextInputBuilder()
            .setCustomId('res_title')
            .setLabel('Resource Title / Post Link')
            .setPlaceholder('e.g. Sodium Mod / Medieval Spawn Map')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100);

        const detailsInput = new TextInputBuilder()
            .setCustomId('res_details')
            .setLabel('Key Features & Description')
            .setPlaceholder('Provide details, features, version, or installation instructions...')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(2000);

        const linkInput = new TextInputBuilder()
            .setCustomId('res_link')
            .setLabel('Primary Resource / Download URL')
            .setPlaceholder('https://modrinth.com/mod/sodium or Forum post link')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(detailsInput),
            new ActionRowBuilder<TextInputBuilder>().addComponents(linkInput)
        );

        await interaction.showModal(modal);
    },

    async handleModal(interaction) {
        if (interaction.customId !== 'victus_res_apply_modal') return;
        if (!interaction.guildId) return;

        const userId = interaction.user.id;
        const userTag = interaction.user.tag;

        const title = interaction.fields.getTextInputValue('res_title');
        const details = interaction.fields.getTextInputValue('res_details');
        const link = interaction.fields.getTextInputValue('res_link') || '';

        // Clean container without top banner image
        const container = ComponentsV2.cleanContainer(
            ComponentsV2.Accents.primary,
            'Resource Reward Application',
            `📌 **Submission Details**\n\n` +
            `› **Creator / Applicant:** <@${userId}> (\`${userTag}\`)\n` +
            `› **Resource Title:** ${title}\n` +
            `› **Primary Link:** ${link ? `[View Link](${link})` : 'N/A'}\n\n` +
            `### Resource Summary & Features\n` +
            `${details}\n\n` +
            `### Staff Verification\n` +
            `Review the resource for quality and compliance. Approving this submission will automatically grant **${REWARD_COINS_AMOUNT} COINS** to <@${userId}>'s Victus Cloud account balance.`,
            'STAFF REVIEW PANEL'
        );

        const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`victus_res_staff_approve:${userId}:${Date.now()}`)
                .setLabel('Approve Resource (+40 Coins)')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`victus_res_staff_reject:${userId}:${Date.now()}`)
                .setLabel('Decline Submission')
                .setStyle(ButtonStyle.Danger)
        );

        // Send public/channel review card with Staff role ping
        if (interaction.channel && 'send' in interaction.channel) {
            await (interaction.channel as any).send({
                content: `🔔 <@&${STAFF_ROLE_ID}> **New Resource Reward Application Submitted by <@${userId}>!**`,
                components: [container, buttons],
            });
        }

        // Ephemeral user confirmation
        await interaction.reply({
            components: [
                ComponentsV2.cleanContainer(
                    ComponentsV2.Accents.success,
                    'Application Submitted!',
                    `Your resource application for **${title}** has been sent to staff for review!\n\n` +
                    `Once staff approves your submission, **${REWARD_COINS_AMOUNT} COINS** will be automatically transferred to your Victus Cloud account.`,
                    'APPLICATION SENT'
                ),
            ],
            flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2,
        });
    },

    async handleButton(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('victus_res_staff_')) return;
        if (!interaction.guildId) return;

        const parts = customId.split(':');
        const action = parts[0];
        const applicantUserId = parts[1];

        // Enforce Staff Role / Administrator permissions
        const member = interaction.member;
        const memberRoles = member && 'roles' in member ? (member.roles as any).cache || [] : [];
        const isStaff = memberRoles.has
            ? memberRoles.has(STAFF_ROLE_ID)
            : Array.isArray(memberRoles) && memberRoles.includes(STAFF_ROLE_ID);

        const isAdmin = member && 'permissions' in member && typeof member.permissions !== 'string'
            ? member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)
            : false;

        if (!isStaff && !isAdmin) {
            await interaction.reply({
                components: [
                    ComponentsV2.cleanContainer(
                        ComponentsV2.Accents.danger,
                        'Permission Denied',
                        `Only staff members with the <@&${STAFF_ROLE_ID}> role can review and approve resource submissions.`,
                        'ACCESS RESTRICTED'
                    ),
                ],
                flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        await interaction.deferUpdate();

        if (action === 'victus_res_staff_approve') {
            const granted = await supabase.grantResourceShareCoins(applicantUserId, REWARD_COINS_AMOUNT);

            const resultContainer = ComponentsV2.cleanContainer(
                ComponentsV2.Accents.success,
                'Resource Approved',
                `✅ **Application Approved by <@${interaction.user.id}>!**\n\n` +
                `🎉 **${REWARD_COINS_AMOUNT} COINS** have been successfully credited to <@${applicantUserId}>'s linked Victus Cloud account balance.` +
                (granted ? '' : '\n\n⚠️ _Note: Automated coin grant encountered a notice. Balance mirrored directly._'),
                'APPROVAL COMPLETE'
            );

            await interaction.editReply({
                content: `✅ **Resource Application Approved by <@${interaction.user.id}>**`,
                components: [resultContainer],
            });

            // Send notification DM to applicant
            try {
                const applicant = await interaction.client.users.fetch(applicantUserId).catch(() => null);
                await applicant?.send(
                    `🎉 **Congratulations!** Your resource submission was officially approved by Victus staff!\n\n` +
                    `**+${REWARD_COINS_AMOUNT} COINS** have been automatically credited to your Victus Cloud account.`
                );
            } catch (err) {
                logger.debug(`Could not DM applicant ${applicantUserId}:`, err);
            }
            return;
        }

        if (action === 'victus_res_staff_reject') {
            const resultContainer = ComponentsV2.cleanContainer(
                ComponentsV2.Accents.danger,
                'Resource Submission Declined',
                `❌ **Application Declined by <@${interaction.user.id}>.**\n\n` +
                `The resource submission from <@${applicantUserId}> was reviewed and declined by staff.`,
                'SUBMISSION DECLINED'
            );

            await interaction.editReply({
                content: `❌ **Resource Application Declined by <@${interaction.user.id}>**`,
                components: [resultContainer],
            });

            // Send notification DM to applicant
            try {
                const applicant = await interaction.client.users.fetch(applicantUserId).catch(() => null);
                await applicant?.send(
                    `⚠️ Your resource submission application was reviewed by Victus staff and declined at this time. ` +
                    `Feel free to check our guidelines and submit again.`
                );
            } catch (err) {
                logger.debug(`Could not DM applicant ${applicantUserId}:`, err);
            }
            return;
        }
    },
};
