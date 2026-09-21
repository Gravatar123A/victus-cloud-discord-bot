import { logger } from '../utils/logger.js';
const SESSION_TTL_MS = 20 * 60 * 1000; // 20 minutes of conversation inactivity
const MAX_TURNS_PER_SESSION = 10; // 5 user turns + 5 assistant turns
class AiConversationMemoryService {
    sessions = new Map();
    cleanupTimer = null;
    constructor() {
        // Periodically purge expired conversation memories every 5 minutes
        this.cleanupTimer = setInterval(() => {
            this.purgeExpired();
        }, 5 * 60 * 1000);
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }
    /**
     * Build standard session identifier based on Discord context.
     */
    getSessionId(channelId, userId, isDm = false, isThread = false) {
        if (isDm)
            return `dm:${userId}`;
        if (isThread)
            return `thread:${channelId}:${userId}`;
        return `channel:${channelId}:${userId}`;
    }
    /**
     * Retrieve recent conversation history formatted for LLM ChatCompletion.
     */
    getHistory(sessionId) {
        const turns = this.sessions.get(sessionId);
        if (!turns || turns.length === 0)
            return [];
        const now = Date.now();
        const validTurns = turns.filter((turn) => now - turn.timestamp < SESSION_TTL_MS);
        if (validTurns.length === 0) {
            this.sessions.delete(sessionId);
            return [];
        }
        return validTurns.map((turn) => ({
            role: turn.role,
            content: turn.content,
        }));
    }
    /**
     * Append a conversation turn (user prompt or assistant answer).
     */
    addTurn(sessionId, role, content) {
        const clean = content.trim();
        if (!clean)
            return;
        let turns = this.sessions.get(sessionId);
        if (!turns) {
            turns = [];
            this.sessions.set(sessionId, turns);
        }
        turns.push({
            role,
            content: clean,
            timestamp: Date.now(),
        });
        // Maintain sliding window of recent turns
        if (turns.length > MAX_TURNS_PER_SESSION) {
            turns.splice(0, turns.length - MAX_TURNS_PER_SESSION);
        }
    }
    /**
     * Clear conversation memory for a session (e.g. user resets chat).
     */
    clearSession(sessionId) {
        this.sessions.delete(sessionId);
    }
    /**
     * Prune expired sessions from memory.
     */
    purgeExpired() {
        const now = Date.now();
        let purgedCount = 0;
        for (const [sessionId, turns] of this.sessions.entries()) {
            const lastTurn = turns[turns.length - 1];
            if (!lastTurn || now - lastTurn.timestamp >= SESSION_TTL_MS) {
                this.sessions.delete(sessionId);
                purgedCount++;
            }
        }
        if (purgedCount > 0) {
            logger.debug(`[AiConversationMemory] Purged ${purgedCount} expired conversation session(s).`);
        }
    }
}
export const aiConversationMemory = new AiConversationMemoryService();
