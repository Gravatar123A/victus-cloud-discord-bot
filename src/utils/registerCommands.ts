import { REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { getCommandData } from '../commands/index.js';
import { logger } from './logger.js';

export async function registerApplicationCommands(source = 'startup'): Promise<void> {
    const rest = new REST({ version: '10' }).setToken(config.discord.token);
    const commandData = getCommandData();

    logger.info(`Syncing ${commandData.length} Discord slash commands (${source})...`);

    if (config.discord.guildId) {
        await rest.put(
            Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
            { body: commandData }
        );
        logger.info(`Slash commands synced to guild ${config.discord.guildId}`);
        return;
    }

    await rest.put(
        Routes.applicationCommands(config.discord.clientId),
        { body: commandData }
    );
    logger.info('Slash commands synced globally. Global propagation can take up to 1 hour.');
}
