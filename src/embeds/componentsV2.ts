/**
 * Premium Discord Components v2 layouts for Victus Cloud.
 * Keep button emoji-free to avoid guild-specific invalid emoji failures.
 */

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SeparatorBuilder,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { compactId, decodeDisplayText, formatCredits, formatDate, Icons, statusIcon, statusLabel } from '../utils/premium.js';

export const IS_COMPONENTS_V2 = 1 << 15;

export const Accents = {
    primary: 0x8b5cf6,
    success: 0x10b981,
    warning: 0xf59e0b,
    danger: 0xef4444,
    info: 0x3b82f6,
    purple: 0x8b5cf6,
    discord: 0x5865f2,
    midnight: 0x111827,
} as const;

const HERO_IMAGE = `${config.branding.website}/images/discord-bot-manager-banner.png`;
const INVITE_URL = `https://discord.com/api/oauth2/authorize?client_id=${config.discord.clientId}&permissions=8&scope=bot%20applications.commands`;

export function text(content: string): TextDisplayBuilder {
    return new TextDisplayBuilder().setContent(content && content.trim() ? content : ' ');
}

export function separator(divider = true): SeparatorBuilder {
    return new SeparatorBuilder().setDivider(divider);
}

export function mediaGallery(imageUrl: string): MediaGalleryBuilder {
    return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl));
}

export function thumbnail(imageUrl = config.branding.logo): ThumbnailBuilder {
    return new ThumbnailBuilder().setURL(imageUrl);
}

export function baseContainer(accent: number): ContainerBuilder {
    return new ContainerBuilder().setAccentColor(accent);
}

function brandLine(label = 'VICTUS CLOUD CONNECTION') {
    return `-# ${Icons.spark} ${label} • secure account intelligence • Discord operations`;
}

function panelTitle(title: string, eyebrow = 'COMMAND LAYER') {
    return `${brandLine(eyebrow)}\n# ${title}`;
}

function premiumContainer(accent: number, title: string, description: string, eyebrow?: string, imageUrl = HERO_IMAGE): ContainerBuilder {
    const container = baseContainer(accent);
    if (imageUrl) container.addMediaGalleryComponents(mediaGallery(imageUrl));
    container
        .addTextDisplayComponents(text(`${panelTitle(title, eyebrow)}\n\n${description}`))
        .addSeparatorComponents(separator());
    return container;
}

function footerNote(note = 'Victus Cloud • private, audited, and account-aware') {
    return text(`-# ${note}`);
}

function commandButtons(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('Open Dashboard')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.website),
        new ButtonBuilder()
            .setLabel('Free Hosting')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.free),
        new ButtonBuilder()
            .setLabel('Support')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.website)
    );
}

function clampPanelText(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 24).trim()}... [message trimmed]`;
}

function createBrandedContainer(accent: number, title: string, description: string, eyebrow: string): ContainerBuilder {
    return premiumContainer(accent, title, description, eyebrow)
        .addTextDisplayComponents(footerNote());
}

export function successContainer(title: string, description: string): ContainerBuilder {
    return createBrandedContainer(Accents.success, `◇ ${title}`, description, 'SUCCESS SIGNAL');
}

export function errorContainer(title: string, description: string): ContainerBuilder {
    return createBrandedContainer(Accents.danger, `△ ${title}`, description, 'ERROR SIGNAL');
}

export function warningContainer(title: string, description: string): ContainerBuilder {
    return createBrandedContainer(Accents.warning, `△ ${title}`, description, 'ATTENTION REQUIRED');
}

export function infoContainer(title: string, description: string): ContainerBuilder {
    return createBrandedContainer(Accents.info, `◆ ${title}`, description, 'INFORMATION NODE');
}

export function linkAccountContainer(
    username: string,
    avatarUrl: string,
    expiryTimestamp: number,
    linkUrl: string
): ContainerBuilder {
    const container = premiumContainer(
        Accents.discord,
        'Link Your Victus Cloud Account',
        `**Confirm the Discord account and Victus account before connecting them.**\n\n` +
        `> Discord identity: **${username}**\n` +
        `> Secure token expires: <t:${expiryTimestamp}:R>\n\n` +
        `### What happens next\n` +
        `› Open the private link below\n` +
        `› Sign in to Victus Cloud\n` +
        `› Review both accounts\n` +
        `› Confirm the connection`,
        'PRIVATE LINK SESSION'
    );

    if (avatarUrl) {
        container.addTextDisplayComponents(text(`-# Discord avatar preview`));
        container.addMediaGalleryComponents(mediaGallery(avatarUrl));
    }

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('Link Account')
            .setStyle(ButtonStyle.Link)
            .setURL(linkUrl),
        new ButtonBuilder()
            .setLabel('Create Account')
            .setStyle(ButtonStyle.Link)
            .setURL(`${config.branding.website}/discord-signup?from=bot`),
        new ButtonBuilder()
            .setLabel('Help')
            .setStyle(ButtonStyle.Link)
            .setURL(`${config.branding.website}/docs`)
    );

    container
        .addActionRowComponents(buttons)
        .addTextDisplayComponents(footerNote('Private link tokens are single-user and expire automatically.'));

    return container;
}

