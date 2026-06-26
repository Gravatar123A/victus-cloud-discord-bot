import type { VoiceState, VoiceBasedChannel } from 'discord.js';
import type { Event } from '../types/index.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { awardVoiceXp } from '../services/activityXp.js';

// In-memory voice XP tracking. One ticking timer per (guild, user) session that
// awards XP each minute while the member is "actively" in voice: not self-muted,
// not self-deafened, not server-muted/deafened, and not alone in the channel.
// Timers are cleared on leave/disconnect/move so nothing leaks.

interface VoiceSession {
    timer: NodeJS.Timeout;
}

const sessions = new Map<string, VoiceSession>();

function sessionKey(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
}

// A member counts as "active" if they aren't muted/deafened (self or server)
// and there is at least one other non-bot human in the channel.
function isActive(state: VoiceState): boolean {
    if (!state.channel) return false;
    if (state.selfMute || state.selfDeaf || state.mute || state.deaf) return false;
    return hasOtherHumans(state.channel, state.id);
}

function hasOtherHumans(channel: VoiceBasedChannel, selfUserId: string): boolean {
    let others = 0;
    for (const member of channel.members.values()) {
        if (member.user.bot) continue;
        if (member.id === selfUserId) continue;
        others++;
    }
    return others > 0;
}

function stopSession(guildId: string, userId: string): void {
    const key = sessionKey(guildId, userId);
    const session = sessions.get(key);
    if (session) {
        clearInterval(session.timer);
        sessions.delete(key);
    }
}

function startSession(guildId: string, userId: string): void {
    const key = sessionKey(guildId, userId);
    if (sessions.has(key)) return; // already ticking

    const timer = setInterval(() => {
        // Re-resolve live state each tick; only award when still active.
        const guild = currentGuild(guildId);
        const voice = guild?.voiceStates.cache.get(userId);
        if (!voice || !voice.channel) {
            stopSession(guildId, userId);
            return;
        }
        if (!isActive(voice)) return; // paused (muted/deafened/alone) — keep ticking, just don't award
        void awardVoiceXp(userId, 1).catch(() => undefined);
    }, 60_000);

    // Don't keep the process alive solely for this timer.
    if (typeof timer.unref === 'function') timer.unref();
    sessions.set(key, { timer });
}

// Resolve the guild from any tracked voice state for cleanup ticks. We capture
// the client off the first VoiceState we see and reuse it.
let clientRef: import('discord.js').Client | null = null;
function currentGuild(guildId: string) {
    return clientRef?.guilds.cache.get(guildId) ?? null;
}

export const voiceStateUpdateEvent: Event = {
    name: 'voiceStateUpdate',
    async execute(oldState: VoiceState, newState: VoiceState) {
        if (!clientRef) clientRef = newState.client;

        // XP disabled — make sure nothing is running and bail.
        if (config.economy.xpPerVoiceMinute <= 0) {
            if (newState.guild) stopSession(newState.guild.id, newState.id);
            return;
        }

        const member = newState.member ?? oldState.member;
        if (member?.user.bot) return;

        const guildId = newState.guild?.id ?? oldState.guild?.id;
        const userId = newState.id;
        if (!guildId) return;

        const inVoiceNow = !!newState.channel;

        try {
            if (inVoiceNow) {
                // Joined or moved/updated while in a voice channel — ensure a
                // ticking session exists (the tick itself gates on activity).
                startSession(guildId, userId);
            } else {
                // Left voice entirely — stop and clean up the timer.
                stopSession(guildId, userId);
            }
        } catch (error) {
            logger.warn('voiceStateUpdate handling failed:', error);
        }
    },
};
