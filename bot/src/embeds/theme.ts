import { EmbedBuilder, ColorResolvable } from 'discord.js';
import { config } from '../config.js';
import { VICTUS_COLORS } from '../types/index.js';

export const BOT_BANNER_URL = `${config.branding.website}/images/discord-bot-manager-banner.png`;

/**
 * Base embed with Victus Cloud branding
 */
export function createEmbed(options: {
    title?: string;
    description?: string;
    color?: keyof typeof VICTUS_COLORS | number;
    thumbnail?: boolean;
    footer?: boolean;
    banner?: boolean;
}): EmbedBuilder {
    const { title, description, color = 'primary', thumbnail = false, footer = true, banner = true } = options;

    const embed = new EmbedBuilder()
        .setColor((typeof color === 'number' ? color : VICTUS_COLORS[color]) as ColorResolvable);

    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (banner) embed.setImage(BOT_BANNER_URL);
    if (thumbnail) embed.setThumbnail(config.branding.logo);
    if (footer) {
        embed.setFooter({
            text: config.branding.name,
            iconURL: config.branding.logo,
        });
    }

    return embed;
}

/**
 * Success embed
 */
export function successEmbed(title: string, description?: string): EmbedBuilder {
    return createEmbed({
        title: `✅ ${title}`,
        description,
        color: 'success',
    });
}

/**
 * Error embed
 */
export function errorEmbed(title: string, description?: string): EmbedBuilder {
    return createEmbed({
        title: `❌ ${title}`,
        description,
        color: 'error',
    });
}

/**
 * Warning embed  
 */
export function warningEmbed(title: string, description?: string): EmbedBuilder {
    return createEmbed({
        title: `⚠️ ${title}`,
        description,
        color: 'warning',
    });
}

/**
 * Info embed
 */
export function infoEmbed(title: string, description?: string): EmbedBuilder {
    return createEmbed({
        title: `📘 ${title}`,
        description,
        color: 'info',
    });
}

/**
 * Loading embed
 */
export function loadingEmbed(message = 'Processing...'): EmbedBuilder {
    return createEmbed({
        description: `<a:loading:1234567890> ${message}`,
        color: 'neutral',
        footer: false,
    });
}

/**
 * Account not linked embed
 */
export function notLinkedEmbed(): EmbedBuilder {
    return createEmbed({
        title: '🔗 Account Not Linked',
        description:
            'Your Discord account is not linked to Victus Cloud.\n\n' +
            '**To link your account:**\n' +
            '1. Use the `/link` command\n' +
            '2. Click the verification link\n' +
            '3. Log in to your Victus Cloud account\n' +
            '4. Confirm the link\n\n' +
            'Once linked, you can manage your servers and billing directly from Discord!',
        color: 'warning',
        thumbnail: true,
    });
}

/**
 * Permission denied embed
 */
export function permissionDeniedEmbed(): EmbedBuilder {
    return createEmbed({
        title: '🚫 Permission Denied',
        description: 'You do not have permission to use this command.',
        color: 'error',
    });
}

/**
 * Server status embed colors
 */
export function getServerStatusColor(status: string): keyof typeof VICTUS_COLORS {
    switch (status?.toLowerCase()) {
        case 'running':
            return 'success';
        case 'starting':
        case 'stopping':
            return 'warning';
        case 'offline':
        case 'suspended':
            return 'error';
        default:
            return 'neutral';
    }
}

/**
 * Server status emoji
 */
export function getServerStatusEmoji(status: string): string {
    switch (status?.toLowerCase()) {
        case 'running':
            return '🟢';
        case 'starting':
            return '🟡';
        case 'stopping':
            return '🟠';
        case 'offline':
            return '🔴';
        case 'suspended':
            return '⛔';
        default:
            return '⚪';
    }
}

/**
 * Invoice status emoji
 */
export function getInvoiceStatusEmoji(status: string): string {
    switch (status?.toLowerCase()) {
        case 'paid':
            return '✅';
        case 'unpaid':
            return '⏳';
        case 'cancelled':
            return '❌';
        case 'refunded':
            return '↩️';
        default:
            return '❓';
    }
}

/**
 * Service status emoji
 */
export function getServiceStatusEmoji(status: string): string {
    switch (status?.toLowerCase()) {
        case 'active':
            return '✅';
        case 'suspended':
            return '⚠️';
        case 'cancelled':
            return '❌';
        case 'pending':
            return '⏳';
        default:
            return '❓';
    }
}