export function linkPanelContainer(): ContainerBuilder {
    const container = premiumContainer(
        Accents.primary,
        'Victus Cloud Account Link Panel',
        `**Bind Discord to Victus Cloud and unlock account-aware controls.**\n\n` +
        `### Unlocks\n` +
        `› Website linked role and member verification\n` +
        `› Account, server, invoice, and service commands\n` +
        `› Private operational DMs from Victus Cloud\n` +
        `› Faster support context for staff\n\n` +
        `### Security\n` +
        `Each click creates a private expiring token for the user who pressed it. The final website page shows both accounts before linking.`,
        'PUBLIC CONNECTION PANEL'
    );

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('victus_link_panel_start')
            .setLabel('Link Victus Account')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setLabel('Open Victus Cloud')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.website),
        new ButtonBuilder()
            .setLabel('Invite Bot')
            .setStyle(ButtonStyle.Link)
            .setURL(INVITE_URL)
    );

    return container
        .addActionRowComponents(buttons)
        .addTextDisplayComponents(footerNote('Press the button once. The next message is private to you.'));
}

export function adminDmContainer(subject: string, message: string, adminEmail?: string | null): ContainerBuilder {
    const container = premiumContainer(
        Accents.primary,
        subject,
        `${message}\n\n` +
        `### Source\n` +
        `› Sent by **Victus Cloud Admin**${adminEmail ? ` (${adminEmail})` : ''}\n` +
        `› Delivery channel: Discord direct message\n` +
        `› This message was queued from the admin panel`,
        'ADMIN DIRECT MESSAGE'
    );

    return container
        .addActionRowComponents(commandButtons())
        .addTextDisplayComponents(footerNote('You can configure DM notification categories with /preferences.'));
}

export function helpMenuContainer(
    username: string,
    _avatarUrl: string,
    commandCount: number
): ContainerBuilder {
    const container = premiumContainer(
        Accents.primary,
        'Victus Cloud Help Menu',
        `Welcome, **${username}**.\n\n` +
        `### Live command surface\n` +
        `› **${commandCount}** slash commands available\n` +
        `› Account linking and role sync\n` +
        `› Server, billing, services, and support workflows\n\n` +
        `Use the category selector below to open a command group.`,
        'HELP CENTER'
    );

    const menu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('help_category')
            .setPlaceholder('Select a command category')
            .addOptions([
                { label: 'Account', description: 'Link, unlink, profile, preferences', value: 'account' },
                { label: 'Servers', description: 'List, inspect, and power manage servers', value: 'servers' },
                { label: 'Billing', description: 'Invoices, services, and account billing', value: 'billing' },
                { label: 'AI Support', description: 'Ask the Victus Cloud AI assistant', value: 'ai' },
                { label: 'Support', description: 'Support paths and Victus Cloud links', value: 'support' },
            ])
    );

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('Invite')
            .setStyle(ButtonStyle.Link)
            .setURL(INVITE_URL),
        new ButtonBuilder()
            .setLabel('Dashboard')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.website),
        new ButtonBuilder()
            .setLabel('Support')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.website)
    );

    return container
        .addActionRowComponents(buttons)
        .addActionRowComponents(menu)
        .addTextDisplayComponents(footerNote('Select a category to reshape this panel.'));
}

export function aiChatContainer(
    question: string,
    answer: string,
    model: string,
    linked: boolean
): ContainerBuilder {
    const container = premiumContainer(
        Accents.info,
        'Victus Cloud AI',
        `**Question**\n${clampPanelText(question, 900)}\n\n` +
        `**Answer**\n${clampPanelText(answer, 2900)}`,
        'GROQ LLAMA SUPPORT'
    );

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('Open Dashboard')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.website),
        new ButtonBuilder()
            .setLabel('Support')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.website),
        new ButtonBuilder()
            .setLabel(linked ? 'Account Linked' : 'Link Account')
            .setStyle(ButtonStyle.Link)
            .setURL(`${config.branding.website}/discord-link`)
    );

    return container
        .addActionRowComponents(buttons)
        .addTextDisplayComponents(footerNote(`Model: ${model} - Victus-focused answers, not live billing approval.`));
}

