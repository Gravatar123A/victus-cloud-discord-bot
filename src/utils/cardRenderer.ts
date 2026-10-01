import { AttachmentBuilder } from 'discord.js';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from './logger.js';

export interface LevelCardOptions {
    username: string;
    avatarUrl?: string | null;
    level: number;
    tierName: string;
    tierEmoji: string;
    tierColorHex?: string;
    totalXp: number;
    progress: number;
    cpToNext: number;
    rankedUp?: boolean;
    mode?: 'levelup' | 'profile';
    coins?: number;
    xpReward?: number;
    coinsReward?: number;
}

export interface BattlePassCardOptions {
    guildName: string;
    guildIconUrl?: string | null;
    level: number;
    totalXp: number;
    progressXp?: number;
    neededXp?: number;
    progressPercent?: number;
    rewards?: string[];
    ramUnlocked?: boolean;
    subdomainUnlocked?: boolean;
    mode?: 'levelup' | 'overview';
}

let fontRegistered = false;

function registerCustomFont(GlobalFonts: any) {
    if (fontRegistered || !GlobalFonts) return;
    const candidates = [
        path.resolve(process.cwd(), 'assets', 'fonts', 'GoogleSans.ttf'),
        path.resolve(process.cwd(), 'node_modules', 'musicard', 'Fonts', 'GoogleSans.ttf'),
    ];
    for (const fontPath of candidates) {
        try {
            if (fs.existsSync(fontPath)) {
                GlobalFonts.registerFromPath(fontPath, 'GoogleSans');
                fontRegistered = true;
                logger.debug(`[CardRenderer] Registered GoogleSans font from ${fontPath}`);
                break;
            }
        } catch (e) {
            logger.debug(`[CardRenderer] Failed to register font at ${fontPath}:`, e);
        }
    }
}

function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
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

// ---------------------------------------------------------------------------
// Shared canvas chrome
// ---------------------------------------------------------------------------

const CARD_WIDTH = 1000;
const CARD_HEIGHT = 430;
const CARD_PAD = 20;
const CARD_RADIUS = 26;
const CARD_INNER_W = CARD_WIDTH - CARD_PAD * 2;
const CARD_INNER_H = CARD_HEIGHT - CARD_PAD * 2;
const CARD_RIGHT = CARD_PAD + CARD_INNER_W;

function fontOf(size: number, bold = true): string {
    return `${bold ? 'bold ' : ''}${size}px GoogleSans, sans-serif`;
}

function clampPercent(value: number): number {
    return Math.max(0, Math.min(100, value));
}

/** Shrinks text to fit `maxW`, then ellipsizes as a last resort. Leaves ctx.font set for the caller. */
function fitText(ctx: any, text: string, maxW: number, size: number, minSize: number, bold = true) {
    let s = size;
    ctx.font = fontOf(s, bold);
    while (ctx.measureText(text).width > maxW && s > minSize) {
        s -= 0.5;
        ctx.font = fontOf(s, bold);
    }
    let out = text;
    if (ctx.measureText(out).width > maxW) {
        while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) {
            out = out.slice(0, -1);
        }
        out = `${out}…`;
    }
    return { text: out, size: s };
}

