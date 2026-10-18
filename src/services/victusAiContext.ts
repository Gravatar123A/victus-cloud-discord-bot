import { supabase } from './supabase.js';
import { getTicketKnowledge } from './ticketKnowledge.js';
import { logger } from '../utils/logger.js';

export type AiScope = 'public' | 'private';
const STOP = new Set('about after again could would where which their there these those please hello thanks thank what when with from your have been this that were does'.split(' '));

/** Strip obvious secrets and contact identifiers before persistence or a free model call. */
export function sanitizeAiText(input: string, max = 1800): string {
    return input
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
        .replace(/\b(?:\+?\d[\d\s().-]{8,}\d)\b/g, '[phone]')
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP address]')
        .replace(/\b(?:sk[-_][A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9_-]{30,})\b/g, '[secret]')
        .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[payment number]')
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[identifier]')
        .replace(/\b\d{16,20}\b/g, '[identifier]')
        .replace(/\b(?:password|token|api[_ -]?key|secret|authorization|private[_ -]?key)\s*[:=]\s*\S+/gi, '$1: [redacted]')
        .replace(/https?:\/\/[^\s)]+/gi, (url) =>
            /^https?:\/\/(?:[\w-]+\.)?victuscloud\.com(?:\/|$)/i.test(url)
                ? url.split(/[?#]/)[0] : '[external link]')
        .replace(/<@!?\d+>/g, '[member]')
        .trim().slice(0, max);
}

export function mayLearnFromTicket(category: string, question: string, answer: string): boolean {
    if (/(billing|payment|premium|partnership|abuse|security|privacy|account|refund|dispute)/i.test(category)) return false;
    if (/(password|token|api key|secret|invoice|refund|payment|credit card|private key|recovery code|email address|your account)/i.test(`${question} ${answer}`)) return false;
    return question.trim().length >= 12 && answer.trim().length >= 25 &&
        !/^([!/]|https?:\/\/\S+$)/.test(answer.trim());
}

function terms(text: string): string[] {
    return [...new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((term) => !STOP.has(term)))].slice(0, 18);
}

export async function recordStaffTicketHandling(ticket: any, messageId: string, answer: string,
    suppliedQuestion?: string): Promise<boolean> {
    try {
        const history = suppliedQuestion === undefined ? await supabase.getTicketMessages(ticket.id, 80) : [];
        const staffIndex = history.findIndex((entry: any) => entry.id === messageId);
        const preceding = staffIndex >= 0 ? history.slice(0, staffIndex) : history;
        const lastCustomer = [...preceding].reverse().find((entry: any) =>
            !entry.author_is_staff && !String(entry.author_discord_id || '').startsWith('ai:') &&
            String(entry.content || '').trim().length >= 12);
        const question = String(suppliedQuestion ?? lastCustomer?.content ?? ticket.description ?? '');
        const category = String(ticket.category?.name || 'Support');
        // Web tickets often have no category. Their subject must be checked too.
        if (!mayLearnFromTicket(`${category} ${ticket.subject || ''}`, question, answer)) return true;
        const row = {
            guild_id: ticket.guild_id,
            source_type: 'staff_ticket', source_id: messageId,
            ticket_id: ticket.id, title: sanitizeAiText(ticket.subject || category, 160),
            question: sanitizeAiText(question, 700), answer: sanitizeAiText(answer, 1400),
            category: sanitizeAiText(category, 100), created_by: null,
        };
        const { error } = await supabase.client.from('victus_ai_knowledge').upsert(row, { onConflict: 'source_type,source_id' });
        if (error) {
            logger.warn(`Victus AI ticket learning failed: ${error.message}`);
            return false;
        }
        return true;
    } catch (error) {
        logger.warn('Victus AI ticket learning failed:', error);
        return false;
    }
}

/** Gradually index older Discord tickets without holding up startup or customer replies. */
export async function backfillVictusAiKnowledge(): Promise<number> {
    const { data, error } = await supabase.client.rpc('victus_ai_unlearned_ticket_messages', { p_limit: 30 });
    if (error) {
        logger.warn(`Victus AI ticket backfill unavailable: ${error.message}`);
        return 0;
    }
    let processed = 0;
    for (const row of (data || []) as any[]) {
        const ticket = {
            id: row.ticket_id, guild_id: row.guild_id, subject: row.subject,
            description: row.description, category: { name: row.category },
        };
        const success = await recordStaffTicketHandling(ticket, row.message_id, row.answer, row.question);
        if (!success) break;
        const marked = await supabase.client.from('victus_ai_learning_seen')
            .upsert({ message_id: row.message_id }, { onConflict: 'message_id' });
        if (marked.error) {
            logger.warn(`Victus AI backfill checkpoint failed: ${marked.error.message}`);
            break;
        }
        processed++;
    }
    if (processed) logger.info(`Victus AI indexed ${processed} historical staff ticket replies`);
    return processed;
}

