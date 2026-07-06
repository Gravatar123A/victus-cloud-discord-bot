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
        .setColor(0x6366f1)
        .setDescription(
            `-# 🎵 MUSIC SYSTEM • SESSION STANDBY\n` +
            `# Ready to Play\n\n` +
            `There is no active music session playing in this server right now.\n\n` +
            `› Use \`/play <song or link>\` to start playing.\n` +
            `› Supports: \`YouTube\`, \`Spotify\`, \`SoundCloud\`, \`Bandcamp\`, and direct stream URLs.`
        );
}

/** The public "Now Playing" panel with live transport controls. */
export async function nowPlayingContainer(player: Player, guild?: any): Promise<{ embeds: EmbedBuilder[]; components: any[]; files: AttachmentBuilder[] }> {
    const track = player.queue.current;
    if (!track) {
        const embed = new EmbedBuilder()
            .setColor(0x6366f1)
            .setDescription(
                `-# 🎵 NOW PLAYING • INACTIVE SESSION\n` +
                `# Nothing is playing right now.`
            );
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
            progressBar: live ? 100 : (duration > 0 ? (pos / duration) * 100 : 0),
            backgroundColor: '#07070a', // a dark blue/black background matching the bot theme
            styleConfig: {
                trackStyle: {
                    textColor: '#ffffff',
                    textGlow: true,
                },
                artistStyle: {
                    textColor: '#a5b4fc', // indigo-300 light lavender/indigo tint
                    textGlow: false,
                },
                timeStyle: {
                    textColor: '#cbd5e1', // slate-300
                },
                progressBarStyle: {
                    barColor: '#6366f1', // Victus Indigo brand color!
                    barColorDuo: true
                }
            }
        });
    } catch (err) {
        logger.error('Failed to generate musicard:', err);
    }

    const files: AttachmentBuilder[] = [];
    const embed = new EmbedBuilder()
        .setColor(0x6366f1); // Victus Indigo brand color

    const nextTrack = player.queue.tracks[0];
    const nextUpStr = nextTrack 
        ? `⏭️ **Next up:** [${escapeMd(nextTrack.info?.title)}](${nextTrack.info?.uri})`
        : `⏭️ **Next up:** _Queue end_`;

    if (cardBuffer.length > 0) {
        files.push(new AttachmentBuilder(cardBuffer, { name: 'musicard.png' }));
        embed.setImage('attachment://musicard.png');
        
        embed.setDescription(
            `-# 🎵 MUSIC SYSTEM • NOW PLAYING\n` +
            `# [${escapeMd(info?.title)}](${info?.uri})\n\n` +
            `› **Requester:** ${reqId ? `<@${reqId}>` : 'System'}\n` +
            `› **Source:** ${sourceIcon(info?.sourceName)} ${info?.sourceName ? info.sourceName.charAt(0).toUpperCase() + info.sourceName.slice(1) : 'Unknown'}\n` +
            `› **Loop Mode:** \`${player.repeatMode === 'off' ? 'Disabled' : player.repeatMode === 'track' ? 'Current Track' : 'Whole Queue'}\`\n` +
            `› **Volume:** \`${player.volume}%\`\n\n` +
            `${nextUpStr}`
        );
    } else {
        const art = info?.artworkUrl;
        if (art && typeof art === 'string' && art.startsWith('http')) {
            embed.setThumbnail(art);
        }
        embed.setDescription(
            `-# 🎵 MUSIC SYSTEM • NOW PLAYING\n` +
            `# [${escapeMd(info?.title)}](${info?.uri})\n\n` +
            `› **Artist:** \`${escapeMd(info?.author || 'Unknown Artist')}\`\n` +
            `› **Requester:** ${reqId ? `<@${reqId}>` : 'System'}\n` +
            `› **Source:** ${sourceIcon(info?.sourceName)} ${info?.sourceName ? info.sourceName.charAt(0).toUpperCase() + info.sourceName.slice(1) : 'Unknown'}\n` +
            `› **Duration:** \`${formatDuration(pos)} / ${formatDuration(duration)}\`\n` +
            `› **Progress:** ${generateProgressBar(pos, duration)}\n\n` +
            `${nextUpStr}`
        );
    }

    const playPauseEmoji = player.paused ? '▶️' : '⏸️';
    const loopEmoji = player.repeatMode === 'off' ? '🔁' : player.repeatMode === 'track' ? '🔂' : '🔁';
    const loopStyle = player.repeatMode === 'off' ? ButtonStyle.Secondary : ButtonStyle.Primary;

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music:pause').setEmoji(playPauseEmoji).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:loop').setEmoji(loopEmoji).setStyle(loopStyle),
        new ButtonBuilder().setCustomId('music:open_controls').setEmoji('🎛️').setLabel('Controls').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:stop').setEmoji('❌').setStyle(ButtonStyle.Danger),
    );

    return { 
        embeds: [embed], 
        components: [row],
        files
    };
}