/** Monochrome backdrop: gradient, dotted grid, diagonal sweep, corner glow and vignette. */
function drawCardBackdrop(ctx: any) {
    const bgGrad = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
    bgGrad.addColorStop(0, '#0a0a0b');
    bgGrad.addColorStop(0.5, '#141416');
    bgGrad.addColorStop(1, '#08080a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
    for (let x = 20; x < CARD_WIDTH; x += 40) {
        for (let y = 20; y < CARD_HEIGHT; y += 40) {
            ctx.fillRect(x, y, 1.4, 1.4);
        }
    }

    const sweep = ctx.createLinearGradient(0, CARD_HEIGHT, CARD_WIDTH, 0);
    sweep.addColorStop(0, 'rgba(255, 255, 255, 0)');
    sweep.addColorStop(0.5, 'rgba(255, 255, 255, 0.03)');
    sweep.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = sweep;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    const cornerGlow = ctx.createRadialGradient(130, 120, 8, 130, 120, 220);
    cornerGlow.addColorStop(0, 'rgba(255, 255, 255, 0.10)');
    cornerGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = cornerGlow;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    const vignette = ctx.createRadialGradient(
        CARD_WIDTH / 2,
        CARD_HEIGHT / 2,
        160,
        CARD_WIDTH / 2,
        CARD_HEIGHT / 2,
        640,
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
}

/** Frosted panel with an outer drop shadow and a gradient hairline border. */
function drawGlassPanel(ctx: any) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 14;
    roundRect(ctx, CARD_PAD, CARD_PAD, CARD_INNER_W, CARD_INNER_H, CARD_RADIUS);
    ctx.fillStyle = 'rgba(18, 18, 20, 0.97)';
    ctx.fill();
    ctx.restore();

    const borderGrad = ctx.createLinearGradient(CARD_PAD, CARD_PAD, CARD_RIGHT, CARD_PAD + CARD_INNER_H);
    borderGrad.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
    borderGrad.addColorStop(0.32, 'rgba(255, 255, 255, 0.08)');
    borderGrad.addColorStop(0.72, 'rgba(255, 255, 255, 0.18)');
    borderGrad.addColorStop(1, 'rgba(255, 255, 255, 0.45)');
    roundRect(ctx, CARD_PAD, CARD_PAD, CARD_INNER_W, CARD_INNER_H, CARD_RADIUS);
    ctx.strokeStyle = borderGrad;
    ctx.lineWidth = 1.4;
    ctx.stroke();
}

/** Uppercase tag pill with a leading dot, drawn from its top-left corner. */
function drawTagPill(ctx: any, x: number, y: number, text: string) {
    ctx.save();
    ctx.font = fontOf(11);
    const w = ctx.measureText(text).width + 34;
    roundRect(ctx, x, y, w, 25, 12.5);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x + 14, y + 12.5, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();

    ctx.font = fontOf(11);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 24, y + 13);
    ctx.textBaseline = 'alphabetic';
}

/** Bold primary title, auto-fitted to `maxW`. */
function drawCardTitle(ctx: any, x: number, y: number, text: string, maxW: number) {
    const fitted = fitText(ctx, text, maxW, 30, 18);
    ctx.save();
    ctx.font = fontOf(fitted.size);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(255, 255, 255, 0.28)';
    ctx.shadowBlur = 10;
    ctx.textAlign = 'left';
    ctx.fillText(fitted.text, x, y);
    ctx.restore();
}

/** Muted one-line subtitle. */
function drawCardSubtitle(ctx: any, x: number, y: number, text: string) {
    ctx.font = fontOf(14.5, false);
    ctx.fillStyle = '#a1a1aa';
    ctx.textAlign = 'left';
    ctx.fillText(text, x, y);
}

/** Left / right labelled row sitting above a progress bar. */
function drawProgressLabels(ctx: any, x: number, y: number, w: number, left: string, right: string) {
    ctx.font = fontOf(13);
    ctx.fillStyle = '#e4e4e7';
    ctx.textAlign = 'left';
    ctx.fillText(left, x, y - 10);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(right, x + w, y - 10);
    ctx.textAlign = 'left';
}

