import 'dotenv/config';

function victusComUrl(url: string): string {
    return url.replace(/victuscloud\.xyz/gi, 'victuscloud.com');
}

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
        // ytsearch (YouTube) is the default; users can paste SoundCloud/Bandcamp/
        // direct URLs too. Override with LAVALINK_SEARCH (e.g. scsearch).
        defaultSource: process.env.LAVALINK_SEARCH || 'ytsearch',
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
        apiKey: process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY || process.env.GROQ_API_KEY || '',
        baseUrl: process.env.OPENROUTER_API_KEY
            ? (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1')
            : (process.env.AI_BASE_URL || process.env.GROQ_BASE_URL || 'https://openrouter.ai/api/v1'),
        model: process.env.OPENROUTER_API_KEY
            ? (process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3.5-lightning:free')
            : (process.env.AI_MODEL || process.env.GROQ_MODEL || 'nvidia/nemotron-3.5-lightning:free'),
        temperature: Number(process.env.AI_TEMPERATURE || process.env.GROQ_TEMPERATURE || '0.4'),
        // Higher default: Laguna + gpt-5.6 can spend output on reasoning, small cap yields empty reply. Clamped downstream.
        maxTokens: Number(process.env.OPENROUTER_MAX_TOKENS || process.env.AI_MAX_TOKENS || process.env.GROQ_MAX_TOKENS || '4000'),
        systemPrompt: process.env.VICTUS_AI_SYSTEM_PROMPT || '',
        enabled: !!(process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY || process.env.GROQ_API_KEY),
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
        levelUpChannelId: process.env.DISCORD_LEVEL_UP_CHANNEL_ID || '1416377943776559204',
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
        coinsPerLevel: parseInt(process.env.ECON_COINS_PER_LEVEL || '30', 10),

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
        free: 'https://victuscloud.com/free',
        billing: 'https://billing.victuscloud.com',
        panel: 'https://control.victuscloud.com',
    },
} as const;

export type Config = typeof config;
