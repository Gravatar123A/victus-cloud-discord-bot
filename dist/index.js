import { Client, Collection, GatewayIntentBits, Partials, ContainerBuilder } from 'discord.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { loadCommands } from './commands/index.js';
import { loadEvents } from './events/index.js';
import { createLavalinkManager } from './services/music.js';
import { antigravityBridge } from './services/antigravityBridge.js';
// Global override: Disable accent colors for all V2 layout containers to achieve clean slate designs
ContainerBuilder.prototype.setAccentColor = function () {
    return this;
};
// --- Secure TLS hardening: ensure CA certs are available, log cert errors with context ---
process.on('uncaughtException', (err) => {
    logger.error('🔥 Uncaught Exception:', err?.message || err);
    if (err?.stack)
        logger.error(err.stack);
    if (String(err?.message || '').includes('unable to verify the first certificate')) {
        logger.error('🔒 TLS cert chain incomplete - ensure ca-certificates is installed in container. See Dockerfile fix.');
    }
});
process.on('unhandledRejection', (reason) => {
    const msg = reason?.message || String(reason);
    logger.error('🔥 Unhandled Rejection:', msg);
    if (reason?.stack)
        logger.error(reason.stack);
});
async function main() {
    logger.info('🚀 Starting Victus Cloud Discord Bot...');
    // Run migration of local JSON data to Supabase
    try {
        const { migrateLocalDataToSupabase } = await import('./services/migrateLocalData.js');
        await migrateLocalDataToSupabase();
    }
    catch (err) {
        logger.error('Failed to run local data migration:', err);
    }
    // Create client with required intents
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMessageReactions,
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildVoiceStates,
            // Required to receive inviteCreate/inviteDelete and to call
            // guild.invites.fetch() for invite->inviter attribution.
            GatewayIntentBits.GuildInvites,
        ],
        partials: [
            Partials.Channel,
            Partials.Message,
            Partials.Reaction,
        ],
    });
    // Initialize collections
    client.commands = new Collection();
    client.buttons = new Collection();
    client.selectMenus = new Collection();
    client.modals = new Collection();
    // Initialize the Lavalink music manager (connects on `ready`).
    createLavalinkManager(client);
    // Load commands and events
    await loadCommands(client);
    await loadEvents(client);
    logger.info(`📦 Loaded ${client.commands.size} commands`);
    // Register late completion delivery for Antigravity tasks that finish after prolonged execution
    antigravityBridge.setLateCompletionHandler(async (info) => {
        const targetChannelId = info.threadId || info.channelId;
        if (!targetChannelId)
            return;
        try {
            const channel = await client.channels.fetch(targetChannelId);
            if (channel && channel.isTextBased()) {
                const { createResultEmbeds } = await import('./embeds/antigravityEmbeds.js');
                const { embeds, components } = createResultEmbeds(info.result, {
                    task: info.rawPrompt || 'Staff Task',
                    userTag: info.userTag || 'Staff',
                });
                await channel.send({
                    content: `🔔 **Antigravity Workstation Task Completed** (Background Delivery):`,
                    embeds,
                    components,
                });
            }
        }
        catch (err) {
            logger.error('[AntigravityBridge] Failed to deliver late completion to channel:', err);
        }
    });
    // Login
    try {
        await client.login(config.discord.token);
    }
    catch (error) {
        logger.error('Failed to login to Discord:', error);
        process.exit(1);
    }
}
// Handle graceful shutdown
process.on('SIGINT', () => {
    logger.info('🛑 Shutting down...');
    process.exit(0);
});
process.on('SIGTERM', () => {
    logger.info('🛑 Shutting down...');
    process.exit(0);
});
main().catch((error) => {
    logger.error('Fatal error:', error);
    process.exit(1);
});
