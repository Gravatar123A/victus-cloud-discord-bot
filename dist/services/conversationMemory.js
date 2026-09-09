import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import { supabase as supabaseClient } from './supabase.js';
const MAX_TURNS_PER_USER = 40; // 20 exchanges
const MAX_USERS_IN_MEM = 1000;
const FILE_DIR = path.resolve(process.cwd(), 'data', 'memory');
const SUPABASE_LIMIT = 8; // how many turns we return to LLM
class ConversationMemoryService {
    mem = new Map();
    loading = new Map();
    dirReady = false;
    async ensureDir() {
        if (this.dirReady)
            return;
        try {
            await fs.mkdir(FILE_DIR, { recursive: true });
            this.dirReady = true;
        }
        catch (e) {
            logger.warn('memory ensureDir failed:', e.message);
        }
    }
    filePath(discordId) {
        // sanitize discordId to avoid path traversal
        const safe = String(discordId).replace(/[^0-9a-zA-Z_-]/g, '_');
        return path.join(FILE_DIR, `${safe}.json`);
    }
    evictIfNeeded() {
        if (this.mem.size <= MAX_USERS_IN_MEM)
            return;
        // delete oldest inserted (Map preserves insertion order)
        const firstKey = this.mem.keys().next().value;
        if (firstKey)
            this.mem.delete(firstKey);
    }
    async getHistory(discordId, limit = SUPABASE_LIMIT) {
        if (!discordId)
            return [];
        // mem hit
        const cached = this.mem.get(discordId);
        if (cached) {
            const slice = cached.slice(-limit * 2);
            return slice.map(t => ({ role: t.role, content: t.content }));
        }
        // dedup concurrent loads
        if (this.loading.has(discordId)) {
            const turns = await this.loading.get(discordId);
            const slice = turns.slice(-limit * 2);
            return slice.map(t => ({ role: t.role, content: t.content }));
        }
        const p = this.load(discordId);
        this.loading.set(discordId, p);
        try {
            const turns = await p;
            this.mem.set(discordId, turns);
            this.evictIfNeeded();
            const slice = turns.slice(-limit * 2);
            return slice.map(t => ({ role: t.role, content: t.content }));
        }
        finally {
            this.loading.delete(discordId);
        }
    }
    async load(discordId) {
        // 1) try file
        await this.ensureDir();
        try {
            const raw = await fs.readFile(this.filePath(discordId), 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                // legacy: array directly
                return parsed.filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string').slice(-MAX_TURNS_PER_USER);
            }
            if (Array.isArray(parsed.turns)) {
                return parsed.turns.filter((t) => t && (t.role === 'user' || t.role === 'assistant')).slice(-MAX_TURNS_PER_USER);
            }
        }
        catch { /* no file or corrupt */ }
        // 2) try supabase (best-effort)
        try {
            const h = await supabaseClient.getConversationHistory?.(discordId, 20);
            if (Array.isArray(h) && h.length) {
                return h.map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000), ts: Date.now() }));
            }
        }
        catch { /* ignore */ }
        return [];
    }
    async addTurn(discordId, role, content) {
        if (!discordId || !content)
            return;
        const turn = { role, content: String(content).slice(0, 2000), ts: Date.now() };
        let turns = this.mem.get(discordId);
        if (!turns) {
            turns = await this.load(discordId);
        }
        turns.push(turn);
        if (turns.length > MAX_TURNS_PER_USER)
            turns.splice(0, turns.length - MAX_TURNS_PER_USER);
        this.mem.set(discordId, turns);
        this.evictIfNeeded();
        // async persist: file + supabase (fire-and-forget)
        this.persistFile(discordId, turns).catch(() => { });
        // also try supabase best-effort
        supabaseClient.updateConversationHistory?.(discordId, role, content)?.catch?.(() => { });
    }
    async addExchange(discordId, userPrompt, assistantReply) {
        await this.addTurn(discordId, 'user', userPrompt);
        await this.addTurn(discordId, 'assistant', assistantReply);
    }
    async persistFile(discordId, turns) {
        await this.ensureDir();
        const fp = this.filePath(discordId);
        const tmp = `${fp}.tmp`;
        const data = JSON.stringify({ v: 1, discordId, updatedAt: new Date().toISOString(), turns }, null, 2);
        await fs.writeFile(tmp, data, 'utf-8');
        await fs.rename(tmp, fp);
    }
    async clear(discordId) {
        this.mem.delete(discordId);
        try {
            await fs.unlink(this.filePath(discordId));
        }
        catch { /* ignore */ }
        // also clear supabase best-effort (overwrite with empty)
        try {
            const cur = this.mem.get(discordId) || [];
            if (!cur.length) {
                // supabase clear via empty history not yet implemented, just ensure mem cleared
            }
        }
        catch { /* ignore */ }
    }
}
export const conversationMemory = new ConversationMemoryService();
