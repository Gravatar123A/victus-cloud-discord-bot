/**
 * Music UI for the Victus Cloud bot — Clean, professional standard Discord Embeds
 * for the Lavalink music feature (Now Playing, queue, "added" confirmations)
 * plus the select menu dropdown control row.
 */
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    EmbedBuilder,
    AttachmentBuilder,
} from 'discord.js';
import type { MessageActionRowComponentBuilder } from 'discord.js';
import type { Player, Track, UnresolvedTrack } from 'lavalink-client';
import { Bloom } from 'musicard';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

type AnyTrack = Track | UnresolvedTrack;

const SOURCE_ICON: Record<string, string> = {
    youtube: '▶️',
    soundcloud: '🟠',
    bandcamp: '🔵',
    twitch: '🟣',
    vimeo: '🎬',
    spotify: '🟢',
    deezer: '🟣',
    applemusic: '🍎',
    http: '🔗',
};

export function sourceIcon(source?: string): string {
    return SOURCE_ICON[(source || '').toLowerCase()] || '🎵';
}

/** Escape Discord markdown so track titles can't break the layout. */
export function escapeMd(value: string | undefined | null): string {
    return String(value ?? '').replace(/([\\\`*_~|>\[\]()])/g, '\\$1').slice(0, 230);
}

/** Format a millisecond duration as `m:ss` / `h:mm:ss`. */
export function formatDuration(ms?: number): string {
    if (!ms || ms <= 0 || !Number.isFinite(ms)) return '0:00';
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function trackInfo(t: AnyTrack) {
    return (t as Track).info;
}

function requesterId(t: AnyTrack): string | null {
    const r = (t as Track).requester as { id?: string } | undefined;
    return r?.id ?? null;
}

/** Idle control panel shown by /music when nothing is playing. */
export function musicIdleContainer(): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(config.branding.color)
        .setTitle('🎵 Music System')
        .setDescription(
            'Nothing is playing right now.\n\n' +
            'Use `/play <song or link>` to start playing music.\n' +
            '-# YouTube, Spotify, SoundCloud, Bandcamp, and direct URLs are supported.'
        );
}

/** The public "Now Playing" panel with live transport controls. */
export async function nowPlayingContainer(player: Player): Promise<{ embeds: EmbedBuilder[]; components: any[]; files: AttachmentBuilder[] }> {
    const track = player.queue.current;
    if (!track) {
        const embed = new EmbedBuilder()
            .setColor(config.branding.color)
            .setTitle('🎵 Now Playing')
            .setDescription('Nothing is playing right now.');
        return { embeds: [embed], components: [], files: [] };
    }

    const info = trackInfo(track);
    const duration = info?.duration ?? 0;
    const pos = Math.min(player.position ?? 0, duration);
    const reqId = requesterId(track);
    const live = !!info?.isStream;

    // Generate musicard Bloom image
    let cardBuffer: Buffer = Buffer.alloc(0);
    try {
        cardBuffer = await Bloom({
            trackName: info?.title || 'Unknown Title',
            artistName: info?.author || 'Unknown Artist',
            albumArt: info?.artworkUrl || config.branding.logo,
            fallbackArt: config.branding.logo,
            isExplicit: false,
            timeAdjust: {
                timeStart: formatDuration(pos),
                timeEnd: live ? 'LIVE' : formatDuration(duration)
            },
            progressBar: live ? 100 : (duration > 0 ? (pos / duration) * 100 : 0)
        });
    } catch (err) {
        logger.error('Failed to generate musicard:', err);
    }

    const files: AttachmentBuilder[] = [];
    const embed = new EmbedBuilder()
        .setColor(config.branding.color)
        .setTitle(info?.title || 'Unknown Title')
        .setURL(info?.uri || null)
        .setDescription(
            `• **Author:** ${escapeMd(info?.author || 'Unknown Artist')}\n` +
            `• **Duration:** \`${formatDuration(pos)} / ${formatDuration(duration)}\`\n` +
            `• **Requester:** ${reqId ? `<@${reqId}>` : 'Unknown'}`
        );

    if (cardBuffer.length > 0) {
        files.push(new AttachmentBuilder(cardBuffer, { name: 'musicard.png' }));
        embed.setImage('attachment://musicard.png');
    } else {
        const art = info?.artworkUrl;
        if (art && typeof art === 'string' && art.startsWith('http')) {
            embed.setThumbnail(art);
        }
    }

    // Dropdown Select Menu
    const paused = !!player?.paused;
    const mode = player?.repeatMode ?? 'off';
    const vol = player?.volume ?? 80;

    const selectMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('music:controls')
            .setPlaceholder('Select a music control option...')
            .addOptions([
                { label: paused ? '▶️ Resume' : '⏸️ Pause', value: 'pause', description: paused ? 'Resume playback' : 'Pause playback' },
                { label: '⏭ Skip', value: 'skip', description: 'Skip to next track' },
                { label: '⏮ Previous', value: 'previous', description: 'Play the previous track' },
                { label: '⏹ Stop', value: 'stop', description: 'Stop and clear the queue' },
                { label: '⏪ Restart', value: 'restart', description: 'Restart current track' },
                { label: '⏪ -10s', value: 'seekback', description: 'Seek back 10 seconds' },
                { label: '⏩ +10s', value: 'seekfwd', description: 'Seek forward 10 seconds' },
                { label: '🔉 Volume Down', value: 'voldown', description: `Current: ${vol}%` },
                { label: '🔊 Volume Up', value: 'volup', description: `Current: ${vol}%` },
                { label: `🔁 Loop: ${mode === 'off' ? 'Off → Track' : mode === 'track' ? 'Track → Queue' : 'Queue → Off'}`, value: 'loop', description: `Currently: ${mode}` },
                { label: '🔀 Shuffle', value: 'shuffle', description: 'Shuffle the queue' },
                { label: '📋 Queue', value: 'queue', description: 'View the full queue' },
                { label: '🔄 Refresh', value: 'refresh', description: 'Refresh the now playing panel' },
                { label: '🗑️ Clear Queue', value: 'clear', description: 'Remove all upcoming tracks' },
            ])
    );

    return { 
        embeds: [embed], 
        components: [selectMenu],
        files
    };
}

/** Confirmation shown when a track (or playlist) is queued. */
export function addedContainer(
    tracks: AnyTrack[],
    playlistName: string | null,
    position: number,
): EmbedBuilder {
    const embed = new EmbedBuilder().setColor(0x10b981); // Green

    if (playlistName && tracks.length > 1) {
        const totalMs = tracks.reduce((sum, t) => sum + (trackInfo(t)?.duration || 0), 0);
        embed.setTitle('☑️ Playlist Added')
            .setDescription(
                `**${escapeMd(playlistName)}**\n` +
                `Tracks: \`${tracks.length}\` • Duration: \`${formatDuration(totalMs)}\``
            );
        return embed;
    }

    const t = tracks[0];
    const info = trackInfo(t);
    const reqId = requesterId(t);
    
    embed.setTitle('☑️ Track Added')
        .setDescription(
            `**[${escapeMd(info?.title)}](${info?.uri})** by \`${escapeMd(info?.author || 'Unknown Artist')}\`\n` +
            `Position \`#${position}\` • Duration \`${formatDuration(info?.duration)}\`${reqId ? ` • By <@${reqId}>` : ''}`
        );

    const art = info?.artworkUrl;
    if (art && typeof art === 'string' && art.startsWith('http')) {
        embed.setThumbnail(art);
    }

    return embed;
}

const QUEUE_PAGE_SIZE = 10;

/** Full queue listing, paginated. */
export function queueContainer(player: Player, page = 0): EmbedBuilder {
    const current = player.queue.current;
    const upcoming = player.queue.tracks as AnyTrack[];

    const embed = new EmbedBuilder()
        .setColor(config.branding.color)
        .setTitle('ℹ️ Music Queue');

    let description = '';
    if (current) {
        const info = trackInfo(current);
        description += `**0 | [${escapeMd(info?.title)}](${info?.uri})** - \`${formatDuration(info?.duration)}\`\n\n`;
    }

    if (!upcoming.length) {
        description += '_Queue is empty — add more with `/play`._';
    } else {
        const pages = Math.max(1, Math.ceil(upcoming.length / QUEUE_PAGE_SIZE));
        const safePage = Math.max(0, Math.min(page, pages - 1));
        const start = safePage * QUEUE_PAGE_SIZE;
        const slice = upcoming.slice(start, start + QUEUE_PAGE_SIZE);
        const totalMs = upcoming.reduce((sum, t) => sum + (trackInfo(t)?.duration || 0), 0);

        slice.forEach((t, i) => {
            const info = trackInfo(t);
            description += `**${start + i + 1} | [${escapeMd(info?.title)}](${info?.uri})** - \`${formatDuration(info?.duration)}\`\n`;
        });

        embed.setFooter({ text: `Page ${safePage + 1}/${pages} • Total duration: ${formatDuration(totalMs)} • Volume: ${player.volume}%` });
    }

    embed.setDescription(description);
    return embed;
}
