import { Client } from 'discord.js';
import { logger } from '../utils/logger.js';
import type { Event } from '../types/index.js';

// Import events
import { readyEvent } from './ready.js';
import { interactionCreateEvent } from './interactionCreate.js';
import { messageCreateEvent } from './messageCreate.js';
import { voiceStateUpdateEvent } from './voiceStateUpdate.js';
import { guildMemberAddEvent } from './guildMemberAdd.js';
import { channelDeleteEvent } from './channelDelete.js';
import { messageUpdateEvent } from './messageUpdate.js';
import { messageDeleteEvent } from './messageDelete.js';
import { guildMemberRemoveEvent } from './guildMemberRemove.js';
import { guildBanAddEvent } from './guildBanAdd.js';
import { guildBanRemoveEvent } from './guildBanRemove.js';
import { inviteCreateEvent } from './inviteCreate.js';
import { inviteDeleteEvent } from './inviteDelete.js';

const events: Event[] = [
    readyEvent,
    interactionCreateEvent,
    messageCreateEvent,
    voiceStateUpdateEvent,
    guildMemberAddEvent,
    channelDeleteEvent,
    messageUpdateEvent,
    messageDeleteEvent,
    guildMemberRemoveEvent,
    guildBanAddEvent,
    guildBanRemoveEvent,
    inviteCreateEvent,
    inviteDeleteEvent,
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
