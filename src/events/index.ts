import { Client } from 'discord.js';
import { logger } from '../utils/logger.js';
import type { Event } from '../types/index.js';

// Import events
import { readyEvent } from './ready.js';
import { interactionCreateEvent } from './interactionCreate.js';

const events: Event[] = [
    readyEvent,
    interactionCreateEvent,
];

/**
 * Load events into the client
 */
export async function loadEvents(client: Client): Promise<void> {
    for (const event of events) {
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args));
        } else {
            client.on(event.name, (...args) => event.execute(...args));
        }
        logger.debug(`Loaded event: ${event.name}`);
    }
}
