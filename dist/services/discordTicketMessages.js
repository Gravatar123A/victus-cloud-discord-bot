import { PermissionFlagsBits } from 'discord.js';
import { supabase } from './supabase.js';
import { ticketTranslationService } from './ticketTranslationService.js';
import { logger } from '../utils/logger.js';
import { enqueueTicketAi } from './discordTicketAi.js';
const notTicketUntil = new Map();
const NOT_TICKET_TTL_MS = 60_000;
/** Keep Discord ticket transcripts and translation inside Discord. */
export async function handleDiscordTicketMessage(message) {
    if (message.author.bot || !message.inGuild())
        return false;
    if ((notTicketUntil.get(message.channelId) || 0) > Date.now())
        return false;
    const ticket = await supabase.getTicketByChannel(message.channelId).catch(() => null);
    if (!ticket || ticket.guild_id !== message.guildId) {
        notTicketUntil.set(message.channelId, Date.now() + NOT_TICKET_TTL_MS);
        return false;
    }
    const settings = await supabase.getBotSettings(message.guildId).catch(() => null);
    const staffRoleIds = [
        ...(settings?.ticket_staff_role_ids || []),
        ...(settings?.ticket_admin_role_ids || []),
        ...(ticket.category?.staff_roles || []),
    ];
    const isStaff = !!message.member && (message.member.permissions?.has?.(PermissionFlagsBits.Administrator) ||
        message.member.permissions?.has?.(PermissionFlagsBits.ManageChannels) ||
        staffRoleIds.some((id) => message.member?.roles.cache.has(id)));
    await supabase.logTicketMessage({
        ticket_id: ticket.id,
        author_discord_id: `dc:${message.author.id}`,
        author_username: message.member?.displayName || message.author.username,
        author_is_staff: isStaff,
        content: message.content || '(attachment / no text)',
        attachments: [...message.attachments.values()].map((attachment) => attachment.url),
    });
    void translateTicketMessage(message, ticket, isStaff).catch((error) => {
        logger.error('Discord ticket translation failed:', error);
    });
    if (!isStaff && message.author.id === ticket.discord_id && message.content.trim() && !/^[!/]/.test(message.content.trim())) {
        enqueueTicketAi(ticket, message.channel, message.content);
    }
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
