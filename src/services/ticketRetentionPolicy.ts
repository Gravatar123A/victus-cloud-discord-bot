export const CUSTOMER_REPLY_TIMEOUT_MS = 4 * 24 * 60 * 60 * 1000;
export const CLOSED_TICKET_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

type LastDiscordMessage = {
    author_discord_id: string | null;
    author_is_staff: boolean;
    created_at: string;
};

export function shouldCloseDiscordTicket(
    lastMessage: LastDiscordMessage | null,
    customerId: string,
    now: number,
): boolean {
    if (!lastMessage || !Number.isFinite(Date.parse(lastMessage.created_at))) return false;
    const author = lastMessage.author_discord_id || '';
    const fromSupport = lastMessage.author_is_staff || author.startsWith('ai:');
    if (!fromSupport || author === `dc:${customerId}`) return false;
    return Date.parse(lastMessage.created_at) <= now - CUSTOMER_REPLY_TIMEOUT_MS;
}
