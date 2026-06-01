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
            .setURL(linkUrl)
            .setEmoji('🔗'),
        new ButtonBuilder()
            .setLabel('Help')
            .setStyle(ButtonStyle.Link)
            .setURL(`${config.branding.website}/help/discord-linking`)
            .setEmoji('❓')
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
            .setURL(`https://discord.com/api/oauth2/authorize?client_id=${config.discord.clientId}&permissions=8&scope=bot%20applications.commands`)
            .setEmoji('🔗'),
        new ButtonBuilder()
            .setLabel('Support')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.website)
            .setEmoji('🛠️')
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
    let content = `# 📄 Your Invoices\n\n`;

    if (invoices.length === 0) {
        content += `No invoices found.`;
    } else {
        invoices.slice(0, 5).forEach((inv) => {
            const statusEmoji = inv.status === 'paid' ? '✅' :
                inv.status === 'pending' ? '⏳' : '❌';
            content += `### Invoice #${inv.id}\n` +
                `💰 **Amount:** ${inv.amount} | ${statusEmoji} **Status:** ${inv.status}\n` +
                `📅 **Date:** ${inv.date}\n\n`;
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
    let content = `# 📦 Your Services\n\n`;

    if (services.length === 0) {
        content += `No active services found.`;
    } else {
        services.slice(0, 5).forEach((svc) => {
            const statusEmoji = svc.status === 'active' ? '🟢' : '🔴';
            content += `### ${svc.name}\n` +
                `${statusEmoji} **Status:** ${svc.status} | 💰 **Price:** ${svc.price}` +
                (svc.renewsAt ? `\n📅 **Renews:** ${svc.renewsAt}` : '') +
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
    history: any[] = []
): ContainerBuilder {
    const accent = isLinked ? Accents.success : Accents.warning;
    const container = baseContainer(accent);

    let content = `# 👤 User Profile: ${username}\n`;
    content += `🆔 **Discord ID:** \`${discordId}\`\n`;
    content += `🔗 **Linked:** ${isLinked ? '✅ Yes' : '❌ No'}\n\n`;

    if (isLinked && profile) {
        content += `### 💳 Account Details\n`;
        content += `📧 **Email:** ${profile.email || '`Hidden`'}\n`;
        content += `💰 **Credits:** ${profile.credits || 0}\n`;
        content += `📅 **Joined:** ${profile.created_at ? new Date(profile.created_at).toLocaleDateString() : 'Unknown'}\n\n`;

        content += `### 🎮 Active Servers (${servers.length})\n`;
        if (servers.length > 0) {
            servers.slice(0, 3).forEach(s => {
                content += `• \`${s.identifier}\` - **${s.name}**\n`;
            });
        } else {
            content += `_No active servers found._\n`;
        }
        content += `\n`;

        content += `### 🕒 Recent Actions\n`;
        if (history.length > 0) {
            history.slice(0, 3).forEach(h => {
                content += `• [${new Date(h.created_at || '').toLocaleDateString()}] ${h.action || 'Action'}\n`;
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
