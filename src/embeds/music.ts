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
} from 'discord.js';
import type { MessageActionRowComponentBuilder } from 'discord.js';
import type { Player, Track, UnresolvedTrack } from 'lavalink-client';
import { ComponentsV2 } from './componentsV2.js';

type AnyTrack = Track | UnresolvedTrack;

const SOURCE_ICON: Record<string, string> = {
    youtube: '▶️',
    soundcloud: '🟠',
    bandcamp: '🔵',
    twitch: '🟣',
    vimeo: '🎬',
    http: '🔗',
};

export function sourceIcon(source?: string): string {
    return SOURCE_ICON[(source || '').toLowerCase()] || '🎵';
}

/** Escape Discord markdown so track titles can't break the layout. */
export function escapeMd(value: string | undefined | null): string {
    return String(value ?? '').replace(/([\\`*_~|>\[\]()])/g, '\\$1').slice(0, 230);
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
    // Track and UnresolvedTrack both expose `.info`.
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

function progressBar(player: Player): string {
    const cur = player.queue.current;
    if (!cur) return '';
    const info = trackInfo(cur);
    const dur = info?.duration ?? 0;
    if (!dur || info?.isStream) return '🔴 LIVE';
    const pos = Math.min(player.position ?? 0, dur);
    const slots = 18;
    const filled = Math.max(0, Math.min(slots - 1, Math.floor((pos / dur) * slots)));
    const bar = '▬'.repeat(filled) + '🔘' + '▬'.repeat(slots - 1 - filled);
    return `${formatDuration(pos)} ${bar} ${formatDuration(dur)}`;
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
 * Full transport control grid for the live panel: four button rows grouped by
 * function plus a string-select for less-common actions. All ids use the
 * `music:` prefix and are validated by `playCommand.handleButton` /
 * `handleSelectMenu`. A Discord message allows up to 5 action rows; we use
 * exactly 5 (4 button rows + 1 select).
 */
export function controlRows(
    player?: Player,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const paused = !!player?.paused;
    const live = player ? isLiveTrack(player) : false;
    const hasPrev = !!player && (player.queue.previous?.length ?? 0) > 0;
    const hasQueue = !!player && player.queue.tracks.length > 0;

    // Row 1 — primary transport: Previous, Play/Pause, Skip, Stop.
    const transport = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('music:previous')
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasPrev),
        new ButtonBuilder()
            .setCustomId('music:pause')
            .setLabel(paused ? 'Resume' : 'Pause')
            .setStyle(paused ? ButtonStyle.Success : ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music:skip').setLabel('Skip').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music:stop').setLabel('Stop').setStyle(ButtonStyle.Danger),
    );

    // Row 2 — seeking: Restart, −10s, +10s (disabled for live streams).
    const seekRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music:restart').setLabel('Restart').setStyle(ButtonStyle.Secondary).setDisabled(live),
        new ButtonBuilder().setCustomId('music:seekback').setLabel('-10s').setStyle(ButtonStyle.Secondary).setDisabled(live),
        new ButtonBuilder().setCustomId('music:seekfwd').setLabel('+10s').setStyle(ButtonStyle.Secondary).setDisabled(live),
    );

    // Row 3 — volume: Vol −, Vol +.
    const volumeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music:voldown').setLabel('Vol −').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:volup').setLabel('Vol +').setStyle(ButtonStyle.Secondary),
    );

    // Row 4 — queue/loop controls.
    const queueRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('music:loop').setLabel(loopShort(player?.repeatMode)).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:shuffle').setLabel('Shuffle').setStyle(ButtonStyle.Secondary).setDisabled(!hasQueue),
        new ButtonBuilder().setCustomId('music:queue').setLabel('Queue').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:refresh').setLabel('Refresh').setStyle(ButtonStyle.Secondary),
    );

    // Row 5 — overflow menu for less-common actions.
    const mode = player?.repeatMode ?? 'off';
    const menu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('music:select')
            .setPlaceholder('More controls…')
            .addOptions([
                { label: 'Volume 25%', description: 'Set playback volume to 25%', value: 'vol:25' },
                { label: 'Volume 50%', description: 'Set playback volume to 50%', value: 'vol:50' },
                { label: 'Volume 75%', description: 'Set playback volume to 75%', value: 'vol:75' },
                { label: 'Volume 100%', description: 'Set playback volume to 100%', value: 'vol:100' },
                { label: 'Loop: Off', description: 'Disable looping', value: 'loop:off', default: mode === 'off' },
                { label: 'Loop: Track', description: 'Repeat the current track', value: 'loop:track', default: mode === 'track' },
                { label: 'Loop: Queue', description: 'Repeat the whole queue', value: 'loop:queue', default: mode === 'queue' },
                { label: 'Clear queue', description: 'Remove every upcoming track', value: 'clear' },
            ]),
    );

    const rows = [transport, seekRow, volumeRow, queueRow, menu];
    return rows as unknown as ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

/** Idle control panel shown by /music when nothing is playing. */
export function musicIdleContainer(): ContainerBuilder {
    return ComponentsV2.baseContainer(ComponentsV2.Accents.primary).addTextDisplayComponents(
        ComponentsV2.text(
            `-# 🎵 VICTUS CLOUD MUSIC\n` +
                `### Music Control Panel\n` +
                `Nothing is playing right now.\n\n` +
                `Use \`/play <song or link>\` to start — YouTube, SoundCloud, Bandcamp and direct links all work. ` +
                `Then \`/music\` opens this live control panel with full transport controls.`,
        ),
    );
}

/** The public "Now Playing" panel with live transport controls. */
export function nowPlayingContainer(player: Player): ContainerBuilder {
    const track = player.queue.current;
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.purple);

    if (!track) {
        c.addTextDisplayComponents(ComponentsV2.text('### 🎵 Now Playing\n_Nothing is playing right now._'));
        return c;
    }

    const info = trackInfo(track);
    const live = !!info?.isStream;
    const art = info?.artworkUrl;
    if (art) c.addMediaGalleryComponents(ComponentsV2.mediaGallery(art));

    const source = info?.sourceName ?? 'stream';
    const badge = live ? '🔴 LIVE' : player.paused ? '⏸️ PAUSED' : '▶️ PLAYING';

    // Header: branded eyebrow with source icon + live/playing badge.
    let body = `-# ${sourceIcon(info?.sourceName)} VICTUS CLOUD MUSIC • ${source.toUpperCase()} • ${badge}\n`;
    body += `### 🎵 Now Playing\n`;
    body += `**[${escapeMd(info?.title)}](${info?.uri})**\n`;
    body += `-# by ${escapeMd(info?.author || 'Unknown artist')}`;
    if (!live && info?.duration) body += ` • \`${formatDuration(info.duration)}\``;
    body += `\n\n`;

    // Progress bar (or LIVE marker for streams).
    body += `\`${progressBar(player)}\`\n\n`;

    // Status line: playback state • volume • loop • requester.
    const statusBits = [
        player.paused ? '⏸️ Paused' : live ? '🔴 Live' : '▶️ Playing',
        `🔊 ${player.volume}%`,
        repeatLabel(player.repeatMode),
    ];
    body += statusBits.join('  •  ');
    const reqId = requesterId(track);
    if (reqId) body += `\n-# requested by <@${reqId}>`;

    // Up Next list.
    const upNext = player.queue.tracks.slice(0, 5) as AnyTrack[];
    if (upNext.length) {
        const totalMs = (player.queue.tracks as AnyTrack[]).reduce((sum, t) => sum + (trackInfo(t)?.duration || 0), 0);
        body += `\n\n### Up Next — ${player.queue.tracks.length} in queue • ${formatDuration(totalMs)}\n`;
        body += upNext
            .map((t, i) => `\`${i + 1}.\` ${escapeMd(trackInfo(t)?.title)} \`${formatDuration(trackInfo(t)?.duration)}\``)
            .join('\n');
        const remaining = player.queue.tracks.length - upNext.length;
        if (remaining > 0) body += `\n-# +${remaining} more — open **Queue** for the full list`;
    } else {
        body += `\n\n-# Queue is empty — add more with \`/play\``;
    }

    c.addTextDisplayComponents(ComponentsV2.text(body));
    c.addSeparatorComponents(ComponentsV2.separator());
    for (const row of controlRows(player)) c.addActionRowComponents(row);
    return c;
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
        let body = `### ✅ Added Playlist\n`;
        body += `**${escapeMd(playlistName)}**\n`;
        body += `-# ${tracks.length} tracks • ${formatDuration(totalMs)} total\n\n`;
        body += tracks
            .slice(0, 5)
            .map((t, i) => `\`${i + 1}.\` ${escapeMd(trackInfo(t)?.title)}`)
            .join('\n');
        if (tracks.length > 5) body += `\n-# +${tracks.length - 5} more`;
        c.addTextDisplayComponents(ComponentsV2.text(body));
        return c;
    }

    const t = tracks[0];
    const info = trackInfo(t);
    const art = info?.artworkUrl;
    if (art) c.addMediaGalleryComponents(ComponentsV2.mediaGallery(art));
    let body = `### ✅ Added to Queue\n`;
    body += `**[${escapeMd(info?.title)}](${info?.uri})**\n`;
    body += `-# by ${escapeMd(info?.author || 'Unknown artist')} • \`${formatDuration(info?.duration)}\``;
    if (position > 0) body += ` • position **#${position}** in queue`;
    c.addTextDisplayComponents(ComponentsV2.text(body));
    return c;
}

