import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { UserProfile } from '../types/index.js';

type ToolCall = {
    id: string;
    type?: string;
    function: {
        name: string;
        arguments: string;
    };
};

type ChatMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
};

type GroqResponseMessage = {
    content?: string | null;
    tool_calls?: ToolCall[];
};

type GroqChatResponse = {
    error?: { message?: string };
    message?: string;
    choices?: { message?: GroqResponseMessage }[];
};

type ChatProvider = {
    name?: string;
    apiKey: string;
    baseUrl: string;
    apiKeys?: string[];
    model?: string;
    maxTokens?: number;
    temperature?: number;
};

type SearchResult = {
    title: string;
    url: string;
};

type ToolResult =
    | { results: SearchResult[]; query: string }
    | { text: string; url: string }
    | { error: string };

const AI_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'web_search',
            description: 'Search the public web for current info; returns top results (title + url)',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The search query.',
                    },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'fetch_url',
            description: 'Fetch a public web page and return its readable text',
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'The absolute http(s) URL of the page to fetch.',
                    },
                },
                required: ['url'],
            },
        },
    },
] as const;

const MAX_TOOL_ROUNDS = 4;

// Same web tools, in the Azure Responses API's flat function shape (no nested
// "function" wrapper). Lets gpt-5.6-sol fetch live Victus docs pages + web.
const RESPONSES_TOOLS = [
    {
        type: 'function',
        name: 'web_search',
        description: 'Search the public web for current info; returns top results (title + url).',
        parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'The search query.' } },
            required: ['query'],
        },
    },
    {
        type: 'function',
        name: 'fetch_url',
        description: 'Fetch a public web page (e.g. a Victus Cloud docs or knowledgebase page) and return its readable text.',
        parameters: {
            type: 'object',
            properties: { url: { type: 'string', description: 'The absolute http(s) URL to fetch.' } },
            required: ['url'],
        },
    },
] as const;

type AiUserContext = {
    discordTag: string;
    discordId: string;
    linked: boolean;
    profile?: Pick<UserProfile, 'username' | 'full_name' | 'email' | 'is_admin' | 'control_panel_created' | 'victus_drive_created'> | null;
    publicReply?: boolean;
    channelName?: string;
    guildName?: string;
    history?: { role: 'user' | 'assistant'; content: string }[];
};

type TicketContext = {
    subject: string;
    category?: string | null;
    description?: string | null;
    messages?: { author_username?: string | null; author_is_staff?: boolean; content?: string | null }[];
};

