import { logger } from './utils/logger.js';
import { registerApplicationCommands } from './utils/registerCommands.js';

async function deployCommands() {
    try {
        await registerApplicationCommands('manual register script');
    } catch (error) {
        logger.error('Failed to deploy commands:', error);
        process.exit(1);
    }
}

deployCommands();
