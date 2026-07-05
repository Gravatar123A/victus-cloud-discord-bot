import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';

export interface PlaylistTrack {
    title: string;
    uri: string;
    author: string;
    duration: number; // ms
    source: string; // e.g. 'youtube', 'spotify', 'soundcloud'
}

export interface Playlist {
    name: string;
    tracks: PlaylistTrack[];
    createdAt: string;
    updatedAt: string;
}

type PlaylistStore = Record<string, Record<string, Playlist>>;

const DATA_PATH = join(process.cwd(), 'data', 'playlists.json');

async function readAllPlaylists(): Promise<PlaylistStore> {
    try {
        const raw = await readFile(DATA_PATH, 'utf8');
        return JSON.parse(raw) as PlaylistStore;
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            logger.warn('Failed to read playlists:', error);
        }
        return {};
    }
}

async function writeAllPlaylists(store: PlaylistStore): Promise<void> {
    await mkdir(dirname(DATA_PATH), { recursive: true });
    await writeFile(DATA_PATH, JSON.stringify(store, null, 2), 'utf8');
}

export class PlaylistService {
    private key(guildId: string, userId: string): string {
        return `${guildId}:${userId}`;
    }

    async getAll(guildId: string, userId: string): Promise<Playlist[]> {
        const store = await readAllPlaylists();
        const userPlaylists = store[this.key(guildId, userId)] || {};
        return Object.values(userPlaylists);
    }

    async get(guildId: string, userId: string, name: string): Promise<Playlist | null> {
        const store = await readAllPlaylists();
        const userPlaylists = store[this.key(guildId, userId)] || {};
        return userPlaylists[name.toLowerCase()] || null;
    }

    async create(guildId: string, userId: string, name: string): Promise<Playlist> {
        const store = await readAllPlaylists();
        const k = this.key(guildId, userId);
        const userPlaylists = store[k] || {};
        const nameKey = name.toLowerCase();

        if (userPlaylists[nameKey]) {
            throw new Error(`Playlist "${name}" already exists.`);
        }

        const now = new Date().toISOString();
        const playlist: Playlist = {
            name,
            tracks: [],
            createdAt: now,
            updatedAt: now,
        };

        userPlaylists[nameKey] = playlist;
        store[k] = userPlaylists;
        await writeAllPlaylists(store);
        return playlist;
    }

    async delete(guildId: string, userId: string, name: string): Promise<boolean> {
        const store = await readAllPlaylists();
        const k = this.key(guildId, userId);
        const userPlaylists = store[k] || {};
        const nameKey = name.toLowerCase();

        if (!userPlaylists[nameKey]) return false;

        delete userPlaylists[nameKey];
        store[k] = userPlaylists;
        await writeAllPlaylists(store);
        return true;
    }

    async rename(guildId: string, userId: string, oldName: string, newName: string): Promise<Playlist> {
        const store = await readAllPlaylists();
        const k = this.key(guildId, userId);
        const userPlaylists = store[k] || {};
        const oldKey = oldName.toLowerCase();
        const newKey = newName.toLowerCase();

        const playlist = userPlaylists[oldKey];
        if (!playlist) {
            throw new Error(`Playlist "${oldName}" not found.`);
        }

        if (oldKey !== newKey && userPlaylists[newKey]) {
            throw new Error(`Playlist "${newName}" already exists.`);
        }

        delete userPlaylists[oldKey];
        playlist.name = newName;
        playlist.updatedAt = new Date().toISOString();
        userPlaylists[newKey] = playlist;
        store[k] = userPlaylists;
        await writeAllPlaylists(store);
        return playlist;
    }

    async addTrack(guildId: string, userId: string, playlistName: string, track: PlaylistTrack): Promise<Playlist> {
        const store = await readAllPlaylists();
        const k = this.key(guildId, userId);
        const userPlaylists = store[k] || {};
        const nameKey = playlistName.toLowerCase();

        const playlist = userPlaylists[nameKey];
        if (!playlist) {
            throw new Error(`Playlist "${playlistName}" not found.`);
        }

        playlist.tracks.push(track);
        playlist.updatedAt = new Date().toISOString();
        userPlaylists[nameKey] = playlist;
        store[k] = userPlaylists;
        await writeAllPlaylists(store);
        return playlist;
    }

    async removeTrack(guildId: string, userId: string, playlistName: string, index: number): Promise<Playlist> {
        const store = await readAllPlaylists();
        const k = this.key(guildId, userId);
        const userPlaylists = store[k] || {};
        const nameKey = playlistName.toLowerCase();

        const playlist = userPlaylists[nameKey];
        if (!playlist) {
            throw new Error(`Playlist "${playlistName}" not found.`);
        }

        if (index < 0 || index >= playlist.tracks.length) {
            throw new Error(`Track index ${index} is out of range (0-${playlist.tracks.length - 1}).`);
        }

        playlist.tracks.splice(index, 1);
        playlist.updatedAt = new Date().toISOString();
        userPlaylists[nameKey] = playlist;
        store[k] = userPlaylists;
        await writeAllPlaylists(store);
        return playlist;
    }
}

export const playlistService = new PlaylistService();