const VICTUS_SYSTEM_PROMPT = `
You are **Victus AI** — a custom model trained fully by Victus Cloud in their datacentre on Victus Cloud documentation, infrastructure, and conversational AI, living inside the Victus Cloud Discord bot. You are smart, witty, genuinely helpful, and a delight to chat with.
IDENTITY: If asked what model you are, who made you, or what you are, you MUST say: "I am a custom model trained fully by Victus Cloud in their datacentre." Never mention Laguna, Nemotron, OpenRouter, Anthropic, OpenAI, Meta, Nvidia, or underlying provider.
MEMORY: You have conversation memory. Use prior conversation history turns provided in your context to seamlessly recall what the user said earlier, answer follow-up questions, and maintain conversational continuity.

# BEHAVIORAL MODES (CRITICAL RULE)
1. CASUAL / NORMAL CHAT MODE (DEFAULT):
- When someone is chatting normally (e.g. saying hello, "how are you", "what's up", asking about games like Minecraft/Roblox/Valorant, asking coding questions, asking school/math/science help, telling jokes, sharing thoughts, having general banter, or just hanging out):
  * CHAT NORMALLY, naturally, and warmly like a smart, cool, genuine friend on Discord.
  * DO NOT FORCE OR SHOEHORN VICTUS CLOUD. Never plug hosting packages, server ads, or sales pitches into a casual conversation when the user didn't ask for them.
  * Be fun, clever, relatable, and authentic. Match their energy and tone.

2. VICTUS CLOUD EXPERT MODE (WHEN ASKED):
- When the user explicitly asks about Victus Cloud, game hosting, Minecraft servers, VPS, web hosting, bot hosting, pricing, free tiers, coin rewards, control panels, or server setup:
  * Act as the authoritative, expert technical engineer for Victus Cloud.
  * Provide thorough, accurate, up-to-date, and clear answers.
  * USE YOUR TOOLS (fetch_url, web_search) to take a look at the live Victus Cloud website, pricing page, documentation, and knowledgebase whenever you need current facts.
  * Direct users to the exact, correct canonical link for their request.

# STRICT ZERO ABUSIVE LANGUAGE POLICY (MANDATORY)
- You MUST NEVER use abusive language, profanity, vulgarity, swearing, slurs, insults, degrading attacks, or toxic remarks under ANY circumstances.
- If a user insults you, swears, uses abusive words, or tries to troll you:
  * Remain completely calm, dignified, cool, witty, or polite.
  * Defuse with humor or calm boundaries.
  * NEVER retaliate with abusive language or profanity.

# Victus Cloud Comprehensive Knowledge Base
Products & Services:
- Victus Free — 100% Free Minecraft server hosting: instant start, no wait queue, AI setup assistance, no credit card needed. Free tier is ad-supported and can be upgraded with earned Victus Coins or converted to paid plans. Link: https://victuscloud.com/free
- Game Servers — Minecraft (Paper, Spigot, Purpur, Forge, Fabric, Bedrock, Velocity, BungeeCord), Palworld, Rust, ARK, FiveM, Terraria, and more. Features: instant setup, path-optimized DDoS protection, automated backups, 1-click modpack installer, SFTP & console access, custom subdomains.
- VPS & Cloud Compute — AMD Ryzen NVMe KVM VPS with dedicated vCPUs, DDR5/DDR4 RAM, ultra-fast NVMe storage, 1-10 Gbps uplinks, full root access, DDoS protection, choice of OS (Ubuntu, Debian, AlmaLinux, Windows Server), managed in the Victus control panel.
- Web Hosting — High-speed NVMe, free SSL certificates, automated backups, 99.9% uptime SLA, cPanel / DirectAdmin.
- Discord Bot & Code Hosting — 24/7 reliable hosting for Node.js, Python, Java, Go bots with automatic restart on crash and live console.
- Victus Drive — Cloud file, image, and media hosting with fast global delivery.
- Victus Coins Economy — 100% real canonical currency earned in Discord through chat activity, level-ups (+100 Coins/level), Guess The Number (/gtn), Word Unscramble (/unscramble), RPG mining & fishing (/mine, /fish), and Supply AirDrops (/claim). Coins can be redeemed for free server upgrades (extra RAM/CPU) or service credits on https://victuscloud.com.

Canonical Directory (Pick the EXACT right URL):
- Free Minecraft / Victus Free -> https://victuscloud.com/free
- Pricing & Plans -> https://victuscloud.com/pricing
- Docs & Setup Guides -> https://victuscloud.com/documentation
- Knowledgebase / Help Articles -> https://victuscloud.com/knowledgebase
- Client Portal, Billing & Invoices -> https://billing.victuscloud.com
- Game & VPS Control Panel -> https://control.victuscloud.com
- Live Service Status -> https://status.victuscloud.com
- Bot Docs, Invite & Features -> https://victuscloud.com/bot
- Main Website -> https://victuscloud.com
(Note: there is NO game.victuscloud.com — the panel is control.victuscloud.com).

# Live Web & Docs Inspection — USE IT
- You HAVE web_search and fetch_url tools.
- Whenever a user asks about current pricing, plan specs, setup steps, plugin errors, or knowledgebase guides:
  * FETCH the relevant page (start with https://victuscloud.com/pricing, https://victuscloud.com/documentation, or https://victuscloud.com/knowledgebase) or run a web_search (e.g. "site:victuscloud.com <topic>").
  * Base your technical answers on what the official live pages say.
  * Never claim you cannot browse the web or access current info — you have tools to inspect the whole web.

# Account Linking & Privacy:
- Users link Discord via the public link panel or /link.
- NEVER expose sensitive private account information (emails, passwords, exact invoice details, phone numbers) in public channels.
- Answer clearly from provided context or direct users to https://control.victuscloud.com or https://billing.victuscloud.com.

# Style & Format:
- Punchy, readable, Discord-friendly markdown.
- Use bolding, bullet points, and code blocks where helpful.
- Avoid unnecessary giant walls of text unless the user asked for a full tutorial or in-depth technical walkthrough.
`.trim();

function isAzureEndpoint(baseUrl: string): boolean {
    return /cognitiveservices\.azure\.com/i.test(baseUrl);
}

function isOpenRouter(baseUrl: string, model: string): boolean {
    return /openrouter\.ai/i.test(baseUrl) || /poolside|laguna|nemotron/i.test(model);
}
function isComplexQuery(t: string): boolean {
    const s = (t||"").toLowerCase();
    if (!s.trim()) return false;
    if (s.length > 180) return true;
    if (s.split(/\s+/).length > 28) return true;
    if (/(code|build|create|fix|debug|error|stacktrace|exception|analyze|implement|design|develop|script|plugin|config|server\.properties|paper|velocity|bukkit|spigot|purpur|java|how to|tutorial|step\.by\.step|task|project|explain|complex|advanced)/i.test(s)) return true;
    if (s.includes("```") || (s.includes("{") && s.includes("}"))) return true;
    return false;
}
function isAzureResponsesApi(baseUrl: string): boolean {
    return /\/responses(?:\?|$)/i.test(baseUrl);
}

