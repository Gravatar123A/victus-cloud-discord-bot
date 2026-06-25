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

    // AI Support (optional, OpenAI-compatible Groq endpoint)
    ai: {
        apiKey: process.env.GROQ_API_KEY || '',
        baseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai',
        model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
        temperature: Number(process.env.GROQ_TEMPERATURE || '0.35'),
        maxTokens: Number(process.env.GROQ_MAX_TOKENS || '700'),
        systemPrompt: process.env.VICTUS_AI_SYSTEM_PROMPT || '',
        enabled: !!process.env.GROQ_API_KEY,
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
        aiChannelId: process.env.DISCORD_AI_CHANNEL_ID || '', // Optional fallback AI support channel
        autoRegisterCommands: process.env.DISCORD_AUTO_REGISTER_COMMANDS !== 'false',
        // Uptime Kuma push monitor — the bot pings this on an interval so the
        // "Discord Bot Heartbeat" monitor stays green. Override via env.
        uptimePushUrl: process.env.UPTIME_KUMA_PUSH_URL || 'https://status.victuscloud.com/api/push/KPHJ8IOmDd',
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
