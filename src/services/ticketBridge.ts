import {
    ChannelType,
    PermissionFlagsBits,
    type Client,
    type Message,
} from 'discord.js';
import { supabase } from './supabase.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const WEB_GUILD_ID = 'victus-web';
const DC_PREFIX = 'dc:'; // marks a ticket_message that originated from Discord

// Channels recently confirmed NOT to be ticket channels — avoids a DB lookup on
// every single message in busy channels.
const notTicketUntil = new Map<string, number>();
const NOT_TICKET_TTL_MS = 60_000;

const CHANNEL_PERMS = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
];

/**
 * Start the realtime bridge: website tickets -> Discord channels, and website
 * messages -> Discord. (Discord -> website is handled in messageCreate via
 * handleTicketChannelMessage.)
 */
export function initTicketBridge(client: Client<true>): void {
    supabase.subscribeToTicketBridge(
        (ticket) => {
            void handleNewWebTicket(client, ticket).catch((e) =>
                logger.error('ticketBridge: handleNewWebTicket failed:', e));
        },
        (message) => {
            void relayWebMessageToDiscord(client, message).catch((e) =>
                logger.error('ticketBridge: relayWebMessageToDiscord failed:', e));
        },
    );
    logger.info('🎫 Ticket bridge initialized.');
}

/** A fresh website ticket: spin up a Discord channel and ping staff. */
async function handleNewWebTicket(client: Client<true>, ticket: any): Promise<void> {
    if (!ticket || ticket.guild_id !== WEB_GUILD_ID) return;
    if (ticket.channel_id) return;                       // already has a Discord channel
    if (!ticket.user_id) return;                          // guest / public-group: nothing to bridge
    if (ticket.custom_answers?.support_group === 'public') return;

    const supportGuildId = config.bot.supportGuildId;
    if (!supportGuildId) {
        logger.warn('ticketBridge: DISCORD_SUPPORT_GUILD_ID not set; cannot create channel for web ticket.');
        return;
    }
    const guild = await client.guilds.fetch(supportGuildId).catch(() => null);
    if (!guild) return;

    const linked = await supabase.getLinkedAccountByUserId(ticket.user_id).catch(() => null);
    const settings = await supabase.getBotSettings(guild.id).catch(() => null);

    const adminRoleIds = (settings?.ticket_admin_role_ids || []).filter((id: string) => guild.roles.cache.has(id));
    const staffRoleIds = (settings?.ticket_staff_role_ids || [])
        .filter((id: string) => guild.roles.cache.has(id) && !adminRoleIds.includes(id));

    // Resolve / create the parent "Tickets" category.
    let parentId: string | null = settings?.ticket_parent_category_id || null;
    if (parentId) {
        const parent = await guild.channels.fetch(parentId).catch(() => null);
        if (!parent || parent.type !== ChannelType.GuildCategory) parentId = null;
    }
    if (!parentId) {
        let cat = guild.channels.cache.find(
            (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'tickets');
        if (!cat) cat = await guild.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory });
        parentId = cat.id;
    }

    const overwrites: any[] = [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }];
    if (linked?.discord_id) overwrites.push({ id: linked.discord_id, allow: CHANNEL_PERMS });
    for (const id of staffRoleIds) overwrites.push({ id, allow: CHANNEL_PERMS });
    for (const id of adminRoleIds) {
        overwrites.push({ id, allow: [...CHANNEL_PERMS, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels] });
    }

    const channel = await guild.channels.create({
        name: `web-${ticket.ticket_number ?? 'ticket'}`,
        type: ChannelType.GuildText,
        parent: parentId,
        topic: `Website support ticket • ${ticket.email ?? ''}`,
        permissionOverwrites: overwrites,
    }).catch((e) => { logger.error('ticketBridge: channel create failed:', e); return null; });
    if (!channel) return;

    await supabase.setTicketChannel(ticket.id, channel.id);

    const staffPing = staffRoleIds.map((id: string) => `<@&${id}>`).join(' ');
    const opener = linked?.discord_id ? `<@${linked.discord_id}>` : (ticket.email ?? 'A website user');
    await channel.send({
        content:
            `${staffPing}\n` +
            `🎫 **Website ticket #${ticket.ticket_number ?? ''}** from ${opener}\n` +
            `**Subject:** ${truncate(ticket.subject, 200)}\n\n` +
            `_Reply in this channel to answer — messages sync to the website ticket._`,
        allowedMentions: { parse: ['roles', 'users'] },
    }).catch(() => undefined);

    // Catch-up: relay any messages that already exist (e.g. the opening message,
    // whose realtime event fired before this channel existed).
    const pending = await supabase.getUnbridgedMessages(ticket.id);
    for (const msg of pending) {
        if (typeof msg.author_discord_id === 'string' && msg.author_discord_id.startsWith(DC_PREFIX)) continue;
        if (await supabase.claimMessageForBridge(msg.id)) {
            await postWebMessage(channel, msg).catch(() => undefined);
        }
    }
}

