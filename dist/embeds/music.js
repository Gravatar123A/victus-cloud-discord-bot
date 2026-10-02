/**
 * Music UI for the Victus Cloud bot — Clean, professional standard Discord Embeds
 * for the Lavalink music feature (Now Playing, queue, "added" confirmations)
 * plus the custom buttons control row.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SectionBuilder, ThumbnailBuilder, } from 'discord.js';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../utils/logger.js';
const SOURCE_ICON = {
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
export function sourceIcon(source) {
    return SOURCE_ICON[(source || '').toLowerCase()] || '🎵';
}
const SOURCE_LABEL = {
    youtube: 'YouTube',
    soundcloud: 'SoundCloud',
    bandcamp: 'Bandcamp',
    twitch: 'Twitch',
    vimeo: 'Vimeo',
    spotify: 'Spotify',
    deezer: 'Deezer',
    applemusic: 'Apple Music',
    http: 'Direct link',
    local: 'Local file',
};
/** Human-readable platform name for a LavaLink source id. */
export function sourceLabel(source) {
    const key = (source || '').toLowerCase();
    if (!key)
        return 'Unknown source';
    return SOURCE_LABEL[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}
/** Escape Discord markdown so track titles can't break the layout. */
export function escapeMd(value) {
    return String(value ?? '').replace(/([\\\`*_~|>\[\]()])/g, '\\$1').slice(0, 230);
}
/** Format a millisecond duration as `m:ss` / `h:mm:ss`. */
export function formatDuration(ms) {
    if (!ms || ms <= 0 || !Number.isFinite(ms))
        return '0:00';
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function trackInfo(t) {
    return t.info;
}
function requesterId(t) {
    const r = t.requester;
    return r?.id ?? null;
}
export function generateProgressBar(pos, duration, length = 18) {
    if (duration <= 0)
        return '▬'.repeat(length);
    const progress = Math.min(pos / duration, 1);
    const index = Math.round(progress * (length - 1));
    return '▬'.repeat(index) + '🔵' + '▬'.repeat(length - 1 - index);
}
/** Idle control panel shown by /music when nothing is playing. */
export function musicIdleContainer() {
    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# 🎵 MUSIC SYSTEM • SESSION STANDBY\n` +
        `# Ready to Play\n\n` +
        `There is no active music session playing in this server right now.\n\n` +
        `› Use \`/play <song or link>\` to start playing.\n` +
        `› Supports: \`YouTube\`, \`Spotify\`, \`SoundCloud\`, \`Bandcamp\`, and direct stream URLs.`));
}
/** The public "Now Playing" panel with live transport controls. */
export async function nowPlayingContainer(player, guild) {
    const track = player.queue.current;
    if (!track) {
        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# 🎵 NOW PLAYING • INACTIVE SESSION\n` +
            `# Nothing is playing right now.`));
        return { embeds: [], components: [container], files: [] };
    }
    const info = trackInfo(track);
    const duration = info?.duration ?? 0;
    const pos = Math.min(player.position ?? 0, duration);
    const reqId = requesterId(track);
    const live = !!info?.isStream;
    // The banner is an optional enhancement: renderMusicCard degrades to null when
    // the platform-specific @napi-rs/canvas binding is missing, and the panel then
    // falls back to a text layout instead of taking the bot offline.
    const cardBuffer = (await renderMusicCard(player, guild)) ?? Buffer.alloc(0);
    const files = [];
    const container = new ContainerBuilder();
    const nextTrack = player.queue.tracks[0];
    const nextUpStr = nextTrack
        ? `⏭️ **Next up:** [${escapeMd(nextTrack.info?.title)}](${nextTrack.info?.uri})`
        : `⏭️ **Next up:** _Queue end_`;
    if (cardBuffer.length > 0) {
        files.push(new AttachmentBuilder(cardBuffer, { name: 'musicard.png' }));
        container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://musicard.png')));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(nextUpStr));
    }
    else {
        const art = info?.artworkUrl;
        if (art && typeof art === 'string' && art.startsWith('http')) {
            container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(art)));
        }
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# 🎵 MUSIC SYSTEM • NOW PLAYING\n` +
            `# [${escapeMd(info?.title)}](${info?.uri})\n\n` +
            `› **Artist:** \`${escapeMd(info?.author || 'Unknown Artist')}\`\n` +
            `› **Requester:** ${reqId ? `<@${reqId}>` : 'System'}\n` +
            `› **Source:** ${sourceIcon(info?.sourceName)} ${info?.sourceName ? info.sourceName.charAt(0).toUpperCase() + info.sourceName.slice(1) : 'Unknown'}\n` +
            `› **Duration:** \`${formatDuration(pos)} / ${formatDuration(duration)}\`\n` +
            `› **Progress:** ${generateProgressBar(pos, duration)}\n\n` +
            `${nextUpStr}`));
    }
    const playPauseEmoji = player.paused ? '▶️' : '⏸️';
    const loopEmoji = player.repeatMode === 'off' ? '🔁' : player.repeatMode === 'track' ? '🔂' : '🔁';
    const loopStyle = player.repeatMode === 'off' ? ButtonStyle.Secondary : ButtonStyle.Primary;
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music:pause').setEmoji(playPauseEmoji).setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('music:skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('music:loop').setEmoji(loopEmoji).setStyle(loopStyle), new ButtonBuilder().setCustomId('music:open_controls').setEmoji('🎛️').setLabel('Controls').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('music:stop').setEmoji('❌').setStyle(ButtonStyle.Danger));
    container.addActionRowComponents(row);
    return {
        embeds: [],
        components: [container],
        files
    };
}
const MUSIC_ACCENT = 0x6366f1;
const MUSIC_ACCENT_PAUSED = 0xf0b232;
const COVER_SIZE = 512;
/**
 * Solid two-tone track used instead of a ruler of dashes with an emoji knob.
 * Discord cannot draw a real progress bar, so this is the cleanest option.
 */
