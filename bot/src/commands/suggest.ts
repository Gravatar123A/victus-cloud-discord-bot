import { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType, 
    MessageFlags, 
    PermissionFlagsBits, 
    SlashCommandBuilder 
} from 'discord.js';
import type { Command, Suggestion } from '../types/index.js';
import { supabase } from '../services/supabase.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { logger } from '../utils/logger.js';

const V2 = ComponentsV2.IS_COMPONENTS_V2;
const EPH = MessageFlags.Ephemeral;

function buildSuggestionCard(suggestion: Suggestion, up: number, down: number): any {
    const total = up + down;
    const percentage = total > 0 ? Math.round((up / total) * 100) : 0;
    const filled = Math.round(percentage / 10);
    const empty = 10 - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);

    const accent = suggestion.status === 'approved' ? ComponentsV2.Accents.success
        : suggestion.status === 'denied' ? ComponentsV2.Accents.danger
        : suggestion.status === 'implemented' ? ComponentsV2.Accents.info
        : ComponentsV2.Accents.warning;

    const c = ComponentsV2.baseContainer(accent);

    const statusLabel = suggestion.status === 'approved' ? '🟢 APPROVED'
        : suggestion.status === 'denied' ? '🔴 DENIED'
        : suggestion.status === 'implemented' ? '🟣 IMPLEMENTED'
        : '🟡 PENDING';

    let body = `-# 💡 SUGGESTION • #${suggestion.id} • ${statusLabel}\n` +
        `# ${suggestion.title}\n\n` +
        `**Submitter:** <@${suggestion.user_id}> (${suggestion.author_tag})\n\n` +
        `**Content:**\n${suggestion.content}\n\n` +
        `**Community Feedback:**\n` +
        `\`${bar}\`  \`${percentage}%\`  (👍 ${up} · 👎 ${down})`;

    if (suggestion.locked) {
        body += `\n\n🔒 **Voting has been locked for this suggestion.**`;
    }

    c.addTextDisplayComponents(ComponentsV2.text(body))
        .addSeparatorComponents(ComponentsV2.separator());

    // User buttons row
    const userRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`suggest:upvote:${suggestion.id}`).setLabel('Upvote').setStyle(ButtonStyle.Success).setDisabled(suggestion.locked),
        new ButtonBuilder().setCustomId(`suggest:downvote:${suggestion.id}`).setLabel('Downvote').setStyle(ButtonStyle.Danger).setDisabled(suggestion.locked),
        new ButtonBuilder().setCustomId(`suggest:votes:${suggestion.id}`).setLabel('Voters Log').setStyle(ButtonStyle.Secondary)
    );
    c.addActionRowComponents(userRow);

    // Mod buttons row
    const modRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`suggest_mod:approve:${suggestion.id}`).setLabel('Approve').setStyle(ButtonStyle.Success).setDisabled(suggestion.status === 'approved'),
        new ButtonBuilder().setCustomId(`suggest_mod:deny:${suggestion.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setDisabled(suggestion.status === 'denied'),
        new ButtonBuilder().setCustomId(`suggest_mod:implement:${suggestion.id}`).setLabel('Implement').setStyle(ButtonStyle.Primary).setDisabled(suggestion.status === 'implemented'),
        new ButtonBuilder().setCustomId(`suggest_mod:lock:${suggestion.id}`).setLabel(suggestion.locked ? 'Unlock' : 'Lock').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`suggest_mod:delete:${suggestion.id}`).setLabel('Delete').setStyle(ButtonStyle.Danger)
    );
    c.addActionRowComponents(modRow);

    c.addTextDisplayComponents(ComponentsV2.text(`-# Submitted: <t:${Math.floor(new Date(suggestion.created_at).getTime() / 1000)}:R>`));

    return c;
}

