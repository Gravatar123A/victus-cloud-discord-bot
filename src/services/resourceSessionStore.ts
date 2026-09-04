export interface ResourceSession {
    id: string;
    userId: string;
    guildId: string;
    mode: 'link' | 'manual';
    title: string;
    description: string;
    category: string;
    tags: string[];
    links: string[];
    images: string[];
    author?: string;
    sourceUrl: string;
    updatedAt: number;
}

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes session timeout

class ResourceSessionStore {
    private sessions: Map<string, ResourceSession> = new Map();

    private getSessionKey(userId: string, guildId: string): string {
        return `${guildId}:${userId}`;
    }

    public getSession(userId: string, guildId: string): ResourceSession | undefined {
        const key = this.getSessionKey(userId, guildId);
        const session = this.sessions.get(key);
        if (!session) return undefined;

        // Check if expired
        if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
            this.sessions.delete(key);
            return undefined;
        }

        return session;
    }

    public createSession(
        userId: string,
        guildId: string,
        mode: 'link' | 'manual',
        initialData?: Partial<ResourceSession>
    ): ResourceSession {
        const key = this.getSessionKey(userId, guildId);
        const session: ResourceSession = {
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

    public updateSession(
        userId: string,
        guildId: string,
        updates: Partial<ResourceSession>
    ): ResourceSession | undefined {
        const session = this.getSession(userId, guildId);
        if (!session) return undefined;

        const updatedSession: ResourceSession = {
            ...session,
            ...updates,
            updatedAt: Date.now(),
        };

        this.sessions.set(session.id, updatedSession);
        return updatedSession;
    }

    public deleteSession(userId: string, guildId: string): boolean {
        const key = this.getSessionKey(userId, guildId);
        return this.sessions.delete(key);
    }

    // Clean up stale sessions
    public cleanupStaleSessions(): void {
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
