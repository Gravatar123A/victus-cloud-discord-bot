import { ChannelType, PermissionFlagsBits, } from 'discord.js';
import { supabase } from './supabase.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
import { createTicketControlPanel } from '../commands/ticket.js';
import { ticketTranslationService } from './ticketTranslationService.js';
const WEB_GUILD_ID = 'victus-web';
const DC_PREFIX = 'dc:'; // marks a ticket_message that originated from Discord
// Channels recently confirmed NOT to be ticket channels — avoids a DB lookup on
// every single message in busy channels.
const notTicketUntil = new Map();
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
export function initTicketBridge(client) {
    supabase.subscribeToTicketBridge((ticket) => {
        void handleNewWebTicket(client, ticket).catch((e) => logger.error('ticketBridge: handleNewWebTicket failed:', e));
    }, (message) => {
        void relayWebMessageToDiscord(client, message).catch((e) => logger.error('ticketBridge: relayWebMessageToDiscord failed:', e));
    });
    logger.info('🎫 Ticket bridge initialized.');
}
/** A fresh website ticket: spin up a Discord channel and ping staff. */
async function handleNewWebTicket(client, ticket) {
    if (!ticket || ticket.guild_id !== WEB_GUILD_ID)
        return;
    if (ticket.channel_id)
        return; // already has a Discord channel
    if (!ticket.user_id)
        return; // guest / public-group: nothing to bridge
    if (ticket.custom_answers?.support_group === 'public')
        return;
    const supportGuildId = config.bot.supportGuildId;
    if (!supportGuildId) {
        logger.warn('ticketBridge: DISCORD_SUPPORT_GUILD_ID not set; cannot create channel for web ticket.');
        return;
    }
    const guild = await client.guilds.fetch(supportGuildId).catch(() => null);
    if (!guild)
        return;
    const linked = await supabase.getLinkedAccountByUserId(ticket.user_id).catch(() => null);
    const settings = await supabase.getBotSettings(guild.id).catch(() => null);
    const adminRoleIds = (settings?.ticket_admin_role_ids || []).filter((id) => guild.roles.cache.has(id));
    const staffRoleIds = (settings?.ticket_staff_role_ids || [])
        .filter((id) => guild.roles.cache.has(id) && !adminRoleIds.includes(id));
    // Resolve / create the parent "Tickets" category.
    let parentId = settings?.ticket_parent_category_id || null;
    if (parentId) {
        const parent = await guild.channels.fetch(parentId).catch(() => null);
        if (!parent || parent.type !== ChannelType.GuildCategory)
            parentId = null;
    }
    if (!parentId) {
        let cat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'tickets');
        if (!cat)
            cat = await guild.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory });
        parentId = cat.id;
    }
    const overwrites = [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }];
    if (linked?.discord_id)
        overwrites.push({ id: linked.discord_id, allow: CHANNEL_PERMS });
    for (const id of staffRoleIds)
        overwrites.push({ id, allow: CHANNEL_PERMS });
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
    if (!channel)
        return;
    await supabase.setTicketChannel(ticket.id, channel.id);
    // First message = the full ticket control panel (entered details, custom
    // answers, /link reminder, Close / Add Member / etc. buttons) + staff ping —
    // the same panel the Discord /ticket flow posts.
    const staffPing = [...adminRoleIds, ...staffRoleIds].map((id) => `<@&${id}>`).join(' ');
    const ownerPing = linked?.discord_id ? `<@${linked.discord_id}>` : '';
    try {
        const controlPanel = createTicketControlPanel(ticket, null, linked);
        await channel.send({
            components: [controlPanel],
            flags: ComponentsV2.IS_COMPONENTS_V2,
            allowedMentions: { parse: ['roles', 'users'] },
        });
        // Components V2 messages can't carry a `content` field — ping separately.
        const webPing = `${staffPing} ${ownerPing}`.trim();
        await channel.send({
            content: webPing || `🎫 New website ticket #${ticket.ticket_number ?? ''}`,
            allowedMentions: { parse: ['roles', 'users'] },
        }).catch(() => undefined);
        const transCard = ticketTranslationService.buildLanguageSelector(ticket.id, linked?.discord_id || 'web-user');
        await channel.send({
            components: [transCard],
            flags: ComponentsV2.IS_COMPONENTS_V2,
        }).catch(() => undefined);
    }
    catch (e) {
        logger.error('ticketBridge: control panel send failed, falling back to text:', e);
        const opener = linked?.discord_id ? `<@${linked.discord_id}>` : (ticket.email ?? 'A website user');
        await channel.send({
            content: `${staffPing}\n` +
                `🎫 **Website ticket #${ticket.ticket_number ?? ''}** from ${opener}\n` +
                `**Subject:** ${truncate(ticket.subject, 200)}\n\n` +
                `_Reply in this channel to answer — messages sync to the website ticket._`,
            allowedMentions: { parse: ['roles', 'users'] },
        }).catch(() => undefined);
    }
    // Catch-up: relay any messages that already exist (e.g. the opening message,
    // whose realtime event fired before this channel existed).
    const pending = await supabase.getUnbridgedMessages(ticket.id);
    for (const msg of pending) {
        if (typeof msg.author_discord_id === 'string' && msg.author_discord_id.startsWith(DC_PREFIX))
            continue;
        if (await supabase.claimMessageForBridge(msg.id)) {
            await postWebMessage(channel, msg).catch(() => undefined);
        }
    }
}
/** A new website message: relay it into the linked Discord channel (once). */
async function relayWebMessageToDiscord(client, message) {
    if (!message?.ticket_id)
        return;
    // Discord-origin messages are already in the channel.
    if (typeof message.author_discord_id === 'string' && message.author_discord_id.startsWith(DC_PREFIX))
        return;
    const ticket = await supabase.getTicket(message.ticket_id).catch(() => null);
    if (!ticket || ticket.guild_id !== WEB_GUILD_ID || !ticket.channel_id)
        return;
    const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
    if (!channel || !channel.isTextBased())
        return;
    if (!(await supabase.claimMessageForBridge(message.id)))
        return; // someone else relayed it
    await postWebMessage(channel, message).catch(() => undefined);
}
/**
 * Mirror a Victus AI reply posted in a Discord ticket channel back into the
 * website ticket thread, so the web user sees the answer (e.g. after staff
 * /summon the AI into the ticket). Logged as a Discord-origin staff message so
 * it appears on the website but is never relayed back to Discord (no loop).
 * No-op if the channel isn't a ticket channel.
 */
