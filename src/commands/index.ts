import { Client, Collection } from 'discord.js';
import type { Command } from '../types/index.js';
import { logger } from '../utils/logger.js';

// Import commands
import { linkCommand } from './link.js';
import { unlinkCommand } from './unlink.js';
import { serversCommand } from './servers.js';
import { servicesCommand } from './services.js';
import { invoicesCommand } from './invoices.js';
import { helpCommand } from './help.js';
import { adminCommand } from './admin/index.js';
import { configCommand } from './config.js';
import { userCommand } from './user.js';
import { ticketCommand } from './ticket.js';
import { preferencesCommand } from './preferences.js';
import { announceCommand } from './announce.js';
import { accountCommand } from './account.js';
import { linkPanelCommand } from './link-panel.js';
import { createAccountCommand } from './create-account.js';

// Export command collection
export const commands = new Collection<string, Command>();

// Register all commands
const allCommands: Command[] = [
    linkCommand,
    unlinkCommand,
    serversCommand,
    servicesCommand,
    invoicesCommand,
    helpCommand,
    adminCommand,
    configCommand,
    userCommand,
    ticketCommand,
    preferencesCommand,
    announceCommand,
    accountCommand,
    linkPanelCommand,
    createAccountCommand,
];

for (const command of allCommands) {
    commands.set(command.data.name, command);
}

/**
 * Load commands into the client
 */
export async function loadCommands(client: Client): Promise<void> {
    for (const [name, command] of commands) {
        client.commands.set(name, command);
        logger.debug(`Loaded command: ${name}`);
    }
}

/**
 * Get all command data for registration
 */
export function getCommandData() {
    return allCommands.map((cmd) => cmd.data.toJSON());
}
