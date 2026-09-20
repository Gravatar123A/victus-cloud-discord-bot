import { AttachmentBuilder } from 'discord.js';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from './logger.js';
let fontRegistered = false;
function registerCustomFont(GlobalFonts) {
    if (fontRegistered || !GlobalFonts)
        return;
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
        }
        catch (e) {
            logger.debug(`[CardRenderer] Failed to register font at ${fontPath}:`, e);
        }
    }
}
function roundRect(ctx, x, y, w, h, r) {
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
function drawVectorStar(ctx, cx, cy, spikes, outerRadius, innerRadius, color) {
    let rot = Math.PI / 2 * 3;
    let x = cx;
    let y = cy;
    const step = Math.PI / spikes;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
        x = cx + Math.cos(rot) * outerRadius;
        y = cy + Math.sin(rot) * outerRadius;
        ctx.lineTo(x, y);
        rot += step;
        x = cx + Math.cos(rot) * innerRadius;
        y = cy + Math.sin(rot) * innerRadius;
        ctx.lineTo(x, y);
        rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
    ctx.fillStyle = color || '#ffffff';
    ctx.fill();
    ctx.restore();
}
function drawCoinIcon(ctx, x, y, radius) {
    ctx.save();
    ctx.shadowColor = 'rgba(245, 158, 11, 0.6)';
    ctx.shadowBlur = 10;
    const rimGrad = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
    rimGrad.addColorStop(0, '#fde68a');
    rimGrad.addColorStop(0.5, '#f59e0b');
    rimGrad.addColorStop(1, '#b45309');
    ctx.fillStyle = rimGrad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, radius - 2.5, 0, Math.PI * 2);
    ctx.stroke();
    const faceGrad = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, radius - 4);
    faceGrad.addColorStop(0, '#fbbf24');
    faceGrad.addColorStop(0.8, '#d97706');
    faceGrad.addColorStop(1, '#92400e');
    ctx.fillStyle = faceGrad;
    ctx.beginPath();
    ctx.arc(x, y, radius - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, radius - 6, -Math.PI * 0.7, -Math.PI * 0.2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(radius * 1.1)}px GoogleSans, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 3;
    ctx.fillText('V', x, y + 1);
    ctx.restore();
}
function drawGemIcon(ctx, x, y, size) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 210, 255, 0.7)';
    ctx.shadowBlur = 12;
    const s = size / 2;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.7, y - s * 0.4);
    ctx.lineTo(x + s * 0.7, y - s * 0.4);
    ctx.lineTo(x, y + s * 0.9);
    ctx.closePath();
    const gemGrad = ctx.createLinearGradient(x - s, y - s, x + s, y + s);
    gemGrad.addColorStop(0, '#67e8f9');
    gemGrad.addColorStop(0.4, '#06b6d4');
    gemGrad.addColorStop(1, '#0284c7');
    ctx.fillStyle = gemGrad;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - s * 0.7, y - s * 0.4);
    ctx.lineTo(x - s * 0.4, y - s * 0.9);
    ctx.lineTo(x + s * 0.4, y - s * 0.9);
    ctx.lineTo(x + s * 0.7, y - s * 0.4);
    ctx.closePath();
    ctx.fillStyle = '#a5f3fc';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y - s * 0.4);
    ctx.lineTo(x, y + s * 0.9);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x - s * 0.2, y - s * 0.5, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.restore();
}
function drawShieldIcon(ctx, x, y, size, color) {
    ctx.save();
    ctx.shadowColor = color || 'rgba(0, 210, 255, 0.6)';
    ctx.shadowBlur = 10;
    const s = size / 2;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.85, y - s * 0.5);
    ctx.lineTo(x + s * 0.75, y + s * 0.35);
    ctx.quadraticCurveTo(x, y + s * 1.1, x, y + s);
    ctx.quadraticCurveTo(x, y + s * 1.1, x - s * 0.75, y + s * 0.35);
    ctx.lineTo(x - s * 0.85, y - s * 0.5);
    ctx.closePath();
    const grad = ctx.createLinearGradient(x - s, y - s, x + s, y + s);
    grad.addColorStop(0, '#38bdf8');
    grad.addColorStop(0.6, color || '#0284c7');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    drawVectorStar(ctx, x, y - 1, 5, s * 0.45, s * 0.2, '#ffffff');
    ctx.restore();
}
function drawServerIcon(ctx, x, y, size, color) {
    ctx.save();
    ctx.shadowColor = color || 'rgba(16, 185, 129, 0.6)';
    ctx.shadowBlur = 8;
    const w = size * 0.9;
    const h = size * 0.75;
    const sx = x - w / 2;
    const sy = y - h / 2;
    roundRect(ctx, sx, sy, w, h * 0.44, 4);
    ctx.fillStyle = '#1e293b';
    ctx.fill();
    ctx.strokeStyle = color || '#10b981';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#34d399';
    ctx.beginPath();
    ctx.arc(sx + 8, sy + h * 0.22, 2.5, 0, Math.PI * 2);
    ctx.arc(sx + 16, sy + h * 0.22, 2.5, 0, Math.PI * 2);
    ctx.fill();
    roundRect(ctx, sx, sy + h * 0.56, w, h * 0.44, 4);
    ctx.fillStyle = '#1e293b';
    ctx.fill();
    ctx.strokeStyle = color || '#10b981';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.arc(sx + 8, sy + h * 0.78, 2.5, 0, Math.PI * 2);
    ctx.arc(sx + 16, sy + h * 0.78, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}
function drawGlobeIcon(ctx, x, y, size, color) {
    ctx.save();
    ctx.shadowColor = color || 'rgba(56, 189, 248, 0.6)';
    ctx.shadowBlur = 8;
    const r = size / 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.strokeStyle = color || '#38bdf8';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.45, r, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r, y);
    ctx.stroke();
    ctx.restore();
}
/**
 * Generates Canva-style Level Up or Community Profile visual card.
 */