export const suggestCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('suggest')
        .setDescription('Submit a suggestion to the community')
        .setDMPermission(false)
        .addStringOption(o => o.setName('title').setDescription('Short descriptive title').setRequired(true).setMaxLength(100))
        .addStringOption(o => o.setName('content').setDescription('Detail your suggestion').setRequired(true).setMaxLength(1500)),

    cooldown: 15,

    async execute(interaction) {
        await interaction.deferReply({ flags: EPH });

        const title = interaction.options.getString('title', true).trim();
        const content = interaction.options.getString('content', true).trim();

        // Get suggestion channel
        const settings = await supabase.getBotSettings(interaction.guildId!).catch(() => null);
        const channelId = settings?.suggestion_channel_id;

        if (!channelId) {
            await interaction.editReply({
                components: [ComponentsV2.errorContainer('Not Configured', 'The suggestions channel has not been set up in this server yet. Ask an admin to run `/suggestion config`.')],
                flags: V2
            });
            return;
        }

        const channel = interaction.guild?.channels.cache.get(channelId);
        if (!channel || channel.type !== ChannelType.GuildText) {
            await interaction.editReply({
                components: [ComponentsV2.errorContainer('Configuration Error', 'The configured suggestions channel is invalid or missing.')],
                flags: V2
            });
            return;
        }

        try {
            // Write temporary suggestion with empty message/channel IDs
            const tempSuggestion = await supabase.createSuggestion(
                interaction.guildId!,
                channelId,
                'temp',
                interaction.user.id,
                interaction.user.tag,
                title,
                content
            );

            if (!tempSuggestion) {
                await interaction.editReply({ content: '❌ System error saving suggestion to database.' });
                return;
            }

            // Render suggestion card and send to target channel
            const card = buildSuggestionCard(tempSuggestion, 0, 0);
            const cardMessage = await channel.send({
                components: [card],
                flags: V2
            });

            // Update database suggestion row with actual message and channel IDs
            await supabase.client
                .from('suggestions')
                .update({
                    message_id: cardMessage.id,
                    channel_id: channelId
                })
                .eq('id', tempSuggestion.id);

            await interaction.editReply({
                components: [ComponentsV2.successContainer('Suggestion Submitted', `Your suggestion has been posted to <#${channelId}>!`)],
                flags: V2
            });
        } catch (error) {
            logger.error('Failed to create suggestion:', error);
            await interaction.editReply({ content: '❌ Failed to process suggestion submission.' });
        }
    }
};

