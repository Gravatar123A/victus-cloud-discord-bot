/**
 * Temporarily "summoned" channels: while a channel is summoned, the Victus AI
 * answers every (non-bot) message there — used by staff via /summon so the AI
 * can field general questions inside a ticket or any channel. In-memory with a
 * TTL; a summon naturally expires, or staff can /summon dismiss early.
 */

// channelId -> expiry timestamp (ms since epoch)
const summoned = new Map<string, number>();

export const SUMMON_DEFAULT_MINUTES = 60;
export const SUMMON_MIN_MINUTES = 5;
export const SUMMON_MAX_MINUTES = 720; // 12 hours

/** Summon the AI to a channel for `durationMs`. Returns the expiry timestamp. */
export function summonChannel(channelId: string, durationMs: number): number {
    const expiresAt = Date.now() + durationMs;
    summoned.set(channelId, expiresAt);
    return expiresAt;
}

/** Stop the AI answering everyone in a channel. Returns true if it was active. */
export function dismissChannel(channelId: string): boolean {
    return summoned.delete(channelId);
}

/** Whether the channel is currently summoned (lazily prunes expired entries). */
export function isChannelSummoned(channelId: string): boolean {
    const expiresAt = summoned.get(channelId);
    if (!expiresAt) return false;
    if (expiresAt <= Date.now()) {
        summoned.delete(channelId);
        return false;
    }
    return true;
}

/** Expiry timestamp (ms) if summoned, otherwise null. */
export function getSummonExpiry(channelId: string): number | null {
    return isChannelSummoned(channelId) ? summoned.get(channelId) ?? null : null;
}
