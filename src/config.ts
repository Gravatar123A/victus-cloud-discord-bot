import 'dotenv/config';

function victusComUrl(url: string): string {
    return url.replace(/victuscloud\.xyz/gi, 'victuscloud.com');
}

function splitApiKeys(...names: string[]): string[] {
    const keys = names.flatMap((name) => (process.env[name] || '').split(/[\r\n,]+/));
    return [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
}

export interface AiProviderConfig {
    name: 'groq' | 'openrouter' | 'azure' | 'custom';
    apiKey: string;
    apiKeys: string[];
    baseUrl: string;
    model: string;
    maxTokens: number;
    temperature: number;
}

function normalizeGroqUrl(raw?: string): string {
    const val = (raw || '').trim();
    if (!val || /cognitiveservices\.azure\.com/i.test(val)) return 'https://api.groq.com/openai/v1';
    let url = val.replace(/\/+$/, '');
    if (url.endsWith('/openai')) url += '/v1';
    else if (!url.endsWith('/v1') && !url.includes('/v1/')) url += '/v1';
    return url;
}

function normalizeGroqModel(raw?: string): string {
    const val = (raw || '').trim();
    if (!val || val === 'gpt-5.6-sol' || val === 'llama-3.1-8b-instant' || val === 'llama-3.3-70b-versatile' || val === 'mixtral-8x7b-32768') {
        return 'openai/gpt-oss-120b';
    }
    return val;
}

const rawGroqKeys = splitApiKeys('GROQ_API_KEYS', 'GROQ_API_KEY');
const rawOpenRouterKeys = splitApiKeys('OPENROUTER_API_KEYS', 'OPENROUTER_API_KEY');
const rawAzureKeys = splitApiKeys('AI_API_KEYS', 'AI_API_KEY');
const fallbackEnvKeys = splitApiKeys('AI_FALLBACK_API_KEYS', 'VICTUS_AI_API_KEYS');

const groqKeys: string[] = [];
const azureKeys: string[] = [...rawAzureKeys];
const openRouterKeys: string[] = [...rawOpenRouterKeys];

for (const key of rawGroqKeys) {
    if (key.startsWith('gsk_')) {
        groqKeys.push(key);
    } else if (key.startsWith('sk-or-')) {
        openRouterKeys.push(key);
    } else if (/cognitiveservices\.azure\.com/i.test(process.env.GROQ_BASE_URL || '') || key.length > 50) {
        azureKeys.push(key);
    } else {
        groqKeys.push(key);
    }
}

for (const key of rawAzureKeys) {
    if (key.startsWith('gsk_')) {
        groqKeys.push(key);
    } else if (key.startsWith('sk-or-')) {
        openRouterKeys.push(key);
    }
}

const aiProviders: AiProviderConfig[] = [];

if (groqKeys.length > 0) {
    aiProviders.push({
        name: 'groq',
        apiKey: groqKeys[0],
        apiKeys: groqKeys,
        baseUrl: normalizeGroqUrl(process.env.GROQ_BASE_URL),
        model: normalizeGroqModel(process.env.GROQ_MODEL),
        maxTokens: Math.min(800, Math.max(100, parseInt(process.env.GROQ_MAX_TOKENS || '700', 10))),
        temperature: Number(process.env.GROQ_TEMPERATURE || process.env.AI_TEMPERATURE || '0.35'),
    });
}

if (openRouterKeys.length > 0) {
    aiProviders.push({
        name: 'openrouter',
        apiKey: openRouterKeys[0],
        apiKeys: openRouterKeys,
        baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
        model: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3.5-lightning:free',
        maxTokens: parseInt(process.env.OPENROUTER_MAX_TOKENS || '1000', 10),
        temperature: Number(process.env.AI_TEMPERATURE || '0.4'),
    });
}

const azureBaseUrl = process.env.AI_BASE_URL || (/cognitiveservices\.azure\.com/i.test(process.env.GROQ_BASE_URL || '') ? process.env.GROQ_BASE_URL : '');
if (azureKeys.length > 0 && azureBaseUrl) {
    aiProviders.push({
        name: 'azure',
        apiKey: azureKeys[0],
        apiKeys: azureKeys,
        baseUrl: azureBaseUrl,
        model: process.env.AI_MODEL || (process.env.GROQ_MODEL === 'gpt-5.6-sol' ? 'gpt-5.6-sol' : 'gpt-5.6-sol'),
        maxTokens: parseInt(process.env.AI_MAX_TOKENS || '8000', 10),
        temperature: Number(process.env.AI_TEMPERATURE || '0.4'),
    });
}

const preferredProviderName = (process.env.AI_PROVIDER || '').trim().toLowerCase();
if (preferredProviderName) {
    const idx = aiProviders.findIndex(p => p.name === preferredProviderName);
    if (idx > 0) {
        const [preferred] = aiProviders.splice(idx, 1);
        aiProviders.unshift(preferred);
    }
}

if (aiProviders.length === 0 && (fallbackEnvKeys.length > 0 || azureKeys.length > 0)) {
    const key = fallbackEnvKeys[0] || azureKeys[0] || '';
    const isGroq = key.startsWith('gsk_');
    aiProviders.push({
        name: isGroq ? 'groq' : 'openrouter',
        apiKey: key,
        apiKeys: [key],
        baseUrl: isGroq ? 'https://api.groq.com/openai/v1' : 'https://openrouter.ai/api/v1',
        model: isGroq ? 'openai/gpt-oss-120b' : 'nvidia/nemotron-3.5-lightning:free',
        maxTokens: 700,
        temperature: 0.35,
    });
}

const primaryAiProvider = aiProviders[0] || null;
const primaryAiKeys = primaryAiProvider ? primaryAiProvider.apiKeys : [];
const primaryAiBaseUrl = primaryAiProvider ? primaryAiProvider.baseUrl : '';
const fallbackAiKeys = aiProviders.slice(1).flatMap(p => p.apiKeys);
const fallbackAiBaseUrl = aiProviders[1]?.baseUrl || '';

// Validate required environment variables
const requiredEnvVars = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`❌ Missing required environment variable: ${envVar}`);
        process.exit(1);
    }
}