export function musicControlsContainer(player: Player): { embeds: EmbedBuilder[]; components: any[] } {
    const track = player.queue.current;
    if (!track) {
        const embed = new EmbedBuilder()
            .setColor(0x6366f1)
            .setDescription(
                `-# 🎵 MUSIC SYSTEM • CONTROLS\n` +
                `# Inactive Session\n\n` +
                `There is no music playing right now.`
            );
        return { embeds: [embed], components: [] };
    }

    const info = track.info;
    const isPaused = player.paused;
    const loopMode = player.repeatMode;
    const vol = player.volume;

    const embed = new EmbedBuilder()
        .setColor(0x6366f1)
        .setDescription(
            `-# 🎛️ MUSIC SYSTEM • CONTROL PANEL\n` +
            `# Audio Dashboard\n\n` +
            `### Active Track\n` +
            `› **Title:** [${escapeMd(info.title)}](${info.uri})\n` +
            `› **Artist:** \`${escapeMd(info.author || 'Unknown Artist')}\`\n\n` +
            `### Audio Settings\n` +
            `› **State:** ${isPaused ? '⏸️ Paused' : '▶️ Playing'}\n` +
            `› **Volume:** \`${vol}%\` • **Loop:** \`${loopMode.toUpperCase()}\`\n` +
            `› **Queue Length:** \`${player.queue.tracks.length} tracks\`\n\n` +
            `### Interactive Transport Controls\n` +
            `Use the button rows below to govern playback, adjust settings, and manage your libraries.`
        );

    const playbackRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music:previous').setEmoji('⏮️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:pause').setEmoji(player.paused ? '▶️' : '⏸️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:stop').setEmoji('❌').setStyle(ButtonStyle.Danger),
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
    const embed = new EmbedBuilder().setColor(0x6366f1); // Victus Indigo brand color

    if (playlistName && tracks.length > 1) {
        const totalMs = tracks.reduce((sum, t) => sum + (trackInfo(t)?.duration || 0), 0);
        embed.setDescription(
            `-# 🎵 MUSIC SYSTEM • QUEUE UPDATE\n` +
            `# ✅ Playlist Added\n\n` +
            `› **Playlist:** \`${escapeMd(playlistName)}\`\n` +
            `› **Tracks:** \`${tracks.length}\`\n` +
            `› **Total Duration:** \`${formatDuration(totalMs)}\`\n` +
            `› **Queue Position:** \`#${position}\``
        );
        return embed;
    }

    const t = tracks[0];
    const info = trackInfo(t);
    const reqId = requesterId(t);
    
    embed.setDescription(
        `-# 🎵 MUSIC SYSTEM • QUEUE UPDATE\n` +
        `# ✅ Track Added\n\n` +
        `**[${escapeMd(info?.title)}](${info?.uri})**\n` +
        `› **Artist:** \`${escapeMd(info?.author || 'Unknown Artist')}\`\n` +
        `› **Duration:** \`${formatDuration(info?.duration)}\`\n` +
        `› **Queue Position:** \`#${position}\`${reqId ? `\n› **Requested By:** <@${reqId}>` : ''}`
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

    const embed = new EmbedBuilder().setColor(0x6366f1); // Victus Indigo brand color

    let description = `-# 🎵 MUSIC SYSTEM • TRACK QUEUE\n# Live Playlist Queue\n\n`;
    
    if (current) {
        const info = trackInfo(current);
        const reqId = requesterId(current);
        description += `### 🔊 Now Playing\n` +
            `**[${escapeMd(info?.title)}](${info?.uri})**\n` +
            `› Artist: \`${escapeMd(info?.author || 'Unknown')}\` • Request: ${reqId ? `<@${reqId}>` : 'System'}\n\n`;
    }

    if (!upcoming.length) {
        description += `### ⏭️ Upcoming Playlist\n_No upcoming tracks in queue. Add tracks using \`/play\`._`;
    } else {
        const pages = Math.max(1, Math.ceil(upcoming.length / QUEUE_PAGE_SIZE));
        const safePage = Math.max(0, Math.min(page, pages - 1));
        const start = safePage * QUEUE_PAGE_SIZE;
        const slice = upcoming.slice(start, start + QUEUE_PAGE_SIZE);
        const totalMs = upcoming.reduce((sum, t) => sum + (trackInfo(t)?.duration || 0), 0);

        description += `### ⏭️ Upcoming Playlist (${upcoming.length} tracks)\n`;
        slice.forEach((t, i) => {
            const info = trackInfo(t);
            const reqId = requesterId(t);
            description += `\`${start + i + 1}.\` **[${escapeMd(info?.title)}](${info?.uri})**\n` +
                ` - \`${formatDuration(info?.duration)}\` • Requester: ${reqId ? `<@${reqId}>` : 'System'}\n`;
        });

        embed.setFooter({ 
            text: `Page ${safePage + 1}/${pages} • Total duration: ${formatDuration(totalMs)} • Volume: ${player.volume}%` 
        });
    }

    embed.setDescription(description);
    return embed;
}

