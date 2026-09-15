import {
    ActionRowBuilder,
    ButtonBuilder,
    ContainerBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    MessageFlags,
} from 'discord.js';
import { ButtonStyle } from 'discord-api-types/v10';
import { ComponentsV2 } from './componentsV2.js';
import {
    SUGGESTION_CATEGORIES,
    type SuggestionCategoryDef,
} from '../services/suggestionService.js';
import type { Suggestion, SuggestionVote, SuggestionCategoryKey } from '../types/index.js';

export class SuggestionEmbeds {
    /**
     * Build the ephemeral suggestion launcher with category selection
     */
    static buildLauncher(selectedKeys: SuggestionCategoryKey[] = []): {
        container: ContainerBuilder;
        rows: ActionRowBuilder<any>[];
    } {
        const container = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);

        let activeTagsText = '⚠️ *No categories selected yet. Please pick 1 to 3 categories from the dropdown below.*';
        if (selectedKeys.length > 0) {
            activeTagsText = selectedKeys
                .map((key) => {
                    const cat = SUGGESTION_CATEGORIES[key];
                    return cat ? `\`${cat.emoji} ${cat.label}\`` : `\`${key}\``;
                })
                .join('  ');
        }

        const body =
            `-# 💡 VICTUS CLOUD • COMMUNITY SUGGESTION HUB\n` +
            `# Draft a Suggestion\n\n` +
            `Help shape Victus Cloud by sharing your ideas for hosting infrastructure, billing portals, Discord tools, or panel features.\n\n` +
            `### 🏷️ Step 1: Select Categories (1 - 3)\n` +
            `${activeTagsText}\n\n` +
            `### 📝 Step 2: Enter Details\n` +
            `Once categories are chosen, click **Enter Suggestion Details** to input your title, description, and impact.`;

        container.addTextDisplayComponents(ComponentsV2.text(body));
        container.addSeparatorComponents(ComponentsV2.separator(true));

        // Category multi-select menu
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('suggest:category_select')
            .setPlaceholder('Choose 1 to 3 categories that fit your proposal...')
            .setMinValues(1)
            .setMaxValues(3);