export function progressTrack(pos, duration, length = 14) {
    const ratio = duration > 0 ? Math.max(0, Math.min(1, pos / duration)) : 0;
    const filled = Math.max(0, Math.min(length, Math.round(ratio * length)));
    return `${'▰'.repeat(filled)}${'▱'.repeat(length - filled)}`;
}
/**
 * Branded cover tile used when the source gives us no album art. It renders at
 * thumbnail scale, so it carries a monogram and nothing else.
 * Canvas is an optional dependency, exactly like the Now Playing renderer.
 */
async function renderCoverTile(title) {
    try {
        const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas');
        try {
            const fontPath = path.resolve(process.cwd(), 'assets', 'fonts', 'GoogleSans.ttf');
            if (fs.existsSync(fontPath))
                GlobalFonts.registerFromPath(fontPath, 'GoogleSans');
        }
        catch {
            // Bundled font is optional — canvas falls back to sans-serif.
        }
        const canvas = createCanvas(COVER_SIZE, COVER_SIZE);
        const ctx = canvas.getContext('2d');
        const bg = ctx.createLinearGradient(0, 0, COVER_SIZE, COVER_SIZE);
        bg.addColorStop(0, '#242457');
        bg.addColorStop(0.55, '#141432');
        bg.addColorStop(1, '#0a0a17');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
        const glow = ctx.createRadialGradient(COVER_SIZE * 0.3, COVER_SIZE * 0.22, 10, COVER_SIZE * 0.3, COVER_SIZE * 0.22, COVER_SIZE * 0.95);
        glow.addColorStop(0, 'rgba(148, 163, 255, 0.75)');
        glow.addColorStop(0.5, 'rgba(99, 102, 241, 0.18)');
        glow.addColorStop(1, 'rgba(99, 102, 241, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
        const words = title.replace(/[^\p{L}\p{N} ]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
        const monogram = (words.slice(0, 2).map((word) => word[0]).join('') || 'VC').toUpperCase();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
        ctx.font = 'bold 240px GoogleSans, sans-serif';
        ctx.fillText(monogram, COVER_SIZE / 2, COVER_SIZE / 2 + 10);
        return canvas.toBuffer('image/png');
    }
    catch (err) {
        logger.warn('Music cover generator unavailable; continuing without artwork:', err);
        return null;
    }
}
const CARD_W = 1000;
const CARD_H = 340;
const CARD_PAD = 28;
const CARD_ART = 284;
function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}
/** Shrinks text until it fits `maxW`, then ellipsizes. Leaves ctx.font set for the caller. */
function fitCardText(ctx, value, maxW, size, minSize, bold = true) {
    const font = (s) => `${bold ? 'bold ' : ''}${s}px GoogleSans, sans-serif`;
    let s = size;
    ctx.font = font(s);
    while (ctx.measureText(value).width > maxW && s > minSize) {
        s -= 1;
        ctx.font = font(s);
    }
    if (ctx.measureText(value).width <= maxW)
        return value;
    let out = value;
    while (out.length > 1 && ctx.measureText(`${out}...`).width > maxW)
        out = out.slice(0, -1);
    return `${out}...`;
}
/** Album art fetch with a hard timeout — a slow CDN must never stall an interaction. */
async function loadArtwork(url) {
    if (!url || !url.startsWith('http'))
        return null;
    try {
        const { loadImage } = await import('@napi-rs/canvas');
        const pending = loadImage(url).catch(() => null);
        const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 3000));
        return (await Promise.race([pending, timeout])) ?? null;
    }
    catch {
        return null;
    }
}
/**
 * Lavalink players expose get/set for arbitrary state. Guarded so a stub player
 * (or a cache error) can never take the banner down with it.
 */