export function invoiceListContainer(
    invoices: { id: string; amount: string; status: string; date: string }[]
): ContainerBuilder {
    let content = `${panelTitle('Your Invoices', 'BILLING LEDGER')}\n\n`;

    if (invoices.length === 0) {
        content += `_No invoices found for your linked Victus account._`;
    } else {
        invoices.slice(0, 8).forEach((invoice) => {
            content += `### ${statusIcon(invoice.status)} Invoice #${invoice.id}\n` +
                `${Icons.credits} **Amount:** ${invoice.amount} | **Status:** ${statusLabel(invoice.status)}\n` +
                `${Icons.calendar} **Date:** ${invoice.date}\n\n`;
        });
    }

    return baseContainer(Accents.primary)
        .addMediaGalleryComponents(mediaGallery(HERO_IMAGE))
        .addTextDisplayComponents(text(content))
        .addTextDisplayComponents(footerNote());
}

export function servicesListContainer(
    services: { name: string; status: string; price: string; renewsAt?: string }[]
): ContainerBuilder {
    let content = `${panelTitle('Your Services', 'SERVICE MATRIX')}\n\n`;

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

    return baseContainer(Accents.primary)
        .addMediaGalleryComponents(mediaGallery(HERO_IMAGE))
        .addTextDisplayComponents(text(content))
        .addTextDisplayComponents(footerNote());
}

export function userInfoContainer(
    username: string,
    discordId: string,
    isLinked: boolean,
    profile?: any,
    servers: any[] = [],
    history: any[] = [],
    creditBalance?: { amount: number; currency: string; found: boolean; source: string },
    services: any[] = []
): ContainerBuilder {
    const accent = isLinked ? Accents.success : Accents.warning;
    const container = baseContainer(accent).addMediaGalleryComponents(mediaGallery(HERO_IMAGE));

    const displayName = decodeDisplayText(profile?.username || profile?.full_name || username, username);
    let content = `${panelTitle(`Victus Profile: ${displayName}`, 'ACCOUNT INTELLIGENCE')}\n`;
    content += `-# Discord ID: \`${discordId}\` • Link status: **${isLinked ? 'Connected' : 'Not linked'}**\n\n`;

    if (isLinked && profile) {
        const billingReady = profile.billing_account_created ?? profile.billing_panel_created;
        const panelReady = profile.control_panel_created;
        const driveReady = profile.victus_drive_created;
        const creditText = creditBalance
            ? `${formatCredits(creditBalance.amount, creditBalance.currency)}${creditBalance.source === 'paymenter' ? ' synced from Paymenter' : ''}`
            : formatCredits(profile.credits || profile.credit || profile.balance || 0);

        content += `### Account Ledger\n`;
        content += `${Icons.mail} **Email:** ${profile.email || '`Hidden`'}\n`;
        content += `${Icons.credits} **Credits:** **${creditText}**\n`;
        content += `${Icons.calendar} **Joined:** ${formatDate(profile.created_at)}\n\n`;

        content += `### Provisioning\n`;
        content += `${billingReady ? Icons.success : Icons.warning} Billing account: **${billingReady ? 'Ready' : 'Not ready'}**\n`;
        content += `${panelReady ? Icons.success : Icons.warning} Service provisioning: **${panelReady ? 'Ready' : 'Not ready'}**\n`;
        content += `${driveReady ? Icons.success : Icons.warning} Victus Drive: **${driveReady ? 'Ready' : 'Not ready'}**\n\n`;

        content += `### Servers Owned (${servers.length})\n`;
        if (servers.length > 0) {
            servers.slice(0, 6).forEach(s => {
                const status = s.is_suspended || s.suspended ? 'suspended' : (s.status || 'offline');
                content += `${statusIcon(status)} \`${compactId(s.identifier)}\` **${decodeDisplayText(s.name)}** - ${statusLabel(status)}\n`;
            });
            if (servers.length > 6) content += `-# Showing 6 of ${servers.length}. Use Victus Cloud for the full fleet.\n`;
        } else {
            content += `_No active servers found._\n`;
        }
        content += `\n`;

        content += `### Services (${services.length})\n`;
        if (services.length > 0) {
            services.slice(0, 6).forEach(s => {
                const priceText = s.price ? ` — ${s.price}` : '';
                content += `${statusIcon(s.status)} **${decodeDisplayText(s.name)}** - ${statusLabel(s.status)}${priceText}\n`;
            });
            if (services.length > 6) content += `-# Showing 6 of ${services.length}. Use Victus Cloud for all services.\n`;
        } else {
            content += `_No active services found._\n`;
        }
        content += `\n`;

        content += `### Recent Admin Trace\n`;
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

    return container
        .addTextDisplayComponents(text(content))
        .addActionRowComponents(commandButtons())
        .addTextDisplayComponents(footerNote());
}

export const ComponentsV2 = {
    text,
    separator,
    mediaGallery,
    thumbnail,
    baseContainer,
    successContainer,
    errorContainer,
    warningContainer,
    infoContainer,
    linkAccountContainer,
    linkPanelContainer,
    adminDmContainer,
    helpMenuContainer,
    aiChatContainer,
    invoiceListContainer,
    servicesListContainer,
    userInfoContainer,
    Accents,
    IS_COMPONENTS_V2,
};