/** Horizontal progress bar with a glossy fill and a glowing leading knob. */
function drawProgressBar(ctx: any, x: number, y: number, w: number, h: number, progress: number) {
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = '#232326';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (progress <= 0) return;

    const fillW = Math.max(h, (w * progress) / 100);
    ctx.save();
    roundRect(ctx, x, y, fillW, h, h / 2);
    const fillGrad = ctx.createLinearGradient(x, 0, x + fillW, 0);
    fillGrad.addColorStop(0, '#ffffff');
    fillGrad.addColorStop(0.55, '#e4e4e7');
    fillGrad.addColorStop(1, '#a1a1aa');
    ctx.fillStyle = fillGrad;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.35)';
    ctx.shadowBlur = 6;
    ctx.fill();

    // Glossy top band
    ctx.beginPath();
    ctx.rect(x + h / 2, y + 3, Math.max(0, fillW - h), h / 3.2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
    ctx.fill();

    // Leading knob
    ctx.beginPath();
    ctx.arc(x + fillW - h / 2, y + h / 2, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(255, 255, 255, 0.85)';
    ctx.shadowBlur = 9;
    ctx.fill();
    ctx.restore();
}

/** Centred footer wordmark. */
function drawCardFooter(ctx: any, text: string) {
    ctx.font = fontOf(12, false);
    ctx.fillStyle = '#52525b';
    ctx.textAlign = 'center';
    ctx.fillText(text, CARD_WIDTH / 2, CARD_HEIGHT - 38);
    ctx.textAlign = 'left';
}

// ---------------------------------------------------------------------------
// Level card components
// ---------------------------------------------------------------------------

const RING_CX = 120;
const RING_CY = 114;
const AVATAR_RADIUS = 54;
const RING_RADIUS = 60;
const LEVEL_CONTENT_X = 212;
const LEVEL_BAR_X = LEVEL_CONTENT_X;
const LEVEL_BAR_Y = 166;
const LEVEL_BAR_H = 20;
const LEVEL_BAR_W = CARD_RIGHT - LEVEL_BAR_X - 22;
const LEVEL_TILE_X = CARD_PAD + 24;
const LEVEL_TILE_Y = 206;
const LEVEL_TILE_H = 154;
const LEVEL_TILE_GAP = 14;
const LEVEL_TILE_W = (CARD_INNER_W - 48 - LEVEL_TILE_GAP * 2) / 3;

/** Oversized, ghosted watermark anchoring the header's right side. */
function drawWatermark(ctx: any, text: string, size: number, maxW: number) {
    const fitted = fitText(ctx, text, maxW, size, size * 0.6);
    ctx.save();
    ctx.font = fontOf(fitted.size);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillText(fitted.text, CARD_RIGHT - 42, 142);
    ctx.restore();
}

/** Keeps 3- and 4-digit levels from crowding the header. `base` is the 1-2 digit size. */
function watermarkSizeForLevel(level: number, base = 118): number {
    if (level >= 1000) return Math.round(base * 0.73);
    if (level >= 100) return Math.round(base * 0.86);
    return base;
}

/** Ghosted brand wordmark centred along the bottom of the card. */
function drawBottomWatermark(ctx: any, text: string) {
    const fitted = fitText(ctx, text, 560, 64, 40);
    ctx.save();
    ctx.font = fontOf(fitted.size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillText(fitted.text, CARD_WIDTH / 2, CARD_HEIGHT - 46);
    ctx.restore();
}

/** Circular progress ring with a glowing leading arc. */
function drawProgressRing(ctx: any, progress: number) {
    ctx.beginPath();
    ctx.arc(RING_CX, RING_CY, RING_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)';
    ctx.lineWidth = 6;
    ctx.stroke();

    if (progress <= 0) return;

    ctx.save();
    ctx.beginPath();
    if (progress >= 100) {
        // A full sweep from a negative start angle collapses to nothing in Skia,
        // so draw the completed ring as a plain full circle instead.
        ctx.arc(RING_CX, RING_CY, RING_RADIUS, 0, Math.PI * 2);
    } else {
        ctx.arc(RING_CX, RING_CY, RING_RADIUS, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * progress) / 100);
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255, 255, 255, 0.55)';
    ctx.shadowBlur = 9;
    ctx.stroke();
    ctx.restore();
}

/** Clipped circular avatar, falling back to initials when the image is missing. */
async function drawCircularAvatar(
    ctx: any,
    loadImage: (url: string) => Promise<any>,
    imageUrl: string | null | undefined,
    initials: string,
) {
    let img: any = null;
    if (imageUrl) {
        try {
            img = await loadImage(imageUrl);
        } catch {
            img = null;
        }
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(RING_CX, RING_CY, AVATAR_RADIUS, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (img) {
        ctx.drawImage(img, RING_CX - AVATAR_RADIUS, RING_CY - AVATAR_RADIUS, AVATAR_RADIUS * 2, AVATAR_RADIUS * 2);
    } else {
        const avGrad = ctx.createLinearGradient(
            RING_CX - AVATAR_RADIUS,
            RING_CY - AVATAR_RADIUS,
            RING_CX + AVATAR_RADIUS,
            RING_CY + AVATAR_RADIUS,
        );
        avGrad.addColorStop(0, '#2a2a2e');
        avGrad.addColorStop(1, '#151517');
        ctx.fillStyle = avGrad;
        ctx.fillRect(RING_CX - AVATAR_RADIUS, RING_CY - AVATAR_RADIUS, AVATAR_RADIUS * 2, AVATAR_RADIUS * 2);
        ctx.fillStyle = '#f4f4f5';
        ctx.font = fontOf(40);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials.slice(0, 2).toUpperCase(), RING_CX, RING_CY + 1);
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(RING_CX, RING_CY, AVATAR_RADIUS + 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
}

/** White pill seated on the progress ring. */
function drawRingBadge(ctx: any, cy: number, text: string) {
    ctx.font = fontOf(13);
    const h = 26;
    const w = Math.max(70, ctx.measureText(text).width + 28);
    const x = RING_CX - w / 2;
    const y = cy - h / 2;

    ctx.save();
    roundRect(ctx, x, y, w, h, 13);
    const badgeGrad = ctx.createLinearGradient(x, y, x, y + h);
    badgeGrad.addColorStop(0, '#ffffff');
    badgeGrad.addColorStop(1, '#d4d4d8');
    ctx.fillStyle = badgeGrad;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#0a0a0b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, RING_CX, y + h / 2 + 0.5);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
}

/**
 * Frosted stat tile: small label, large auto-fitting value, muted sub label and a
 * thin accent tick. Symbols are deliberately avoided — `muted` dims the value to
 * signal a locked / inactive state.
 */
function drawStatTile(ctx: any, x: number, label: string, value: string, sub: string, muted = false) {
    const y = LEVEL_TILE_Y;

    ctx.save();

    roundRect(ctx, x, y, LEVEL_TILE_W, LEVEL_TILE_H, 18);
    ctx.fillStyle = 'rgba(26, 26, 29, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Top sheen
    ctx.save();
    roundRect(ctx, x, y, LEVEL_TILE_W, LEVEL_TILE_H, 18);
    ctx.clip();
    const sheen = ctx.createLinearGradient(x, y, x, y + 70);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.055)');
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x, y, LEVEL_TILE_W, 70);
    ctx.restore();

    // Accent tick
    ctx.beginPath();
    ctx.moveTo(x + 24, y + 0.5);
    ctx.lineTo(x + 64, y + 0.5);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.45)';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Label
    ctx.font = fontOf(11);
    ctx.fillStyle = '#71717a';
    ctx.fillText(label, x + 24, y + 36);

    // Value
    const fitted = fitText(ctx, value, LEVEL_TILE_W - 48, 30, 15);
    ctx.font = fontOf(fitted.size);
    ctx.fillStyle = muted ? '#a1a1aa' : '#fafafa';
    ctx.shadowColor = muted ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.3)';
    ctx.shadowBlur = 7;
    ctx.fillText(fitted.text, x + 24, y + 88);
    ctx.shadowBlur = 0;

    // Sub label
    ctx.font = fontOf(12.5, false);
    ctx.fillStyle = '#a1a1aa';
    ctx.fillText(sub, x + 24, y + 126);

    ctx.restore();
}