function readCardCache(player) {
    try {
        return player.get?.('musicCard');
    }
    catch {
        return undefined;
    }
}
function writeCardCache(player, value) {
    try {
        player.set?.('musicCard', value);
    }
    catch {
        // Memoisation is an optimisation — never let it break rendering.
    }
}
/**
 * The Now Playing banner: album art, track identity, a real progress bar and a
 * row of metadata chips. Shared by the public card and the control panel so both
 * surfaces show the same artwork, and memoised per playback state because a
 * single button press refreshes both messages.
 *
 * Returns null when canvas is unavailable so callers can fall back to text.
 */
async function renderMusicCard(player, guild) {
    const track = player.queue.current;
    if (!track)
        return null;
    const info = track.info;
    const reqId = requesterId(track);
    const live = !!info.isStream;
    const duration = info.duration ?? 0;
    const pos = live ? 0 : Math.min(player.position ?? 0, duration);
    const ratio = live ? 1 : duration > 0 ? Math.max(0, Math.min(1, pos / duration)) : 0;
    const cacheKey = [
        info.uri,
        Math.round((player.position ?? 0) / 5000),
        player.paused ? 'p' : 'r',
        player.volume,
        player.repeatMode,
        reqId ?? '',
    ].join('|');
    const cached = readCardCache(player);
    if (cached && cached.key === cacheKey)
        return cached.buffer;
    try {
        const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas');
        try {
            const fontPath = path.resolve(process.cwd(), 'assets', 'fonts', 'GoogleSans.ttf');
            if (fs.existsSync(fontPath))
                GlobalFonts.registerFromPath(fontPath, 'GoogleSans');
        }
        catch {
            // Bundled font is optional — canvas falls back to sans-serif.
        }
        const canvas = createCanvas(CARD_W, CARD_H);
        const ctx = canvas.getContext('2d');
        const art = await loadArtwork(typeof info.artworkUrl === 'string' ? info.artworkUrl : null);
        // Backdrop: base gradient, a blurred wash of the album art, then a vignette.
        const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
        bg.addColorStop(0, '#101018');
        bg.addColorStop(0.5, '#17171d');
        bg.addColorStop(1, '#0c0c12');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, CARD_W, CARD_H);
        if (art) {
            ctx.save();
            ctx.globalAlpha = 0.26;
            try {
                ctx.filter = 'blur(52px)';
            }
            catch {
                // Filter support varies by build — an unblurred wash still reads fine.
            }
            ctx.drawImage(art, CARD_W - 520, -140, 640, 640);
            ctx.filter = 'none';
            ctx.restore();
        }
        // Album art tile, or a generated monogram when the source has none.
        ctx.save();
        roundRectPath(ctx, CARD_PAD, CARD_PAD, CARD_ART, CARD_ART, 24);
        ctx.clip();
        if (art) {
            ctx.drawImage(art, CARD_PAD, CARD_PAD, CARD_ART, CARD_ART);
        }
        else {
            const tile = ctx.createLinearGradient(CARD_PAD, CARD_PAD, CARD_PAD + CARD_ART, CARD_PAD + CARD_ART);
            tile.addColorStop(0, '#242457');
            tile.addColorStop(0.55, '#141432');
            tile.addColorStop(1, '#0a0a17');
            ctx.fillStyle = tile;
            ctx.fillRect(CARD_PAD, CARD_PAD, CARD_ART, CARD_ART);
            const words = (info.title ?? '').replace(/[^\p{L}\p{N} ]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
            const monogram = (words.slice(0, 2).map((word) => word[0]).join('') || 'VC').toUpperCase();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = 'bold 132px GoogleSans, sans-serif';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
            ctx.fillText(monogram, CARD_PAD + CARD_ART / 2, CARD_PAD + CARD_ART / 2 + 4);
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 2;
        roundRectPath(ctx, CARD_PAD, CARD_PAD, CARD_ART, CARD_ART, 24);
        ctx.stroke();
        const x0 = CARD_PAD + CARD_ART + 36;
        const x1 = CARD_W - CARD_PAD;
        const colW = x1 - x0;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = 'bold 19px GoogleSans, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
        ctx.fillText(live ? 'VICTUS CLOUD • LIVE STREAM' : player.paused ? 'VICTUS CLOUD • PAUSED' : 'VICTUS CLOUD • NOW PLAYING', x0, 56);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(fitCardText(ctx, info.title || 'Unknown title', colW, 44, 26), x0, 110);
        ctx.font = '26px GoogleSans, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.fillText(fitCardText(ctx, info.author || 'Unknown artist', colW, 26, 18, false), x0, 152);
        ctx.font = '21px GoogleSans, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillText(live ? 'LIVE' : formatDuration(pos), x0, 200);
        if (!live) {
            ctx.textAlign = 'right';
            ctx.fillText(formatDuration(duration), x1, 200);
            ctx.textAlign = 'left';
        }
        const barY = 216;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
        roundRectPath(ctx, x0, barY, colW, 10, 5);
        ctx.fill();
        if (ratio > 0) {
            const fill = ctx.createLinearGradient(x0, 0, x0 + colW, 0);
            fill.addColorStop(0, '#6366f1');
            fill.addColorStop(1, '#a5b4fc');
            ctx.fillStyle = fill;
            roundRectPath(ctx, x0, barY, Math.max(12, colW * ratio), 10, 5);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x0 + colW * ratio, barY + 5, 9, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }
        const chips = [
            `Volume ${player.volume}%`,
            `Loop ${player.repeatMode === 'off' ? 'off' : player.repeatMode}`,
            `${player.queue.tracks.length} in queue`,
            sourceLabel(info.sourceName),
        ];
        if (reqId && guild?.members?.cache) {
            const member = guild.members.cache.get(reqId);
            chips.push(member?.displayName || member?.user?.username || 'Unknown');
        }
        ctx.font = '20px GoogleSans, sans-serif';
        ctx.textBaseline = 'middle';
        let chipX = x0;
        for (const label of chips) {
            const width = ctx.measureText(label).width + 36;
            if (chipX + width > x1)
                break;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
            roundRectPath(ctx, chipX, 248, width, 42, 21);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
            ctx.fillText(label, chipX + 18, 270);
            chipX += width + 10;
        }
        const buffer = canvas.toBuffer('image/png');
        writeCardCache(player, { key: cacheKey, buffer });
        return buffer;
    }
    catch (err) {
        logger.warn('Music card renderer unavailable; using the text music panel instead:', err);
        return null;
    }
}
/**
 * Ephemeral control panel opened from the Now Playing card.
 *
 * Album art rides in a compact section thumbnail beside the track identity,
 * followed by one progress line, one status line and four labelled button
 * rows. Every visible button maps to a real transport action.
 */
export async function musicControlsContainer(player) {
    const track = player.queue.current;
    if (!track) {
        const container = new ContainerBuilder()
            .setAccentColor(MUSIC_ACCENT)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ♪ VICTUS CLOUD • MUSIC CONTROL\n` +
            `# Nothing playing\n\n` +
            `Start a track with \`/play\` and reopen this panel.`));
        return { embeds: [], components: [container], files: [] };
    }
    const info = track.info;
    const live = !!info.isStream;
    const duration = info.duration ?? 0;
    const pos = live ? 0 : Math.min(player.position ?? 0, duration);
    const paused = player.paused;
    const queueLen = player.queue.tracks.length;
    const loopLabel = player.repeatMode === 'off' ? 'off' : player.repeatMode === 'track' ? 'track' : 'queue';
    const loopEmoji = player.repeatMode === 'off' ? '🔁' : player.repeatMode === 'track' ? '🔂' : '🔁';
    const files = [];
    const container = new ContainerBuilder().setAccentColor(paused ? MUSIC_ACCENT_PAUSED : MUSIC_ACCENT);
    // The header is the same banner /play posts. If canvas is unavailable the panel
    // falls back to a compact text header rather than losing its artwork entirely.
    const card = await renderMusicCard(player);
    if (card) {
        files.push(new AttachmentBuilder(card, { name: 'musicard.png' }));
        container
            .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://musicard.png')))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    }
    else {
        // Fallback header: real album art when the source has it, else a generated tile.
        let artwork = typeof info.artworkUrl === 'string' && info.artworkUrl.startsWith('http') ? info.artworkUrl : null;
        if (!artwork) {
            const cover = await renderCoverTile(info.title ?? '');
            if (cover) {
                files.push(new AttachmentBuilder(cover, { name: 'music-cover.png' }));
                artwork = 'attachment://music-cover.png';
            }
        }
        const identity = new TextDisplayBuilder().setContent(`-# ♪ VICTUS CLOUD • MUSIC CONTROL\n` +
            `# ${escapeMd(info.title)}\n` +
            `-# ${escapeMd(info.author || 'Unknown artist')} • ${sourceLabel(info.sourceName)}`);
        if (artwork) {
            container.addSectionComponents(new SectionBuilder()
                .addTextDisplayComponents(identity)
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(artwork).setDescription('Album art')));
        }
        else {
            container.addTextDisplayComponents(identity);
        }
        container
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(live
            ? '🔴 Live stream'
            : `\`${formatDuration(pos)}\` ${progressTrack(pos, duration)} \`${formatDuration(duration)}\``))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${paused ? '⏸️ Paused' : '▶️ Playing'} • 🔊 ${player.volume}% • ${loopEmoji} Loop ${loopLabel} • 📋 ${queueLen} in queue`))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    }
    const playbackRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music:previous').setEmoji('⏮️').setLabel('Previous').setStyle(ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId('music:pause')
        .setEmoji(paused ? '▶️' : '⏸️')
        .setLabel(paused ? 'Resume' : 'Pause')
        .setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('music:skip').setEmoji('⏭️').setLabel('Skip').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('music:stop').setEmoji('⏹️').setLabel('Stop').setStyle(ButtonStyle.Danger));
    const queueRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music:queue').setEmoji('📋').setLabel(`Queue · ${queueLen}`).setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('music:shuffle').setEmoji('🔀').setLabel('Shuffle').setStyle(ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId('music:loop')
        .setEmoji(loopEmoji)
        .setLabel(`Loop · ${loopLabel.charAt(0).toUpperCase()}${loopLabel.slice(1)}`)
        .setStyle(player.repeatMode === 'off' ? ButtonStyle.Secondary : ButtonStyle.Primary), new ButtonBuilder().setCustomId('music:clear').setEmoji('🗑️').setLabel('Clear').setStyle(ButtonStyle.Secondary));
    const audioRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music:seekback').setEmoji('⏪').setLabel('10s').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('music:seekfwd').setEmoji('⏩').setLabel('10s').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('music:voldown').setEmoji('🔉').setLabel('−10%').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('music:volup').setEmoji('🔊').setLabel('+10%').setStyle(ButtonStyle.Secondary));
    const libraryRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('music:volume').setEmoji('🎚️').setLabel('Volume').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('music:like').setEmoji('🤍').setLabel('Favorite').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('music:library_playlists').setEmoji('📁').setLabel('Playlists').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('music:history').setEmoji('🕒').setLabel('History').setStyle(ButtonStyle.Secondary));
    container
        .addActionRowComponents(playbackRow)
        .addActionRowComponents(queueRow)
        .addActionRowComponents(audioRow)
        .addActionRowComponents(libraryRow);
    return {
        embeds: [],
        components: [container],
        files
    };
}
/** Confirmation shown when a track (or playlist) is queued. */
export function addedContainer(tracks, playlistName, position) {
    const container = new ContainerBuilder();
    if (playlistName && tracks.length > 1) {
        const totalMs = tracks.reduce((sum, t) => sum + (trackInfo(t)?.duration || 0), 0);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# 🎵 MUSIC SYSTEM • QUEUE UPDATE\n` +
            `# ✅ Playlist Added\n\n` +
            `› **Playlist:** \`${escapeMd(playlistName)}\`\n` +
            `› **Tracks:** \`${tracks.length}\`\n` +
            `› **Total Duration:** \`${formatDuration(totalMs)}\`\n` +
            `› **Queue Position:** \`#${position}\``));
        return container;
    }
    const t = tracks[0];
    const info = trackInfo(t);
    const reqId = requesterId(t);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# 🎵 MUSIC SYSTEM • QUEUE UPDATE\n` +
        `# ✅ Track Added\n\n` +
        `**[${escapeMd(info?.title)}](${info?.uri})**\n` +
        `› **Artist:** \`${escapeMd(info?.author || 'Unknown Artist')}\`\n` +
        `› **Duration:** \`${formatDuration(info?.duration)}\`\n` +
        `› **Queue Position:** \`#${position}\`${reqId ? `\n› **Requested By:** <@${reqId}>` : ''}`));
    const art = info?.artworkUrl;
    if (art && typeof art === 'string' && art.startsWith('http')) {
        container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(art)));
    }
    return container;
}
const QUEUE_PAGE_SIZE = 10;
/** Full queue listing, paginated. */
export function queueContainer(player, page = 0) {
    const current = player.queue.current;
    const upcoming = player.queue.tracks;
    const container = new ContainerBuilder();
    let description = `-# 🎵 MUSIC SYSTEM • TRACK QUEUE\n# Live Playlist Queue\n\n`;
    if (current) {
        const info = trackInfo(current);
        const reqId = requesterId(current);
        description += `### 🔊 Now Playing\n` +
            `**[${escapeMd(info?.title)}](${info?.uri})**\n` +
            `› Artist: \`${escapeMd(info?.author || 'Unknown')}\` • Request: ${reqId ? `<@${reqId}>` : 'System'}\n\n`;
    }
    let pages = 1;
    let safePage = 0;
    let totalMs = 0;
    if (!upcoming.length) {
        description += `### ⏭️ Upcoming Playlist\n_No upcoming tracks in queue. Add tracks using \`/play\`._`;
    }
    else {
        pages = Math.max(1, Math.ceil(upcoming.length / QUEUE_PAGE_SIZE));
        safePage = Math.max(0, Math.min(page, pages - 1));
        const start = safePage * QUEUE_PAGE_SIZE;
        const slice = upcoming.slice(start, start + QUEUE_PAGE_SIZE);
        totalMs = upcoming.reduce((sum, t) => sum + (trackInfo(t)?.duration || 0), 0);
        description += `### ⏭️ Upcoming Playlist (${upcoming.length} tracks)\n`;
        slice.forEach((t, i) => {
            const info = trackInfo(t);
            const reqId = requesterId(t);
            description += `\`${start + i + 1}.\` **[${escapeMd(info?.title)}](${info?.uri})**\n` +
                ` - \`${formatDuration(info?.duration)}\` • Requester: ${reqId ? `<@${reqId}>` : 'System'}\n`;
        });
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(description));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Page ${safePage + 1}/${pages} • Total duration: ${formatDuration(totalMs)} • Volume: ${player.volume}%`));
    return container;
}
