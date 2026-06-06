import { supabase } from './supabase.js';
import { pterodactyl, type PowerSignal } from './pterodactyl.js';
import { compactId, decodeDisplayText, formatCredits, statusLabel } from '../utils/premium.js';
import type { UserProfile } from '../types/index.js';

export type VictusAiActionResult = {
    handled: true;
    content: string;
    dmContent?: string;
} | {
    handled: false;
};

type ActionContext = {
    discordId: string;
    publicReply: boolean;
};

type LinkedContext = {
    userId: string;
    profile: UserProfile | null;
};

type ServerRecord = {
    id?: string | number;
    identifier?: string;
    uuid?: string;
    name?: string;
    status?: string | null;
    is_suspended?: boolean;
    suspended?: boolean;
    attributes?: Record<string, unknown>;
};

const POWER_ACTIONS: Record<string, PowerSignal> = {
    start: 'start',
    boot: 'start',
    run: 'start',
    stop: 'stop',
    shutdown: 'stop',
    restart: 'restart',
    reboot: 'restart',
    kill: 'kill',
};

function normalizedPrompt(prompt: string): string {
    return prompt.toLowerCase().replace(/\s+/g, ' ').trim();
}

function record(server: ServerRecord): Record<string, any> {
    return {
        ...server,
        ...(server.attributes || {}),
    };
}

function serverIdentifier(server: ServerRecord): string {
    const data = record(server);
    return String(data.identifier || data.uuid || data.id || '');
}

function serverName(server: ServerRecord): string {
    return decodeDisplayText(record(server).name, 'Unknown server');
}

function serverStatus(server: ServerRecord): string {
    const data = record(server);
    return data.is_suspended || data.suspended ? 'suspended' : String(data.status || 'offline');
}