/**
 * Generates a clean, premium Level Up or Community Profile visual card.
 */
export async function generateLevelCardAttachment(opts: LevelCardOptions): Promise<AttachmentBuilder | null> {
    try {
        const { createCanvas, loadImage, GlobalFonts } = await import('@napi-rs/canvas');
        registerCustomFont(GlobalFonts);

        const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
        const ctx = canvas.getContext('2d');

        const isLevelUp = opts.mode !== 'profile';
        const progress = clampPercent(opts.progress);

        drawCardBackdrop(ctx);
        drawGlassPanel(ctx);
        drawWatermark(ctx, String(opts.level), watermarkSizeForLevel(opts.level), 320);

        drawProgressRing(ctx, progress);
        await drawCircularAvatar(ctx, loadImage, opts.avatarUrl, opts.username);
        drawRingBadge(ctx, RING_CY + RING_RADIUS + 3, `LVL ${opts.level}`);

        drawTagPill(
            ctx,
            LEVEL_CONTENT_X,
            44,
            isLevelUp ? (opts.rankedUp ? 'RANK PROMOTION' : 'LEVEL UP') : 'COMMUNITY PROFILE',
        );
        drawCardTitle(ctx, LEVEL_CONTENT_X, 104, `@${opts.username}`, 520);
        drawCardSubtitle(
            ctx,
            LEVEL_CONTENT_X,
            128,
            isLevelUp
                ? `Advanced to Level ${opts.level} · rewards deposited`
                : 'Community profile · synced across guilds',
        );

        drawProgressLabels(
            ctx,
            LEVEL_BAR_X,
            LEVEL_BAR_Y,
            LEVEL_BAR_W,
            `TOTAL XP: ${opts.totalXp.toLocaleString()}`,
            `${opts.cpToNext.toLocaleString()} XP TO NEXT LEVEL · ${Math.round(progress)}%`,
        );
        drawProgressBar(ctx, LEVEL_BAR_X, LEVEL_BAR_Y, LEVEL_BAR_W, LEVEL_BAR_H, progress);

        const coinsVal = isLevelUp
            ? `+${opts.coinsReward ?? 100} COINS`
            : `${(opts.coins ?? 0).toLocaleString()} COINS`;
        const xpVal = isLevelUp ? `+${opts.xpReward ?? 200} XP` : '+25 XP / Msg';

        const step = LEVEL_TILE_W + LEVEL_TILE_GAP;
        drawStatTile(ctx, LEVEL_TILE_X, 'RANK STATUS', opts.tierName, 'Tier progress tracked');
        drawStatTile(
            ctx,
            LEVEL_TILE_X + step,
            isLevelUp ? 'LEVEL REWARD' : 'WALLET BALANCE',
            coinsVal,
            'Free 24/7 server credit',
        );
        drawStatTile(
            ctx,
            LEVEL_TILE_X + step * 2,
            isLevelUp ? 'BONUS XP' : 'CHAT MULTIPLIER',
            xpVal,
            'Auto-applied rewards',
        );

        drawCardFooter(ctx, 'VICTUS CLOUD  ·  Next-Gen Game & Cloud Server Hosting  ·  victuscloud.com');

        const buffer = await canvas.encode('png');
        const filename = isLevelUp ? 'level_up_card.png' : 'level_card.png';
        return new AttachmentBuilder(buffer, { name: filename });
    } catch (err) {
        logger.debug('[CardRenderer] Level card rendering error:', err);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Battle Pass card components
//
// Deliberately a different composition from the level card: a squared guild
// crest, a dedicated level block, and a milestone rail rather than stat tiles.
// ---------------------------------------------------------------------------

const BP_ICON_X = 44;
const BP_ICON_Y = 44;
const BP_ICON_SIZE = 108;
const BP_ICON_RADIUS = 24;
const BP_CONTENT_X = BP_ICON_X + BP_ICON_SIZE + 32;
const BP_BAR_X = BP_CONTENT_X;
const BP_BAR_Y = 162;
const BP_BAR_H = 20;
const BP_BAR_W = CARD_RIGHT - BP_BAR_X - 22;
const BP_RAIL_Y = 216;
const BP_COL_W = (CARD_INNER_W - 48) / 3;

interface BattlePassMilestone {
    level: number;
    perk: string;
    unlocked: boolean;
}

/** Squared guild crest, clipped with a hairline frame. */
async function drawGuildCrest(
    ctx: any,
    loadImage: (url: string) => Promise<any>,
    imageUrl: string | null | undefined,
    initials: string,
) {
    let img: any = null;
    if (imageUrl) {
        try {
            img = await loadImage(imageUrl);
        } catch {
            img = null;
        }
    }

    ctx.save();
    roundRect(ctx, BP_ICON_X, BP_ICON_Y, BP_ICON_SIZE, BP_ICON_SIZE, BP_ICON_RADIUS);
    ctx.clip();
    if (img) {
        ctx.drawImage(img, BP_ICON_X, BP_ICON_Y, BP_ICON_SIZE, BP_ICON_SIZE);
    } else {
        const grad = ctx.createLinearGradient(BP_ICON_X, BP_ICON_Y, BP_ICON_X + BP_ICON_SIZE, BP_ICON_Y + BP_ICON_SIZE);
        grad.addColorStop(0, '#2a2a2e');
        grad.addColorStop(1, '#151517');
        ctx.fillStyle = grad;
        ctx.fillRect(BP_ICON_X, BP_ICON_Y, BP_ICON_SIZE, BP_ICON_SIZE);
        ctx.fillStyle = '#f4f4f5';
        ctx.font = fontOf(40);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials.slice(0, 2).toUpperCase(), BP_ICON_X + BP_ICON_SIZE / 2, BP_ICON_Y + BP_ICON_SIZE / 2 + 1);
    }
    ctx.restore();

    roundRect(ctx, BP_ICON_X, BP_ICON_Y, BP_ICON_SIZE, BP_ICON_SIZE, BP_ICON_RADIUS);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
}

/**
 * Milestone rail: nodes joined by a track that fills up to the furthest unlocked
 * perk, with the perk's name and status stacked beneath each node.
 */
function drawMilestoneRail(ctx: any, milestones: BattlePassMilestone[], currentLevel: number) {
    const centers = milestones.map((_, i) => LEVEL_TILE_X + BP_COL_W * (i + 0.5));
    const first = centers[0];
    const last = centers[centers.length - 1];

    // Base track
    ctx.beginPath();
    ctx.moveTo(first, BP_RAIL_Y);
    ctx.lineTo(last, BP_RAIL_Y);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Completed portion
    let reached = -1;
    milestones.forEach((m, i) => {
        if (m.unlocked) reached = i;
    });
    if (reached >= 0) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(first, BP_RAIL_Y);
        ctx.lineTo(centers[reached], BP_RAIL_Y);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.restore();
    }

    milestones.forEach((m, i) => {
        const cx = centers[i];

        // Node
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, BP_RAIL_Y, 10, 0, Math.PI * 2);
        if (m.unlocked) {
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = 'rgba(255, 255, 255, 0.6)';
            ctx.shadowBlur = 12;
            ctx.fill();
        } else {
            ctx.fillStyle = '#141416';
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        ctx.restore();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';

        // Milestone level
        ctx.font = fontOf(11);
        ctx.fillStyle = '#71717a';
        ctx.fillText(`LEVEL ${m.level}`, cx, BP_RAIL_Y + 40);

        // Perk
        const fitted = fitText(ctx, m.perk, BP_COL_W - 40, 26, 15);
        ctx.font = fontOf(fitted.size);
        ctx.fillStyle = m.unlocked ? '#fafafa' : '#a1a1aa';
        ctx.shadowColor = m.unlocked ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0)';
        ctx.shadowBlur = m.unlocked ? 7 : 0;
        ctx.fillText(fitted.text, cx, BP_RAIL_Y + 78);
        ctx.shadowBlur = 0;

        // Status
        ctx.font = fontOf(12.5, false);
        ctx.fillStyle = m.unlocked ? '#d4d4d8' : '#71717a';
        ctx.fillText(
            m.unlocked ? 'Active perk' : `Progress ${Math.min(currentLevel, m.level)} / ${m.level}`,
            cx,
            BP_RAIL_Y + 108,
        );
    });

    ctx.textAlign = 'left';
}