const QUEUE_PAGE_SIZE = 10;

/** Full queue listing, paginated. */
export function queueContainer(player: Player, page = 0): ContainerBuilder {
    const c = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
    const current = player.queue.current;
    const upcoming = player.queue.tracks as AnyTrack[];

    let body = `### 🎶 Queue\n`;
    if (current) {
        body += `**Now Playing**\n${sourceIcon(trackInfo(current)?.sourceName)} ${escapeMd(trackInfo(current)?.title)} \`${formatDuration(trackInfo(current)?.duration)}\`\n\n`;
    }

    if (!upcoming.length) {
        body += `_The queue is empty — add more with_ \`/play\`.`;
    } else {
        const pages = Math.max(1, Math.ceil(upcoming.length / QUEUE_PAGE_SIZE));
        const safePage = Math.max(0, Math.min(page, pages - 1));
        const start = safePage * QUEUE_PAGE_SIZE;
        const slice = upcoming.slice(start, start + QUEUE_PAGE_SIZE);
        const totalMs = upcoming.reduce((sum, t) => sum + (trackInfo(t)?.duration || 0), 0);
        body += `**Up Next — ${upcoming.length} tracks • ${formatDuration(totalMs)}**\n`;
        body += slice
            .map((t, i) => {
                const reqId = requesterId(t);
                return `\`${start + i + 1}.\` ${escapeMd(trackInfo(t)?.title)} \`${formatDuration(trackInfo(t)?.duration)}\`${reqId ? ` • <@${reqId}>` : ''}`;
            })
            .join('\n');
        body += `\n\n-# Page ${safePage + 1}/${pages} • 🔁 ${repeatLabel(player.repeatMode).replace(/^.. /, '')} • 🔊 ${player.volume}%`;
    }

    c.addTextDisplayComponents(ComponentsV2.text(body));
    return c;
}
