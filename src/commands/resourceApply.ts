import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
} from 'discord.js';
import type { Command } from '../types/index.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { supabase } from '../services/supabase.js';
import { publishedResourcesStore } from '../services/publishedResourcesStore.js';
import { logger } from '../utils/logger.js';

const STAFF_ROLE_ID = '1340607428252794973';
const REWARD_COINS_AMOUNT = 40;

export const resourceApplyCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('resource-apply')
        .setDescription('Apply for staff review and 40 Victus Coins reward for one of your shared resource listings')
        .setDMPermission(false),

    cooldown: 5,

    async execute(interaction) {
        if (!interaction.guildId) return;

        // Defer reply immediately so interaction never times out in Discord UI
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

            await interaction.editReply({
                components: [warningContainer],
                flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2,
            });
            return;
        }

        // 2. Fetch User's Published Listings
        const userListings = await publishedResourcesStore.getUserListings(interaction.user.id, interaction.guildId);
        const eligibleListings = userListings.filter((l) => !l.applied);

        if (eligibleListings.length === 0) {
            const noListingsContainer = ComponentsV2.cleanContainer(
                ComponentsV2.Accents.warning,
                'No Eligible Resource Listings Found',
                userListings.length > 0
                    ? 'All of your published resource listings have already been submitted for reward review!'
                    : 'You have not published any resource listings yet!\n\n' +
                      '› **Step 1:** Run `/share-resource` to post your Minecraft mod, plugin, map, bot, or build to the forum.\n' +
                      '› **Step 2:** Run `/resource-apply` to select your published listing and request staff approval for 40 Victus Coins!',
                'RESOURCE LISTING REQUIRED'
            );

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

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

        const selectContainer = ComponentsV2.cleanContainer(
            ComponentsV2.Accents.primary,
            'Select Resource Listing',
            `You have **${eligibleListings.length}** eligible resource listing(s) available.\n\n` +
            `Please select which resource listing you would like to submit to staff for verification and your **${REWARD_COINS_AMOUNT} Victus Coins** reward:`,
            'REWARD APPLICATION'
        );

        await interaction.editReply({
            components: [selectContainer, row],
            flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2,
        });
    },

async handleSelectMenu(interaction) {
        if (interaction.customId !== 'victus_res_select_apply') return;
        if (!interaction.guildId) return;

        const listingId = interaction.values[0];
        const listing = await publishedResourcesStore.getListing(listingId);

        if (!listing || listing.userId !== interaction.user.id) {
            await interaction.update({
                content: null,
                components: [
                    ComponentsV2.cleanContainer(
                        ComponentsV2.Accents.danger,
                        'Resource Listing Not Found',
                        'Could not find the specified resource listing. It may have been removed.',
                        'ERROR'
                    ),
                ],
            });
            return;
        }

        if (listing.applied) {
            await interaction.update({
                content: null,
                components: [
                    ComponentsV2.cleanContainer(
                        ComponentsV2.Accents.warning,
                        'Already Applied',
                        'This resource listing has already been submitted for staff review.',
                        'DUPLICATE APPLICATION'
                    ),
                ],
            });
            return;
        }

        const userId = interaction.user.id;
        const userTag = interaction.user.tag;

        // Staff review GUI without top banner image
        const reviewContainer = ComponentsV2.cleanContainer(
            ComponentsV2.Accents.primary,
            'Resource Reward Application',
            `dY"O **Submission Details**\n\n` +
            `�?� **Creator / Applicant:** <@${userId}> (\`${userTag}\`)\n` +
            `�?� **Resource Title:** ${listing.title}\n` +
            `�?� **Category:** ${listing.category}\n` +
            `�?� **Forum Listing:** [View Forum Post](${listing.threadUrl})\n` +
            `�?� **Primary Link:** ${listing.sourceUrl ? `[View Source Link](${listing.sourceUrl})` : 'N/A'}\n\n` +
            `### Resource Summary\n` +
            `${listing.description.slice(0, 1500)}\n\n` +
            `### Staff Verification\n` +
            `Review the resource for quality and compliance. Approving this submission will automatically grant **${REWARD_COINS_AMOUNT} COINS** to <@${userId}>'s Victus Cloud account balance.`,
            'STAFF REVIEW PANEL'
        );

        const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`victus_res_staff_approve:${userId}:${listing.id}`)
                .setLabel('Approve Resource (+40 Coins)')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`victus_res_staff_reject:${userId}:${listing.id}`)
                .setLabel('Decline Submission')
                .setStyle(ButtonStyle.Danger)
        );

        // Post public channel review card with Staff role ping
        try {
            const targetChannel = interaction.channel;
            if (targetChannel && targetChannel.isTextBased() && typeof targetChannel.send === 'function') {
                await targetChannel.send({
                    content: `dY"" <@&${STAFF_ROLE_ID}> **New Resource Reward Application Submitted by <@${userId}>!**`,
                    components: [reviewContainer, buttons],
                    flags: ComponentsV2.IS_COMPONENTS_V2,
                });
            } else {
                logger.warn(`Could not find sendable channel to post staff review card for applicant ${userId}`);
            }
        } catch (sendErr) {
            logger.error('Failed to post staff review card to channel:', sendErr);
        }

        // Confirm to applicant by updating the select menu message
        await interaction.update({
            content: null,
            components: [
                ComponentsV2.cleanContainer(
                    ComponentsV2.Accents.success,
                    'Application Submitted!',
                    `Your resource application for **${listing.title}** has been sent to staff for review!\n\n` +
                    `Once staff approves your submission, **${REWARD_COINS_AMOUNT} COINS** will be automatically transferred to your Victus Cloud account.`,
                    'APPLICATION SENT'
                ),
            ],
        });
    },

    async handleButton(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('victus_res_staff_')) return;
        if (!interaction.guildId) return;

        const parts = customId.split(':');
        const action = parts[0];
        const applicantUserId = parts[1];
        const listingId = parts[2];

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

        if (action === 'victus_res_staff_approve') {
            const resultContainer = ComponentsV2.cleanContainer(
                ComponentsV2.Accents.success,
                'Resource Submission Approved',
                `✅ **Application Approved by <@${interaction.user.id}>.**\n\n` +
                `The resource submission from <@${applicantUserId}> was reviewed and approved by staff. **${REWARD_COINS_AMOUNT} COINS** have been credited to your Victus Cloud account.`,
                'APPROVAL CONFIRMED'
            );

            await interaction.update({
                content: `✅ **Resource Application Approved by <@${interaction.user.id}>**`,
                components: [resultContainer],
            });

            // DM notification to applicant
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
            if (listingId) {
                await publishedResourcesStore.markApplied(listingId, false);
            }

            const resultContainer = ComponentsV2.cleanContainer(
                ComponentsV2.Accents.danger,
                'Resource Submission Declined',
                `❌ **Application Declined by <@${interaction.user.id}>.**\n\n` +
                `The resource submission from <@${applicantUserId}> was reviewed and declined by staff.`,
                'SUBMISSION DECLINED'
            );

            await interaction.update({
                content: `❌ **Resource Application Declined by <@${interaction.user.id}>**`,
                components: [resultContainer],
            });

            // DM notification to applicant
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