export const config = {
    // Discord
    discord: {
        token: process.env.DISCORD_TOKEN!,
        clientId: process.env.DISCORD_CLIENT_ID!,
        guildId: process.env.DISCORD_GUILD_ID, // Optional: for guild-specific commands during dev
    },

    // Supabase
    supabase: {
        url: process.env.SUPABASE_URL!,
        serviceKey: process.env.SUPABASE_SERVICE_KEY!,
    },

    // Lavalink (music) — the dedicated Victus Cloud Lavalink node on DE-1.
    // YouTube + SoundCloud + Bandcamp/Twitch/Vimeo + direct URLs are enabled.
    lavalink: {
        id: process.env.LAVALINK_ID || 'victus-de1',
        host: process.env.LAVALINK_HOST || '135.125.222.36',
        port: parseInt(process.env.LAVALINK_PORT || '25578', 10),
        // Required in production. Do not commit a fallback password: the DE-1
        // node credential is managed independently and may be rotated.
        password: process.env.LAVALINK_PASSWORD || '',
        secure: process.env.LAVALINK_SECURE === 'true',
        // scsearch (SoundCloud) is the default to avoid YouTube datacenter IP blocks.
        // Users can paste YouTube/Spotify/Bandcamp/direct URLs too. Override with LAVALINK_SEARCH.
        defaultSource: process.env.LAVALINK_SEARCH || 'scsearch',
        defaultVolume: parseInt(process.env.LAVALINK_VOLUME || '80', 10),
    },

    // Pterodactyl (optional - can use Supabase edge functions)
    pterodactyl: {
        url: victusComUrl(process.env.PTERODACTYL_URL || ''),
        apiKey: process.env.PTERODACTYL_API_KEY || '',
        clientApiKey: process.env.PTERODACTYL_CLIENT_API_KEY || '',
    },

    // Paymenter (optional - can use Supabase edge functions)
    paymenter: {
        url: victusComUrl(process.env.PAYMENTER_URL || ''),
        apiKey: process.env.PAYMENTER_API_KEY || '',
    },

    // AI reply provider (the AI that answers when the bot is pinged / DM'd / via
    // /ask). Defaults to the Victus Azure AI Foundry GPT-5.6-sol deployment
    // (Responses API — auto-detected by groqAi from the /responses cognitiveservices
    // URL). Override any field via env. Primary env names are AI_*; the legacy
    // GROQ_* names still work. The API KEY is a secret and is NEVER committed — set
    // AI_API_KEY (or GROQ_API_KEY) in the bot's .env on the host.
    ai: {
        providers: aiProviders,
        primaryProvider: primaryAiProvider,
        apiKey: primaryAiProvider?.apiKey || '',
        apiKeys: primaryAiKeys,
        baseUrl: primaryAiBaseUrl,
        model: primaryAiProvider?.model || 'openai/gpt-oss-120b',
        fallbackApiKeys: fallbackAiKeys,
        fallbackBaseUrl: fallbackAiBaseUrl,
        fallbackModel: aiProviders[1]?.model || '',
        temperature: primaryAiProvider?.temperature ?? 0.35,
        maxTokens: primaryAiProvider?.maxTokens ?? 700,
        systemPrompt: process.env.VICTUS_AI_SYSTEM_PROMPT || '',
        enabled: aiProviders.length > 0,
        // Keyless web access (DuckDuckGo HTML scrape) exposed to the AI as tools.
        // Defaults to true unless AI_WEB_SEARCH is explicitly set to "false".
        webSearchEnabled: process.env.AI_WEB_SEARCH !== 'false',
    },

    // Bot Settings
    bot: {
        linkTokenExpiryMinutes: parseInt(process.env.LINK_TOKEN_EXPIRY_MINUTES || '10', 10),
        logLevel: process.env.LOG_LEVEL || 'info',
        linkedRoleId: process.env.DISCORD_LINKED_ROLE_ID || '', // Role to give when account is linked
        supportGuildId: process.env.DISCORD_SUPPORT_GUILD_ID || '', // Main support server ID
        freeUserRoleId: process.env.DISCORD_FREE_USER_ROLE_ID || '1531675572877525082',
        paidClientRoleId: process.env.DISCORD_PAID_CLIENT_ROLE_ID || '1340607431193137296',
        entitlementSyncMinutes: Math.max(1, parseInt(process.env.DISCORD_ENTITLEMENT_SYNC_MINUTES || '5', 10)),
        aiChannelId: process.env.DISCORD_AI_CHANNEL_ID || '', // Optional fallback AI support channel
        autoRegisterCommands: process.env.DISCORD_AUTO_REGISTER_COMMANDS !== 'false',
        levelUpChannelId: process.env.DISCORD_LEVEL_UP_CHANNEL_ID || '1531002070130364426',
        // Uptime Kuma push monitor — the bot pings this on an interval so the
        // "Discord Bot Heartbeat" monitor stays green. Override via env.
        uptimePushUrl: process.env.UPTIME_KUMA_PUSH_URL || 'https://status.victuscloud.com/api/push/KPHJ8IOmDd',
    },

    // Economy / XP rewards for Discord activity (mirrors website upload XP into
    // profiles.total_xp via the increment_xp RPC + cp_transactions ledger).
    economy: {
        // XP awarded per eligible guild message (bots/DMs/commands ignored).
        xpPerMessage: parseInt(process.env.ECON_XP_PER_MESSAGE || '10', 10),
        // Per-user cooldown (seconds) between message XP awards, to curb spam.
        messageXpCooldownSec: parseInt(process.env.ECON_MESSAGE_XP_COOLDOWN_SEC || '0', 10),
        // XP awarded per full minute spent active in a voice channel.
        xpPerVoiceMinute: parseInt(process.env.ECON_XP_PER_VOICE_MINUTE || '15', 10),
        xpPerLevel: parseInt(process.env.ECON_XP_PER_LEVEL || '200', 10),
        coinsPerLevel: parseInt(process.env.ECON_COINS_PER_LEVEL || '100', 10),

        // Automatic "+N COINS per Discord invite" reward (escrow model).
        // Disabled by default: the whole feature is inert until
        // DISCORD_INVITE_COINS_ENABLED=true is set on the bot host, so a deploy
        // ships nothing user-facing until the operator opts in.
        invite: {
            enabled: process.env.DISCORD_INVITE_COINS_ENABLED === 'true',
            amount: parseInt(process.env.INVITE_COINS_AMOUNT || '20', 10),
            qualifyDays: parseInt(process.env.INVITE_QUALIFY_DAYS || '3', 10),
            minAccountAgeDays: parseInt(process.env.INVITE_MIN_ACCOUNT_AGE_DAYS || '30', 10),
            dailyCap: parseInt(process.env.INVITE_DAILY_CAP || '10', 10),
            requireAvatar: process.env.INVITE_REQUIRE_AVATAR !== 'false',
            requireBio: process.env.INVITE_REQUIRE_BIO !== 'false',
            strictUsername: process.env.INVITE_STRICT_USERNAME !== 'false',
        },

        // Discord link reward (join + /link) — granted once per linked account.
        discordLink: {
            enabled: process.env.DISCORD_LINK_COINS_ENABLED !== 'false', // enabled by default
            amount: parseInt(process.env.DISCORD_LINK_COINS_AMOUNT || '100', 10),
        },
    },

    // Victus Cloud Branding
    branding: {
        name: 'Victus Cloud',
        color: 0x6366f1, // Indigo
        logo: 'https://victuscloud.com/favicon.png',
        website: 'https://victuscloud.com',
        botDocs: 'https://victuscloud.com/bot',
        free: 'https://victuscloud.com/free',
        billing: 'https://billing.victuscloud.com',
        panel: 'https://control.victuscloud.com',
    },

    // Antigravity Staff Work Pipeline
    antigravity: {
        enabled: process.env.ANTIGRAVITY_ENABLED !== 'false',
        staffChannelId: process.env.DISCORD_STAFF_AI_CHANNEL_ID || '',
        staffRoleIds: (process.env.DISCORD_STAFF_ROLE_IDS || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        workdir: process.env.ANTIGRAVITY_WORKDIR || (process.platform === 'win32' ? 'e:/heheboi - projects' : process.cwd()),
        model: process.env.ANTIGRAVITY_MODEL || 'gemini-3.8-flash-high',
        agyPath: process.env.ANTIGRAVITY_BIN || 'agy',
        timeoutMs: parseInt(process.env.ANTIGRAVITY_TIMEOUT_MS || '1800000', 10),
        inactivityTimeoutMs: parseInt(process.env.ANTIGRAVITY_INACTIVITY_TIMEOUT_MS || '600000', 10),
    },

    // BuiltByBit (MC-Market) Integration
    builtbybit: {
        apiToken: process.env.BUILTBYBIT_API_TOKEN || process.env.BUILTBYBIT_TOKEN || '',
    },
} as const;


export type Config = typeof config;