export async function mirrorAiReplyToTicket(channelId, botId, content) {
    const text = (content || '').trim();
    if (!text)
        return;
    const ticket = await supabase.getTicketByChannel(channelId).catch(() => null);
    if (!ticket)
        return;
    await supabase.logTicketMessage({
        ticket_id: ticket.id,
        author_discord_id: DC_PREFIX + botId, // Discord-origin → not relayed back
        author_username: 'Victus AI',
        author_is_staff: true,
        content: truncate(text, 1800),
        attachments: [],
    }).catch(() => undefined);
}
async function postWebMessage(channel, msg) {
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
export async function handleTicketChannelMessage(message) {
    if (message.author.bot || !message.inGuild())
        return false;
    const skipUntil = notTicketUntil.get(message.channelId);
    if (skipUntil && skipUntil > Date.now())
        return false;
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
    const isStaff = !!member && (member.permissions?.has?.(PermissionFlagsBits.Administrator) ||
        staffRoleIds.some((id) => member.roles.cache.has(id)));
    await supabase.logTicketMessage({
        ticket_id: ticket.id,
        author_discord_id: DC_PREFIX + message.author.id, // marks Discord origin (no relay back)
        author_username: member?.displayName || message.author.username,
        author_is_staff: isStaff,
        content: message.content || '(attachment / no text)',
        attachments: [...message.attachments.values()].map((a) => a.url),
    });
    // Real-time bidirectional translation
    void handleTicketTranslation(message, ticket, isStaff).catch((err) => {
        logger.error('Error during ticket message translation:', err);
    });
    return true;
}
async function handleTicketTranslation(message, ticket, isStaff) {
    const rawContent = message.content?.trim();
    if (!rawContent || rawContent.length < 2)
        return;
    // Skip commands, internal staff comments
    if (rawContent.startsWith('//') ||
        rawContent.startsWith('/*') ||
        rawContent.startsWith('!') ||
        rawContent.startsWith('/')) {
        return;
    }
    const state = await ticketTranslationService.getState(message.channelId);
    if (!state || !state.enabled || state.language === 'en') {
        return;
    }
    const isCustomer = message.author.id === ticket.discord_id || !isStaff;
    const selectedLang = ticketTranslationService.getLanguage(state.language);
    const englishLang = ticketTranslationService.getLanguage('en');
    try {
        if (isCustomer) {
            // Customer message: translate to English for staff
            const translated = await ticketTranslationService.translate(rawContent, 'en', state.language);
            if (translated && translated.trim().toLowerCase() !== rawContent.toLowerCase()) {
                const notice = ticketTranslationService.formatTranslationNotice({
                    isCustomer: true,
                    authorName: message.member?.displayName || message.author.username,
                    authorId: ticket.discord_id,
                    sourceLanguage: selectedLang,
                    targetLanguage: englishLang,
                    originalText: rawContent,
                    translatedText: translated,
                });
                await message.channel.send({ content: notice }).catch(() => undefined);
            }
        }
        else {
            // Staff message: translate to customer's chosen language
            const translated = await ticketTranslationService.translate(rawContent, state.language, 'en');
            if (translated && translated.trim().toLowerCase() !== rawContent.toLowerCase()) {
                const notice = ticketTranslationService.formatTranslationNotice({
                    isCustomer: false,
                    authorName: message.member?.displayName || message.author.username,
                    authorId: ticket.discord_id,
                    sourceLanguage: englishLang,
                    targetLanguage: selectedLang,
                    originalText: rawContent,
                    translatedText: translated,
                });
                await message.channel.send({ content: notice }).catch(() => undefined);
            }
        }
    }
    catch (err) {
        logger.warn(`Failed translating message in ticket channel ${message.channelId}:`, err);
    }
}
function truncate(value, max) {
    if (!value)
        return '';
    return value.length > max ? value.slice(0, max - 1) + '…' : value;
}