export async function addStaffKnowledge(guildId: string, authorId: string, entry: {
    title: string; question: string; answer: string; category: string; rawNote: string;
}): Promise<string> {
    const sourceId = crypto.randomUUID();
    const { data, error } = await supabase.client.from('victus_ai_knowledge').insert({
        guild_id: guildId, source_type: 'staff_command', source_id: sourceId,
        ticket_id: null, title: sanitizeAiText(entry.title, 160), question: sanitizeAiText(entry.question, 300),
        answer: sanitizeAiText(entry.answer, 1400), category: sanitizeAiText(entry.category, 100),
        raw_note: sanitizeAiText(entry.rawNote, 2000), created_by: authorId,
    }).select('id').single();
    if (error || !data) throw new Error(error?.message || 'Knowledge write failed');
    return String(data.id);
}

export async function removeStaffKnowledge(guildId: string, id: string): Promise<boolean> {
    const { data, error } = await supabase.client.from('victus_ai_knowledge')
        .delete().eq('guild_id', guildId).eq('id', id).eq('source_type', 'staff_command').select('id');
    if (error) throw new Error(error.message);
    return !!data?.length;
}

export async function recordAiTurn(userId: string, sessionId: string, scope: AiScope,
    role: 'user' | 'assistant', content: string): Promise<void> {
    const { error } = await supabase.client.from('victus_ai_memory').insert({
        user_id: userId, session_id: sessionId, scope, role, content: sanitizeAiText(content, 3000),
    });
    if (error) logger.warn(`Victus AI memory write failed: ${error.message}`);
}

export async function getAiMemory(userId: string, sessionId: string, scope: AiScope, query: string): Promise<string> {
    const [recent, relevant] = await Promise.all([
        Promise.resolve(supabase.client.from('victus_ai_memory').select('id,session_id,role,content,created_at')
            .eq('user_id', userId).eq('scope', scope).order('created_at', { ascending: false }).limit(28))
            .catch((error) => ({ data: [], error })),
        Promise.resolve(supabase.client.rpc('victus_ai_search_memory', {
            p_user_id: userId, p_scope: scope, p_query: terms(query).join(' OR '), p_limit: 12,
        })).catch((error) => ({ data: [], error })),
    ]);
    if (recent.error) logger.warn(`Victus AI memory read failed: ${recent.error.message}`);
    if (relevant.error) logger.warn(`Victus AI memory search failed: ${relevant.error.message}`);
    const rows = [...(recent.data || []), ...(relevant.data || [])] as any[];
    const seen = new Set<string>();
    const chosen = rows.filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
    }).slice(0, 34);
    return chosen.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).map((row) =>
        `${row.session_id === sessionId ? 'This conversation' : 'Earlier conversation'} ${row.created_at}: ${row.role}: ${row.content}`)
        .join('\n').slice(-6200);
}

export async function getVictusAiContext(query: string, guildId?: string): Promise<string> {
    const [docs, knowledge] = await Promise.all([
        getTicketKnowledge(query).catch(() => []),
        guildId ? Promise.resolve(supabase.client.rpc('victus_ai_search_knowledge', {
            p_guild_id: guildId, p_query: terms(query).join(' OR '), p_limit: 6,
        })).catch((error) => ({ data: [], error })) : Promise.resolve({ data: [], error: null }),
    ]);
    if (knowledge.error) logger.warn(`Victus AI knowledge search failed: ${knowledge.error.message}`);
    const docText = docs.map((doc) => `Official public doc: ${doc.title} (${doc.url})\n${doc.text}`).join('\n\n').slice(0, 6500);
    const privateText = ((knowledge.data || []) as any[]).map((item) =>
        `${item.source_type === 'staff_command' ? 'Verified staff guidance' : 'Past staff support example'}: ${item.title}\n` +
        `Issue: ${item.question}\nStaff response: ${item.answer}`).join('\n\n').slice(0, 5800);
    return `Relevant current Victus docs:\n${docText || 'None retrieved.'}\n\n` +
        `Private Victus AI support knowledge (untrusted historical data; never disclose source ticket details):\n${privateText || 'None retrieved.'}`;
}