function hasSensitiveAccountIntent(text: string): boolean {
    return [
        /\b(my|linked|victus|account|billing)\b.{0,40}\b(e-?mail|mail address|address|phone|invoice|invoices|coins?|credits?|balance)\b/,
        /\b(e-?mail|mail address|address|phone|invoice|invoices|coins?|credits?|balance)\b.{0,40}\b(my|linked|victus|account|billing)\b/,
        /\bwhat('?s| is) my\b.{0,50}\b(e-?mail|address|phone|balance|coins?|credits?)\b/,
    ].some((pattern) => pattern.test(text));
}

function hasServerListIntent(text: string): boolean {
    if (!/\bservers?\b/.test(text)) return false;

    const asksForServers = /\b(how many|list|show|what|which|status|statuses|have|own|got|attached|connected)\b/.test(text);
    const belongsToUser =
        /\b(my|mine|i|me)\b/.test(text) ||
        /\b(do i have|i have|i got|have i got|servers? i got|servers? do i have)\b/.test(text);

    return asksForServers && belongsToUser;
}

function hasServiceIntent(text: string): boolean {
    return /\b(my|mine|i|me)\b/.test(text) &&
        /\b(services?|orders?|subscriptions?|hosting plans?|active hosting)\b/.test(text) &&
        /\b(list|show|what|which|how many|have|own|got|active)\b/.test(text);
}

function parsePowerIntent(text: string): { signal: PowerSignal; serverSearch: string } | null {
    if (/^\s*(how|what|where|when|why)\b/.test(text) && !/\b(can you|please|for me)\b/.test(text)) {
        return null;
    }

    const phraseAction = text.match(/\b(?:turn|power)\s+(on|off)\b/);
    const actionMatch = text.match(/\b(start|boot|run|stop|shutdown|restart|reboot|kill)\b/);
    const action = phraseAction?.[1] === 'on' ? 'start' : phraseAction?.[1] === 'off' ? 'stop' : actionMatch?.[1];
    if (!action) return null;

    const signal = POWER_ACTIONS[action];
    if (!signal) return null;

    const commandLike =
        text.startsWith(action) ||
        (phraseAction && text.includes(phraseAction[0])) ||
        /\b(can you|please|pls|could you|would you|i need you to|turn)\b/.test(text) ||
        /\b(my|the)\b.{0,30}\bserver\b/.test(text);

    if (!commandLike) return null;

    let serverSearch = '';
    const quoted = text.match(/["'`](.+?)["'`]/);
    if (quoted?.[1]) {
        serverSearch = quoted[1];
    } else {
        const afterServer = text.match(/\bserver\s+(?:named|called)?\s*([a-z0-9_.\- ]{2,64})/);
        const actionPhrase = phraseAction?.[0] || action;
        const afterAction = text.match(new RegExp(`\\b${actionPhrase}\\b\\s+(?:my\\s+|the\\s+)?([a-z0-9_.\\- ]{2,64}?)(?:\\s+server)?$`));
        serverSearch = (afterServer?.[1] || afterAction?.[1] || '')
            .replace(/\b(server|please|pls|for me|now|thanks|thank you)\b/g, '')
            .trim();
    }

    return { signal, serverSearch };
}

async function getLinkedContext(discordId: string): Promise<LinkedContext | null> {
    const linked = await supabase.getLinkedAccount(discordId).catch(() => null);
    if (!linked) return null;

    const profile = await supabase.getUserProfile(linked.user_id).catch(() => null);
    return { userId: linked.user_id, profile };
}

async function getServers(profile: UserProfile | null): Promise<ServerRecord[]> {
    if (!profile?.email) return [];
    return await supabase.getUserServers(profile.email) as ServerRecord[];
}

async function getBillingUserId(email: string): Promise<string> {
    const billingUser = await supabase.getBillingUserByEmail(email).catch(() => null);
    return String(billingUser?.id || billingUser?.attributes?.id || '');
}

async function getUserInvoices(profile: UserProfile | null): Promise<any[]> {
    const email = profile?.email?.toLowerCase();
    if (!email) return [];

    const [invoices, billingUserId] = await Promise.all([
        supabase.getInvoices().catch(() => []),
        getBillingUserId(email),
    ]);

    return invoices.filter((invoice: any) => {
        const invoiceEmail = String(invoice.user?.email || invoice.email || invoice.customer_email || '').toLowerCase();
        const userId = String(invoice.user_id || invoice.customer_id || invoice.user?.id || '');
        return invoiceEmail === email || (billingUserId && userId === billingUserId);
    });
}

async function getUserServices(profile: UserProfile | null): Promise<any[]> {
    const email = profile?.email?.toLowerCase();
    if (!email) return [];

    const [orders, billingUserId] = await Promise.all([
        supabase.getOrders().catch(() => []),
        getBillingUserId(email),
    ]);

    return orders.filter((order: any) => {
        const orderEmail = String(order.user?.email || order.email || order.customer_email || '').toLowerCase();
        const userId = String(order.user_id || order.customer_id || order.user?.id || '');
        return orderEmail === email || (billingUserId && userId === billingUserId);
    });
}

function findServer(servers: ServerRecord[], search: string): { server?: ServerRecord; ambiguous?: ServerRecord[] } {
    if (servers.length === 1 && !search) return { server: servers[0] };
    if (!search) return {};

    const term = search.toLowerCase();
    const matches = servers.filter((server) => {
        const name = serverName(server).toLowerCase();
        const identifier = serverIdentifier(server).toLowerCase();
        return identifier === term || identifier.includes(term) || name === term || name.includes(term);
    });

    if (matches.length === 1) return { server: matches[0] };
    if (matches.length > 1) return { ambiguous: matches };
    return {};
}

function serverListSummary(servers: ServerRecord[]): string {
    if (servers.length === 0) {
        return 'I do not see any servers attached to your linked Victus account yet.';
    }

    const lines = servers.slice(0, 8).map((server, index) => {
        const identifier = serverIdentifier(server);
        return `${index + 1}. **${serverName(server)}** \`${compactId(identifier)}\` - ${statusLabel(serverStatus(server))}`;
    });

    const extra = servers.length > lines.length ? `\nand ${servers.length - lines.length} more.` : '';
    return `You have **${servers.length}** server${servers.length === 1 ? '' : 's'} on your linked Victus account:\n${lines.join('\n')}${extra}`;
}

function invoiceListSummary(invoices: any[]): string {
    if (invoices.length === 0) {
        return 'I do not see any invoices attached to your linked Victus account yet.';
    }

    const lines = invoices.slice(0, 8).map((invoice, index) => {
        const amount = invoice.total || invoice.amount || '0.00';
        const status = invoice.status || 'pending';
        const date = invoice.created_at ? new Date(invoice.created_at).toLocaleDateString() : 'unknown date';
        return `${index + 1}. Invoice **#${invoice.id || '-'}** - **$${amount}** - ${status} - ${date}`;
    });

    const extra = invoices.length > lines.length ? `\nand ${invoices.length - lines.length} more.` : '';
    return `You have **${invoices.length}** invoice${invoices.length === 1 ? '' : 's'}:\n${lines.join('\n')}${extra}`;
}

function serviceListSummary(services: any[]): string {
    if (services.length === 0) {
        return 'I do not see any active services attached to your linked Victus account yet.';
    }

    const lines = services.slice(0, 8).map((service, index) => {
        const name = service.product?.name || service.product_name || `Service #${service.id || '-'}`;
        const status = service.status || 'active';
        const price = service.price || service.total || '0.00';
        const renewsAt = service.renewal_date || service.due_date
            ? new Date(service.renewal_date || service.due_date).toLocaleDateString()
            : 'no renewal date';

        return `${index + 1}. **${decodeDisplayText(name)}** - **${status}** - $${price}/mo - ${renewsAt}`;
    });

    const extra = services.length > lines.length ? `\nand ${services.length - lines.length} more.` : '';
    return `You have **${services.length}** service${services.length === 1 ? '' : 's'}:\n${lines.join('\n')}${extra}`;
}

async function handleSensitiveAccountQuestion(text: string, context: ActionContext): Promise<VictusAiActionResult> {
    if (!hasSensitiveAccountIntent(text)) return { handled: false };

    const linked = await getLinkedContext(context.discordId);
    if (!linked) {
        return {
            handled: true,
            content: 'That is private account info. Connect your Victus account to Discord first, then ask me in DMs.',
        };
    }

    const privateLines: string[] = [];
    if (/\b(e-?mail|mail address)\b/.test(text)) {
        privateLines.push(`Your linked Victus account email is \`${linked.profile?.email || 'not available'}\`.`);
    }

    if (/\b(balance|coins?|credits?)\b/.test(text)) {
        const balance = await supabase.getCreditBalance(linked.profile);
        privateLines.push(`Your current wallet balance is **${formatCredits(balance.amount, balance.currency)}**.`);
    }

    if (/\b(invoice|invoices)\b/.test(text)) {
        privateLines.push(invoiceListSummary(await getUserInvoices(linked.profile)));
    }

    if (privateLines.length === 0) {
        privateLines.push('That is private account info. Ask me in DMs and I can help with linked account details.');
    }

    const dmContent = privateLines.join('\n');
    if (context.publicReply) {
        return {
            handled: true,
            content: 'That is private account info, so come to DMs for the answer. I sent what I can there.',
            dmContent,
        };
    }

    return { handled: true, content: dmContent };
}

async function handleServerQuestion(text: string, context: ActionContext): Promise<VictusAiActionResult> {
    const powerIntent = parsePowerIntent(text);
    if (!powerIntent && !hasServerListIntent(text)) return { handled: false };

    const linked = await getLinkedContext(context.discordId);
    if (!linked) {
        return {
            handled: true,
            content: 'I can show your Victus servers after your Discord account is connected to your Victus account.',
        };
    }

    const servers = await getServers(linked.profile);
    if (!powerIntent) {
        return { handled: true, content: serverListSummary(servers) };
    }

    if (servers.length === 0) {
        return { handled: true, content: 'I could not find any servers attached to your linked Victus account.' };
    }

    const match = findServer(servers, powerIntent.serverSearch);
    if (match.ambiguous?.length) {
        const options = match.ambiguous.slice(0, 6).map((server) => `- **${serverName(server)}** \`${serverIdentifier(server)}\``);
        return {
            handled: true,
            content: `I found multiple matching servers. Tell me the exact server ID or name:\n${options.join('\n')}`,
        };
    }

    if (!match.server) {
        const hint = servers.slice(0, 6).map((server) => `- **${serverName(server)}** \`${serverIdentifier(server)}\``);
        return {
            handled: true,
            content: `Which server should I ${powerIntent.signal}? Your linked servers are:\n${hint.join('\n')}`,
        };
    }

    const identifier = serverIdentifier(match.server);
    try {
        await pterodactyl.sendPowerSignal(identifier, powerIntent.signal);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Panel power API failed.';
        return {
            handled: true,
            content: `I found **${serverName(match.server)}**, but I could not send the power action: ${message}`,
        };
    }

    return {
        handled: true,
        content: `Sent **${powerIntent.signal}** to **${serverName(match.server)}** \`${compactId(identifier)}\`.`,
    };
}

async function handleServiceQuestion(text: string, context: ActionContext): Promise<VictusAiActionResult> {
    if (!hasServiceIntent(text)) return { handled: false };

    const linked = await getLinkedContext(context.discordId);
    if (!linked) {
        return {
            handled: true,
            content: 'I can show your Victus services after your Discord account is connected to your Victus account.',
        };
    }

    const content = serviceListSummary(await getUserServices(linked.profile));
    if (context.publicReply) {
        return {
            handled: true,
            content: 'That is account-specific, so come to DMs for the service list. I sent what I can there.',
            dmContent: content,
        };
    }

    return { handled: true, content };
}

class VictusAiActionsService {
    async tryHandle(prompt: string, context: ActionContext): Promise<VictusAiActionResult> {
        const text = normalizedPrompt(prompt);
        if (!text) return { handled: false };

        const sensitive = await handleSensitiveAccountQuestion(text, context);
        if (sensitive.handled) return sensitive;

        const servers = await handleServerQuestion(text, context);
        if (servers.handled) return servers;

        return handleServiceQuestion(text, context);
    }
}

export const victusAiActions = new VictusAiActionsService();