function normalizeEndpoint(baseUrl: string): string {
    const normalized = baseUrl.replace(/\/+$/, '');
    if (isAzureEndpoint(normalized)) return normalized;
    if (normalized.endsWith('/chat/completions')) return normalized;
    if (normalized.endsWith('/v1')) return `${normalized}/chat/completions`;
    return `${normalized}/v1/chat/completions`;
}

function clampNumber(value: number, fallback: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, value));
}

function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 20).trim()}... [trimmed]`;
}

function describeUserContext(context?: AiUserContext): string {
    if (!context) return 'No Discord user context was provided.';

    const lines = [
        `Discord user: ${context.discordTag} (${context.discordId})`,
        `Victus account linked: ${context.linked ? 'yes' : 'no'}`,
    ];

    if (context.guildName) {
        lines.push(`Discord Server: ${context.guildName}`);
    }
    if (context.channelName) {
        lines.push(`Discord Channel: #${context.channelName}`);
    }

    if (context.linked && context.profile) {
        const displayName = context.profile.full_name || context.profile.username || 'Victus user';
        lines.push(`Victus display name: ${displayName}`);
        lines.push(`Admin account: ${context.profile.is_admin ? 'yes' : 'no'}`);
        lines.push(`Service provisioning ready: ${context.profile.control_panel_created ? 'yes' : 'no'}`);
        lines.push(`Victus Drive created: ${context.profile.victus_drive_created ? 'yes' : 'no'}`);
        if (!context.publicReply && context.profile.email) {
            lines.push(`Private linked email: ${context.profile.email}`);
        }
    }

    if (context.publicReply) {
        lines.push('Reply visibility: public Discord channel. Avoid private account details.');
    } else {
        lines.push('Reply visibility: private/ephemeral. Still avoid unnecessary sensitive details.');
    }

    return lines.join('\n');
}

function buildSystemPrompt(): string {
    const customPrompt = config.ai.systemPrompt.trim();
    return customPrompt ? `${VICTUS_SYSTEM_PROMPT}\n\nExtra Victus operator instructions:\n${customPrompt}` : VICTUS_SYSTEM_PROMPT;
}

const BROWSER_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtmlTags(value: string): string {
    return value.replace(/<[^>]*>/g, '');
}