/** A new website message: relay it into the linked Discord channel (once). */
async function relayWebMessageToDiscord(client: Client<true>, message: any): Promise<void> {
    if (!message?.ticket_id) return;
    // Discord-origin messages are already in the channel.
    if (typeof message.author_discord_id === 'string' && message.author_discord_id.startsWith(DC_PREFIX)) return;

    const ticket = await supabase.getTicket(message.ticket_id).catch(() => null);
    if (!ticket || ticket.guild_id !== WEB_GUILD_ID || !ticket.channel_id) return;

    const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    if (!(await supabase.claimMessageForBridge(message.id))) return; // someone else relayed it
    await postWebMessage(channel as any, message).catch(() => undefined);
}

async function postWebMessage(channel: any, msg: any): Promise<void> {
    const tag = msg.author_is_staff ? '🛡️ ' : '';
    const who = msg.author_username || (msg.author_is_staff ? 'Staff' : 'User');
    const lines = [`**${tag}${who}** (website):`, truncate(msg.content || '', 1800)];
    if (Array.isArray(msg.attachments) && msg.attachments.length) {
        lines.push(msg.attachments.slice(0, 5).join('\n'));
    }
    await channel.send({ content: lines.join('\n'), allowedMentions: { parse: [] } });
}

/**
 * Called from messageCreate: if a message lands in a ticket channel, mirror it
 * to the website ticket. Returns true if it handled the message.
 */
export async function handleTicketChannelMessage(message: Message): Promise<boolean> {
    if (message.author.bot || !message.inGuild()) return false;

    const skipUntil = notTicketUntil.get(message.channelId);
    if (skipUntil && skipUntil > Date.now()) return false;

    const ticket = await supabase.getTicketByChannel(message.channelId).catch(() => null);
    if (!ticket) {
        notTicketUntil.set(message.channelId, Date.now() + NOT_TICKET_TTL_MS);
        return false;
    }

    const settings = await supabase.getBotSettings(message.guildId).catch(() => null);
    const staffRoleIds = [
        ...(settings?.ticket_staff_role_ids || []),
        ...(settings?.ticket_admin_role_ids || []),
    ];
    const member = message.member;
    const isStaff = !!member && (
        member.permissions?.has?.(PermissionFlagsBits.Administrator) ||
        staffRoleIds.some((id: string) => member.roles.cache.has(id))
    );

    await supabase.logTicketMessage({
        ticket_id: ticket.id,
        author_discord_id: DC_PREFIX + message.author.id,   // marks Discord origin (no relay back)
        author_username: member?.displayName || message.author.username,
        author_is_staff: isStaff,
        content: message.content || '(attachment / no text)',
        attachments: [...message.attachments.values()].map((a) => a.url),
    });

    return true;
}

function truncate(value: string, max: number): string {
    if (!value) return '';
    return value.length > max ? value.slice(0, max - 1) + '…' : value;
}
