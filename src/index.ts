import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { loadCommands, commands } from './commands/index.js';
import { loadEvents } from './events/index.js';
import type { Command, ButtonHandler, SelectMenuHandler, ModalHandler } from './types/index.js';

// Extend Discord.js Client type to include our custom properties
declare module 'discord.js' {
    interface Client {
        commands: Collection<string, Command>;
        buttons: Collection<string, ButtonHandler>;
        selectMenus: Collection<string, SelectMenuHandler>;
        modals: Collection<string, ModalHandler>;
    }
}

async function main() {
    logger.info('🚀 Starting Victus Cloud Discord Bot...');

    // Create client with required intents
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMessageReactions,
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.MessageContent,
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

    // Load commands and events
    await loadCommands(client);
    await loadEvents(client);

    logger.info(`📦 Loaded ${client.commands.size} commands`);

    // Login
    try {
        await client.login(config.discord.token);
    } catch (error) {
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










