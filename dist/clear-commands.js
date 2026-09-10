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
        await rest.put(Routes.applicationCommands(config.discord.clientId), { body: [] });
        logger.info('  ✅ Global commands cleared');
        // Clear guild commands for all configured guilds (primary + support)
        const instantGuilds = [config.discord.guildId, config.bot.supportGuildId].filter((g, i, arr) => !!g && arr.indexOf(g) === i);
        for (const guildId of instantGuilds) {
            logger.info(`  → Clearing guild commands for ${guildId}...`);
            await rest.put(Routes.applicationGuildCommands(config.discord.clientId, guildId), { body: [] });
            logger.info(`  ✅ Guild commands cleared for ${guildId}`);
        }
        logger.info('✅ All commands cleared! Run "npm run register" to re-register commands.');
    }
    catch (error) {
        logger.error('Failed to clear commands:', error);
        process.exit(1);
    }
}
clearCommands();
