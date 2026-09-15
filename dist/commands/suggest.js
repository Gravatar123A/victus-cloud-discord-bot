import { ActionRowBuilder, ChannelType, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle, ThreadAutoArchiveDuration, } from 'discord.js';
import { supabase } from '../services/supabase.js';
import { suggestionService } from '../services/suggestionService.js';
import { SuggestionEmbeds } from '../embeds/suggestionEmbeds.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';
import { isVictusStaffOrAdmin } from '../utils/staffAuth.js';
const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;
export const suggestCommand = {
    data: new SlashCommandBuilder()
        .setName('suggest')
        .setDescription('Open the Victus Cloud interactive suggestion hub to submit a proposal')
        .setDMPermission(false)
        .addStringOption((o) => o.setName('title').setDescription('Optional: Direct title for fast submission').setRequired(false).setMaxLength(100))
        .addStringOption((o) => o.setName('content').setDescription('Optional: Direct proposal details').setRequired(false).setMaxLength(1500)),
    cooldown: 5,
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({ content: '⚠️ This command can only be used in a server.', flags: EPH });
            return;
        }
        const forumChannel = await suggestionService.getForumChannel(interaction.guild);
        if (!forumChannel) {
            const errCard = ComponentsV2.errorContainer('Suggestions Not Configured', 'No **Forum Channel** has been configured for suggestions yet.\n\nAn administrator must set one up by running `/suggestion config`.');
            await interaction.reply({ components: [errCard], flags: V2 | EPH });
            return;
        }
        const directTitle = interaction.options.getString('title')?.trim();
        const directContent = interaction.options.getString('content')?.trim();
        // If user provided title and content directly, launch modal or pre-populated launcher
        const initialCategories = [];
        const { container, rows } = SuggestionEmbeds.buildLauncher(initialCategories);
        // If direct title was provided, store in ephemeral hint
        if (directTitle && directContent) {
            const hintCard = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
            hintCard.addTextDisplayComponents(ComponentsV2.text(`-# 💡 VICTUS CLOUD • COMMUNITY SUGGESTION HUB\n` +
                `# Draft: "${directTitle}"\n\n` +
                `**Details Provided:**\n> ${directContent.slice(0, 200)}${directContent.length > 200 ? '...' : ''}\n\n` +
                `### 🏷️ Step 1: Select 1 to 3 Categories Below\n` +
                `Choose the best sectors for your suggestion, then click **Enter Suggestion Details** to review and submit.`));
            hintCard.addSeparatorComponents(ComponentsV2.separator(true));
            await interaction.reply({
                components: [hintCard, ...rows],
                flags: V2 | EPH,
            });
            return;
        }
        await interaction.reply({
            components: [container, ...rows],
            flags: V2 | EPH,
        });
    },
    async handleSelectMenu(interaction) {
        if (interaction.customId !== 'suggest:category_select')
            return;
        const selectedKeys = interaction.values;
        const { container, rows } = SuggestionEmbeds.buildLauncher(selectedKeys);
        await interaction.update({
            components: [container, ...rows],
            flags: V2,
        });
    },
    async handleButton(interaction) {
        const customId = interaction.customId;
        // 1. Suggestion Creation Modal Open
        if (customId.startsWith('suggest:open_modal:')) {
            const rawCats = customId.replace('suggest:open_modal:', '');
            const selectedCats = rawCats && rawCats !== 'none' ? rawCats.split(',') : ['general'];
            const modal = new ModalBuilder()
                .setCustomId(`suggest_modal:submit:${selectedCats.join(',')}`)
                .setTitle('Submit Community Suggestion');
            const titleInput = new TextInputBuilder()
                .setCustomId('title')
                .setLabel('Suggestion Title')
                .setPlaceholder('Clear, concise summary (e.g. Add auto-backup scheduling)')
                .setStyle(TextInputStyle.Short)
                .setMinLength(5)
                .setMaxLength(100)
                .setRequired(true);
            const contentInput = new TextInputBuilder()
                .setCustomId('content')
                .setLabel('Proposal Details & Description')
                .setPlaceholder('Explain what you would like to see, why, and how it should work...')
                .setStyle(TextInputStyle.Paragraph)
                .setMinLength(15)
                .setMaxLength(2000)
                .setRequired(true);
            const impactInput = new TextInputBuilder()
                .setCustomId('impact')
                .setLabel('Expected Value & Impact (Optional)')
                .setPlaceholder('How does this benefit Victus Cloud users or server owners?')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(500)
                .setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(titleInput), new ActionRowBuilder().addComponents(contentInput), new ActionRowBuilder().addComponents(impactInput));
            await interaction.showModal(modal);
            return;
        }
        // 2. Suggestion Cancel
        if (customId === 'suggest:cancel') {
            await interaction.update({
                content: '🚫 Suggestion draft cancelled.',
                components: [],
            });
            return;
        }
        // 3. Voting: Upvote & Downvote
        if (customId.startsWith('suggest:upvote:') || customId.startsWith('suggest:downvote:')) {
            const parts = customId.split(':');
            const voteType = parts[1];
            const suggestionId = parseInt(parts[2], 10);
            if (isNaN(suggestionId))
                return;
            const suggestion = await suggestionService.getSuggestion(suggestionId);
            if (!suggestion) {
                await interaction.reply({ content: '❌ Suggestion not found in records.', flags: EPH });
                return;
            }
            if (suggestion.locked) {
                await interaction.reply({ content: '🔒 Voting is currently locked for this suggestion.', flags: EPH });
                return;
            }
            await interaction.deferReply({ flags: EPH });
            const type = voteType === 'upvote' ? 'up' : 'down';
            const result = await suggestionService.voteSuggestion(suggestionId, interaction.user, type);
            // Re-render message card
            const { container, rows } = SuggestionEmbeds.buildSuggestionCard(suggestion, result.up, result.down, result.userVote);
            await interaction.message.edit({
                components: [container, ...rows],
                flags: V2,
            }).catch((err) => logger.warn('Failed to edit suggestion card after vote:', err));
            if (result.removed) {
                await interaction.editReply({ content: '↩️ Your vote has been removed.' });
            }
            else {
                await interaction.editReply({
                    content: `✅ Recorded your **${type === 'up' ? '👍 Upvote' : '👎 Downvote'}**! Net Score is now **${result.up - result.down}**.`,
                });
            }
            return;
        }
        // 4. Voters Log
        if (customId.startsWith('suggest:voters:')) {
            const suggestionId = parseInt(customId.split(':')[2], 10);
            if (isNaN(suggestionId))
                return;
            await interaction.deferReply({ flags: V2 | EPH });
            const votes = await suggestionService.getVotes(suggestionId);
            const card = SuggestionEmbeds.buildVotersCard(suggestionId, votes);
            await interaction.editReply({
                components: [card],
                flags: V2,
            });
            return;
        }
        // 5. Staff Moderation Buttons
        if (customId.startsWith('suggest_mod:')) {
            const parts = customId.split(':');
            const action = parts[1];
            const suggestionId = parseInt(parts[2], 10);
            if (isNaN(suggestionId))
                return;
            // Auth check: Platform admin or ManageGuild
            const isStaff = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
                (await isVictusStaffOrAdmin(interaction.user, interaction.client));
            if (!isStaff) {
                await interaction.reply({
                    content: '⛔ You do not have permission to moderate suggestions.',
                    flags: EPH,
                });
                return;
            }
            const suggestion = await suggestionService.getSuggestion(suggestionId);
            if (!suggestion) {
                await interaction.reply({ content: '❌ Suggestion not found in database.', flags: EPH });
                return;
            }
            // Accept Modal
            if (action === 'accept') {
                const modal = new ModalBuilder()
                    .setCustomId(`suggest_modal:accept:${suggestionId}`)
                    .setTitle(`Accept Suggestion #${suggestionId}`);
                const noteInput = new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Acceptance Note / Roadmap Details (Optional)')
                    .setPlaceholder('e.g. Approved for implementation! Will be added in the next update.')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(1000)
                    .setRequired(false);
                modal.addComponents(new ActionRowBuilder().addComponents(noteInput));
                await interaction.showModal(modal);
                return;
            }
            // Reject Modal
            if (action === 'reject') {
                const modal = new ModalBuilder()
                    .setCustomId(`suggest_modal:reject:${suggestionId}`)
                    .setTitle(`Reject Suggestion #${suggestionId}`);
                const reasonInput = new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Reason for Rejection (Required)')
                    .setPlaceholder('Explain why this suggestion is declined at this time...')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMinLength(5)
                    .setMaxLength(1000)
                    .setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
                await interaction.showModal(modal);
                return;
            }
            // Implement Modal
            if (action === 'implement') {
                const modal = new ModalBuilder()
                    .setCustomId(`suggest_modal:implement:${suggestionId}`)
                    .setTitle(`Implement Suggestion #${suggestionId}`);
                const changelogInput = new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Changelog Notes / Release Info (Optional)')
                    .setPlaceholder('e.g. Deployed in v2.4! Check the release notes.')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(1000)
                    .setRequired(false);
                modal.addComponents(new ActionRowBuilder().addComponents(changelogInput));
                await interaction.showModal(modal);
                return;
            }
            // Toggle Lock
            if (action === 'lock') {
                await interaction.deferReply({ flags: EPH });
                const updated = await suggestionService.toggleLock(suggestionId);
                const counts = await suggestionService.getVoteCounts(suggestionId);
                if (updated) {
                    const { container, rows } = SuggestionEmbeds.buildSuggestionCard(updated, counts.up, counts.down);
                    await interaction.message.edit({
                        components: [container, ...rows],
                        flags: V2,
                    }).catch(() => { });
                }
                await interaction.editReply({
                    content: updated?.locked ? '🔒 Suggestion voting locked.' : '🔓 Suggestion voting unlocked.',
                });
                return;
            }
            // Delete Suggestion
            if (action === 'delete') {
                await interaction.deferReply({ flags: EPH });
                await suggestionService.deleteSuggestion(suggestionId);
                await interaction.editReply({ content: '🗑️ Suggestion deleted.' });
                // If message is in thread, delete thread
                if (interaction.channel?.isThread()) {
                    await interaction.channel.delete('Suggestion deleted by staff').catch(() => { });
                }
                else {
                    await interaction.message.delete().catch(() => { });
                }
                return;
            }
        }
    },
    async handleModal(interaction) {
        const customId = interaction.customId;
        // 1. Submit New Suggestion
        if (customId.startsWith('suggest_modal:submit:')) {
            await interaction.deferReply({ flags: V2 | EPH });
            const rawCats = customId.replace('suggest_modal:submit:', '');
            const selectedCategoryKeys = (rawCats && rawCats !== 'none'
                ? rawCats.split(',')
                : ['general']);
            const title = interaction.fields.getTextInputValue('title').trim();
            const content = interaction.fields.getTextInputValue('content').trim();
            const impact = interaction.fields.getTextInputValue('impact')?.trim() || undefined;
            if (!interaction.guild) {
                await interaction.editReply({ content: '⚠️ Missing server context.' });
                return;
            }
            const forumChannel = await suggestionService.getForumChannel(interaction.guild);
            if (!forumChannel) {
                const errCard = ComponentsV2.errorContainer('Suggestions Not Configured', 'The Forum Channel for suggestions has not been configured or is missing. Please contact staff.');
                await interaction.editReply({ components: [errCard], flags: V2 });
                return;
            }
            try {
                // Auto-reconcile forum tags
                const tagMap = await suggestionService.reconcileForumTags(forumChannel);
                // Prepare applied tags: Pending status tag + category tags (max 5 tags allowed by Discord)
                const appliedTags = [];
                if (tagMap['pending']) {
                    appliedTags.push(tagMap['pending']);
                }
                for (const catKey of selectedCategoryKeys) {
                    if (tagMap[catKey] && !appliedTags.includes(tagMap[catKey])) {
                        appliedTags.push(tagMap[catKey]);
                    }
                }
                // Initial placeholder card
                const placeholderSuggestion = {
                    id: 0,
                    guild_id: interaction.guild.id,
                    channel_id: forumChannel.id,
                    message_id: '',
                    user_id: interaction.user.id,
                    author_tag: interaction.user.tag || interaction.user.username,
                    title,
                    content,
                    impact,
                    categories: selectedCategoryKeys,
                    status: 'pending',
                    locked: false,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                };
                const { container: initialCard, rows: initialRows } = SuggestionEmbeds.buildSuggestionCard(placeholderSuggestion, 0, 0);
                // Create the forum thread/post (Components V2 does not allow legacy content field)
                const thread = await forumChannel.threads.create({
                    name: `💡 [Pending] ${title.slice(0, 80)}`,
                    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
                    appliedTags: appliedTags.slice(0, 5),
                    message: {
                        components: [initialCard, ...initialRows],
                        flags: V2,
                    },
                });
                // Send notification and ping author in the forum thread
                await thread.send({
                    content: `💡 **New Suggestion from** <@${interaction.user.id}>! Join the discussion below or cast your vote with the buttons.`,
                }).catch(() => { });
                // Fetch starter message
                const starterMessage = await thread.fetchStarterMessage().catch(() => null);
                const messageId = starterMessage?.id || thread.id;
                // Create permanent record
                const createdSuggestion = await suggestionService.createSuggestionRecord(interaction.guild.id, forumChannel.id, thread.id, messageId, interaction.user.id, interaction.user.tag || interaction.user.username, title, content, impact, selectedCategoryKeys);
                // Update starter message with actual suggestion ID
                if (starterMessage) {
                    const { container: finalCard, rows: finalRows } = SuggestionEmbeds.buildSuggestionCard(createdSuggestion, 0, 0);
                    await starterMessage.edit({
                        components: [finalCard, ...finalRows],
                        flags: V2,
                    }).catch(() => { });
                }
                const successCard = ComponentsV2.successContainer('Suggestion Published!', `Your suggestion **"${title}"** has been published to <#${forumChannel.id}>!\n\n👉 **[Jump to your suggestion post](${thread.url})** to follow community feedback.`);
                await interaction.editReply({
                    components: [successCard],
                    flags: V2,
                });
            }
            catch (err) {
                logger.error('Failed to create suggestion post in forum channel:', err);
                const errCard = ComponentsV2.errorContainer('Submission Failed', `Could not publish your suggestion to the forum channel: \`${err?.message || 'Unknown error'}\``);
                await interaction.editReply({ components: [errCard], flags: V2 });
            }
            return;
        }
        // 2. Staff Review: Accept Modal Submit
        if (customId.startsWith('suggest_modal:accept:')) {
            const suggestionId = parseInt(customId.replace('suggest_modal:accept:', ''), 10);
            if (isNaN(suggestionId))
                return;
            await interaction.deferReply({ flags: EPH });
            const reason = interaction.fields.getTextInputValue('reason')?.trim() || undefined;
            const updated = await suggestionService.updateStatus(suggestionId, interaction.user, 'approved', reason);
            if (!updated || !interaction.guild) {
                await interaction.editReply({ content: '❌ Could not update suggestion.' });
                return;
            }
            await syncForumThreadReview(interaction, updated, 'approved', reason);
            await interaction.editReply({ content: `🟢 Suggestion #${suggestionId} has been **ACCEPTED**.` });
            return;
        }
        // 3. Staff Review: Reject Modal Submit
        if (customId.startsWith('suggest_modal:reject:')) {
            const suggestionId = parseInt(customId.replace('suggest_modal:reject:', ''), 10);
            if (isNaN(suggestionId))
                return;
            await interaction.deferReply({ flags: EPH });
            const reason = interaction.fields.getTextInputValue('reason')?.trim() || 'Declined by staff team.';
            const updated = await suggestionService.updateStatus(suggestionId, interaction.user, 'denied', reason);
            if (!updated || !interaction.guild) {
                await interaction.editReply({ content: '❌ Could not update suggestion.' });
                return;
            }
            await syncForumThreadReview(interaction, updated, 'denied', reason);
            await interaction.editReply({ content: `🔴 Suggestion #${suggestionId} has been **REJECTED**.` });
            return;
        }
        // 4. Staff Review: Implement Modal Submit
        if (customId.startsWith('suggest_modal:implement:')) {
            const suggestionId = parseInt(customId.replace('suggest_modal:implement:', ''), 10);
            if (isNaN(suggestionId))
                return;
            await interaction.deferReply({ flags: EPH });
            const reason = interaction.fields.getTextInputValue('reason')?.trim() || 'Implemented in production.';
            const updated = await suggestionService.updateStatus(suggestionId, interaction.user, 'implemented', reason);
            if (!updated || !interaction.guild) {
                await interaction.editReply({ content: '❌ Could not update suggestion.' });
                return;
            }
            await syncForumThreadReview(interaction, updated, 'implemented', reason);
            await interaction.editReply({ content: `🟣 Suggestion #${suggestionId} marked as **IMPLEMENTED**.` });
            return;
        }
    },
};
/**
 * Helper to synchronize thread title, tags, card message, and send notification post
 */
