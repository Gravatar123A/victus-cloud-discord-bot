import { supabase } from './supabase.js';
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

export class PlaylistService {
    async getAll(guildId: string, userId: string): Promise<Playlist[]> {
        try {
            const embed = await supabase.getCustomEmbed(guildId, `_playlist_${userId}`);
            if (!embed?.description) return [];
            const userPlaylists = JSON.parse(embed.description) as Record<string, Playlist>;
            return Object.values(userPlaylists);
        } catch (error) {
            logger.error(`Failed to get playlists for user ${userId} in guild ${guildId}:`, error);
            return [];
        }
    }

    async get(guildId: string, userId: string, name: string): Promise<Playlist | null> {
        try {
            const embed = await supabase.getCustomEmbed(guildId, `_playlist_${userId}`);
            if (!embed?.description) return null;
            const userPlaylists = JSON.parse(embed.description) as Record<string, Playlist>;
            return userPlaylists[name.toLowerCase()] || null;
        } catch (error) {
            logger.error(`Failed to get playlist ${name} for user ${userId} in guild ${guildId}:`, error);
            return null;
        }
    }

    async create(guildId: string, userId: string, name: string): Promise<Playlist> {
        const embed = await supabase.getCustomEmbed(guildId, `_playlist_${userId}`);
        let userPlaylists: Record<string, Playlist> = {};
        if (embed?.description) {
            try {
                userPlaylists = JSON.parse(embed.description);
            } catch {}
        }
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
        try {
            await supabase.saveCustomEmbed(guildId, `_playlist_${userId}`, {
                description: JSON.stringify(userPlaylists)
            });
        } catch (error) {
            logger.error(`Failed to save playlist creation for user ${userId} in guild ${guildId}:`, error);
        }
        return playlist;
    }

    async delete(guildId: string, userId: string, name: string): Promise<boolean> {
        const embed = await supabase.getCustomEmbed(guildId, `_playlist_${userId}`);
        if (!embed?.description) return false;
        let userPlaylists: Record<string, Playlist> = {};
        try {
            userPlaylists = JSON.parse(embed.description);
        } catch {
            return false;
        }
        const nameKey = name.toLowerCase();

        if (!userPlaylists[nameKey]) return false;

        delete userPlaylists[nameKey];
        try {
            await supabase.saveCustomEmbed(guildId, `_playlist_${userId}`, {
                description: JSON.stringify(userPlaylists)
            });
        } catch (error) {
            logger.error(`Failed to save playlist deletion for user ${userId} in guild ${guildId}:`, error);
        }
        return true;
    }

    async rename(guildId: string, userId: string, oldName: string, newName: string): Promise<Playlist> {
        const embed = await supabase.getCustomEmbed(guildId, `_playlist_${userId}`);
        if (!embed?.description) {
            throw new Error(`Playlist "${oldName}" not found.`);
        }
        let userPlaylists: Record<string, Playlist> = {};
        try {
            userPlaylists = JSON.parse(embed.description);
        } catch {
            throw new Error(`Playlist "${oldName}" not found.`);
        }
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
        try {
            await supabase.saveCustomEmbed(guildId, `_playlist_${userId}`, {
                description: JSON.stringify(userPlaylists)
            });
        } catch (error) {
            logger.error(`Failed to save playlist rename for user ${userId} in guild ${guildId}:`, error);
        }
        return playlist;
    }

    async addTrack(guildId: string, userId: string, playlistName: string, track: PlaylistTrack): Promise<Playlist> {
        const embed = await supabase.getCustomEmbed(guildId, `_playlist_${userId}`);
        if (!embed?.description) {
            throw new Error(`Playlist "${playlistName}" not found.`);
        }
        let userPlaylists: Record<string, Playlist> = {};
        try {
            userPlaylists = JSON.parse(embed.description);
        } catch {
            throw new Error(`Playlist "${playlistName}" not found.`);
        }
        const nameKey = playlistName.toLowerCase();

        const playlist = userPlaylists[nameKey];
        if (!playlist) {
            throw new Error(`Playlist "${playlistName}" not found.`);
        }

        playlist.tracks.push(track);
        playlist.updatedAt = new Date().toISOString();
        userPlaylists[nameKey] = playlist;
        try {
            await supabase.saveCustomEmbed(guildId, `_playlist_${userId}`, {
                description: JSON.stringify(userPlaylists)
            });
        } catch (error) {
            logger.error(`Failed to save playlist track add for user ${userId} in guild ${guildId}:`, error);
        }
        return playlist;
    }

    async removeTrack(guildId: string, userId: string, playlistName: string, index: number): Promise<Playlist> {
        const embed = await supabase.getCustomEmbed(guildId, `_playlist_${userId}`);
        if (!embed?.description) {
            throw new Error(`Playlist "${playlistName}" not found.`);
        }
        let userPlaylists: Record<string, Playlist> = {};
        try {
            userPlaylists = JSON.parse(embed.description);
        } catch {
            throw new Error(`Playlist "${playlistName}" not found.`);
        }
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
        try {
            await supabase.saveCustomEmbed(guildId, `_playlist_${userId}`, {
                description: JSON.stringify(userPlaylists)
            });
        } catch (error) {
            logger.error(`Failed to save playlist track remove for user ${userId} in guild ${guildId}:`, error);
        }
        return playlist;
    }
}

export const playlistService = new PlaylistService();
