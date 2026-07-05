/**
 * Music UI for the Victus Cloud bot — Components v2 panels for the Lavalink
 * music feature (Now Playing, queue, "added" confirmations) plus the shared
 * transport-control button row used by /play and the music button handler.
 */
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    StringSelectMenuBuilder,
    AttachmentBuilder,
} from 'discord.js';
import type { MessageActionRowComponentBuilder } from 'discord.js';
import type { Player, Track, UnresolvedTrack } from 'lavalink-client';
import { ComponentsV2 } from './componentsV2.js';
import { Bloom } from 'musicard';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

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

function repeatLabel(mode: string | undefined): string {
    if (mode === 'track') return '🔂 Track';
    if (mode === 'queue') return '🔁 Queue';
    return '➡️ Off';
}

function loopShort(mode: string | undefined): string {
    if (mode === 'track') return 'Loop: Track';
    if (mode === 'queue') return 'Loop: Queue';
    return 'Loop: Off';
}

function isLiveTrack(player: Player): boolean {
    return !!player.queue.current && !!trackInfo(player.queue.current)?.isStream;
}

/**
 * Full transport control grid for the live panel.
 */
export function controlRows(
    player?: Player,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const paused = !!player?.paused;
    const live = player ? isLiveTrack(player) : false;
    const hasPrev = !!player && (player.queue.previous?.length ?? 0) > 0;
    const hasQueue = !!player && player.queue.tracks.length > 0;

    const transport = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music:previous').setLabel('⏮').setStyle(ButtonStyle.Secondary).setDisabled(!hasPrev),
        new ButtonBuilder().setCustomId('music:pause').setLabel(paused ? '▶️' : '⏸️').setStyle(paused ? ButtonStyle.Success : ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music:skip').setLabel('⏭').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music:stop').setLabel('⏹').setStyle(ButtonStyle.Danger),
    );

    const seekRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music:restart').setLabel('⏪').setStyle(ButtonStyle.Secondary).setDisabled(live),
        new ButtonBuilder().setCustomId('music:seekback').setLabel('-10s').setStyle(ButtonStyle.Secondary).setDisabled(live),
        new ButtonBuilder().setCustomId('music:seekfwd').setLabel('+10s').setStyle(ButtonStyle.Secondary).setDisabled(live),
    );

    const volumeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music:voldown').setLabel('🔉').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:volup').setLabel('🔊').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:loop').setLabel(loopShort(player?.repeatMode)).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:shuffle').setLabel('🔀').setStyle(ButtonStyle.Secondary).setDisabled(!hasQueue),
    );

    const extraRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music:queue').setLabel('📋 Queue').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:refresh').setLabel('🔄').setStyle(ButtonStyle.Secondary),
    );

    const rows = [transport, seekRow, volumeRow, extraRow];
    return rows as unknown as ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

/** Idle control panel shown by /music when nothing is playing. */
export function musicIdleContainer(): ContainerBuilder {
    return ComponentsV2.baseContainer(ComponentsV2.Accents.primary).addTextDisplayComponents(
        ComponentsV2.text(
            `-# 🎵 VICTUS CLOUD MUSIC\n` +
                `### Nothing Playing\n` +
                `Use \`/play <song or link>\` to start.\n` +
                `-# YouTube • SoundCloud • Spotify • Bandcamp • Direct URLs`,
        ),
    );
}

