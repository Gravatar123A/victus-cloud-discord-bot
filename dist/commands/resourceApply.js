import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, } from 'discord.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { supabase } from '../services/supabase.js';
import { publishedResourcesStore } from '../services/publishedResourcesStore.js';
import { logger } from '../utils/logger.js';
const PRIMARY_STAFF_ROLE_ID = '1340607428252794973';
const REWARD_COINS_AMOUNT = 40;
/**
 * Robust staff permission check.
 * Checks administrator permissions, manage guild, manage channels,
 * primary staff role, and any staff roles configured in server settings.
 */
async function checkIsStaff(interaction) {
    if (!interaction.guildId)
        return false;
    let member = interaction.member;
    if (!member || !('permissions' in member) || !('roles' in member)) {
        member = (await interaction.guild?.members.fetch(interaction.user.id).catch(() => null));
    }
    if (!member)
        return false;
    // 1. High-level permissions
    if ('permissions' in member && typeof member.permissions !== 'string') {
        if (member.permissions.has(PermissionFlagsBits.Administrator) ||
            member.permissions.has(PermissionFlagsBits.ManageGuild) ||
            member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return true;
        }
    }
    // 2. Fetch server-configured staff roles from Supabase + default staff role
    const settings = await supabase.getBotSettings(interaction.guildId).catch(() => null);
    const staffRoleIds = new Set([
        PRIMARY_STAFF_ROLE_ID,
        ...(settings?.ticket_staff_role_ids || []),
        ...(settings?.ticket_admin_role_ids || []),
    ]);
    // 3. Member roles check (supports both RoleManager cache and raw API array)
    const rolesObj = member.roles;
    if (rolesObj) {
        if (Array.isArray(rolesObj)) {
            if (rolesObj.some((id) => staffRoleIds.has(id)))
                return true;
        }
        else if (rolesObj.cache && typeof rolesObj.cache.has === 'function') {
            for (const id of staffRoleIds) {
                if (rolesObj.cache.has(id))
                    return true;
            }
        }
    }
    return false;
}
export const resourceApplyCommand = {
    data: new SlashCommandBuilder()
        .setName('resource-apply')
        .setDescription('Apply for staff review and 40 Victus Coins reward for one of your shared resource listings')
        .setDMPermission(false),
    cooldown: 5,
    async execute(interaction) {
        if (!interaction.guildId)
            return;
        // Defer reply immediately so interaction never times out in Discord UI
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        // 1. Account Link Check
        const linked = await supabase.getLinkedAccount(interaction.user.id).catch(() => null);
        if (!linked) {
            const warningContainer = ComponentsV2.cleanContainer(ComponentsV2.Accents.warning, 'Account Link Required', 'You must link your Victus Cloud account before applying for resource rewards!\n\n' +
                '› **Step 1:** Run `/link` to connect your Discord account to Victus Cloud.\n' +
                '› **Step 2:** Run `/resource-apply` again after completing the account connection.', 'ACCOUNT LINK REQUIRED');
            await interaction.editReply({
                components: [warningContainer],
                flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }
        // 2. Fetch User's Published Listings (exclude already-approved listings)
        const userListings = await publishedResourcesStore.getUserListings(interaction.user.id, interaction.guildId);
        const eligibleListings = userListings.filter((l) => !l.approved);
        if (eligibleListings.length === 0) {
            const noListingsContainer = ComponentsV2.cleanContainer(ComponentsV2.Accents.warning, 'No Eligible Resource Listings Found', userListings.length > 0
                ? 'All of your published resource listings have already been approved and rewarded!'
                : 'You have not published any resource listings yet!\n\n' +
                    '› **Step 1:** Run `/share-resource` to post your Minecraft mod, plugin, map, bot, or build to the forum.\n' +
                    '› **Step 2:** Run `/resource-apply` to select your published listing and request staff approval for 40 Victus Coins!', 'RESOURCE LISTING REQUIRED');
            await interaction.editReply({
                components: [noListingsContainer],
                flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }
        // 3. Build Select Menu GUI for user to pick listing
        const selectOptions = eligibleListings.slice(0, 25).map((l) => ({
            label: `[${l.category}] ${l.title}`.slice(0, 100),
            value: l.id,
            description: `Published on ${new Date(l.createdAt).toLocaleDateString()}`.slice(0, 100),
        }));
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('victus_res_select_apply')
            .setPlaceholder('Select a resource listing to apply for reward...')
            .addOptions(selectOptions);
        const row = new ActionRowBuilder().addComponents(selectMenu);
        const selectContainer = ComponentsV2.cleanContainer(ComponentsV2.Accents.primary, 'Select Resource Listing', `You have **${eligibleListings.length}** eligible resource listing(s) available.\n\n` +
            `Please select which resource listing you would like to submit to staff for verification and your **${REWARD_COINS_AMOUNT} Victus Coins** reward:`, 'REWARD APPLICATION');
        await interaction.editReply({
            components: [selectContainer, row],
            flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2,
        });
    },
    async handleSelectMenu(interaction) {
        if (interaction.customId !== 'victus_res_select_apply')
            return;
        if (!interaction.guildId)
            return;
        const listingId = interaction.values[0];
        const listing = await publishedResourcesStore.getListing(listingId);
        if (!listing || listing.userId !== interaction.user.id) {
            await interaction.update({
                content: null,
                components: [
                    ComponentsV2.cleanContainer(ComponentsV2.Accents.danger, 'Resource Listing Not Found', 'Could not find the specified resource listing. It may have been removed.', 'ERROR'),
                ],
            });
            return;
        }
        if (listing.approved) {
            await interaction.update({
                content: null,
                components: [
                    ComponentsV2.cleanContainer(ComponentsV2.Accents.warning, 'Already Approved', 'This resource listing has already been approved and rewarded by staff.', 'REWARD GRANTED'),
                ],
            });
            return;
        }
        const userId = interaction.user.id;
        const userTag = interaction.user.tag;
        // Staff review GUI in the forum listing
        const reviewContainer = ComponentsV2.cleanContainer(ComponentsV2.Accents.primary, 'Resource Reward Application', `### 📋 Submission Details\n` +
            `› **Creator / Applicant:** <@${userId}> (\`${userTag}\`)\n` +
            `› **Resource Title:** ${listing.title}\n` +
            `› **Category:** \`${listing.category}\`\n` +
            `› **Forum Listing:** [View Forum Post](${listing.threadUrl})\n` +
            `› **Primary Link:** ${listing.sourceUrl ? `[View Source Link](${listing.sourceUrl})` : '*(None provided)*'}\n\n` +
            `### Resource Summary\n` +
            `${listing.description.slice(0, 1500)}\n\n` +
            `### Staff Verification\n` +
            `Review this resource for community quality and validity. Approving this submission will automatically credit **${REWARD_COINS_AMOUNT} COINS** to <@${userId}>'s Victus Cloud account balance.`, 'STAFF REVIEW PANEL');
        const buttons = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(`victus_res_staff_approve:${userId}:${listing.id}`)
            .setLabel('Approve Resource (+40 Coins)')
            .setStyle(ButtonStyle.Success), new ButtonBuilder()
            .setCustomId(`victus_res_staff_reject:${userId}:${listing.id}`)
            .setLabel('Decline Submission')
            .setStyle(ButtonStyle.Danger));
        // 1. Resolve and post review card directly inside the resource's forum listing thread
        let targetThread = null;
        if (listing.threadId) {
            targetThread = await interaction.client.channels.fetch(listing.threadId).catch(() => null);
        }
        if (!targetThread && listing.threadUrl) {
            const match = listing.threadUrl.match(/\/(\d{17,20})\/?$/);
            if (match && match[1]) {
                targetThread = await interaction.client.channels.fetch(match[1]).catch(() => null);
            }
        }
        let postedSuccessfully = false;
        if (targetThread && targetThread.isTextBased() && 'send' in targetThread && typeof targetThread.send === 'function') {
            try {
                if (targetThread.archived && typeof targetThread.setArchived === 'function') {
                    await targetThread.setArchived(false).catch(() => { });
                }
                await targetThread.send({
                    content: `📢 <@&${PRIMARY_STAFF_ROLE_ID}> **New Resource Reward Application Submitted by <@${userId}>!**`,
                    components: [reviewContainer, buttons],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
                postedSuccessfully = true;
            }
            catch (threadSendErr) {
                logger.error(`Failed to post staff review card to thread ${targetThread.id}:`, threadSendErr);
            }
        }
        // Fallback: if thread could not be reached, try current channel if it supports messages
        if (!postedSuccessfully) {
            const currentChan = interaction.channel;
            if (currentChan && currentChan.isTextBased() && 'send' in currentChan && typeof currentChan.send === 'function') {
                try {
                    await currentChan.send({
                        content: `📢 <@&${PRIMARY_STAFF_ROLE_ID}> **New Resource Reward Application Submitted by <@${userId}>!**`,
                        components: [reviewContainer, buttons],
                        flags: ComponentsV2.IS_COMPONENTS_V2,
                    });
                    postedSuccessfully = true;
                }
                catch (currentChanErr) {
                    logger.error('Failed to post staff review card to current channel:', currentChanErr);
                }
            }
        }
        // Mark listing as submitted in store
        await publishedResourcesStore.submitApplication(listing.id);
        // Confirm to applicant by updating the select menu message
        await interaction.update({
            content: null,
            components: [
                ComponentsV2.cleanContainer(ComponentsV2.Accents.success, 'Application Submitted!', `Your resource application for **${listing.title}** has been sent to staff for review!\n\n` +
                    `› **Forum Listing:** [View Your Forum Post](${listing.threadUrl})\n` +
                    `Once staff approves your submission, **${REWARD_COINS_AMOUNT} COINS** will be automatically transferred to your Victus Cloud account.`, 'APPLICATION SENT'),
            ],
        });
    },
    async handleButton(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('victus_res_staff_'))
            return;
        if (!interaction.guildId)
            return;
        // Enforce strict Staff Role / Administrator permissions
        const isStaff = await checkIsStaff(interaction);
        if (!isStaff) {
            await interaction.reply({
                components: [
                    ComponentsV2.cleanContainer(ComponentsV2.Accents.danger, 'Permission Denied', `Only staff members with the <@&${PRIMARY_STAFF_ROLE_ID}> role can review, approve, or decline resource submissions.`, 'ACCESS RESTRICTED'),
                ],
                flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }
        const parts = customId.split(':');
        const action = parts[0];
        const applicantUserId = parts[1];
        const listingId = parts[2];
        const listing = await publishedResourcesStore.getListing(listingId);
        // 1. Staff Approve Action
        if (action === 'victus_res_staff_approve') {
            if (listing?.approved) {
                await interaction.reply({
                    content: '⚠️ This resource submission has already been approved.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            if (listingId) {
                await publishedResourcesStore.markApplied(listingId, true, {
                    reviewedBy: interaction.user.id,
                });
            }
            // Award 40 coins to applicant in Paymenter and Supabase
            await supabase.grantResourceShareCoins(applicantUserId, REWARD_COINS_AMOUNT, `resource_approval:${listingId || 'manual'}:${applicantUserId}`);
            const resultContainer = ComponentsV2.cleanContainer(ComponentsV2.Accents.success, 'Resource Submission Approved', `✅ **Application Approved by <@${interaction.user.id}>.**\n\n` +
                `› **Creator:** <@${applicantUserId}>\n` +
                `› **Resource:** ${listing ? listing.title : 'Resource Submission'}\n` +
                `› **Reward Credited:** **+${REWARD_COINS_AMOUNT} COINS**\n\n` +
                `The reward has been automatically deposited into <@${applicantUserId}>'s Victus Cloud account balance.`, 'APPROVAL CONFIRMED');
            await interaction.update({
                content: `✅ **Resource Application Approved by <@${interaction.user.id}>**`,
                components: [resultContainer],
            });
            // DM notification to applicant
            try {
                const applicant = await interaction.client.users.fetch(applicantUserId).catch(() => null);
                await applicant?.send(`🎉 **Congratulations!** Your resource submission for **${listing?.title || 'your resource'}** was officially approved by staff member <@${interaction.user.id}>!\n\n` +
                    `**+${REWARD_COINS_AMOUNT} COINS** have been automatically credited to your Victus Cloud account balance.`);
            }
            catch (err) {
                logger.debug(`Could not DM applicant ${applicantUserId}:`, err);
            }
            return;
        }
        // 2. Staff Reject Action -> Display modal for optional rejection reason
        if (action === 'victus_res_staff_reject') {
            const modal = new ModalBuilder()
                .setCustomId(`victus_res_modal_reject:${applicantUserId}:${listingId}`)
                .setTitle('Decline Resource Submission');
            const reasonInput = new TextInputBuilder()
                .setCustomId('reject_reason')
                .setLabel('Reason for Declining (Optional)')
                .setPlaceholder('e.g. Incomplete description, broken link, lacks proof...')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(500);
            const row = new ActionRowBuilder().addComponents(reasonInput);
            modal.addComponents(row);
            try {
                await interaction.showModal(modal);
                return;
            }
            catch (modalErr) {
                logger.warn('Could not display rejection modal, falling back to direct decline:', modalErr);
            }
            // Fallback direct decline if modal cannot be opened
            if (listingId) {
                await publishedResourcesStore.markApplied(listingId, false, {
                    reviewedBy: interaction.user.id,
                    rejectionReason: 'Does not meet current community resource guidelines.',
                });
            }
            const resultContainer = ComponentsV2.cleanContainer(ComponentsV2.Accents.danger, 'Resource Submission Declined', `❌ **Application Declined by <@${interaction.user.id}>.**\n\n` +
                `› **Creator:** <@${applicantUserId}>\n` +
                `› **Resource:** ${listing ? listing.title : 'Resource Submission'}\n` +
                `› **Reason:** Does not meet current community resource guidelines.`, 'SUBMISSION DECLINED');
            await interaction.update({
                content: `❌ **Resource Application Declined by <@${interaction.user.id}>**`,
                components: [resultContainer],
            });
            // DM notification to applicant
            try {
                const applicant = await interaction.client.users.fetch(applicantUserId).catch(() => null);
                await applicant?.send(`⚠️ Your resource submission application for **${listing?.title || 'your resource'}** was reviewed by Victus staff and declined.\n\n` +
                    `Feel free to review community guidelines and submit again.`);
            }
            catch (err) {
                logger.debug(`Could not DM applicant ${applicantUserId}:`, err);
            }
            return;
        }
    },
    async handleModal(interaction) {
        if (!interaction.customId.startsWith('victus_res_modal_reject:'))
            return;
        if (!interaction.guildId)
            return;
        // Enforce strict staff check on modal submission
        const isStaff = await checkIsStaff(interaction);
        if (!isStaff) {
            await interaction.reply({
                components: [
                    ComponentsV2.cleanContainer(ComponentsV2.Accents.danger, 'Permission Denied', 'Only authorized staff members can decline resource submissions.', 'ACCESS RESTRICTED'),
                ],
                flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }
        const parts = interaction.customId.split(':');
        const applicantUserId = parts[1];
        const listingId = parts[2];
        const reason = interaction.fields.getTextInputValue('reject_reason')?.trim() ||
            'Does not meet current community resource guidelines.';
        const listing = await publishedResourcesStore.getListing(listingId);
        if (listingId) {
            await publishedResourcesStore.markApplied(listingId, false, {
                reviewedBy: interaction.user.id,
                rejectionReason: reason,
            });
        }
        const resultContainer = ComponentsV2.cleanContainer(ComponentsV2.Accents.danger, 'Resource Submission Declined', `❌ **Application Declined by <@${interaction.user.id}>.**\n\n` +
            `› **Creator:** <@${applicantUserId}>\n` +
            `› **Resource:** ${listing ? listing.title : 'Resource Submission'}\n` +
            `› **Reason:** ${reason}\n\n` +
            `The applicant has been notified via direct message.`, 'SUBMISSION DECLINED');
        if (interaction.isFromMessage()) {
            await interaction.update({
                content: `❌ **Resource Application Declined by <@${interaction.user.id}>**`,
                components: [resultContainer],
            });
        }
        else {
            await interaction.reply({
                content: `❌ **Resource Application Declined by <@${interaction.user.id}>**`,
                components: [resultContainer],
            });
        }
        // DM notification to applicant
        try {
            const applicant = await interaction.client.users.fetch(applicantUserId).catch(() => null);
            await applicant?.send(`⚠️ Your resource reward application for **${listing?.title || 'your submission'}** was reviewed by staff and declined.\n\n` +
                `› **Reason:** ${reason}\n\n` +
                `You are welcome to update your resource listing and re-apply once addressed.`);
        }
        catch (err) {
            logger.debug(`Could not DM applicant ${applicantUserId}:`, err);
        }
    },
};
