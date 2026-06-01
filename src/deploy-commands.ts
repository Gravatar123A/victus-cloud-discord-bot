import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { getCommandData } from './commands/index.js';
import { logger } from './utils/logger.js';

async function deployCommands() {
    const rest = new REST({ version: '10' }).setToken(config.discord.token);

    try {
        logger.info('🔄 Started refreshing application (/) commands...');

        const commandData = getCommandData();
        logger.info(`📦 Deploying ${commandData.length} commands...`);

        if (config.discord.guildId) {
            // Deploy to specific guild (faster, for development)
            await rest.put(
                Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
                { body: commandData }
            );
            logger.info(`✅ Successfully deployed ${commandData.length} commands to guild ${config.discord.guildId}`);
        } else {
            // Deploy globally (takes up to 1 hour to propagate)
            await rest.put(
                Routes.applicationCommands(config.discord.clientId),
                { body: commandData }
            );
            logger.info(`✅ Successfully deployed ${commandData.length} commands globally`);
        }
    } catch (error) {
        logger.error('Failed to deploy commands:', error);
        process.exit(1);
    }
}

deployCommands();