/** The public "Now Playing" panel with live transport controls. */
export async function nowPlayingContainer(player: Player): Promise<{ container: ContainerBuilder; files: AttachmentBuilder[] }> {
    const track = player.queue.current;
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.purple);

    if (!track) {
        c.addTextDisplayComponents(ComponentsV2.text('### 🎵 Now Playing\n_Nothing is playing right now._'));
        return { container: c, files: [] };
    }

    const info = trackInfo(track);
    const live = !!info?.isStream;
    const duration = info?.duration ?? 0;
    const pos = Math.min(player.position ?? 0, duration);

    // Generate musicard Bloom image
    let cardBuffer: Buffer;
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
        const art = info?.artworkUrl;
        if (art && typeof art === 'string' && art.startsWith('http')) {
            c.addMediaGalleryComponents(ComponentsV2.mediaGallery(art));
        }
        cardBuffer = Buffer.alloc(0);
    }

    const files: AttachmentBuilder[] = [];
    if (cardBuffer.length > 0) {
        files.push(new AttachmentBuilder(cardBuffer, { name: 'musicard.png' }));
        c.addMediaGalleryComponents(ComponentsV2.mediaGallery('attachment://musicard.png'));
    }

    const source = info?.sourceName ?? 'stream';
    const badge = live ? '🔴 LIVE' : player.paused ? '⏸️ Paused' : '▶️ Playing';
    const reqId = requesterId(track);

    let body = `-# ${sourceIcon(info?.sourceName)} ${source.toUpperCase()} • ${badge} • 🔊 ${player.volume}%\n`;
    body += `**[${escapeMd(info?.title)}](${info?.uri})**\n`;
    body += `-# ${escapeMd(info?.author || 'Unknown')}`;
    if (reqId) body += ` • <@${reqId}>`;
    body += `\n`;

    // Compact up-next
    const upcoming = player.queue.tracks as AnyTrack[];
    if (upcoming.length > 0) {
        body += `\n-# Up next: **${escapeMd(trackInfo(upcoming[0])?.title)}**`;
        if (upcoming.length > 1) body += ` +${upcoming.length - 1} more`;
    }

    c.addTextDisplayComponents(ComponentsV2.text(body));
    c.addSeparatorComponents(ComponentsV2.separator());
    for (const row of controlRows(player)) c.addActionRowComponents(row);

    return { container: c, files };
}

/** Confirmation shown when a track (or playlist) is queued. */
export function addedContainer(
    tracks: AnyTrack[],
    playlistName: string | null,
    position: number,
): ContainerBuilder {
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.success);
    if (playlistName && tracks.length > 1) {
        const totalMs = tracks.reduce((sum, t) => sum + (trackInfo(t)?.duration || 0), 0);
        const source = trackInfo(tracks[0])?.sourceName || '';
        let body = `-# ${sourceIcon(source)} PLAYLIST ADDED\n`;
        body += `**${escapeMd(playlistName)}**\n`;
        body += `-# ${tracks.length} tracks • ${formatDuration(totalMs)}`;
        c.addTextDisplayComponents(ComponentsV2.text(body));
        return c;
    }

    const t = tracks[0];
    const info = trackInfo(t);
    const art = info?.artworkUrl;
    if (art && typeof art === 'string' && art.startsWith('http')) {
        c.addMediaGalleryComponents(ComponentsV2.mediaGallery(art));
    }
    let body = `-# ${sourceIcon(info?.sourceName)} ADDED TO QUEUE\n`;
    body += `**[${escapeMd(info?.title)}](${info?.uri})**\n`;
    body += `-# ${escapeMd(info?.author || 'Unknown')} • \`${formatDuration(info?.duration)}\``;
    if (position > 0) body += ` • #${position}`;
    c.addTextDisplayComponents(ComponentsV2.text(body));
    return c;
}

const QUEUE_PAGE_SIZE = 10;

/** Full queue listing, paginated. */
export function queueContainer(player: Player, page = 0): ContainerBuilder {
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
    const current = player.queue.current;
    const upcoming = player.queue.tracks as AnyTrack[];

    let body = `-# 🎵 QUEUE\n`;
    if (current) {
        body += `**Now:** ${sourceIcon(trackInfo(current)?.sourceName)} ${escapeMd(trackInfo(current)?.title)} \`${formatDuration(trackInfo(current)?.duration)}\`\n`;
    }

    if (!upcoming.length) {
        body += `-# Queue is empty — add more with \`/play\``;
    } else {
        const pages = Math.max(1, Math.ceil(upcoming.length / QUEUE_PAGE_SIZE));
        const safePage = Math.max(0, Math.min(page, pages - 1));
        const start = safePage * QUEUE_PAGE_SIZE;
        const slice = upcoming.slice(start, start + QUEUE_PAGE_SIZE);
        const totalMs = upcoming.reduce((sum, t) => sum + (trackInfo(t)?.duration || 0), 0);
        body += `-# ${upcoming.length} tracks • ${formatDuration(totalMs)}\n`;
        body += slice
            .map((t, i) => `\`${start + i + 1}.\` ${escapeMd(trackInfo(t)?.title)} \`${formatDuration(trackInfo(t)?.duration)}\``)
            .join('\n');
        body += `\n-# Page ${safePage + 1}/${pages} • ${loopShort(player.repeatMode)} • 🔊 ${player.volume}%`;
    }

    c.addTextDisplayComponents(ComponentsV2.text(body));
    return c;
}
