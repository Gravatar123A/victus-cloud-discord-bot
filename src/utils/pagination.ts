import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ComponentType,
    Message,
    ChatInputCommandInteraction,
    ButtonInteraction,
} from 'discord.js';
import { VICTUS_COLORS } from '../types/index.js';
import { BOT_BANNER_URL } from '../embeds/theme.js';

export interface PaginationOptions<T> {
    items: T[];
    itemsPerPage?: number;
    embedBuilder: (items: T[], page: number, totalPages: number) => EmbedBuilder;
    timeout?: number;
}

/**
 * Create a paginated embed with navigation buttons
 */
export async function createPagination<T>(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    options: PaginationOptions<T>
): Promise<void> {
    const { items, itemsPerPage = 5, embedBuilder, timeout = 120000 } = options;
    const totalPages = Math.ceil(items.length / itemsPerPage);

    if (totalPages === 0) {
        const emptyEmbed = new EmbedBuilder()
            .setColor(VICTUS_COLORS.neutral)
            .setImage(BOT_BANNER_URL)
            .setDescription('📭 No items to display.');

        await interaction.editReply({ embeds: [emptyEmbed] });
        return;
    }

    let currentPage = 0;

    const getPageItems = (page: number): T[] => {
        const start = page * itemsPerPage;
        return items.slice(start, start + itemsPerPage);
    };

    const getButtons = (page: number): ActionRowBuilder<ButtonBuilder> => {
        return new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('pagination_first')
                .setEmoji('⏮️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId('pagination_prev')
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId('pagination_page')
                .setLabel(`${page + 1} / ${totalPages}`)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId('pagination_next')
                .setEmoji('▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1),
            new ButtonBuilder()
                .setCustomId('pagination_last')
                .setEmoji('⏭️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1)
        );
    };

    const embed = embedBuilder(getPageItems(currentPage), currentPage, totalPages).setImage(BOT_BANNER_URL);
    const message = await interaction.editReply({
        embeds: [embed],
        components: totalPages > 1 ? [getButtons(currentPage)] : [],
    }) as Message;

    if (totalPages <= 1) return;

    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: timeout,
    });

    collector.on('collect', async (buttonInteraction) => {
        // Only allow original user to interact
        if (buttonInteraction.user.id !== interaction.user.id) {
            await buttonInteraction.reply({
                content: '❌ Only the command author can use these buttons.',
                ephemeral: true,
            });
            return;
        }

        switch (buttonInteraction.customId) {
            case 'pagination_first':
                currentPage = 0;
                break;
            case 'pagination_prev':
                currentPage = Math.max(0, currentPage - 1);
                break;
            case 'pagination_next':
                currentPage = Math.min(totalPages - 1, currentPage + 1);
                break;
            case 'pagination_last':
                currentPage = totalPages - 1;
                break;
        }

        const newEmbed = embedBuilder(getPageItems(currentPage), currentPage, totalPages).setImage(BOT_BANNER_URL);
        await buttonInteraction.update({
            embeds: [newEmbed],
            components: [getButtons(currentPage)],
        });
    });

    collector.on('end', async () => {
        // Disable buttons after timeout
        try {
            await message.edit({
                components: [],
            });
        } catch {
            // Message may have been deleted
        }
    });
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format uptime in seconds to human-readable string
 */
export function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);

    return parts.length > 0 ? parts.join(' ') : '< 1m';
}

/**
 * Format currency
 */
export function formatCurrency(amount: number, currency = 'USD'): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
    }).format(amount);
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
}
