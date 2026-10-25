import { PermissionFlagsBits, type Message } from 'discord.js';
import { supabase } from './supabase.js';
import { ticketTranslationService } from './ticketTranslationService.js';
import { logger } from '../utils/logger.js';
import { enqueueTicketAi, pauseTicketAiLocally } from './discordTicketAi.js';
import { hasReadableTicketAttachment, ticketAiQueryWithAttachments } from './ticketAiAttachments.js';
import { hasAiImageAttachment, loadAiImages } from './aiImages.js';
import { recordAiTurn, recordStaffTicketHandling } from './victusAiContext.js';

const notTicketUntil = new Map<string, number>();
const lastLookupFailureNotice = new Map<string, number>();
const NOT_TICKET_TTL_MS = 60_000;

export function shouldAutoReplyToTicketMessage(ticketOwnerId: string, authorId: string, content: string, hasAttachments = false): boolean {
    const text = content.trim();
    return authorId === ticketOwnerId && (text.length > 0 || hasAttachments) && !/^[!/]/.test(text);
}

/** Keep Discord ticket transcripts and translation inside Discord. */
export async function handleDiscordTicketMessage(message: Message): Promise<boolean> {
    if (message.author.bot || !message.inGuild()) return false;
    if ((notTicketUntil.get(message.channelId) || 0) > Date.now()) return false;

    const startedAt = Date.now();
    const ticket = await supabase.getTicketByChannel(message.channelId).catch(() => null);
    if (!ticket || ticket.guild_id !== message.guildId) {
        // A transient database failure must not suppress the next message in a
        // real ticket for a full minute.
        const looksLikeTicket = /^ticket-\d+$/i.test(message.channel.name);
        if (!looksLikeTicket) {
            notTicketUntil.set(message.channelId, Date.now() + NOT_TICKET_TTL_MS);
        } else if (!supabase.isAvailable() &&
            (lastLookupFailureNotice.get(message.channelId) || 0) < Date.now() - 5 * 60_000) {
            const sent = await (message.channel as any).send({
                content: 'Victus AI cannot access ticket records right now. Your message is visible here for staff to review.',
                allowedMentions: { parse: [] },
            }).catch(() => null);
            if (sent) lastLookupFailureNotice.set(message.channelId, Date.now());
        }
        return false;
    }

    // Schedule the answer as soon as the ticket is identified. Transcript and
    // staff-role lookups should not hold up the customer's AI response.
    if (shouldAutoReplyToTicketMessage(ticket.discord_id, message.author.id, message.content,
        hasReadableTicketAttachment(message) || hasAiImageAttachment(message.attachments.values()))) {
        enqueueTicketAi(ticket, message.channel as any, Promise.all([
            ticketAiQueryWithAttachments(message).catch(() => message.content),
            loadAiImages(message.attachments.values()).catch((error) => {
                logger.warn(`Could not read ticket AI image: ${error instanceof Error ? error.message : String(error)}`);
                return [];
            }),
        ]).then(([query, images]) => ({
            query: query || 'Please inspect my attached image.', images,
        })));
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
    const member = isTicketOwner ? message.member : (message.member ?? await message.guild?.members.fetch(message.author.id).catch(() => null));
    const isStaff = !isTicketOwner && !!member && (
        member.permissions?.has?.(PermissionFlagsBits.Administrator) ||
        member.permissions?.has?.(PermissionFlagsBits.ManageChannels) ||
        staffRoleIds.some((id: string) => member.roles.cache.has(id))
    );

    if (isStaff) {
        // Stop queued and in-flight AI replies before slower transcript/knowledge writes.
        // The database state preserves the handoff through bot restarts.
        pauseTicketAiLocally(ticket.id);
        const state = await supabase.getDiscordTicketAiState(ticket.id).catch(() => null);
        if (state?.enabled !== false) {
            const saved = await supabase.setDiscordTicketAiEnabled(ticket.id, false, message.author.id).catch(() => false);
            if (saved) {
                await (message.channel as any).send({
                    content: '⏸️ Victus AI paused because staff replied. Staff can use `/ticketai resume` when AI help is needed again.',
                    allowedMentions: { parse: [] },
                }).catch(() => undefined);
            } else {
                logger.error(`Could not persist staff AI handoff for ticket ${ticket.id}; replies remain paused in this bot process`);
            }
        }
    }

    const logged = await supabase.logTicketMessage({
        ticket_id: ticket.id,
        author_discord_id: `dc:${message.author.id}`,
        author_username: member?.displayName || message.author.username,
        author_is_staff: isStaff,
        content: message.content || '(attachment / no text)',
        attachments: [...message.attachments.values()].map((attachment) => attachment.url),
    });
    if (!logged) logger.warn(`Ticket transcript write failed for ${ticket.id}`);
    if (logged && isTicketOwner && message.content.trim()) {
        void recordAiTurn(message.author.id, `ticket:${ticket.id}`, 'private', 'user', message.content)
            .catch((error) => logger.warn('Victus AI ticket memory write failed:', error));
    }
    if (logged && isStaff && message.content.trim()) {
        void recordStaffTicketHandling(ticket, logged, message.content).catch((error) =>
            logger.warn('Victus AI could not learn from staff ticket reply:', error));
        void recordAiTurn(String(ticket.discord_id), `ticket:${ticket.id}`, 'private', 'assistant',
            `Staff response: ${message.content}`).catch((error) =>
            logger.warn('Victus AI staff response memory write failed:', error));
    }

    void translateTicketMessage(message, ticket, isStaff).catch((error) => {
        logger.error('Discord ticket translation failed:', error);
    });
    return true;
}

async function translateTicketMessage(message: Message, ticket: any, isStaff: boolean): Promise<void> {
    const content = message.content?.trim();
    if (!content || content.length < 2 || /^(\/\/|\/\*|!|\/)/.test(content)) return;

    const state = await ticketTranslationService.getState(message.channelId);
    if (!state?.enabled || state.language === 'en') return;

    const isCustomer = message.author.id === ticket.discord_id || !isStaff;
    const source = isCustomer ? state.language : 'en';
    const target = isCustomer ? 'en' : state.language;
    const translated = await ticketTranslationService.translate(content, target, source);
    if (!translated || translated.trim().toLowerCase() === content.toLowerCase()) return;

    const notice = ticketTranslationService.formatTranslationNotice({
        isCustomer,
        authorName: message.member?.displayName || message.author.username,
        authorId: ticket.discord_id,
        sourceLanguage: ticketTranslationService.getLanguage(source),
        targetLanguage: ticketTranslationService.getLanguage(target),
        originalText: content,
        translatedText: translated,
    });
    await (message.channel as any).send({ content: notice }).catch(() => undefined);
}
