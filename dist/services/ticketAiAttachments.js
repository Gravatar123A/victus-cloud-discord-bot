import { redactTicketText } from './discordTicketAi.js';
import { logger } from '../utils/logger.js';
const MAX_ATTACHMENT_BYTES = 64_000;
const MAX_ATTACHMENTS = 2;
export function summarizeTicketLog(raw) {
    const lines = raw.replace(/\r/g, '').split('\n').map((line) => line.trimEnd()).filter(Boolean);
    const selected = new Set();
    for (let index = 0; index < Math.min(5, lines.length); index++)
        selected.add(index);
    for (let index = Math.max(0, lines.length - 12); index < lines.length; index++)
        selected.add(index);
    const causes = lines.map((line, index) => /caused by:|exception|fatal/i.test(line) ? index : -1)
        .filter((index) => index >= 0).slice(-12);
    const otherErrors = lines.map((line, index) => /error|failed|crash|unable to|could not/i.test(line) ? index : -1)
        .filter((index) => index >= 0);
    for (const index of [...causes, ...otherErrors.slice(0, 8), ...otherErrors.slice(-8)]) {
        selected.add(index);
        if (index > 0)
            selected.add(index - 1);
    }
    // Put exception headers first so a long stack trace cannot truncate them.
    const excerpt = [...new Set([...causes, ...[...selected].sort((a, b) => a - b)])]
        .map((index) => `${index + 1}: ${redactTicketText(lines[index], 450)}`).join('\n');
    return excerpt.slice(0, 5_000);
}
function isReadableText(attachment) {
    const url = new URL(attachment.url);
    return url.protocol === 'https:' &&
        ['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) &&
        attachment.size > 0 && attachment.size <= MAX_ATTACHMENT_BYTES &&
        (/\.(txt|log)$/i.test(attachment.name || '') || attachment.contentType?.startsWith('text/plain') === true);
}
export function hasReadableTicketAttachment(message) {
    return [...message.attachments.values()].some((item) => {
        try {
            return isReadableText(item);
        }
        catch {
            return false;
        }
    });
}
async function readAttachment(attachment) {
    if (!isReadableText(attachment))
        return null;
    const response = await fetch(attachment.url, { redirect: 'error', signal: AbortSignal.timeout(6_000) });
    if (!response.ok)
        return null;
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_ATTACHMENT_BYTES)
        return null;
    const reader = response.body?.getReader();
    if (!reader)
        return null;
    const chunks = [];
    let bytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            bytes += value.byteLength;
            if (bytes > MAX_ATTACHMENT_BYTES)
                return null;
            chunks.push(value);
        }
    }
    finally {
        await reader.cancel().catch(() => undefined);
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
    }
    if (data.includes(0))
        return null;
    return summarizeTicketLog(new TextDecoder().decode(data));
}
/** Read small Discord text logs locally, then include only redacted excerpts in the AI prompt. */
export async function ticketAiQueryWithAttachments(message) {
    const attachments = [...message.attachments.values()].filter((item) => {
        try {
            return isReadableText(item);
        }
        catch {
            return false;
        }
    }).slice(0, MAX_ATTACHMENTS);
    if (!attachments.length)
        return message.content;
    const excerpts = await Promise.all(attachments.map(async (item) => {
        try {
            const text = await readAttachment(item);
            return text ? `Attachment ${item.name} (selected log lines):\n${text}` : null;
        }
        catch (error) {
            logger.warn(`Could not read ticket AI text attachment: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }));
    const readable = excerpts.filter((item) => Boolean(item));
    return readable.length
        ? `${message.content}\n\n${readable.join('\n\n')}`.slice(0, 11_000)
        : `${message.content}\n\nA text attachment was provided but could not be read. Staff can inspect it in Discord.`;
}
