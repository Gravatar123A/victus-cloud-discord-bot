import { PermissionFlagsBits } from 'discord.js';
import { supabase } from './supabase.js';
import { ticketTranslationService } from './ticketTranslationService.js';
import { logger } from '../utils/logger.js';
import { enqueueTicketAi } from './discordTicketAi.js';
import { recordAiTurn, recordStaffTicketHandling } from './victusAiContext.js';
const notTicketUntil = new Map();
const lastLookupFailureNotice = new Map();
const NOT_TICKET_TTL_MS = 60_000;
export function shouldAutoReplyToTicketMessage(ticketOwnerId, authorId, content) {
    const text = content.trim();
    return authorId === ticketOwnerId && text.length > 0 && !/^[!/]/.test(text);
}
/** Keep Discord ticket transcripts and translation inside Discord. */
export async function handleDiscordTicketMessage(message) {
    if (message.author.bot || !message.inGuild())
        return false;
    if ((notTicketUntil.get(message.channelId) || 0) > Date.now())
        return false;
    const startedAt = Date.now();
    const ticket = await supabase.getTicketByChannel(message.channelId).catch(() => null);
    if (!ticket || ticket.guild_id !== message.guildId) {
        // A transient database failure must not suppress the next message in a
        // real ticket for a full minute.
        const looksLikeTicket = /^ticket-\d+$/i.test(message.channel.name);
        if (!looksLikeTicket) {
            notTicketUntil.set(message.channelId, Date.now() + NOT_TICKET_TTL_MS);
        }
        else if (!supabase.isAvailable() &&
            (lastLookupFailureNotice.get(message.channelId) || 0) < Date.now() - 5 * 60_000) {
            const sent = await message.channel.send({
                content: 'Victus AI cannot access ticket records right now. Your message is visible here for staff to review.',
                allowedMentions: { parse: [] },
            }).catch(() => null);
            if (sent)
                lastLookupFailureNotice.set(message.channelId, Date.now());
        }
        return false;
    }
    // Schedule the answer as soon as the ticket is identified. Transcript and
    // staff-role lookups should not hold up the customer's AI response.
    if (shouldAutoReplyToTicketMessage(ticket.discord_id, message.author.id, message.content)) {
        enqueueTicketAi(ticket, message.channel, message.content);
        logger.info(`Ticket AI queued for ${ticket.id} in ${Date.now() - message.createdTimestamp}ms (lookup ${Date.now() - startedAt}ms)`);
    }
    const settings = await supabase.getBotSettings(message.guildId).catch(() => null);
    const staffRoleIds = [
        ...(settings?.ticket_staff_role_ids || []),
        ...(settings?.ticket_admin_role_ids || []),
        ...(ticket.category?.staff_roles || []),
    ];
    const isTicketOwner = message.author.id === ticket.discord_id;
    // Staff can open their own support ticket. In that ticket they are the customer.
    const isStaff = !isTicketOwner && !!message.member && (message.member.permissions?.has?.(PermissionFlagsBits.Administrator) ||
        message.member.permissions?.has?.(PermissionFlagsBits.ManageChannels) ||
        staffRoleIds.some((id) => message.member?.roles.cache.has(id)));
    const logged = await supabase.logTicketMessage({
        ticket_id: ticket.id,
        author_discord_id: `dc:${message.author.id}`,
        author_username: message.member?.displayName || message.author.username,
        author_is_staff: isStaff,
        content: message.content || '(attachment / no text)',
        attachments: [...message.attachments.values()].map((attachment) => attachment.url),
    });
    if (!logged)
        logger.warn(`Ticket transcript write failed for ${ticket.id}; AI was still queued`);
    if (logged && isTicketOwner && message.content.trim()) {
        void recordAiTurn(message.author.id, `ticket:${ticket.id}`, 'private', 'user', message.content)
            .catch((error) => logger.warn('Victus AI ticket memory write failed:', error));
    }
    if (logged && isStaff && message.content.trim()) {
        void recordStaffTicketHandling(ticket, logged, message.content).catch((error) => logger.warn('Victus AI could not learn from staff ticket reply:', error));
        void recordAiTurn(String(ticket.discord_id), `ticket:${ticket.id}`, 'private', 'assistant', `Staff response: ${message.content}`).catch((error) => logger.warn('Victus AI staff response memory write failed:', error));
    }
    void translateTicketMessage(message, ticket, isStaff).catch((error) => {
        logger.error('Discord ticket translation failed:', error);
    });
    return true;
}
async function translateTicketMessage(message, ticket, isStaff) {
    const content = message.content?.trim();
    if (!content || content.length < 2 || /^(\/\/|\/\*|!|\/)/.test(content))
        return;
    const state = await ticketTranslationService.getState(message.channelId);
    if (!state?.enabled || state.language === 'en')
        return;
    const isCustomer = message.author.id === ticket.discord_id || !isStaff;
    const source = isCustomer ? state.language : 'en';
    const target = isCustomer ? 'en' : state.language;
    const translated = await ticketTranslationService.translate(content, target, source);
    if (!translated || translated.trim().toLowerCase() === content.toLowerCase())
        return;
    const notice = ticketTranslationService.formatTranslationNotice({
        isCustomer,
        authorName: message.member?.displayName || message.author.username,
        authorId: ticket.discord_id,
        sourceLanguage: ticketTranslationService.getLanguage(source),
        targetLanguage: ticketTranslationService.getLanguage(target),
        originalText: content,
        translatedText: translated,
    });
    await message.channel.send({ content: notice }).catch(() => undefined);
}