export async function generateLevelCardAttachment(opts) {
    try {
        const { createCanvas, loadImage, GlobalFonts } = await import('@napi-rs/canvas');
        registerCustomFont(GlobalFonts);
        const width = 1000;
        const height = 430;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        const tierColor = opts.tierColorHex || '#00d2ff';
        const isLevelUp = opts.mode !== 'profile';
        // 1. Canvas Background
        const bgGrad = ctx.createLinearGradient(0, 0, width, height);
        bgGrad.addColorStop(0, '#090b14');
        bgGrad.addColorStop(0.5, '#0e1224');
        bgGrad.addColorStop(1, '#05060d');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);
        // Tech grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
        ctx.lineWidth = 1;
        for (let x = 0; x < width; x += 40) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 0; y < height; y += 40) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        // Ambient glows
        const avatarGlow = ctx.createRadialGradient(140, 130, 10, 140, 130, 220);
        avatarGlow.addColorStop(0, 'rgba(0, 210, 255, 0.22)');
        avatarGlow.addColorStop(1, 'rgba(0, 210, 255, 0)');
        ctx.fillStyle = avatarGlow;
        ctx.fillRect(0, 0, width, height);
        const rightGlow = ctx.createRadialGradient(850, 150, 10, 850, 150, 250);
        rightGlow.addColorStop(0, 'rgba(245, 158, 11, 0.18)');
        rightGlow.addColorStop(1, 'rgba(245, 158, 11, 0)');
        ctx.fillStyle = rightGlow;
        ctx.fillRect(0, 0, width, height);
        // 2. Main Glass Card Container
        const cardX = 20;
        const cardY = 20;
        const cardW = width - 40;
        const cardH = height - 40;
        roundRect(ctx, cardX, cardY, cardW, cardH, 24);
        ctx.fillStyle = 'rgba(13, 16, 32, 0.88)';
        ctx.fill();
        const borderGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
        borderGrad.addColorStop(0, 'rgba(0, 210, 255, 0.7)');
        borderGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.12)');
        borderGrad.addColorStop(0.7, 'rgba(245, 158, 11, 0.35)');
        borderGrad.addColorStop(1, 'rgba(0, 210, 255, 0.25)');
        ctx.strokeStyle = borderGrad;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        // 3. Avatar Section
        const avX = 55;
        const avY = 46;
        const avSize = 120;
        ctx.save();
        ctx.beginPath();
        ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2 + 5, 0, Math.PI * 2);
        ctx.strokeStyle = tierColor;
        ctx.lineWidth = 3.5;
        ctx.shadowColor = tierColor;
        ctx.shadowBlur = 16;
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        if (opts.avatarUrl) {
            try {
                const img = await loadImage(opts.avatarUrl);
                ctx.drawImage(img, avX, avY, avSize, avSize);
            }
            catch {
                ctx.fillStyle = '#1e2438';
                ctx.fillRect(avX, avY, avSize, avSize);
                ctx.fillStyle = '#38bdf8';
                ctx.font = 'bold 44px GoogleSans, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(opts.username.slice(0, 2).toUpperCase(), avX + avSize / 2, avY + avSize / 2);
            }
        }
        else {
            ctx.fillStyle = '#1e2438';
            ctx.fillRect(avX, avY, avSize, avSize);
            ctx.fillStyle = '#38bdf8';
            ctx.font = 'bold 44px GoogleSans, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(opts.username.slice(0, 2).toUpperCase(), avX + avSize / 2, avY + avSize / 2);
        }
        ctx.restore();
        // Badge on Avatar corner
        const badgeW = 72;
        const badgeH = 28;
        const badgeX = avX + avSize - badgeW / 2 - 8;
        const badgeY = avY + avSize - badgeH / 2 - 4;
        ctx.save();
        roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 14);
        const badgeGrad = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeW, badgeY);
        badgeGrad.addColorStop(0, '#00d2ff');
        badgeGrad.addColorStop(1, '#2563eb');
        ctx.fillStyle = badgeGrad;
        ctx.shadowColor = 'rgba(0, 210, 255, 0.8)';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = 'bold 14px GoogleSans, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`LVL ${opts.level}`, badgeX + badgeW / 2, badgeY + badgeH / 2);
        ctx.restore();
        // 4. Header Section
        const contentX = 210;
        const tagText = isLevelUp
            ? (opts.rankedUp ? 'RANK PROMOTION' : 'LEVEL UP EVENT')
            : 'COMMUNITY PROFILE';
        ctx.save();
        ctx.font = 'bold 11px GoogleSans, sans-serif';
        const tagW = ctx.measureText(tagText).width + 30;
        roundRect(ctx, contentX, 46, tagW, 24, 12);
        ctx.fillStyle = 'rgba(0, 210, 255, 0.12)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 210, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(contentX + 13, 58, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#38bdf8';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#38bdf8';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(tagText, contentX + 22, 58);
        ctx.restore();
        // Username
        ctx.save();
        ctx.font = 'bold 30px GoogleSans, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(255, 255, 255, 0.3)';
        ctx.shadowBlur = 8;
        ctx.textAlign = 'left';
        ctx.fillText(`@${opts.username}`, contentX, 102);
        ctx.restore();
        // Subtitle
        ctx.font = '15px GoogleSans, sans-serif';
        ctx.fillStyle = '#94a3b8';
        const subtitle = isLevelUp
            ? `Advanced to Level ${opts.level}! Cross-guild rewards deposited.`
            : `Synchronized Community Profile · Multi-Guild Rail`;
        ctx.fillText(subtitle, contentX, 128);
        // Right Rank Showcase Tile
        const rightBoxW = 195;
        const rightBoxH = 88;
        const rightBoxX = width - cardX - rightBoxW - 20;
        const rightBoxY = 44;
        ctx.save();
        roundRect(ctx, rightBoxX, rightBoxY, rightBoxW, rightBoxH, 18);
        ctx.fillStyle = 'rgba(20, 24, 44, 0.8)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.font = 'bold 11px GoogleSans, sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText('CURRENT RANK', rightBoxX + 16, rightBoxY + 26);
        ctx.font = 'bold 22px GoogleSans, sans-serif';
        ctx.fillStyle = tierColor;
        ctx.shadowColor = tierColor;
        ctx.shadowBlur = 8;
        ctx.fillText(opts.tierName.toUpperCase(), rightBoxX + 16, rightBoxY + 58);
        drawShieldIcon(ctx, rightBoxX + rightBoxW - 32, rightBoxY + rightBoxH / 2, 36, tierColor);
        ctx.restore();
        // 5. Progress Bar Section
        const barX = contentX;
        const barY = 160;
        const barW = width - cardX - barX - 20;
        const barH = 22;
        const clampedProg = Math.max(0, Math.min(100, Math.round(opts.progress)));
        ctx.font = 'bold 13px GoogleSans, sans-serif';
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(`TOTAL XP: ${opts.totalXp.toLocaleString()} XP`, barX, barY - 8);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`${opts.cpToNext.toLocaleString()} XP to Next Level (${clampedProg}%)`, barX + barW, barY - 8);
        ctx.textAlign = 'left';
        ctx.save();
        roundRect(ctx, barX, barY, barW, barH, 11);
        ctx.fillStyle = '#0f1322';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.stroke();
        const fillW = Math.max(16, (barW * clampedProg) / 100);
        roundRect(ctx, barX, barY, fillW, barH, 11);
        const fillGrad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
        fillGrad.addColorStop(0, '#00d2ff');
        fillGrad.addColorStop(0.7, '#3b82f6');
        fillGrad.addColorStop(1, '#6366f1');
        ctx.fillStyle = fillGrad;
        ctx.shadowColor = 'rgba(0, 210, 255, 0.7)';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.beginPath();
        ctx.rect(barX + 6, barY + 2, fillW - 12, barH / 3);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fill();
        ctx.restore();
        // 6. 3 Glass Stat Cards
        const tileY = 208;
        const tileH = 145;
        const tileW = (cardW - 70) / 3;
        function drawStatTile(tx, ty, tw, th, title, value, sub, iconType, accentColor) {
            ctx.save();
            roundRect(ctx, tx, ty, tw, th, 18);
            ctx.fillStyle = 'rgba(18, 22, 40, 0.75)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 1.2;
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(tx + 20, ty);
            ctx.lineTo(tx + tw - 20, ty);
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = 2.5;
            ctx.shadowColor = accentColor;
            ctx.shadowBlur = 8;
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.font = 'bold 11px GoogleSans, sans-serif';
            ctx.fillStyle = '#64748b';
            ctx.textAlign = 'left';
            ctx.fillText(title, tx + 18, ty + 28);
            if (iconType === 'coin') {
                drawCoinIcon(ctx, tx + 34, ty + 68, 18);
                ctx.font = 'bold 22px GoogleSans, sans-serif';
                ctx.fillStyle = '#fbbf24';
                ctx.shadowColor = 'rgba(251, 191, 36, 0.5)';
                ctx.shadowBlur = 8;
                ctx.fillText(value, tx + 62, ty + 75);
            }
            else if (iconType === 'gem') {
                drawGemIcon(ctx, tx + 34, ty + 68, 26);
                ctx.font = 'bold 22px GoogleSans, sans-serif';
                ctx.fillStyle = '#38bdf8';
                ctx.shadowColor = 'rgba(56, 189, 248, 0.5)';
                ctx.shadowBlur = 8;
                ctx.fillText(value, tx + 62, ty + 75);
            }
            else {
                drawShieldIcon(ctx, tx + 34, ty + 68, 30, accentColor);
                ctx.font = 'bold 22px GoogleSans, sans-serif';
                ctx.fillStyle = accentColor;
                ctx.shadowColor = accentColor;
                ctx.shadowBlur = 8;
                ctx.fillText(value, tx + 62, ty + 75);
            }
            ctx.shadowBlur = 0;
            ctx.font = '13px GoogleSans, sans-serif';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(sub, tx + 18, ty + 115);
            ctx.restore();
        }
        const t1X = cardX + 24;
        const t2X = t1X + tileW + 11;
        const t3X = t2X + tileW + 11;
        const coinsVal = isLevelUp
            ? `+${opts.coinsReward ?? 100} COINS`
            : `${(opts.coins ?? 0).toLocaleString()} COINS`;
        const xpVal = isLevelUp
            ? `+${opts.xpReward ?? 200} XP`
            : '+25 XP / Msg';
        drawStatTile(t1X, tileY, tileW, tileH, 'RANK STATUS', opts.tierName, 'Multi-Guild Synced', 'shield', '#00d2ff');
        drawStatTile(t2X, tileY, tileW, tileH, isLevelUp ? 'LEVEL REWARD' : 'WALLET BALANCE', coinsVal, 'Free 24/7 Server Credit', 'coin', '#f59e0b');
        drawStatTile(t3X, tileY, tileW, tileH, isLevelUp ? 'BONUS XP' : 'CHAT MULTIPLIER', xpVal, 'Auto-applied rewards', 'gem', '#a855f7');
        // Footer watermark
        ctx.font = '12px GoogleSans, sans-serif';
        ctx.fillStyle = '#475569';
        ctx.textAlign = 'center';
        ctx.fillText('VICTUS CLOUD  •  Next-Gen Game & Cloud Server Hosting  •  victuscloud.com', width / 2, height - 28);
        const buffer = await canvas.encode('png');
        const filename = isLevelUp ? 'level_up_card.png' : 'level_card.png';
        return new AttachmentBuilder(buffer, { name: filename });
    }
    catch (err) {
        logger.debug('[CardRenderer] Level card rendering error:', err);
        return null;
    }
}
/**
 * Generates Canva-style Server Battle Pass visual card.
 */
