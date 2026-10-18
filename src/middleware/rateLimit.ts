import { Collection, ChatInputCommandInteraction } from 'discord.js';

// Store cooldowns: Map<commandName, Map<userId, timestamp>>
const cooldowns = new Collection<string, Collection<string, number>>();
const burstWindows = new Map<string, { startedAt: number; count: number }>();

/** Bound total bot interactions from a user, including commands without a cooldown. */
export function checkBurstLimit(userId: string, limit = 10, windowMs = 10_000): boolean {
    const now = Date.now();
    const current = burstWindows.get(userId);
    if (!current || now - current.startedAt >= windowMs) {
        burstWindows.set(userId, { startedAt: now, count: 1 });
        if (burstWindows.size > 10_000) {
            for (const [key, value] of burstWindows) {
                if (now - value.startedAt >= windowMs) burstWindows.delete(key);
            }
        }
        return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
}

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
    setTimeout(() => {
        if (timestamps.get(interaction.user.id) === now) timestamps.delete(interaction.user.id);
    }, cooldownAmount);

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