async function syncForumThreadReview(interaction, suggestion, decision, reason) {
    try {
        const forumChannel = await suggestionService.getForumChannel(interaction.guild);
        if (!forumChannel)
            return;
        const tagMap = await suggestionService.reconcileForumTags(forumChannel);
        // Fetch thread channel
        const threadId = suggestion.thread_id || suggestion.channel_id;
        const thread = await interaction.guild.channels.fetch(threadId).catch(() => null);
        if (thread && thread.isThread()) {
            // 1. Update Thread Name
            const statusPrefix = decision === 'approved' ? '[Accepted]' : decision === 'denied' ? '[Rejected]' : '[Implemented]';
            await thread.setName(`💡 ${statusPrefix} ${suggestion.title.slice(0, 80)}`).catch(() => { });
            // 2. Update Thread Applied Tags
            const statusTagKey = decision === 'approved' ? 'accepted' : decision === 'denied' ? 'rejected' : 'implemented';
            const newStatusTagId = tagMap[statusTagKey];
            const oldStatusTagIds = [
                tagMap['pending'],
                tagMap['accepted'],
                tagMap['rejected'],
                tagMap['implemented'],
            ].filter(Boolean);
            const currentTags = [...thread.appliedTags];
            const preservedCategoryTags = currentTags.filter((t) => !oldStatusTagIds.includes(t));
            const nextTags = [...preservedCategoryTags];
            if (newStatusTagId && !nextTags.includes(newStatusTagId)) {
                nextTags.unshift(newStatusTagId);
            }
            await thread.setAppliedTags(nextTags.slice(0, 5)).catch((err) => logger.warn('Failed to update forum thread tags:', err));
            // 3. Update Starter Message Card
            const counts = await suggestionService.getVoteCounts(suggestion.id);
            const { container, rows } = SuggestionEmbeds.buildSuggestionCard(suggestion, counts.up, counts.down);
            const starterMessage = await thread.fetchStarterMessage().catch(() => null);
            if (starterMessage) {
                await starterMessage.edit({
                    components: [container, ...rows],
                    flags: V2,
                }).catch(() => { });
            }
            // 4. Send Announcement Message in Thread pinging the submitter
            if (decision === 'approved') {
                await thread.send({
                    content: `🎉 <@${suggestion.user_id}> Your suggestion was **ACCEPTED** by <@${interaction.user.id}>!\n` +
                        (reason ? `> **Staff Note:** ${reason}` : ''),
                }).catch(() => { });
            }
            else if (decision === 'denied') {
                await thread.send({
                    content: `❌ <@${suggestion.user_id}> Your suggestion was **DECLINED** by <@${interaction.user.id}>.\n` +
                        `> **Reason:** ${reason || 'Declined by staff team.'}`,
                }).catch(() => { });
            }
            else if (decision === 'implemented') {
                await thread.send({
                    content: `🚀 <@${suggestion.user_id}> Your suggestion has been **IMPLEMENTED** by <@${interaction.user.id}>!\n` +
                        (reason ? `> **Release Note:** ${reason}` : ''),
                }).catch(() => { });
            }
        }
    }
    catch (err) {
        logger.error('Failed to sync forum thread review:', err);
    }
}
export const suggestionCommand = {
    data: new SlashCommandBuilder()
        .setName('suggestion')
        .setDescription('Configure suggestion configurations and forum settings')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((sub) => sub
        .setName('config')
        .setDescription('Set the target Forum channel for suggestions and reconcile tags')
        .addChannelOption((o) => o
        .setName('channel')
        .setDescription('Select the target Forum channel')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildForum)))
        .addSubcommand((sub) => sub.setName('status').setDescription('View current suggestion forum channel and tag configuration')),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({ content: '⚠️ Must be executed in a guild.', flags: EPH });
            return;
        }
        const sub = interaction.options.getSubcommand(true);
        if (sub === 'config') {
            await interaction.deferReply({ flags: V2 | EPH });
            const channel = interaction.options.getChannel('channel', true);
            if (channel.type !== ChannelType.GuildForum) {
                const err = ComponentsV2.errorContainer('Invalid Channel Type', `Channel <#${channel.id}> is not a **Forum Channel**. Please select a forum channel with threads enabled.`);
                await interaction.editReply({ components: [err], flags: V2 });
                return;
            }
            // Save settings to Supabase and local store
            await supabase.updateBotSettings(interaction.guild.id, {
                suggestion_channel_id: channel.id,
            });
            // Reconcile and auto-provision all 12 tags
            const tagMap = await suggestionService.reconcileForumTags(channel);
            const statusCount = Object.keys(tagMap).filter((k) => ['pending', 'accepted', 'rejected', 'implemented'].includes(k)).length;
            const categoryCount = Object.keys(tagMap).length - statusCount;
            const setupCard = ComponentsV2.successContainer('Suggestions Forum Configured', `Target forum channel set to <#${channel.id}>.\n\n` +
                `### 🏷️ Auto-Provisioned Tags (${Object.keys(tagMap).length}/12)\n` +
                `• **Status Tags:** \`⏳ Pending\`, \`✅ Accepted\`, \`❌ Rejected\`, \`🚀 Implemented\`\n` +
                `• **Category Tags:** \`🎛️ Control Panel\`, \`🌐 Website\`, \`💬 Discord Server\`, \`🤖 Discord Bot\`, \`⛏️ Free Minecraft\`, \`💎 Premium MC\`, \`⚡ Bot Hosting\`, \`📦 General\`\n\n` +
                `Members can now run \`/suggest\` anywhere to draft and submit suggestions directly into this forum channel!`);
            await interaction.editReply({
                components: [setupCard],
                flags: V2,
            });
            return;
        }
        if (sub === 'status') {
            await interaction.deferReply({ flags: V2 | EPH });
            const forumChannel = await suggestionService.getForumChannel(interaction.guild);
            if (!forumChannel) {
                const unconfigured = ComponentsV2.warningContainer('Suggestions Not Configured', 'No Forum channel is currently assigned for suggestions. Run `/suggestion config` to set one.');
                await interaction.editReply({ components: [unconfigured], flags: V2 });
                return;
            }
            const tagsList = forumChannel.availableTags
                .map((t) => `${t.emoji?.name || '🏷️'} **${t.name}**`)
                .join(', ');
            const statusCard = ComponentsV2.infoContainer('Suggestions Forum Status', `**Configured Channel:** <#${forumChannel.id}>\n` +
                `**Total Tags on Forum:** ${forumChannel.availableTags.length}/20\n\n` +
                `### Tags Detected\n${tagsList || '_None_'}\n\n` +
                `Run \`/suggestion config\` at any time to re-provision missing tags.`);
            await interaction.editReply({
                components: [statusCard],
                flags: V2,
            });
        }
    },
    // Forward buttons, menus, and modals to suggestCommand
    async handleButton(interaction) {
        return suggestCommand.handleButton(interaction);
    },
    async handleSelectMenu(interaction) {
        return suggestCommand.handleSelectMenu(interaction);
    },
    async handleModal(interaction) {
        return suggestCommand.handleModal(interaction);
    },
};