        for (const cat of Object.values(SUGGESTION_CATEGORIES)) {
            const isSelected = selectedKeys.includes(cat.id);
            selectMenu.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(cat.label)
                    .setValue(cat.id)
                    .setDescription(cat.description.slice(0, 100))
                    .setEmoji(cat.emoji)
                    .setDefault(isSelected)
            );
        }

        const menuRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

        // Action button row
        const hasSelection = selectedKeys.length > 0;
        const joinedKeys = selectedKeys.length > 0 ? selectedKeys.join(',') : 'none';

        const openModalButton = new ButtonBuilder()
            .setCustomId(`suggest:open_modal:${joinedKeys}`)
            .setLabel('Enter Suggestion Details')
            .setStyle(hasSelection ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(!hasSelection);

        const cancelBtn = new ButtonBuilder()
            .setCustomId('suggest:cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary);

        const btnRow = new ActionRowBuilder<ButtonBuilder>().addComponents(openModalButton, cancelBtn);

        return {
            container,
            rows: [menuRow, btnRow],
        };
    }

    /**
     * Render ASCII progress bar
     */
    private static renderProgressBar(up: number, down: number): { bar: string; percentage: number } {
        const total = up + down;
        if (total === 0) return { bar: '░░░░░░░░░░', percentage: 0 };
        const ratio = up / total;
        const percentage = Math.round(ratio * 100);
        const filledLength = Math.round(ratio * 10);
        const bar = '█'.repeat(filledLength) + '░'.repeat(Math.max(0, 10 - filledLength));
        return { bar, percentage };
    }

    /**
     * Build the live suggestion card for the Forum Thread
     */
    static buildSuggestionCard(
        suggestion: Suggestion,
        upvotes = 0,
        downvotes = 0,
        userVote?: 'up' | 'down' | null
    ): { container: ContainerBuilder; rows: ActionRowBuilder<ButtonBuilder>[] } {
        let accent = ComponentsV2.Accents.warning;
        let statusTag = '🟡 [ STATUS: PENDING COMMUNITY REVIEW ]';

        if (suggestion.status === 'approved') {
            accent = ComponentsV2.Accents.success;
            statusTag = '🟢 [ STATUS: APPROVED & ACCEPTED ]';
        } else if (suggestion.status === 'denied') {
            accent = ComponentsV2.Accents.danger;
            statusTag = '🔴 [ STATUS: DECLINED & REJECTED ]';
        } else if (suggestion.status === 'implemented') {
            accent = ComponentsV2.Accents.purple;
            statusTag = '🟣 [ STATUS: IMPLEMENTED & DEPLOYED ]';
        }

        const container = ComponentsV2.baseContainer(accent);

        // Format category badges
        const cats = suggestion.categories || ['general'];
        const categoryBadges = cats
            .map((k) => {
                const def = SUGGESTION_CATEGORIES[k as SuggestionCategoryKey];
                return def ? `\`${def.emoji} ${def.label}\`` : `\`📦 ${k}\``;
            })
            .join('  ');

        const { bar, percentage } = this.renderProgressBar(upvotes, downvotes);
        const netScore = upvotes - downvotes;
        const netDisplay = netScore > 0 ? `+${netScore}` : `${netScore}`;
        const createdTimestamp = Math.floor(new Date(suggestion.created_at).getTime() / 1000);

        let body =
            `-# 💡 VICTUS CLOUD • COMMUNITY PROPOSAL #${suggestion.id}\n` +
            `\`${statusTag}\`\n\n` +
            `# ${suggestion.title}\n\n` +
            `**Categories:** ${categoryBadges}\n` +
            `**Author:** <@${suggestion.user_id}> (${suggestion.author_tag}) • <t:${createdTimestamp}:R>\n\n` +
            `### 📋 Proposal Details\n${suggestion.content}\n\n`;

        if (suggestion.impact && suggestion.impact.trim()) {
            body += `### 🎯 Expected Impact & Value\n${suggestion.impact}\n\n`;
        }

        // Industrial voting metrics display
        body +=
            '```asciidoc\n' +
            '=== COMMUNITY VOTING METRICS ===\n' +
            `Approval: [${bar}] ${percentage}%\n` +
            `▲ Upvotes: ${upvotes.toString().padEnd(4)} | ▼ Downvotes: ${downvotes.toString().padEnd(4)} | Net Score: ${netDisplay}\n` +
            '```\n';

        if (suggestion.locked) {
            body += `🔒 *Voting has been locked for this suggestion.*\n\n`;
        }

        // Staff review record if already reviewed
        if (suggestion.staff_reviewer_id || suggestion.staff_response) {
            const reviewerDisplay = suggestion.staff_reviewer_id ? `<@${suggestion.staff_reviewer_id}>` : 'Victus Staff';
            const actionLabel =
                suggestion.status === 'approved'
                    ? 'ACCEPTED'
                    : suggestion.status === 'denied'
                    ? 'DECLINED'
                    : 'IMPLEMENTED';

            body +=
                `### 🛡️ Staff Review Record\n` +
                `**Decision:** \`${actionLabel}\` by ${reviewerDisplay}\n` +
                (suggestion.staff_response ? `> ${suggestion.staff_response}\n\n` : '\n');
        }

        container.addTextDisplayComponents(ComponentsV2.text(body));
        container.addSeparatorComponents(ComponentsV2.separator(true));

        // Community button row
        const communityRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`suggest:upvote:${suggestion.id}`)
                .setLabel(`Upvote (${upvotes})`)
                .setEmoji('👍')
                .setStyle(userVote === 'up' ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(suggestion.locked),
            new ButtonBuilder()
                .setCustomId(`suggest:downvote:${suggestion.id}`)
                .setLabel(`Downvote (${downvotes})`)
                .setEmoji('👎')
                .setStyle(userVote === 'down' ? ButtonStyle.Danger : ButtonStyle.Secondary)
                .setDisabled(suggestion.locked),
            new ButtonBuilder()
                .setCustomId(`suggest:voters:${suggestion.id}`)
                .setLabel(`Voters (${upvotes + downvotes})`)
                .setEmoji('📜')
                .setStyle(ButtonStyle.Secondary)
        );

        // Staff moderation row
        const staffRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`suggest_mod:accept:${suggestion.id}`)
                .setLabel('Accept')
                .setEmoji('✅')
                .setStyle(ButtonStyle.Success)
                .setDisabled(suggestion.status === 'approved'),
            new ButtonBuilder()
                .setCustomId(`suggest_mod:reject:${suggestion.id}`)
                .setLabel('Reject')
                .setEmoji('❌')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(suggestion.status === 'denied'),
            new ButtonBuilder()
                .setCustomId(`suggest_mod:implement:${suggestion.id}`)
                .setLabel('Implement')
                .setEmoji('🚀')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(suggestion.status === 'implemented'),
            new ButtonBuilder()
                .setCustomId(`suggest_mod:lock:${suggestion.id}`)
                .setLabel(suggestion.locked ? 'Unlock' : 'Lock')
                .setEmoji(suggestion.locked ? '🔓' : '🔒')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`suggest_mod:delete:${suggestion.id}`)
                .setLabel('Delete')
                .setEmoji('🗑️')
                .setStyle(ButtonStyle.Danger)
        );

        return { container, rows: [communityRow, staffRow] };
    }

    /**
     * Build voters breakdown modal/card
     */
    static buildVotersCard(
        suggestionId: number,
        votes: SuggestionVote[]
    ): ContainerBuilder {
        const upvoters = votes.filter((v) => v.vote_type === 'up');
        const downvoters = votes.filter((v) => v.vote_type === 'down');

        const upList = upvoters.length > 0
            ? upvoters.slice(0, 15).map((v) => `• <@${v.user_id}> (\`${v.username}\`)`).join('\n') + (upvoters.length > 15 ? `\n... and ${upvoters.length - 15} more` : '')
            : '_No upvotes yet._';

        const downList = downvoters.length > 0
            ? downvoters.slice(0, 15).map((v) => `• <@${v.user_id}> (\`${v.username}\`)`).join('\n') + (downvoters.length > 15 ? `\n... and ${downvoters.length - 15} more` : '')
            : '_No downvotes yet._';

        const container = ComponentsV2.baseContainer(ComponentsV2.Accents.info);
        container.addTextDisplayComponents(
            ComponentsV2.text(
                `-# 💡 VICTUS CLOUD • VOTER AUDIT LOG\n` +
                `# Suggestion #${suggestionId} Voters\n\n` +
                `### 👍 Upvoters (${upvoters.length})\n${upList}\n\n` +
                `### 👎 Downvoters (${downvoters.length})\n${downList}`
            )
        );
        return container;
    }
}