export const suggestionCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('suggestion')
        .setDescription('Configure suggestion configurations')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('config')
                .setDescription('Set target suggestions channel')
                .addChannelOption(o => o.setName('channel').setDescription('Target text channel').setRequired(true).addChannelTypes(ChannelType.GuildText))
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand(true);

        if (sub === 'config') {
            await interaction.deferReply({ flags: EPH });
            const channel = interaction.options.getChannel('channel', true);

            const success = await supabase.updateBotSettings(interaction.guildId!, {
                suggestion_channel_id: channel.id
            } as any);

            if (success) {
                await interaction.editReply({
                    components: [ComponentsV2.successContainer('Configurations Updated', `Suggestions channel has been set to <#${channel.id}>.`)],
                    flags: V2
                });
            } else {
                await interaction.editReply({
                    components: [ComponentsV2.errorContainer('System Error', 'Failed to update suggestion channel settings.')],
                    flags: V2
                });
            }
        }
    },

    async handleButton(interaction) {
        if (!interaction.customId.startsWith('suggest:') && !interaction.customId.startsWith('suggest_mod:')) return;

        const parts = interaction.customId.split(':');
        const system = parts[0];
        const action = parts[1];
        const suggestionId = parseInt(parts[2], 10);

        if (isNaN(suggestionId)) return;

        const suggestion = await supabase.getSuggestion(suggestionId);
        if (!suggestion) {
            await interaction.reply({ content: '❌ Suggestion not found in database.', flags: EPH });
            return;
        }

        if (system === 'suggest') {
            if (action === 'upvote' || action === 'downvote') {
                if (suggestion.locked) {
                    await interaction.reply({ content: '🔒 Voting is locked on this suggestion.', flags: EPH });
                    return;
                }

                // Check if user already voted that way
                const votes = await supabase.getSuggestionVotes(suggestionId);
                const userVote = votes.find(v => v.user_id === interaction.user.id);

                if (userVote && userVote.vote_type === (action === 'upvote' ? 'up' : 'down')) {
                    // Remove vote if clicked same one again (toggle behavior)
                    await supabase.removeSuggestionVote(suggestionId, interaction.user.id);
                    await interaction.reply({ content: '👍 Vote removed.', flags: EPH });
                } else {
                    // Save vote
                    await supabase.addSuggestionVote(suggestionId, interaction.user.id, interaction.user.username, action === 'upvote' ? 'up' : 'down');
                    await interaction.reply({ content: `✅ Recorded ${action === 'upvote' ? 'Upvote' : 'Downvote'}.`, flags: EPH });
                }

                // Refresh card message
                const newCounts = await supabase.getSuggestionVoteCounts(suggestionId);
                const newCard = buildSuggestionCard(suggestion, newCounts.up, newCounts.down);

                // Fetch original message
                const channel = interaction.guild?.channels.cache.get(suggestion.channel_id);
                if (channel && 'messages' in channel) {
                    const message = await channel.messages.fetch(suggestion.message_id).catch(() => null);
                    if (message) {
                        await message.edit({ components: [newCard], flags: V2 }).catch(() => {});
                    }
                }
            } 
            else if (action === 'votes') {
                await interaction.deferReply({ flags: EPH });
                const votes = await supabase.getSuggestionVotes(suggestionId);

                if (votes.length === 0) {
                    await interaction.editReply({
                        components: [ComponentsV2.infoContainer('Voters Log', 'No votes have been recorded for this suggestion yet.')],
                        flags: V2
                    });
                    return;
                }

                let voteText = `# 🧾 Voters Log: Suggestion #${suggestionId}\n\n`;
                votes.forEach((v, i) => {
                    voteText += `\`#${i+1}\` <@${v.user_id}> (${v.username}) voted **${v.vote_type === 'up' ? '👍 Up' : '👎 Down'}** • <t:${Math.floor(new Date(v.created_at).getTime() / 1000)}:R>\n`;
                });

                await interaction.editReply({
                    components: [ComponentsV2.baseContainer(ComponentsV2.Accents.primary).addTextDisplayComponents(ComponentsV2.text(voteText))],
                    flags: V2
                });
            }
        } 
        else if (system === 'suggest_mod') {
            // Permission check
            const isAdmin = await supabase.isUserAdmin(interaction.user.id).catch(() => false);
            const isMod = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

            if (!isAdmin && !isMod) {
                await interaction.reply({ content: '⛔ You do not have permission to moderate suggestions.', flags: EPH });
                return;
            }

            if (action === 'approve') {
                await supabase.updateSuggestionStatus(suggestionId, 'approved');
                await interaction.reply({ content: '🟢 Suggestion approved.', flags: EPH });
            } 
            else if (action === 'deny') {
                await supabase.updateSuggestionStatus(suggestionId, 'denied');
                await interaction.reply({ content: '🔴 Suggestion denied.', flags: EPH });
            } 
            else if (action === 'implement') {
                await supabase.updateSuggestionStatus(suggestionId, 'implemented');
                await interaction.reply({ content: '🟣 Suggestion marked as implemented.', flags: EPH });
            }
            else if (action === 'lock') {
                await supabase.toggleSuggestionLock(suggestionId);
                const updated = await supabase.getSuggestion(suggestionId);
                await interaction.reply({ content: updated?.locked ? '🔒 Suggestion locked.' : '🔓 Suggestion unlocked.', flags: EPH });
            }
            else if (action === 'delete') {
                await supabase.deleteSuggestion(suggestionId);
                await interaction.reply({ content: '🗑️ Suggestion deleted.', flags: EPH });

                // Delete discord card message
                const channel = interaction.guild?.channels.cache.get(suggestion.channel_id);
                if (channel && 'messages' in channel) {
                    const message = await channel.messages.fetch(suggestion.message_id).catch(() => null);
                    if (message) {
                        await message.delete().catch(() => {});
                    }
                }
                return;
            }

            // Refresh card message
            const updatedSuggestion = await supabase.getSuggestion(suggestionId);
            if (updatedSuggestion) {
                const counts = await supabase.getSuggestionVoteCounts(suggestionId);
                const card = buildSuggestionCard(updatedSuggestion, counts.up, counts.down);

                const channel = interaction.guild?.channels.cache.get(suggestion.channel_id);
                if (channel && 'messages' in channel) {
                    const message = await channel.messages.fetch(suggestion.message_id).catch(() => null);
                    if (message) {
                        await message.edit({ components: [card], flags: V2 }).catch(() => {});
                    }
                }
            }
        }
    }
};