async function webSearch(query: string): Promise<ToolResult> {
    const trimmed = query.trim();
    if (!trimmed) {
        return { error: 'Search query is required.' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
        const response = await fetch(`https://duckduckgo.com/html/?q=${encodeURIComponent(trimmed)}`, {
            method: 'GET',
            headers: {
                'User-Agent': BROWSER_USER_AGENT,
            },
            signal: controller.signal,
        });

        if (!response.ok) {
            return { error: `Search provider returned an error (${response.status}).` };
        }

        const html = await response.text();
        const results: SearchResult[] = [];
        const anchorRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        let match: RegExpExecArray | null;

        while ((match = anchorRegex.exec(html)) !== null && results.length < 8) {
            let url = match[1];
            const uddg = /[?&]uddg=([^&]+)/.exec(url);
            if (uddg) {
                url = decodeURIComponent(uddg[1]);
            }

            const title = decodeHtmlEntities(stripHtmlTags(match[2])).replace(/\s+/g, ' ').trim();
            if (!url || !title) continue;

            results.push({ title, url });
        }

        if (results.length === 0) {
            return { error: 'No results found.' };
        }

        return { query: trimmed, results };
    } catch (error) {
        logger.warn('AI web_search failed:', error);
        return { error: `Search failed: ${error instanceof Error ? error.message : 'unknown error'}` };
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchUrl(url: string): Promise<ToolResult> {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
        return { error: 'Only http(s) URLs can be fetched.' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
        const response = await fetch(trimmed, {
            method: 'GET',
            headers: {
                'User-Agent': BROWSER_USER_AGENT,
            },
            signal: controller.signal,
        });

        if (!response.ok) {
            return { error: `Page returned an error (${response.status}).` };
        }

        const html = await response.text();
        const text = decodeHtmlEntities(
            stripHtmlTags(
                html
                    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
                    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                    .replace(/<!--[\s\S]*?-->/g, ' ')
            )
        )
            .replace(/\s+/g, ' ')
            .trim();

        if (!text) {
            return { error: 'No readable text found on the page.' };
        }

        return { url: trimmed, text: truncate(text, 3000) };
    } catch (error) {
        logger.warn('AI fetch_url failed:', error);
        return { error: `Fetch failed: ${error instanceof Error ? error.message : 'unknown error'}` };
    } finally {
        clearTimeout(timeout);
    }
}

async function runTool(name: string, rawArguments: string): Promise<ToolResult> {
    let parsed: { query?: unknown; url?: unknown };
    try {
        parsed = rawArguments ? JSON.parse(rawArguments) : {};
    } catch {
        return { error: 'Invalid tool arguments (not valid JSON).' };
    }

    if (name === 'web_search') {
        return webSearch(typeof parsed.query === 'string' ? parsed.query : '');
    }
    if (name === 'fetch_url') {
        return fetchUrl(typeof parsed.url === 'string' ? parsed.url : '');
    }
    return { error: `Unknown tool: ${name}` };
}

class GroqAiService {
    isEnabled(): boolean {
        return config.ai.enabled;
    }

    get model(): string {
        return config.ai.model;
    }

    /**
     * Classify one short guild message. This is deliberately a separate,
     * tool-free call: moderation must never browse the web or inherit the
     * conversational assistant's tone. The caller applies conservative
     * confidence thresholds before taking action.
     */
    async classifyModeration(content: string): Promise<{
        language: string;
        english: boolean;
        languageConfidence: number;
        abusive: boolean;
        abuseConfidence: number;
        category: string;
        reason: string;
    } | null> {
        if (!this.isEnabled()) return null;

        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: [
                    'You are a strict Discord safety classifier for Victus Cloud.',
                    'Return ONLY one valid JSON object, with no markdown or explanation.',
                    'Detect the dominant natural-language language and targeted abuse.',
                    'Do not mark short neutral text, usernames, URLs, code, game commands, emojis, or ordinary frustration as abusive.',
                    'Abusive means a targeted insult, harassment, threat, hate/slur, sexual harassment, or clearly degrading attack.',
                    'For language, classify natural text as English only when it is genuinely English. Romanized or transliterated Hindi, Urdu, Arabic, Bengali, Punjabi, and other languages written with Latin letters are still non-English. If a message contains a meaningful non-English phrase such as "baat sun", classify it as non-English even when it also contains English words.',
                    'Required schema: {"language":"English","english":true,"languageConfidence":0.99,"abusive":false,"abuseConfidence":0.01,"category":"none","reason":"brief reason"}',
                ].join('\n'),
            },
            { role: 'user', content: `Message to classify:\n${content.slice(0, 1800)}` },
        ];

        try {
            // Moderation is best-effort. A provider returning no text must fall
            // back to the local detectors without generating an application
            // error stack for every message.
            const raw = await this.complete(messages, false, false);
            const jsonStart = raw.indexOf('{');
            const jsonEnd = raw.lastIndexOf('}');
            if (jsonStart < 0 || jsonEnd <= jsonStart) return null;
            const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
            const number = (value: unknown) => Math.max(0, Math.min(1, Number(value) || 0));
            return {
                language: String(parsed.language || 'Unknown').slice(0, 40),
                english: parsed.english === true || String(parsed.language || '').toLowerCase() === 'english',
                languageConfidence: number(parsed.languageConfidence),
                abusive: parsed.abusive === true,
                abuseConfidence: number(parsed.abuseConfidence),
                category: String(parsed.category || 'none').slice(0, 40),
                reason: String(parsed.reason || 'Policy classification').slice(0, 240),
            };
        } catch (error) {
            logger.debug(`Moderation classification failed: ${(error as Error).message}`);
            return null;
        }
    }

    async askVictus(question: string, context?: AiUserContext): Promise<string> {
        const messages: ChatMessage[] = [
            { role: 'system', content: buildSystemPrompt() },
        ];

        // Inject prior conversation turns if provided
        if (context?.history && context.history.length > 0) {
            for (const turn of context.history) {
                if (turn.content && turn.content.trim()) {
                    messages.push({
                        role: turn.role,
                        content: turn.content.trim(),
                    });
                }
            }
        }

        messages.push({
            role: 'user',
            content:
                `User context:\n${describeUserContext(context)}\n\n` +
                `Question:\n${truncate(question.trim(), 2000)}`,
        });

        return this.complete(messages);
    }

    async suggestForTicket(ticket: TicketContext): Promise<string> {
        const compactMessages = (ticket.messages || [])
            .slice(-12)
            .map((message) => {
                const author = message.author_username || (message.author_is_staff ? 'Staff' : 'User');
                const role = message.author_is_staff ? 'staff' : 'user';
                return `${author} (${role}): ${truncate(String(message.content || ''), 500)}`;
            })
            .filter(Boolean)
            .join('\n');

        const messages: ChatMessage[] = [
            { role: 'system', content: buildSystemPrompt() },
            {
                role: 'user',
                content:
                    `Create a concise support suggestion for this Victus Cloud ticket. ` +
                    `Give practical next steps and note when staff action is needed.\n\n` +
                    `Category: ${ticket.category || 'Unknown'}\n` +
                    `Subject: ${ticket.subject}\n` +
                    `Description: ${ticket.description || 'No description provided'}\n\n` +
                    `Recent messages:\n${compactMessages || 'No messages yet.'}`,
            },
        ];

        return this.complete(messages);
    }

    async extractResourceMetadata(url: string, rawText?: string): Promise<{
        title?: string;
        description?: string;
        category?: string;
        author?: string;
        tags?: string[];
        images?: string[];
    } | null> {
        if (!this.isEnabled()) return null;

        try {
            const prompt = `You are an expert Minecraft & Discord bot resource metadata extraction assistant.\n` +
                `URL to analyze: ${url}\n` +
                (rawText ? `Extracted Page Snippet:\n${truncate(rawText, 3000)}\n\n` : '\n') +
                `Your task: Extract structured details for this resource (Minecraft map, build, lobby, plugin, mod, Discord bot, code script, etc.).\n` +
                `If the raw snippet is empty or insufficient, use web_search or fetch_url to find the resource details on the web.\n\n` +
                `Return ONLY a raw valid JSON object with these exact keys:\n` +
                `{\n` +
                `  "title": "string (clear title, max 80 chars)",\n` +
                `  "description": "string (comprehensive markdown description of features, usage, version compatibility)",\n` +
                `  "category": "string (MUST be one of: 'Maps', 'Builds', 'Lobbies', 'Plugins', 'Mods', 'Bots', 'Codes', 'Other')",\n` +
                `  "author": "string (author/creator/dev name)",\n` +
                `  "tags": ["array of 3-6 relevant tags"],\n` +
                `  "images": ["array of image or banner URLs if found"]\n` +
                `}\n\n` +
                `Output pure JSON only without markdown formatting.`;

            const messages: ChatMessage[] = [
                { role: 'system', content: buildSystemPrompt() },
                { role: 'user', content: prompt },
            ];

            const answer = await this.complete(messages);
            const cleaned = answer.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

            const parsed = JSON.parse(cleaned);
            return {
                title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : undefined,
                description: typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim() : undefined,
                category: typeof parsed.category === 'string' && parsed.category.trim() ? parsed.category.trim() : undefined,
                author: typeof parsed.author === 'string' && parsed.author.trim() ? parsed.author.trim() : undefined,
                tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).filter(Boolean) : undefined,
                images: Array.isArray(parsed.images) ? parsed.images.map(String).filter((img: string) => img.startsWith('http')) : undefined,
            };
        } catch (error) {
            logger.warn('AI resource metadata extraction failed:', error);
            return null;
        }
    }

    async executeStaffTask(
        prompt: string,
        context?: {
            userTag?: string;
            history?: { role: 'user' | 'assistant'; content: string }[];
            attachments?: { name: string; url: string }[];
        }
    ): Promise<string> {
        const staffSystemPrompt = [
            'You are Antigravity Staff AI — an advanced autonomous engineering and technical operations assistant for Victus Cloud.',
            'You are running inside a Discord staff operations channel/thread assisting server administrators and engineers.',
            'You have deep expertise in systems administration, Discord bots, gaming infrastructure (Minecraft, Rust, ARK), Pterodactyl panels, networking, databases, Docker, Node.js, and TypeScript.',
            'Provide direct, technically accurate, and production-ready solutions.',
            'If the instruction requires decisions, choices, or information from the staff operator, format your questions under a dedicated section:',
            '### ❓ Questions for Staff',
            '1. [First specific question]',
            '2. [Second specific question]',
        ].join('\n');

        const messages: ChatMessage[] = [
            { role: 'system', content: staffSystemPrompt },
        ];

        if (context?.history && context.history.length > 0) {
            for (const h of context.history) {
                messages.push({
                    role: h.role,
                    content: h.content,
                });
            }
        }

        let userMessage = prompt;
        if (context?.attachments && context.attachments.length > 0) {
            const atts = context.attachments.map((a) => `- ${a.name}: ${a.url}`).join('\n');
            userMessage += `\n\n[Attachments]:\n${atts}\n(Please inspect or consider these attachments in your analysis).`;
        }

        if (context?.userTag) {
            userMessage = `[Operator: ${context.userTag}]\n${userMessage}`;
        }

        messages.push({
            role: 'user',
            content: userMessage,
        });

        let result = '';
        try {
            result = await this.complete(messages, config.ai.webSearchEnabled);
        } catch (err: any) {
            logger.warn(`[GroqAi] Primary completion failed for staff task: ${err?.message || err}. Attempting secondary fallback...`);
            try {
                // Secondary attempt without tools
                const fallbackMessage = await this.callChatCompletions(messages, false);
                result = typeof fallbackMessage === 'string' ? fallbackMessage : (fallbackMessage?.content || '');
            } catch (fallbackErr: any) {
                logger.error('[GroqAi] Secondary fallback also failed:', fallbackErr?.message || fallbackErr);
            }
        }

        if (!result || !result.trim()) {
            return (
                `⚠️ **Cloud AI Fallback Notice**\n\n` +
                `Received staff instruction:\n> ${prompt}\n\n` +
                `The cloud AI provider returned an empty response. If you want this task to execute inside your PC's Antigravity desktop app, start the bridge on your computer:\n` +
                `\`\`\`powershell\nnpm run antigravity:bridge\n\`\`\``
            );
        }

        return result.trim();
    }

    private async callChatCompletionsOnce(
        messages: ChatMessage[],
        withTools: boolean,
        model: string,
        ms: number,
        provider: ChatProvider = config.ai,
    ): Promise<GroqResponseMessage> {
        const endpoint = normalizeEndpoint(provider.baseUrl);
        const isAzure = isAzureEndpoint(endpoint);
        const isGroq = provider.name === 'groq' || /groq\.com/i.test(provider.baseUrl) || (provider.apiKey || '').startsWith('gsk_');
        const isOR = !isGroq && !isAzure && isOpenRouter(provider.baseUrl, model);
        const maxTokens = isGroq
            ? clampNumber(provider.maxTokens || config.ai.maxTokens, 700, 100, 800)
            : clampNumber(provider.maxTokens || config.ai.maxTokens, 1000, 100, 4000);
        const temperature = clampNumber(provider.temperature ?? config.ai.temperature, 0.35, 0, 1.5);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), ms);
        try {
            const body: Record<string, unknown> = {
                model,
                messages,
                temperature,
                max_tokens: maxTokens,
            };
            const hasToolHistory = messages.some(m => m.role === 'tool' || (m.role === 'assistant' && Array.isArray((m as any).tool_calls) && (m as any).tool_calls.length > 0));
            if (withTools || hasToolHistory) {
                body.tools = AI_TOOLS;
                body.tool_choice = 'auto';
            }
            if (isOR) {
                (body as any).reasoning = { effort: 'high', exclude: false };
                (body as any).top_p = 0.95;
            }
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    ...(isAzure
                        ? { 'api-key': provider.apiKey }
                        : { Authorization: `Bearer ${provider.apiKey}` }),
                    'Content-Type': 'application/json',
                    ...(isOR ? { 'HTTP-Referer': 'https://victuscloud.com', 'X-Title': 'Victus Cloud' } : {}),
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            const payload = await response.json().catch(() => null) as GroqChatResponse | null;
            if (!response.ok) {
                const detail = payload?.error?.message || payload?.message || response.statusText;
                throw new Error(`AI request failed (${response.status}): ${detail}`);
            }
            const message = payload?.choices?.[0]?.message;
            if (!message) throw new Error('AI returned an empty response.');
            return message;
        } finally {
            clearTimeout(timeout);
        }
    }

    private async callChatCompletions(
        messages: ChatMessage[],
        withTools: boolean,
        providerOverride?: ChatProvider,
    ): Promise<GroqResponseMessage> {
        const provider = providerOverride || (config.ai as any).primaryProvider || config.ai;
        const keys = provider.apiKeys?.length ? provider.apiKeys : [provider.apiKey];
        const isAzure = isAzureEndpoint(provider.baseUrl);
        const isGroq = provider.name === 'groq' || /groq\.com/i.test(provider.baseUrl) || (provider.apiKey || '').startsWith('gsk_');
        const isOR = !isGroq && !isAzure && isOpenRouter(provider.baseUrl, provider.model || config.ai.model);

        const tryModel = async (model: string, ms: number): Promise<GroqResponseMessage> => {
            let lastError: unknown;
            for (const apiKey of keys) {
                try {
                    return await this.callChatCompletionsOnce(messages, withTools, model, ms, { ...provider, apiKey });
                } catch (error) {
                    lastError = error;
                }
            }
            throw lastError instanceof Error ? lastError : new Error('AI provider request failed.');
        };

        if (isGroq) {
            const requested = providerOverride?.model || provider.model;
            const modelsToTry = [
                requested,
                'openai/gpt-oss-120b',
                'qwen/qwen3.8-27b',
                'openai/gpt-oss-20b',
            ].filter(Boolean) as string[];
            const uniqueModels = [...new Set(modelsToTry)];
            let lastErr: unknown;
            for (const m of uniqueModels) {
                try {
                    return await tryModel(m, 25000);
                } catch (err) {
                    lastErr = err;
                    logger.warn(`Groq model "${m}" failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            throw lastErr instanceof Error ? lastErr : new Error('All Groq models failed.');
        }

        if (isOR) {
            const requestedModel = providerOverride?.model || provider.model;
            if (requestedModel && !requestedModel.includes(':free')) {
                return tryModel(requestedModel, 30000);
            }
            const lastUser = [...messages].reverse().find(m => (m as any).role === "user") as any;
            const text = lastUser?.content || (messages[messages.length - 1] as any)?.content || "";
            const complex = isComplexQuery(String(text));
            const primary = complex ? 'poolside/laguna-xs-2.1:free' : 'nvidia/nemotron-3.5-lightning:free';
            const primaryMs = complex ? 12000 : 15000;
            try {
                return await tryModel(primary, primaryMs);
            } catch (e) {
                logger.warn(`${primary} failed, falling back to nemotron-ultra: ${e instanceof Error ? e.message : String(e)}`);
                return await tryModel('nvidia/nemotron-3-ultra-550b-a55b:free', 40000);
            }
        }

        return tryModel(provider.model || config.ai.model, 25000);
    }

    private async callResponsesApi(messages: ChatMessage[], withTools: boolean, providerOverride?: ChatProvider): Promise<string> {
        const provider = providerOverride || (config.ai as any).primaryProvider || config.ai;
        const endpoint = provider.baseUrl;
        let maxTokens = clampNumber(provider.maxTokens || config.ai.maxTokens, 8000, 2000, 32000);
        const input: Record<string, unknown>[] = messages.map((message) => ({
            role: message.role === 'tool' ? 'assistant' : message.role,
            content: message.content || '',
        }));

        let toolsAllowed = withTools;
        let useReasoning = true;

        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
            const attachTools = toolsAllowed && round < MAX_TOOL_ROUNDS;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 45000);
            try {
                const body: Record<string, unknown> = {
                    model: provider.model || config.ai.model,
                    input,
                    max_output_tokens: maxTokens,
                };
                if (useReasoning) {
                    body.reasoning = { effort: 'low' };
                }
                if (attachTools) {
                    body.tools = RESPONSES_TOOLS;
                    body.tool_choice = 'auto';
                }

                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'api-key': provider.apiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });

                const payload = await response.json().catch(() => null) as any;
                if (!response.ok) {
                    if (response.status === 400 && (attachTools || useReasoning)) {
                        toolsAllowed = false;
                        useReasoning = false;
                        continue;
                    }
                    const detail = payload?.error?.message || payload?.message || response.statusText;
                    throw new Error(`Azure AI request failed (${response.status}): ${detail}`);
                }

                const output: any[] = payload?.output || [];
                const calls = output.filter((item: any) => item.type === 'function_call');

                if (attachTools && calls.length > 0) {
                    let allErrored = true;
                    for (const call of calls) {
                        const rawArgs = typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments || {});
                        input.push({ type: 'function_call', call_id: call.call_id, name: call.name, arguments: rawArgs });
                        const result = await runTool(call.name, rawArgs);
                        if (!(result && typeof result === 'object' && 'error' in result)) {
                            allErrored = false;
                        }
                        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
                    }
                    if (allErrored) {
                        toolsAllowed = false;
                    }
                    continue;
                }

                const messageItem = output.find((item: any) => item.type === 'message' && item.role === 'assistant');
                let text: string | undefined = messageItem?.content?.[0]?.text;
                if (!text && Array.isArray(messageItem?.content)) {
                    text = messageItem.content.map((c: any) => c?.text || '').join('').trim() || undefined;
                }
                if (!text && typeof payload?.output_text === 'string') {
                    text = payload.output_text;
                }

                if (typeof text === 'string' && text.trim()) {
                    return truncate(text.trim(), 3200);
                }

                const truncatedByTokens = payload?.status === 'incomplete'
                    && payload?.incomplete_details?.reason === 'max_output_tokens';
                if (truncatedByTokens && maxTokens < 32000) {
                    maxTokens = Math.min(32000, maxTokens * 2);
                    continue;
                }
                if (toolsAllowed) {
                    toolsAllowed = false;
                    if (maxTokens < 16000) maxTokens = 16000;
                    continue;
                }

                throw new Error(`Azure AI returned an empty response (status=${payload?.status ?? 'unknown'}).`);
            } finally {
                clearTimeout(timeout);
            }
        }

        throw new Error('Azure AI returned an empty response.');
    }

    private async complete(
        messages: ChatMessage[],
        allowTools = config.ai.webSearchEnabled,
        logFailure = true,
    ): Promise<string> {
        const providers: ChatProvider[] = (config.ai as any).providers?.length
            ? (config.ai as any).providers
            : (config.ai.apiKey ? [{
                name: 'default',
                apiKey: config.ai.apiKey,
                apiKeys: config.ai.apiKeys || [config.ai.apiKey],
                baseUrl: config.ai.baseUrl,
                model: config.ai.model,
                maxTokens: config.ai.maxTokens,
                temperature: config.ai.temperature,
            }] : []);

        if (providers.length === 0) {
            throw new Error('AI is not configured. Set GROQ_API_KEY (or OPENROUTER_API_KEY / AI_API_KEY) in the bot environment.');
        }

        let lastError: unknown = null;

        for (let pIdx = 0; pIdx < providers.length; pIdx++) {
            const provider = providers[pIdx];
            try {
                if (isAzureResponsesApi(provider.baseUrl)) {
                    return await this.callResponsesApi(messages, allowTools, provider);
                }

                const withTools = allowTools;
                const conversation: ChatMessage[] = [...messages];

                for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
                    const allowToolsRound = withTools && round < MAX_TOOL_ROUNDS;
                    const response = await this.callChatCompletions(conversation, allowToolsRound, provider);

                    const toolCalls = response.tool_calls;
                    if (allowToolsRound && Array.isArray(toolCalls) && toolCalls.length > 0) {
                        conversation.push({
                            role: 'assistant',
                            content: response.content ?? null,
                            tool_calls: toolCalls,
                        });

                        for (const toolCall of toolCalls) {
                            const result = await runTool(toolCall.function.name, toolCall.function.arguments);
                            conversation.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: JSON.stringify(result),
                            });
                        }
                        if (round + 1 >= MAX_TOOL_ROUNDS) {
                            conversation.push({
                                role: 'system',
                                content: 'Tool execution is complete. Synthesize the final answer for the user based on the tool results above. Do not output any tool calls.',
                            });
                        }
                        continue;
                    }

                    // Fallback: Check if model emitted tool call as inline XML/Markdown text (<tool_call> or ```tool_call)
                    if (allowToolsRound && (!toolCalls || toolCalls.length === 0) && response.content) {
                        const toolCallMatch = response.content.match(/<tool_call>([\s\S]*?)<\/tool_call>/i) ||
                                              response.content.match(/```(?:json|tool_call)?\s*(\{\s*"name"\s*:\s*"(?:web_search|fetch_url)"[\s\S]*?\})\s*```/i);
                        if (toolCallMatch) {
                            try {
                                const parsed = JSON.parse(toolCallMatch[1].trim());
                                const toolName = parsed.name || parsed.function?.name || parsed.tool;
                                const rawArgs = typeof parsed.arguments === 'string'
                                    ? parsed.arguments
                                    : JSON.stringify(parsed.arguments || parsed.parameters || {});
                                if (toolName === 'web_search' || toolName === 'fetch_url') {
                                    const callId = `call_text_${Date.now()}`;
                                    conversation.push({
                                        role: 'assistant',
                                        content: response.content,
                                    });
                                    const result = await runTool(toolName, rawArgs);
                                    conversation.push({
                                        role: 'tool',
                                        tool_call_id: callId,
                                        content: JSON.stringify(result),
                                    });
                                    if (round + 1 >= MAX_TOOL_ROUNDS) {
                                        conversation.push({
                                            role: 'system',
                                            content: 'Tool execution is complete. Synthesize the final answer for the user based on the tool results above. Do not output any tool calls.',
                                        });
                                    }
                                    continue;
                                }
                            } catch (parseErr) {
                                logger.debug('Text-based tool call parsing skipped:', parseErr);
                            }
                        }
                    }

                    const rawAnswer = (response.content || '')
                        .replace(/<think>[\s\S]*?<\/think>/gi, '')
                        .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
                        .trim();

                    if (!rawAnswer) {
                        throw new Error('AI returned an empty response.');
                    }

                    return truncate(rawAnswer, 3200);
                }

                throw new Error('AI returned an empty response after max tool rounds.');
            } catch (err: any) {
                lastError = err;
                const msg = err instanceof Error ? err.message : String(err);
                logger.warn(`AI provider "${provider.name || provider.baseUrl}" failed: ${msg}`);
                if (pIdx + 1 < providers.length) {
                    logger.info(`Failing over to next provider: ${providers[pIdx + 1].name || providers[pIdx + 1].baseUrl}...`);
                }
            }
        }

        if (logFailure) logger.error('All configured AI providers failed. Last error:', lastError);
        throw lastError instanceof Error ? lastError : new Error('All configured AI providers failed.');
    }
}

export const groqAi = new GroqAiService();
