import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';
const LOCAL_STORE_PATH = join(process.cwd(), 'data', 'published-resources.json');
class PublishedResourcesStore {
    listings = new Map();
    loaded = false;
    async ensureLoaded() {
        if (this.loaded)
            return;
        try {
            const raw = await readFile(LOCAL_STORE_PATH, 'utf8');
            const data = JSON.parse(raw);
            for (const item of data) {
                if (!item.likes || !Array.isArray(item.likes)) {
                    item.likes = [];
                }
                this.listings.set(item.id, item);
            }
        }
        catch (error) {
            if (error?.code !== 'ENOENT') {
                logger.warn('Failed to read published-resources.json:', error);
            }
        }
        this.loaded = true;
    }
    async persist() {
        try {
            await mkdir(dirname(LOCAL_STORE_PATH), { recursive: true });
            const list = Array.from(this.listings.values());
            await writeFile(LOCAL_STORE_PATH, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
        }
        catch (error) {
            logger.error('Failed to write published-resources.json:', error);
        }
    }
    generateListingId() {
        return `res_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    async addListing(data) {
        await this.ensureLoaded();
        const id = data.id || this.generateListingId();
        const listing = {
            ...data,
            id,
            createdAt: data.createdAt || Date.now(),
            applied: data.applied ?? false,
            likes: Array.isArray(data.likes) ? data.likes : [],
        };
        this.listings.set(id, listing);
        await this.persist();
        return listing;
    }
    async getUserListings(userId, guildId) {
        await this.ensureLoaded();
        const results = [];
        for (const item of this.listings.values()) {
            if (item.userId === userId && item.guildId === guildId) {
                results.push(item);
            }
        }
        return results.sort((a, b) => b.createdAt - a.createdAt);
    }
    async getListing(id) {
        await this.ensureLoaded();
        return this.listings.get(id);
    }
    async getListingByThreadId(threadId) {
        await this.ensureLoaded();
        for (const item of this.listings.values()) {
            if (item.threadId === threadId) {
                return item;
            }
        }
        return undefined;
    }
    async hasUserLiked(listingId, userId) {
        await this.ensureLoaded();
        const item = this.listings.get(listingId);
        if (!item || !Array.isArray(item.likes))
            return false;
        return item.likes.includes(userId);
    }
    async addLike(listingId, userId) {
        await this.ensureLoaded();
        const item = this.listings.get(listingId);
        if (!item) {
            return { success: false, likesCount: 0, error: 'not_found' };
        }
        if (!Array.isArray(item.likes)) {
            item.likes = [];
        }
        if (item.likes.includes(userId)) {
            return { success: false, likesCount: item.likes.length, error: 'already_liked' };
        }
        item.likes.push(userId);
        this.listings.set(listingId, item);
        await this.persist();
        return { success: true, likesCount: item.likes.length };
    }
    async markApplied(id, approved = true) {
        await this.ensureLoaded();
        const item = this.listings.get(id);
        if (!item)
            return false;
        item.applied = true;
        item.appliedAt = Date.now();
        item.approved = approved;
        this.listings.set(id, item);
        await this.persist();
        return true;
    }
}
export const publishedResourcesStore = new PublishedResourcesStore();
