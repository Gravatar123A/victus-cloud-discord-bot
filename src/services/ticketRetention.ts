import type { Client } from 'discord.js';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';
import {
    CLOSED_TICKET_RETENTION_MS,
    CUSTOMER_REPLY_TIMEOUT_MS,
    shouldCloseDiscordTicket,
} from './ticketRetentionPolicy.js';

const BATCH_SIZE = 100;
const MAX_SCAN = 1000;
let running = false;

type DiscordTicket = {
    id: string;
    guild_id: string;
    channel_id: string | null;
    discord_id: string;
    ticket_number: number;
};

async function discordChannel(client: Client<true>, id: string | null): Promise<any | null> {
    if (!id) return null;
    try {
        return await client.channels.fetch(id);
    } catch (error) {
        if ((error as { code?: number }).code === 10003) return null;
        throw error;
    }
}

async function closePortalTickets(now: number): Promise<number> {
    const cutoff = new Date(now - CUSTOMER_REPLY_TIMEOUT_MS).toISOString();
    const { data: candidates, error } = await supabase.client
        .from('support_portal_tickets')
        .select('id,updated_at')
        .eq('status', 'open')
        .eq('support_status', 'awaiting_customer')
        .lte('updated_at', cutoff)
        .order('updated_at')
        .limit(BATCH_SIZE);
    if (error) throw error;
    let closed = 0;
    for (const ticket of candidates || []) {
        const closedAt = new Date().toISOString();
        const { data, error: closeError } = await supabase.client
            .from('support_portal_tickets')
            .update({ status: 'closed', support_status: 'closed', closed_at: closedAt, updated_at: closedAt })
            .eq('id', ticket.id)
            .eq('status', 'open')
            .eq('support_status', 'awaiting_customer')
            .eq('updated_at', ticket.updated_at)
            .select('id')
            .maybeSingle();
        if (closeError) {
            logger.error(`Portal ticket auto-close failed for ${ticket.id}:`, closeError);
            continue;
        }
        if (!data) continue;
        closed++;
        const { error: eventError } = await supabase.client.from('support_portal_ticket_events').insert({
            ticket_id: ticket.id,
            event_type: 'auto_closed_inactive',
            old_value: 'awaiting_customer',
            new_value: 'closed',
        });
        if (eventError) logger.warn(`Portal auto-close event failed for ${ticket.id}: ${eventError.message}`);
    }
    return closed;
}

async function deletePortalTickets(now: number): Promise<number> {
    const cutoff = new Date(now - CLOSED_TICKET_RETENTION_MS).toISOString();
    const { data: candidates, error } = await supabase.client
        .from('support_portal_tickets')
        .select('id,closed_at')
        .eq('status', 'closed')
        .lte('closed_at', cutoff)
        .order('closed_at')
        .limit(BATCH_SIZE);
    if (error) throw error;
    let deleted = 0;
    for (const ticket of candidates || []) {
        const { data: attachments, error: attachmentError } = await supabase.client
            .from('support_portal_ticket_attachments')
            .select('storage_path')
            .eq('ticket_id', ticket.id);
        if (attachmentError) {
            logger.error(`Portal attachment lookup failed for ${ticket.id}:`, attachmentError);
            continue;
        }
        const paths = (attachments || []).map((attachment) => attachment.storage_path);
        let removalFailed = false;
        for (let i = 0; i < paths.length; i += BATCH_SIZE) {
            const { error: storageError } = await supabase.client.storage
                .from('support-attachments')
                .remove(paths.slice(i, i + BATCH_SIZE));
            if (storageError) {
                logger.error(`Portal attachment removal failed for ${ticket.id}:`, storageError);
                removalFailed = true;
                break;
            }
        }
        if (removalFailed) continue;
        const { data, error: deleteError } = await supabase.client
            .from('support_portal_tickets')
            .delete()
            .eq('id', ticket.id)
            .eq('status', 'closed')
            .eq('closed_at', ticket.closed_at)
            .select('id')
            .maybeSingle();
        if (deleteError) logger.error(`Portal ticket deletion failed for ${ticket.id}:`, deleteError);
        else if (data) deleted++;
    }
    return deleted;
}

