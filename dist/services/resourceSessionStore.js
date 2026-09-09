const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes session timeout
class ResourceSessionStore {
    sessions = new Map();
    getSessionKey(userId, guildId) {
        return `${guildId}:${userId}`;
    }
    getSession(userId, guildId) {
        const key = this.getSessionKey(userId, guildId);
        const session = this.sessions.get(key);
        if (!session)
            return undefined;
        // Check if expired
        if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
            this.sessions.delete(key);
            return undefined;
        }
        return session;
    }
    createSession(userId, guildId, mode, initialData) {
        const key = this.getSessionKey(userId, guildId);
        const session = {
            id: key,
            userId,
            guildId,
            mode,
            title: initialData?.title || '',
            description: initialData?.description || '',
            category: initialData?.category || 'Other',
            tags: initialData?.tags || [],
            links: initialData?.links || [],
            images: initialData?.images || [],
            author: initialData?.author || '',
            sourceUrl: initialData?.sourceUrl || '',
            updatedAt: Date.now(),
        };
        this.sessions.set(key, session);
        return session;
    }
    updateSession(userId, guildId, updates) {
        const session = this.getSession(userId, guildId);
        if (!session)
            return undefined;
        const updatedSession = {
            ...session,
            ...updates,
            updatedAt: Date.now(),
        };
        this.sessions.set(session.id, updatedSession);
        return updatedSession;
    }
    deleteSession(userId, guildId) {
        const key = this.getSessionKey(userId, guildId);
        return this.sessions.delete(key);
    }
    // Clean up stale sessions
    cleanupStaleSessions() {
        const now = Date.now();
        for (const [key, session] of this.sessions.entries()) {
            if (now - session.updatedAt > SESSION_TTL_MS) {
                this.sessions.delete(key);
            }
        }
    }
}
export const resourceSessionStore = new ResourceSessionStore();
// Periodically clean up stale sessions every 5 minutes
setInterval(() => {
    resourceSessionStore.cleanupStaleSessions();
}, 5 * 60 * 1000);
