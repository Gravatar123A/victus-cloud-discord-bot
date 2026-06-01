import { Collection, ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../utils/logger.js';

// Store cooldowns: Map<commandName, Map<userId, timestamp>>
const cooldowns = new Collection<string, Collection<string, number>>();

/**
 * Check and apply command cooldown
 * Returns remaining seconds if on cooldown, 0 if not
 */
export function checkCooldown(
    interaction: ChatInputCommandInteraction,
    commandName: string,
    cooldownSeconds: number
): number {
    if (!cooldowns.has(commandName)) {
        cooldowns.set(commandName, new Collection());
    }

    const now = Date.now();
    const timestamps = cooldowns.get(commandName)!;
    const cooldownAmount = cooldownSeconds * 1000;

    if (timestamps.has(interaction.user.id)) {
        const expirationTime = timestamps.get(interaction.user.id)! + cooldownAmount;

        if (now < expirationTime) {
            const remainingSeconds = Math.ceil((expirationTime - now) / 1000);
            return remainingSeconds;
        }
    }

    timestamps.set(interaction.user.id, now);

    // Clean up expired cooldowns after the cooldown period
    setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

    return 0;
}

/**
 * Clear a user's cooldown for a command
 */
export function clearCooldown(userId: string, commandName: string): void {
    const timestamps = cooldowns.get(commandName);
    if (timestamps) {
        timestamps.delete(userId);
    }
}

/**
 * Clear all cooldowns for a user
 */
export function clearAllCooldowns(userId: string): void {
    for (const [, timestamps] of cooldowns) {
        timestamps.delete(userId);
    }
}
