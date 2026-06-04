/**
 * Discord Components v2 Theme Utilities
 * Uses the new Discord.js v14.19+ Components v2 system
 */

import {
    ContainerBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    SeparatorBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    StringSelectMenuBuilder,
    ButtonStyle,
} from 'discord.js';
import { config } from '../config.js';
import { compactId, decodeDisplayText, formatCredits, formatDate, Icons, statusIcon, statusLabel } from '../utils/premium.js';

// ============================================
// Constants
// ============================================
// Flag for V2 Components support in interaction responses
export const IS_COMPONENTS_V2 = 1 << 15;

// ============================================
// Color Accents (for containers)
// ============================================
export const Accents = {
    primary: 0x6366f1,    // Indigo - Victus brand
    success: 0x10b981,    // Emerald
    warning: 0xf59e0b,    // Amber
    danger: 0xef4444,     // Red
    info: 0x3b82f6,       // Blue
    purple: 0x8b5cf6,     // Purple
    discord: 0x5865f2,    // Discord blurple
} as const;

// ============================================
// Helper: Create Text Display
// ============================================
export function text(content: string): TextDisplayBuilder {
    const safeContent = content && content.trim().length > 0 ? content : ' ';
    return new TextDisplayBuilder().setContent(safeContent);
}

// ============================================
// Helper: Create Separator
// ============================================
export function separator(divider = true): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(divider);
}

// ============================================
// Helper: Create Media Gallery
// ============================================
export function mediaGallery(imageUrl: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(imageUrl)
    );
}

// ============================================
// Preset: Base Container
// ============================================
export function baseContainer(accent: number): ContainerBuilder {
    return new ContainerBuilder().setAccentColor(accent);
}

// ============================================
// Preset: Standard Message Container
// ============================================
function createBrandedContainer(accent: number, title: string, description: string, emoji: string): ContainerBuilder {
    return baseContainer(accent)
        .addTextDisplayComponents(text(`# ${emoji} ${title}\n\n${description}`));
}

// ============================================
// Preset: Success Message Container
// ============================================
export function successContainer(title: string, description: string): ContainerBuilder {
    return createBrandedContainer(Accents.success, title, description, '✅');
}

// ============================================
// Preset: Error Message Container
// ============================================
export function errorContainer(title: string, description: string): ContainerBuilder {
    return createBrandedContainer(Accents.danger, title, description, '⚠️');
}

// ============================================
// Preset: Warning Message Container
// ============================================
export function warningContainer(title: string, description: string): ContainerBuilder {
    return createBrandedContainer(Accents.warning, title, description, '⚠️');
}

// ============================================
// Preset: Info Message Container
// ============================================
export function infoContainer(title: string, description: string): ContainerBuilder {
    return createBrandedContainer(Accents.info, title, description, 'ℹ️');
}

// ============================================
// Preset: Link Account Container
// ============================================
export function linkAccountContainer(
    username: string,
    avatarUrl: string,
    expiryTimestamp: number,
    linkUrl: string
): ContainerBuilder {
    const container = baseContainer(Accents.primary)
        .addTextDisplayComponents(
            text(
                `# 🔗 Link Your Account\n\n` +
                `Click the button below to link your Discord account to Victus Cloud.\n\n` +
                `### How it works:\n` +
                `1️⃣ Click **Link Account**\n` +
                `2️⃣ Log in to Victus Cloud\n` +
                `3️⃣ Confirm the connection\n\n` +
                `⏰ **Expires:** <t:${expiryTimestamp}:R>\n` +
                `👤 **Discord:** ${username}`
            )
        );

    if (avatarUrl) {
        container.addMediaGalleryComponents(mediaGallery(avatarUrl));
    }

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('Link Account')
            .setStyle(ButtonStyle.Link)
            .setURL(linkUrl),
        new ButtonBuilder()
            .setLabel('Help')
            .setStyle(ButtonStyle.Link)
            .setURL(`${config.branding.website}/help/discord-linking`)
    );

    container.addActionRowComponents(buttons);
    return container;
}

// ============================================
// Preset: Help Menu Container
// ============================================
export function helpMenuContainer(
    username: string,
    avatarUrl: string,
    commandCount: number
): ContainerBuilder {
    const container = baseContainer(Accents.primary)
        .addTextDisplayComponents(
            text(
                `# 🛠️ Help Menu\n\n` +
                `### ⭐ Welcome, ${username}!\n` +
                `Use the dropdown below to explore commands.\n\n` +
                `### 📊 Bot Statistics\n` +
                `✅ **${commandCount}** Commands Available\n` +
                `✅ Account Linking\n` +
                `✅ Server Management\n` +
                `✅ Billing Integration\n\n` +
                `-# Select a category from the dropdown menu below`
            )
        );

    const menu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('help_category')
            .setPlaceholder('🏠 Main Menu')
            .addOptions([
                { label: 'Account', description: 'Link/unlink commands', value: 'account', emoji: '👤' },
                { label: 'Servers', description: 'Server management', value: 'servers', emoji: '🖥️' },
                { label: 'Billing', description: 'Invoices & services', value: 'billing', emoji: '💳' },
                { label: 'Support', description: 'Get help', value: 'support', emoji: '🎫' },
            ])
    );

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('Invite')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/api/oauth2/authorize?client_id=${config.discord.clientId}&permissions=8&scope=bot%20applications.commands`),
        new ButtonBuilder()
            .setLabel('Support')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.website)
    );

    container.addActionRowComponents(menu);
    container.addActionRowComponents(buttons);

    return container;
}

// ============================================
// Preset: Invoice List Container
// ============================================
export function invoiceListContainer(
    invoices: { id: string; amount: string; status: string; date: string }[]
): ContainerBuilder {
    let content = `# ${Icons.invoice} Your Invoices\n\n`;

    if (invoices.length === 0) {
        content += `_No invoices found for your linked Victus account._`;
    } else {
        invoices.slice(0, 8).forEach((invoice) => {
            content += `### ${statusIcon(invoice.status)} Invoice #${invoice.id}\n` +
                `${Icons.credits} **Amount:** ${invoice.amount} | **Status:** ${statusLabel(invoice.status)}\n` +
                `${Icons.calendar} **Date:** ${invoice.date}\n\n`;
        });
    }

    return baseContainer(Accents.primary).addTextDisplayComponents(text(content));
}


