/**
 * Music UI for the Victus Cloud bot — Clean, professional standard Discord Embeds
 * for the Lavalink music feature (Now Playing, queue, "added" confirmations)
 * plus the custom buttons control row.
 */
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    AttachmentBuilder,
} from 'discord.js';
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

export function generateProgressBar(pos: number, duration: number, length = 18): string {
    if (duration <= 0) return '▬'.repeat(length);
    const progress = Math.min(pos / duration, 1);
    const index = Math.round(progress * (length - 1));
    return '▬'.repeat(index) + '🔵' + '▬'.repeat(length - 1 - index);
}

/** Idle control panel shown by /music when nothing is playing. */
export function musicIdleContainer(): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(0x2b2d31) // Neutral dark background
        .setTitle('🎵 Music System')
        .setDescription(
            'Nothing is playing right now.\n\n' +
            'Use `/play <song or link>` to start playing music.\n' +
            '-# YouTube, Spotify, SoundCloud, Bandcamp, and direct URLs are supported.'
        );
}

/** The public "Now Playing" panel with live transport controls. */
export async function nowPlayingContainer(player: Player, guild?: any): Promise<{ embeds: EmbedBuilder[]; components: any[]; files: AttachmentBuilder[] }> {
    const track = player.queue.current;
    if (!track) {
        const embed = new EmbedBuilder()
            .setColor(0x2b2d31)
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
        .setColor(0x2b2d31) // Neutral dark background (no accent color stripe)
        .setTitle('Now playing')
        .setDescription(
            `**[${escapeMd(info?.title)}](${info?.uri})**\n\n` +
            `⊕ ${reqId ? `<@${reqId}>` : 'Unknown'}\n\n` +
            `\`${formatDuration(pos)} / ${formatDuration(duration)}\`\n\n` +
            `${generateProgressBar(pos, duration)}`
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

    // Unified single ActionRow with exactly 5 buttons for premium alignment
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music:like').setEmoji('🤍').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:loop').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:open_controls').setEmoji('🎛️').setLabel('Open music controls').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:stop').setEmoji('❌').setStyle(ButtonStyle.Secondary),
    );

    return { 
        embeds: [embed], 
        components: [row],
        files
    };
}

export function musicControlsContainer(player: Player): { embeds: EmbedBuilder[]; components: any[] } {
    const track = player.queue.current;
    const title = track ? track.info.title : 'Unknown Track';
    const pos = player.position ?? 0;
    const duration = track ? track.info.duration : 0;
    const live = track ? track.info.isStream : false;
    
    const timeStr = live ? 'LIVE' : `${formatDuration(pos)} / ${formatDuration(duration)}`;
    const header = `**${escapeMd(title).slice(0, 50)}... (${timeStr})**`;

    const embed = new EmbedBuilder()
        .setColor(0x2b2d31) // Neutral dark background
        .setDescription(
            `${header}\n` +
            `───────────────────────────────────\n` +
            `**Playback**\n\n\n\n` +
            `**Music**\n\n\n\n` +
            `**Controls**\n\n\n\n` +
            `**Library**`
        );

    const playbackRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music:previous').setEmoji('⏮️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:pause').setEmoji(player.paused ? '▶️' : '⏸️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:stop').setEmoji('❌').setStyle(ButtonStyle.Secondary),
    );

    const musicRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music:queue').setEmoji('📊').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:filters').setEmoji('🎛️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:add').setEmoji('➕').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:search').setEmoji('🔍').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:lyrics').setEmoji('🎵').setStyle(ButtonStyle.Secondary),
    );

    const controlsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music:like').setEmoji('🤍').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:volume').setEmoji('🔊').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:eq').setEmoji('🎚️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:preset').setEmoji('🟣').setStyle(ButtonStyle.Secondary),
    );

    const libraryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music:library_playlists').setEmoji('📁').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:history').setEmoji('🕒').setStyle(ButtonStyle.Secondary),
    );

    return {
        embeds: [embed],
        components: [playbackRow, musicRow, controlsRow, libraryRow]
    };
}

/** Confirmation shown when a track (or playlist) is queued. */
export function addedContainer(
    tracks: AnyTrack[],
    playlistName: string | null,
    position: number,
): EmbedBuilder {
    const embed = new EmbedBuilder().setColor(0x2b2d31); // Neutral dark background

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
        .setColor(0x2b2d31) // Neutral dark background
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
