import 'dotenv/config';

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
        url: process.env.PTERODACTYL_URL || '',
        apiKey: process.env.PTERODACTYL_API_KEY || '',
    },

    // Paymenter (optional - can use Supabase edge functions)
    paymenter: {
        url: process.env.PAYMENTER_URL || '',
        apiKey: process.env.PAYMENTER_API_KEY || '',
    },

    // AI Support (optional)
    ai: {
        openaiKey: process.env.OPENAI_API_KEY || '',
        enabled: !!process.env.OPENAI_API_KEY,
    },

    // Bot Settings
    bot: {
        linkTokenExpiryMinutes: parseInt(process.env.LINK_TOKEN_EXPIRY_MINUTES || '10', 10),
        logLevel: process.env.LOG_LEVEL || 'info',
        linkedRoleId: process.env.DISCORD_LINKED_ROLE_ID || '', // Role to give when account is linked
        supportGuildId: process.env.DISCORD_SUPPORT_GUILD_ID || '', // Main support server ID
    },

    // Victus Cloud Branding
    branding: {
        name: 'Victus Cloud',
        color: 0x6366f1, // Indigo
        logo: 'https://victuscloud.xyz/favicon.png',
        website: 'https://victuscloud.xyz',
        billing: 'https://billing.victuscloud.xyz',
        panel: 'https://game.victuscloud.xyz',
    },
} as const;

export type Config = typeof config;