async function closeDiscordTickets(client: Client<true>, now: number): Promise<number> {
    const guildIds = [...client.guilds.cache.keys()];
    if (!guildIds.length) return 0;
    const cutoff = new Date(now - CUSTOMER_REPLY_TIMEOUT_MS).toISOString();
    const candidates: DiscordTicket[] = [];
    for (let start = 0; start < MAX_SCAN; start += BATCH_SIZE) {
        const { data, error } = await supabase.client
            .from('tickets')
            .select('id,guild_id,channel_id,discord_id,ticket_number')
            .in('guild_id', guildIds)
            .neq('status', 'closed')
            .lte('created_at', cutoff)
            .order('created_at')
            .range(start, start + BATCH_SIZE - 1);
        if (error) throw error;
        candidates.push(...((data || []) as DiscordTicket[]));
        if (!data || data.length < BATCH_SIZE) break;
    }
    if (candidates.length === MAX_SCAN) logger.warn('Discord ticket retention scan reached its 1000-ticket cap');
    let closed = 0;
    for (const ticket of candidates) {
        const { data: lastMessage, error } = await supabase.client
            .from('ticket_messages')
            .select('author_discord_id,author_is_staff,created_at')
            .eq('ticket_id', ticket.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) {
            logger.error(`Discord ticket activity lookup failed for ${ticket.id}:`, error);
            continue;
        }
        if (!shouldCloseDiscordTicket(lastMessage, ticket.discord_id, now)) continue;
        let channel: any;
        try {
            channel = await discordChannel(client, ticket.channel_id);
            const recent = await channel?.messages?.fetch?.({ limit: 20 });
            if (recent?.some((message: any) => message.createdTimestamp > now - CUSTOMER_REPLY_TIMEOUT_MS)) continue;
        } catch (channelError) {
            logger.warn(`Could not verify recent channel activity for ${ticket.id}: ${String(channelError)}`);
            continue;
        }
        const closedAt = new Date().toISOString();
        const { data, error: closeError } = await supabase.client
            .from('tickets')
            .update({ status: 'closed', closed_at: closedAt, updated_at: closedAt })
            .eq('id', ticket.id)
            .neq('status', 'closed')
            .select('id')
            .maybeSingle();
        if (closeError) {
            logger.error(`Discord ticket auto-close failed for ${ticket.id}:`, closeError);
            continue;
        }
        if (!data) continue;
        closed++;
        try {
            if (channel?.send) {
                await channel.send({
                    content: '🔒 This ticket was closed after 4 days without a customer reply. The channel will be deleted in 2 days.',
                    allowedMentions: { parse: [] },
                });
                await channel.permissionOverwrites?.edit(ticket.discord_id, { SendMessages: false });
            }
        } catch (channelError) {
            logger.warn(`Could not lock Discord ticket channel ${ticket.channel_id}: ${String(channelError)}`);
        }
    }
    return closed;
}

async function deleteDiscordTickets(client: Client<true>, now: number): Promise<number> {
    const guildIds = [...client.guilds.cache.keys()];
    if (!guildIds.length) return 0;
    const cutoff = new Date(now - CLOSED_TICKET_RETENTION_MS).toISOString();
    const { data: candidates, error } = await supabase.client
        .from('tickets')
        .select('id,channel_id,closed_at')
        .in('guild_id', guildIds)
        .eq('status', 'closed')
        .lte('closed_at', cutoff)
        .order('closed_at')
        .limit(BATCH_SIZE);
    if (error) throw error;
    let deleted = 0;
    for (const ticket of candidates || []) {
        try {
            const channel = await discordChannel(client, ticket.channel_id);
            if (channel?.delete) await channel.delete('Closed ticket retention period ended');
        } catch (channelError) {
            logger.error(`Discord ticket channel deletion failed for ${ticket.id}:`, channelError);
            continue;
        }
        const { data, error: deleteError } = await supabase.client
            .from('tickets')
            .delete()
            .eq('id', ticket.id)
            .eq('status', 'closed')
            .eq('closed_at', ticket.closed_at)
            .select('id')
            .maybeSingle();
        if (deleteError) logger.error(`Discord ticket deletion failed for ${ticket.id}:`, deleteError);
        else if (data) deleted++;
    }
    return deleted;
}

export async function runTicketRetention(client: Client<true>): Promise<void> {
    if (running || !supabase.isAvailable()) return;
    running = true;
    try {
        const now = Date.now();
        const results = await Promise.allSettled([
            closePortalTickets(now),
            deletePortalTickets(now),
            closeDiscordTickets(client, now),
            deleteDiscordTickets(client, now),
        ]);
        const names = ['portal closed', 'portal deleted', 'Discord closed', 'Discord deleted'];
        results.forEach((result, index) => {
            if (result.status === 'rejected') logger.error(`Ticket retention ${names[index]} failed:`, result.reason);
            else if (result.value) logger.info(`Ticket retention ${names[index]}: ${result.value}`);
        });
    } finally {
        running = false;
    }
}

export function startTicketRetention(client: Client<true>): void {
    setTimeout(() => void runTicketRetention(client), 60_000).unref?.();
    setInterval(() => void runTicketRetention(client), 60 * 60_000).unref?.();
    logger.info('Ticket retention worker started (hourly)');
}