/**
 * Generates a clean, premium Server Battle Pass visual card.
 */
export async function generateBattlePassCardAttachment(opts: BattlePassCardOptions): Promise<AttachmentBuilder | null> {
    try {
        const { createCanvas, loadImage, GlobalFonts } = await import('@napi-rs/canvas');
        registerCustomFont(GlobalFonts);

        const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
        const ctx = canvas.getContext('2d');

        const nextLvlXp = opts.neededXp ?? 500 * Math.pow(opts.level, 2);
        const prevLvlXp = 500 * Math.pow(Math.max(1, opts.level - 1), 2);
        const progXp = opts.progressXp ?? Math.max(0, opts.totalXp - prevLvlXp);
        const diffXp = Math.max(1, nextLvlXp - prevLvlXp);
        const progress = clampPercent(opts.progressPercent ?? Math.round((progXp / diffXp) * 100));

        drawCardBackdrop(ctx);
        drawGlassPanel(ctx);
        drawWatermark(ctx, String(opts.level), watermarkSizeForLevel(opts.level, 140), 320);

        await drawGuildCrest(ctx, loadImage, opts.guildIconUrl, opts.guildName);

        drawTagPill(
            ctx,
            BP_CONTENT_X,
            48,
            opts.mode === 'levelup' ? 'BATTLE PASS LEVEL UP' : 'SERVER BATTLE PASS',
        );
        drawCardTitle(ctx, BP_CONTENT_X, 104, opts.guildName, 470);
        drawCardSubtitle(ctx, BP_CONTENT_X, 128, 'Community XP from chat, mining & invites');

        drawProgressLabels(
            ctx,
            BP_BAR_X,
            BP_BAR_Y,
            BP_BAR_W,
            `TOTAL SERVER XP: ${opts.totalXp.toLocaleString()}`,
            `${Math.max(0, diffXp - progXp).toLocaleString()} XP TO LEVEL ${opts.level + 1} · ${Math.round(progress)}%`,
        );
        drawProgressBar(ctx, BP_BAR_X, BP_BAR_Y, BP_BAR_W, BP_BAR_H, progress);

        drawMilestoneRail(
            ctx,
            [
                { level: 5, perk: '+1GB RAM', unlocked: Boolean(opts.ramUnlocked) || opts.level >= 5 },
                { level: 10, perk: 'SUBDOMAIN', unlocked: Boolean(opts.subdomainUnlocked) || opts.level >= 10 },
                { level: 20, perk: 'VPS NODE', unlocked: opts.level >= 20 },
            ],
            opts.level,
        );

        drawBottomWatermark(ctx, 'VICTUS CLOUD');
        drawCardFooter(ctx, 'Free Server RAM & Subdomain Hosting Rewards  ·  victuscloud.com');

        const buffer = await canvas.encode('png');
        return new AttachmentBuilder(buffer, { name: 'battle_pass_card.png' });
    } catch (err) {
        logger.debug('[CardRenderer] Battle Pass card rendering error:', err);
        return null;
    }
}
