import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { Icons } from '../utils/premium.js';
import {
    Accents,
    baseContainer,
    commandButtons,
    footerNote,
    mediaGallery,
    panelTitle,
    text,
    separator,
    IS_COMPONENTS_V2,
} from './componentsV2.js';

const HERO_IMAGE = `${config.branding.website}/images/discord-bot-manager-banner.png`;

function notificationContainer(accent: number, title: string, description: string, eyebrow: string): ContainerBuilder {
    const container = baseContainer(accent);
    container.addMediaGalleryComponents(mediaGallery(HERO_IMAGE));
    container
        .addTextDisplayComponents(text(`${panelTitle(title, eyebrow)}\n\n${description}`))
        .addSeparatorComponents(separator());
    return container;
}
/** Welcome / sign-up DM — sent when user signs up via Discord OAuth */
export function welcomeDM(discordUsername: string): ContainerBuilder {
    const container = notificationContainer(
        Accents.success,
        `Welcome to Victus Cloud, ${discordUsername}!`,
        `${Icons.crown} **Your account is ready.**\n\n` +
        `${Icons.spark} You now have access to:\n` +
        `${Icons.server} › **Game Servers** — deploy Minecraft, Rust, CS2 and more\n` +
        `${Icons.node} › **VPS / Cloud** — full root access virtual servers\n` +
        `${Icons.network} › **Web Hosting** — fast and secure website hosting\n` +
        `${Icons.brand} › **And more** — code hosting, Discord bots, hosted apps\n\n` +
        `${Icons.link} **Next steps:**\n` +
        `› Use **/link** to connect your Discord to Victus Cloud\n` +
        `› Visit the **dashboard** to deploy your first service\n` +
        `› Join the **support server** if you need help\n\n` +
        `${Icons.credits} You have access to **free hosting** to get started.`,
        'WELCOME ABOARD'
    );

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('Open Dashboard')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.website),
        new ButtonBuilder()
            .setLabel('Free Hosting')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.free),
        new ButtonBuilder()
            .setLabel('Support Server')
            .setStyle(ButtonStyle.Link)
            .setURL(`${config.branding.website}/discord`)
    );

    return container
        .addActionRowComponents(buttons)
        .addTextDisplayComponents(footerNote('You can configure DM notification categories with /preferences.'));
}

/** Account linked DM — sent when user links Discord to Victus Cloud */
export function accountLinkedDM(discordUsername: string): ContainerBuilder {
    const container = notificationContainer(
        Accents.success,
        `${Icons.link} Account Linked Successfully`,
        `${Icons.success} **${discordUsername}**, your Discord is now connected to Victus Cloud.\n\n` +
        `${Icons.spark} **What changed:**\n` +
        `${Icons.node} › You now have **account-aware** commands\n` +
        `${Icons.server} › Use **/servers** to view & manage your servers\n` +
        `${Icons.invoice} › Use **/invoices** to check billing\n` +
        `${Icons.service} › Use **/services** to view your active services\n` +
        `${Icons.id} › You\'ll receive **private DMs** for billing & server updates\n\n` +
        `${Icons.success} Your linked role has been assigned.`,
        'ACCOUNT CONNECTED'
    );

    return container
        .addActionRowComponents(commandButtons())
        .addTextDisplayComponents(footerNote('Manage notification preferences with /preferences.'));
}

/** Invoice created/due DM — payment reminder with pay button */
export function invoiceDueDM(
    invoiceId: string,
    amount: string,
    currency: string,
    dueDate: string,
    billingUrl: string
): ContainerBuilder {
    const container = notificationContainer(
        Accents.warning,
        `${Icons.invoice} Invoice #${invoiceId} is Due`,
        `${Icons.credits} **Amount:** ${currency}${amount}\n` +
        `${Icons.calendar} **Due Date:** ${dueDate}\n\n` +
        `${Icons.warning} Please pay your invoice before the due date to avoid service interruption.\n\n` +
        `You can pay securely through the billing panel.`,
        'PAYMENT REMINDER'
    );

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('Pay Invoice')
            .setStyle(ButtonStyle.Link)
            .setURL(`${billingUrl}/invoice/${invoiceId}`),
        new ButtonBuilder()
            .setLabel('Billing Dashboard')
            .setStyle(ButtonStyle.Link)
            .setURL(billingUrl)
    );

    return container
        .addActionRowComponents(buttons)
        .addTextDisplayComponents(footerNote('Late payments may result in service suspension.'));
}

/** Invoice paid DM — confirmation */
export function invoicePaidDM(
    invoiceId: string,
    amount: string,
    currency: string
): ContainerBuilder {
    const container = notificationContainer(
        Accents.success,
        `${Icons.success} Invoice #${invoiceId} Paid`,
        `${Icons.credits} **Amount paid:** ${currency}${amount}\n\n` +
        `${Icons.success} Your payment has been confirmed. Thank you!\n\n` +
        `${Icons.spark} Your services will remain active. You can view your invoice history in the billing panel.`,
        'PAYMENT CONFIRMED'
    );

    return container
        .addActionRowComponents(commandButtons())
        .addTextDisplayComponents(footerNote('Receipts are available in the billing panel.'));
}

