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
    return /\b(my|mine|i)\b.{0,50}\bservers?\b/.test(text) &&
        /\b(how many|list|show|what|which|status|statuses|have|own)\b/.test(text);
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

    const extra = servers.length > lines.length ? `\n…and ${servers.length - lines.length} more.` : '';
    return `You have **${servers.length}** server${servers.length === 1 ? '' : 's'} on your linked Victus account:\n${lines.join('\n')}${extra}`;
}

async function handleSensitiveAccountQuestion(text: string, context: ActionContext): Promise<VictusAiActionResult> {
    if (!hasSensitiveAccountIntent(text)) return { handled: false };

    const linked = await getLinkedContext(context.discordId);
    if (!linked) {
        return {
            handled: true,
            content: 'That is private account info. Link your Victus account with `/link`, then ask me in DMs.',
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
        privateLines.push('For invoice details, use `/invoices` in Discord or open the billing panel. I keep invoice details out of public chat.');
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
            content: 'I can access your Victus servers after you link your account with `/link`.',
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

class VictusAiActionsService {
    async tryHandle(prompt: string, context: ActionContext): Promise<VictusAiActionResult> {
        const text = normalizedPrompt(prompt);
        if (!text) return { handled: false };

        const sensitive = await handleSensitiveAccountQuestion(text, context);
        if (sensitive.handled) return sensitive;

        return handleServerQuestion(text, context);
    }
}

export const victusAiActions = new VictusAiActionsService();
