/**
 * Clear all Discord commands (both global and guild-specific)
 * Run with: npx tsx src/clear-commands.ts
 */

import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';

async function clearCommands() {
    const rest = new REST({ version: '10' }).setToken(config.discord.token);

    try {
        logger.info('🗑️ Clearing all application (/) commands...');

        // Clear global commands
        logger.info('  → Clearing global commands...');
        await rest.put(
            Routes.applicationCommands(config.discord.clientId),
            { body: [] }
        );
        logger.info('  ✅ Global commands cleared');

        // Clear guild commands if guild ID is set
        if (config.discord.guildId) {
            logger.info(`  → Clearing guild commands for ${config.discord.guildId}...`);
            await rest.put(
                Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
                { body: [] }
            );
            logger.info('  ✅ Guild commands cleared');
        }

        logger.info('✅ All commands cleared! Run "npm run register" to re-register commands.');
    } catch (error) {
        logger.error('Failed to clear commands:', error);
        process.exit(1);
    }
}

clearCommands();