export async function generateBattlePassCardAttachment(opts) {
    try {
        const { createCanvas, loadImage, GlobalFonts } = await import('@napi-rs/canvas');
        registerCustomFont(GlobalFonts);
        const width = 1000;
        const height = 430;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        const cardX = 20;
        const cardY = 20;
        const cardW = width - 40;
        const cardH = height - 40;
        // Background
        const bgGrad = ctx.createLinearGradient(0, 0, width, height);
        bgGrad.addColorStop(0, '#0a0d16');
        bgGrad.addColorStop(0.5, '#121829');
        bgGrad.addColorStop(1, '#06080e');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);
        // Grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
        ctx.lineWidth = 1;
        for (let x = 0; x < width; x += 40) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 0; y < height; y += 40) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        // Glows
        const bpGoldGlow = ctx.createRadialGradient(140, 130, 10, 140, 130, 220);
        bpGoldGlow.addColorStop(0, 'rgba(245, 158, 11, 0.25)');
        bpGoldGlow.addColorStop(1, 'rgba(245, 158, 11, 0)');
        ctx.fillStyle = bpGoldGlow;
        ctx.fillRect(0, 0, width, height);
        const bpEmeraldGlow = ctx.createRadialGradient(850, 150, 10, 850, 150, 250);
        bpEmeraldGlow.addColorStop(0, 'rgba(16, 185, 129, 0.2)');
        bpEmeraldGlow.addColorStop(1, 'rgba(16, 185, 129, 0)');
        ctx.fillStyle = bpEmeraldGlow;
        ctx.fillRect(0, 0, width, height);
        // Main Glass Card
        roundRect(ctx, cardX, cardY, cardW, cardH, 24);
        ctx.fillStyle = 'rgba(15, 19, 36, 0.88)';
        ctx.fill();
        const bpBorderGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
        bpBorderGrad.addColorStop(0, 'rgba(245, 158, 11, 0.7)');
        bpBorderGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.12)');
        bpBorderGrad.addColorStop(0.7, 'rgba(16, 185, 129, 0.4)');
        bpBorderGrad.addColorStop(1, 'rgba(245, 158, 11, 0.25)');
        ctx.strokeStyle = bpBorderGrad;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        // Guild Icon
        const avX = 55;
        const avY = 46;
        const avSize = 120;
        ctx.save();
        ctx.beginPath();
        ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2 + 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3.5;
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 16;
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        if (opts.guildIconUrl) {
            try {
                const img = await loadImage(opts.guildIconUrl);
                ctx.drawImage(img, avX, avY, avSize, avSize);
            }
            catch {
                ctx.fillStyle = '#22283a';
                ctx.fillRect(avX, avY, avSize, avSize);
                ctx.fillStyle = '#fbbf24';
                ctx.font = 'bold 44px GoogleSans, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(opts.guildName.slice(0, 2).toUpperCase(), avX + avSize / 2, avY + avSize / 2);
            }
        }
        else {
            ctx.fillStyle = '#22283a';
            ctx.fillRect(avX, avY, avSize, avSize);
            ctx.fillStyle = '#fbbf24';
            ctx.font = 'bold 44px GoogleSans, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(opts.guildName.slice(0, 2).toUpperCase(), avX + avSize / 2, avY + avSize / 2);
        }
        ctx.restore();
        // BP Level Badge on Guild Icon
        const badgeW = 72;
        const badgeH = 28;
        const badgeX = avX + avSize - badgeW / 2 - 8;
        const badgeY = avY + avSize - badgeH / 2 - 4;
        ctx.save();
        roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 14);
        const bpBadgeGrad = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeW, badgeY);
        bpBadgeGrad.addColorStop(0, '#f59e0b');
        bpBadgeGrad.addColorStop(1, '#d97706');
        ctx.fillStyle = bpBadgeGrad;
        ctx.shadowColor = 'rgba(245, 158, 11, 0.8)';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = 'bold 14px GoogleSans, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`LVL ${opts.level}`, badgeX + badgeW / 2, badgeY + badgeH / 2);
        ctx.restore();
        // Guild Header
        const contentX = 210;
        const bpTagText = opts.mode === 'levelup' ? 'BATTLE PASS LEVEL UP' : 'SERVER BATTLE PASS';
        ctx.save();
        ctx.font = 'bold 11px GoogleSans, sans-serif';
        const bpTagW = ctx.measureText(bpTagText).width + 30;
        roundRect(ctx, contentX, 46, bpTagW, 24, 12);
        ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(contentX + 13, 58, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24';
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fbbf24';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(bpTagText, contentX + 22, 58);
        ctx.restore();
        // Server Name
        ctx.save();
        ctx.font = 'bold 28px GoogleSans, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(255, 255, 255, 0.3)';
        ctx.shadowBlur = 8;
        ctx.textAlign = 'left';
        ctx.fillText(opts.guildName.length > 28 ? opts.guildName.slice(0, 26) + '...' : opts.guildName, contentX, 102);
        ctx.restore();
        // Subtitle
        ctx.font = '15px GoogleSans, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('Community XP from Chat, Mining Expeditions & Server Invites', contentX, 128);
        // Right BP Milestone Showcase
        const rightBoxW = 205;
        const rightBoxH = 88;
        const rightBoxX = width - cardX - rightBoxW - 20;
        const rightBoxY = 44;
        ctx.save();
        roundRect(ctx, rightBoxX, rightBoxY, rightBoxW, rightBoxH, 18);
        ctx.fillStyle = 'rgba(26, 22, 40, 0.8)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.font = 'bold 11px GoogleSans, sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText('NEXT MAJOR PERK', rightBoxX + 16, rightBoxY + 26);
        ctx.font = 'bold 18px GoogleSans, sans-serif';
        ctx.fillStyle = '#34d399';
        ctx.shadowColor = '#34d399';
        ctx.shadowBlur = 8;
        const nextPerkText = opts.level < 5 ? '+1GB RAM (LVL 5)' : (opts.level < 10 ? 'SUBDOMAIN (LVL 10)' : 'VPS NODE (LVL 20)');
        ctx.fillText(nextPerkText, rightBoxX + 16, rightBoxY + 58);
        drawServerIcon(ctx, rightBoxX + rightBoxW - 28, rightBoxY + rightBoxH / 2, 32, '#34d399');
        ctx.restore();
        // BP Progress Bar
        const barX = contentX;
        const barY = 160;
        const barW = width - cardX - barX - 20;
        const barH = 22;
        const nextLvlXp = opts.neededXp ?? (500 * Math.pow(opts.level, 2));
        const prevLvlXp = 500 * Math.pow(Math.max(1, opts.level - 1), 2);
        const progXp = opts.progressXp ?? Math.max(0, opts.totalXp - prevLvlXp);
        const diffXp = Math.max(1, nextLvlXp - prevLvlXp);
        const bpProgress = opts.progressPercent ?? Math.min(100, Math.round((progXp / diffXp) * 100));
        ctx.font = 'bold 13px GoogleSans, sans-serif';
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText(`TOTAL SERVER XP: ${opts.totalXp.toLocaleString()} XP`, barX, barY - 8);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(`${(diffXp - progXp).toLocaleString()} XP to Level ${opts.level + 1} (${bpProgress}%)`, barX + barW, barY - 8);
        ctx.textAlign = 'left';
        ctx.save();
        roundRect(ctx, barX, barY, barW, barH, 11);
        ctx.fillStyle = '#0f1322';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.stroke();
        const bpFillW = Math.max(16, (barW * bpProgress) / 100);
        roundRect(ctx, barX, barY, bpFillW, barH, 11);
        const bpFillGrad = ctx.createLinearGradient(barX, 0, barX + bpFillW, 0);
        bpFillGrad.addColorStop(0, '#f59e0b');
        bpFillGrad.addColorStop(0.7, '#10b981');
        bpFillGrad.addColorStop(1, '#06b6d4');
        ctx.fillStyle = bpFillGrad;
        ctx.shadowColor = 'rgba(245, 158, 11, 0.7)';
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.beginPath();
        ctx.rect(barX + 6, barY + 2, bpFillW - 12, barH / 3);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fill();
        ctx.restore();
        // 3 Milestone Cards
        const tileY = 208;
        const tileH = 145;
        const tileW = (cardW - 70) / 3;
        function drawBpMilestoneTile(tx, ty, tw, th, title, value, status, iconType, accentColor, isUnlocked) {
            ctx.save();
            roundRect(ctx, tx, ty, tw, th, 18);
            ctx.fillStyle = isUnlocked ? 'rgba(16, 36, 30, 0.85)' : 'rgba(18, 22, 40, 0.75)';
            ctx.fill();
            ctx.strokeStyle = isUnlocked ? 'rgba(52, 211, 153, 0.3)' : 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 1.2;
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(tx + 20, ty);
            ctx.lineTo(tx + tw - 20, ty);
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = 2.5;
            ctx.shadowColor = accentColor;
            ctx.shadowBlur = 8;
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.font = 'bold 11px GoogleSans, sans-serif';
            ctx.fillStyle = '#64748b';
            ctx.textAlign = 'left';
            ctx.fillText(title, tx + 18, ty + 28);
            if (iconType === 'ram') {
                drawServerIcon(ctx, tx + 34, ty + 68, 30, accentColor);
            }
            else if (iconType === 'globe') {
                drawGlobeIcon(ctx, tx + 34, ty + 68, 30, accentColor);
            }
            else {
                drawShieldIcon(ctx, tx + 34, ty + 68, 30, accentColor);
            }
            ctx.font = 'bold 20px GoogleSans, sans-serif';
            ctx.fillStyle = accentColor;
            ctx.shadowColor = accentColor;
            ctx.shadowBlur = 8;
            ctx.fillText(value, tx + 62, ty + 75);
            ctx.shadowBlur = 0;
            ctx.font = 'bold 13px GoogleSans, sans-serif';
            ctx.fillStyle = isUnlocked ? '#34d399' : '#94a3b8';
            ctx.fillText(status, tx + 18, ty + 115);
            ctx.restore();
        }
        const t1X = cardX + 24;
        const t2X = t1X + tileW + 11;
        const t3X = t2X + tileW + 11;
        const isRamUnlocked = opts.ramUnlocked || opts.level >= 5;
        const isSubdomainUnlocked = opts.subdomainUnlocked || opts.level >= 10;
        drawBpMilestoneTile(t1X, tileY, tileW, tileH, 'LEVEL 5 MILESTONE', '+1GB RAM', isRamUnlocked ? 'ACTIVE PERK' : `PROGRESS: ${opts.level}/5`, 'ram', '#10b981', isRamUnlocked);
        drawBpMilestoneTile(t2X, tileY, tileW, tileH, 'LEVEL 10 MILESTONE', 'SUBDOMAIN', isSubdomainUnlocked ? 'ACTIVE PERK' : `PROGRESS: ${opts.level}/10`, 'globe', '#38bdf8', isSubdomainUnlocked);
        drawBpMilestoneTile(t3X, tileY, tileW, tileH, 'LEVEL 20 MILESTONE', 'VPS NODE', opts.level >= 20 ? 'ACTIVE PERK' : 'LOCKED (LVL 20)', 'shield', '#a855f7', opts.level >= 20);
        ctx.font = '12px GoogleSans, sans-serif';
        ctx.fillStyle = '#475569';
        ctx.textAlign = 'center';
        ctx.fillText('VICTUS CLOUD  •  Free Server RAM & Subdomain Hosting Rewards  •  victuscloud.com', width / 2, height - 28);
        const buffer = await canvas.encode('png');
        return new AttachmentBuilder(buffer, { name: 'battle_pass_card.png' });
    }
    catch (err) {
        logger.debug('[CardRenderer] Battle Pass card rendering error:', err);
        return null;
    }
}