/** Server created / deployed DM */
export function serverCreatedDM(
    serverName: string,
    serverType: string,
    panelUrl: string
): ContainerBuilder {
    const container = notificationContainer(
        Accents.info,
        `${Icons.server} Server Deployed: ${serverName}`,
        `${Icons.spark} Your **${serverType}** server has been created and is being provisioned.\n\n` +
        `${Icons.node} **Server:** ${serverName}\n` +
        `${Icons.panel} **Panel:** Access your server through the control panel below\n\n` +
        `${Icons.activity} The server will be ready within a few minutes. You\'ll receive another notification once installation is complete.`,
        'SERVER DEPLOYMENT'
    );

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('Open Control Panel')
            .setStyle(ButtonStyle.Link)
            .setURL(panelUrl),
        new ButtonBuilder()
            .setLabel('Dashboard')
            .setStyle(ButtonStyle.Link)
            .setURL(config.branding.website)
    );

    return container
        .addActionRowComponents(buttons)
        .addTextDisplayComponents(footerNote('Server provisioning typically takes 1-5 minutes.'));
}

/** Server installed DM */
export function serverInstalledDM(
    serverName: string,
    panelUrl: string
): ContainerBuilder {
    const container = notificationContainer(
        Accents.success,
        `${Icons.success} Server Ready: ${serverName}`,
        `${Icons.spark} Your server **${serverName}** is now fully installed and ready to use!\n\n` +
        `${Icons.start} You can now:\n` +
        `${Icons.node} › Start, stop, or restart your server\n` +
        `${Icons.disk} › Manage files and backups\n` +
        `${Icons.database} › Configure your server settings\n` +
        `${Icons.network} › Assign additional ports\n\n` +
        `${Icons.link} Click below to go to your control panel.`,
        'SERVER READY'
    );

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('Open Control Panel')
            .setStyle(ButtonStyle.Link)
            .setURL(panelUrl),
        new ButtonBuilder()
            .setLabel('Documentation')
            .setStyle(ButtonStyle.Link)
            .setURL(`${config.branding.website}/docs`)
    );

    return container
        .addActionRowComponents(buttons)
        .addTextDisplayComponents(footerNote('Need help? Use /help or join our support server.'));
}

/** Order confirmed DM */
export function orderConfirmedDM(
    orderId: string,
    productName: string,
    amount: string,
    currency: string
): ContainerBuilder {
    const container = notificationContainer(
        Accents.success,
        `${Icons.service} Order #${orderId} Confirmed`,
        `${Icons.spark} Your order for **${productName}** has been confirmed.\n\n` +
        `${Icons.credits} **Amount:** ${currency}${amount}\n` +
        `${Icons.id} **Order ID:** #${orderId}\n\n` +
        `${Icons.node} Your service is being provisioned. You will receive another notification when it\'s ready.`,
        'ORDER CONFIRMED'
    );

    return container
        .addActionRowComponents(commandButtons())
        .addTextDisplayComponents(footerNote('Check order status with /services.'));
}

/** Ticket created DM (user) */
export function ticketCreatedDM(
    ticketId: string,
    subject: string
): ContainerBuilder {
    const container = notificationContainer(
        Accents.info,
        `${Icons.mail} Support Ticket #${ticketId} Created`,
        `${Icons.spark} Your support ticket has been created.\n\n` +
        `${Icons.node} **Subject:** ${subject}\n` +
        `${Icons.id} **Ticket ID:** #${ticketId}\n\n` +
        `${Icons.info} A support agent will respond shortly. You\'ll be notified when there\'s a reply.`,
        'SUPPORT TICKET'
    );

    return container
        .addActionRowComponents(commandButtons())
        .addTextDisplayComponents(footerNote('Response time: typically within 1-2 hours.'));
}

/** New login detected DM */
export function loginDetectedDM(
    ip: string,
    device: string,
    time: string
): ContainerBuilder {
    const container = notificationContainer(
        Accents.danger,
        `${Icons.warning} New Login Detected`,
        `${Icons.spark} A new login was detected on your Victus Cloud account.\n\n` +
        `${Icons.network} **IP Address:** ${ip}\n` +
        `${Icons.node} **Device:** ${device}\n` +
        `${Icons.calendar} **Time:** ${time}\n\n` +
        `${Icons.danger} If this wasn\'t you, please secure your account immediately.`,
        'SECURITY ALERT'
    );

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setLabel('Account Settings')
            .setStyle(ButtonStyle.Link)
            .setURL(`${config.branding.website}/settings`),
        new ButtonBuilder()
            .setLabel('Contact Support')
            .setStyle(ButtonStyle.Link)
            .setURL(`${config.branding.website}/support`)
    );

    return container
        .addActionRowComponents(buttons)
        .addTextDisplayComponents(footerNote('Enable 2FA in account settings for enhanced security.'));
}

export const NotificationTemplates = {
    welcomeDM,
    accountLinkedDM,
    invoiceDueDM,
    invoicePaidDM,
    serverCreatedDM,
    serverInstalledDM,
    orderConfirmedDM,
    ticketCreatedDM,
    loginDetectedDM,
    IS_COMPONENTS_V2,
};

export type NotificationType =
    | 'welcome'
    | 'account_linked'
    | 'invoice_due'
    | 'invoice_paid'
    | 'server_created'
    | 'server_installed'
    | 'order_confirmed'
    | 'ticket_created'
    | 'login_detected';
