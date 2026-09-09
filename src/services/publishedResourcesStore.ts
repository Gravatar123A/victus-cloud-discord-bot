import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';

export interface PublishedResourceListing {
    id: string;
    userId: string;
    guildId: string;
    title: string;
    description: string;
    category: string;
    sourceUrl?: string;
    threadUrl: string;
    threadId?: string;
    createdAt: number;
    applied?: boolean;
    appliedAt?: number;
    approved?: boolean;
    likes?: string[];
}

const LOCAL_STORE_PATH = join(process.cwd(), 'data', 'published-resources.json');

class PublishedResourcesStore {
    private listings: Map<string, PublishedResourceListing> = new Map();
    private loaded = false;

    private async ensureLoaded(): Promise<void> {
        if (this.loaded) return;
        try {
            const raw = await readFile(LOCAL_STORE_PATH, 'utf8');
            const data: PublishedResourceListing[] = JSON.parse(raw);
            for (const item of data) {
                if (!item.likes || !Array.isArray(item.likes)) {
                    item.likes = [];
                }
                this.listings.set(item.id, item);
            }
        } catch (error: any) {
            if (error?.code !== 'ENOENT') {
                logger.warn('Failed to read published-resources.json:', error);
            }
        }
        this.loaded = true;
    }

    private async persist(): Promise<void> {
        try {
            await mkdir(dirname(LOCAL_STORE_PATH), { recursive: true });
            const list = Array.from(this.listings.values());
            await writeFile(LOCAL_STORE_PATH, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
        } catch (error) {
            logger.error('Failed to write published-resources.json:', error);
        }
    }

    public generateListingId(): string {
        return `res_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }

    public async addListing(data: Omit<PublishedResourceListing, 'createdAt'> & { createdAt?: number }): Promise<PublishedResourceListing> {
        await this.ensureLoaded();
        const id = data.id || this.generateListingId();
        const listing: PublishedResourceListing = {
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

    public async getUserListings(userId: string, guildId: string): Promise<PublishedResourceListing[]> {
        await this.ensureLoaded();
        const results: PublishedResourceListing[] = [];
        for (const item of this.listings.values()) {
            if (item.userId === userId && item.guildId === guildId) {
                results.push(item);
            }
        }
        return results.sort((a, b) => b.createdAt - a.createdAt);
    }

    public async getListing(id: string): Promise<PublishedResourceListing | undefined> {
        await this.ensureLoaded();
        return this.listings.get(id);
    }

    public async getListingByThreadId(threadId: string): Promise<PublishedResourceListing | undefined> {
        await this.ensureLoaded();
        for (const item of this.listings.values()) {
            if (item.threadId === threadId) {
                return item;
            }
        }
        return undefined;
    }

    public async hasUserLiked(listingId: string, userId: string): Promise<boolean> {
        await this.ensureLoaded();
        const item = this.listings.get(listingId);
        if (!item || !Array.isArray(item.likes)) return false;
        return item.likes.includes(userId);
    }

    public async addLike(listingId: string, userId: string): Promise<{ success: boolean; likesCount: number; error?: string }> {
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

    public async markApplied(id: string, approved = true): Promise<boolean> {
        await this.ensureLoaded();
        const item = this.listings.get(id);
        if (!item) return false;

        item.applied = true;
        item.appliedAt = Date.now();
        item.approved = approved;
        this.listings.set(id, item);
        await this.persist();
        return true;
    }
}

export const publishedResourcesStore = new PublishedResourcesStore();
