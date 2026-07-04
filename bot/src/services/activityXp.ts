// Awards XP for Discord activity (messages + voice time) to linked Victus Cloud
// accounts. XP is written to profiles.total_xp via supabase.grantXp(), the same
// mechanism the website uses for upload XP — this never touches Coins.

import { config } from '../config.js';
import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';

// Cache the discord -> user_id resolution so we don't hit Supabase on every
// single message. null means "checked, not linked".
const LINK_CACHE_TTL_MS = 5 * 60_000;
const linkCache = new Map<string, { userId: string | null; expiresAt: number }>();

async function resolveLinkedUserId(discordId: string): Promise<string | null> {
    const cached = linkCache.get(discordId);
    if (cached && cached.expiresAt > Date.now()) return cached.userId;
    const linked = await supabase.getLinkedAccount(discordId).catch(() => null);
    const userId = linked?.user_id ?? null;
    linkCache.set(discordId, { userId, expiresAt: Date.now() + LINK_CACHE_TTL_MS });
    return userId;
}

// Per-user cooldown gate for message XP.
const lastMessageXpAt = new Map<string, number>();

/**
 * Award message XP to a linked user, respecting a per-user cooldown. Safe to
 * call on every eligible guild message — bails fast when on cooldown or unlinked.
 */
export async function awardMessageXp(discordId: string): Promise<void> {
    const amount = config.economy.xpPerMessage;
    if (amount <= 0) return;

    const cooldownMs = Math.max(0, config.economy.messageXpCooldownSec) * 1000;
    const now = Date.now();
    const last = lastMessageXpAt.get(discordId) || 0;
    if (cooldownMs > 0 && now - last < cooldownMs) return;
    // Reserve the slot before the async lookup so concurrent messages can't
    // double-award during the round-trip.
    lastMessageXpAt.set(discordId, now);

    const userId = await resolveLinkedUserId(discordId);
    if (!userId) return;

    try {
        await supabase.grantXp(userId, amount, 'discord_message', { discord_id: discordId });
    } catch (error) {
        logger.warn(`awardMessageXp failed for ${discordId}:`, error);
    }
}

/**
 * Award voice XP for whole minutes spent active in voice. Returns silently when
 * unlinked or when XP is disabled.
 */
export async function awardVoiceXp(discordId: string, minutes: number): Promise<void> {
    const perMinute = config.economy.xpPerVoiceMinute;
    if (perMinute <= 0 || minutes <= 0) return;

    const userId = await resolveLinkedUserId(discordId);
    if (!userId) return;

    const amount = perMinute * minutes;
    try {
        await supabase.grantXp(userId, amount, 'discord_voice', { discord_id: discordId, minutes });
    } catch (error) {
        logger.warn(`awardVoiceXp failed for ${discordId}:`, error);
    }
}