// ============================================
// Preset: Services List Container
// ============================================
export function servicesListContainer(
    services: { name: string; status: string; price: string; renewsAt?: string }[]
): ContainerBuilder {
    let content = `# ${Icons.service} Your Services\n\n`;

    if (services.length === 0) {
        content += `_No active services found for your linked Victus account._`;
    } else {
        services.slice(0, 8).forEach((service) => {
            content += `### ${statusIcon(service.status)} ${decodeDisplayText(service.name)}\n` +
                `**Status:** ${statusLabel(service.status)} | ${Icons.credits} **Price:** ${service.price}` +
                (service.renewsAt ? `\n${Icons.calendar} **Renews:** ${service.renewsAt}` : '') +
                `\n\n`;
        });
    }

    return baseContainer(Accents.primary).addTextDisplayComponents(text(content));
}


// ============================================
// Preset: User Info Container
// ============================================
export function userInfoContainer(
    username: string,
    discordId: string,
    isLinked: boolean,
    profile?: any,
    servers: any[] = [],
    history: any[] = [],
    creditBalance?: { amount: number; currency: string; found: boolean; source: string }
): ContainerBuilder {
    const accent = isLinked ? Accents.success : Accents.warning;
    const container = baseContainer(accent);

    const displayName = decodeDisplayText(profile?.username || profile?.full_name || username, username);
    let content = `# ${Icons.crown} Victus Profile: ${displayName}\n`;
    content += `-# ${Icons.id} Discord ID: \`${discordId}\`  ${Icons.link} Link Status: **${isLinked ? 'Connected' : 'Not linked'}**\n\n`;

    if (isLinked && profile) {
        const billingReady = profile.billing_account_created ?? profile.billing_panel_created;
        const panelReady = profile.control_panel_created;
        const driveReady = profile.victus_drive_created;
        const creditText = creditBalance
            ? `${formatCredits(creditBalance.amount, creditBalance.currency)}${creditBalance.source === 'paymenter' ? ' synced from Paymenter' : ''}`
            : formatCredits(profile.credits || profile.credit || profile.balance || 0);

        content += `### ${Icons.credits} Account Ledger\n`;
        content += `${Icons.mail} **Email:** ${profile.email || '`Hidden`'}\n`;
        content += `${Icons.credits} **Credits:** **${creditText}**\n`;
        content += `${Icons.calendar} **Joined:** ${formatDate(profile.created_at)}\n\n`;

        content += `### ${Icons.spark} Provisioning\n`;
        content += `${billingReady ? Icons.success : Icons.warning} Billing account: **${billingReady ? 'Ready' : 'Not ready'}**\n`;
        content += `${panelReady ? Icons.success : Icons.warning} Game panel: **${panelReady ? 'Ready' : 'Not ready'}**\n`;
        content += `${driveReady ? Icons.success : Icons.warning} Victus Drive: **${driveReady ? 'Ready' : 'Not ready'}**\n\n`;

        content += `### ${Icons.server} Servers Owned (${servers.length})\n`;
        if (servers.length > 0) {
            servers.slice(0, 6).forEach(s => {
                const status = s.is_suspended || s.suspended ? 'suspended' : (s.status || 'offline');
                content += `${statusIcon(status)} \`${compactId(s.identifier)}\` **${decodeDisplayText(s.name)}** - ${statusLabel(status)}\n`;
            });
            if (servers.length > 6) content += `-# Showing 6 of ${servers.length}. Use the panel for the full fleet.\n`;
        } else {
            content += `_No active servers found._\n`;
        }
        content += `\n`;

        content += `### ${Icons.activity} Recent Admin Trace\n`;
        if (history.length > 0) {
            history.slice(0, 3).forEach(h => {
                content += `${Icons.spark} ${formatDate(h.created_at)} - ${decodeDisplayText(h.action || 'Action')}\n`;
            });
        } else {
            content += `_No recent actions recorded._\n`;
        }
    } else {
        content += `_This user has not linked their Victus Cloud account yet._`;
    }

    container.addTextDisplayComponents(text(content));
    return container;
}

// ============================================
// Export all
// ============================================
export const ComponentsV2 = {
    // Helpers
    text,
    separator,
    mediaGallery,
    baseContainer,
    // Presets
    successContainer,
    errorContainer,
    warningContainer,
    infoContainer,
    linkAccountContainer,
    helpMenuContainer,
    invoiceListContainer,
    servicesListContainer,
    userInfoContainer,
    // Constants
    Accents,
    IS_COMPONENTS_V2,
};

