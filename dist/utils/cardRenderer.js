import { AttachmentBuilder } from 'discord.js';
import { logger } from './logger.js';

export async function generateLevelCardAttachment(opts) {
    try {
        const { createCanvas, loadImage } = await import('@napi-rs/canvas');

        const width = 960;
        const height = 480;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        const primaryColor = opts.tierColorHex || '#00d2ff';

        const bgGradient = ctx.createLinearGradient(0, 0, width, height);
        bgGradient.addColorStop(0, '#0d0f1a');
        bgGradient.addColorStop(0.5, '#131627');
        bgGradient.addColorStop(1, '#080910');
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, width, height);

        const radialGlow = ctx.createRadialGradient(200, 150, 20, 200, 150, 320);
        radialGlow.addColorStop(0, 'rgba(0, 210, 255, 0.18)');
        radialGlow.addColorStop(1, 'rgba(0, 210, 255, 0)');
        ctx.fillStyle = radialGlow;
        ctx.fillRect(0, 0, width, height);

        const goldGlow = ctx.createRadialGradient(800, 360, 20, 800, 360, 300);
        goldGlow.addColorStop(0, 'rgba(245, 158, 11, 0.15)');
        goldGlow.addColorStop(1, 'rgba(245, 158, 11, 0)');
        ctx.fillStyle = goldGlow;
        ctx.fillRect(0, 0, width, height);

        function roundRect(x, y, w, h, r) {
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

        ctx.save();
        roundRect(24, 24, width - 48, height - 48, 28);
        ctx.fillStyle = 'rgba(18, 20, 32, 0.82)';
        ctx.fill();
        ctx.lineWidth = 2;
        const borderGrad = ctx.createLinearGradient(0, 0, width, height);
        borderGrad.addColorStop(0, 'rgba(0, 210, 255, 0.5)');
        borderGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
        borderGrad.addColorStop(1, 'rgba(245, 158, 11, 0.4)');
        ctx.strokeStyle = borderGrad;
        ctx.stroke();
        ctx.restore();

        const avatarSize = 130;
        const avatarX = 70;
        const avatarY = 70;

        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 6, 0, Math.PI * 2);
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 4;
        ctx.shadowColor = primaryColor;
        ctx.shadowBlur = 18;
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();

        if (opts.avatarUrl) {
            try {
                const img = await loadImage(opts.avatarUrl);
                ctx.drawImage(img, avatarX, avatarY, avatarSize, avatarSize);
            } catch {
                ctx.fillStyle = '#1e2337';
                ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
                ctx.fillStyle = '#cbd5e1';
                ctx.font = 'bold 50px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(opts.username.slice(0, 2).toUpperCase(), avatarX + avatarSize / 2, avatarY + avatarSize / 2);
            }
        } else {
            ctx.fillStyle = '#1e2337';
            ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
            ctx.fillStyle = '#cbd5e1';
            ctx.font = 'bold 50px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(opts.username.slice(0, 2).toUpperCase(), avatarX + avatarSize / 2, avatarY + avatarSize / 2);
        }
        ctx.restore();

        const textStartX = 230;

        ctx.save();
        ctx.font = 'bold 38px sans-serif';
        const heading = opts.rankedUp ? `RANK UP — ${opts.tierName.toUpperCase()}` : `LEVEL UP — LEVEL ${opts.level}`;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(255, 255, 255, 0.4)';
        ctx.shadowBlur = 12;
        ctx.fillText(heading, textStartX, 105);
        ctx.restore();

        ctx.font = '22px sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`@${opts.username} has reached Level ${opts.level}!`, textStartX, 142);

        ctx.font = 'bold 20px sans-serif';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`Rank: ${opts.tierName}`, textStartX, 185);

        ctx.font = '20px sans-serif';
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(`Total XP: ${opts.totalXp.toLocaleString('en-US')}`, textStartX + 220, 185);

        const barX = textStartX;
        const barY = 215;
        const barW = 650;
        const barH = 26;
        const clampedProg = Math.max(0, Math.min(100, Math.round(opts.progress)));

        ctx.save();
        roundRect(barX, barY, barW, barH, 13);
        ctx.fillStyle = '#1b1f33';
        ctx.fill();
        ctx.strokeStyle = '#2d334e';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        if (clampedProg > 0) {
            const fillW = Math.max(26, (barW * clampedProg) / 100);
            ctx.save();
            roundRect(barX, barY, fillW, barH, 13);
            const fillGrad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
            fillGrad.addColorStop(0, '#00d2ff');
            fillGrad.addColorStop(1, '#3b82f6');
            ctx.fillStyle = fillGrad;
            ctx.shadowColor = '#00d2ff';
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.restore();
        }

        ctx.font = 'bold 15px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.fillText(`Progress ${clampedProg}%`, barX + 16, barY + 18);

        ctx.textAlign = 'right';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`${opts.cpToNext.toLocaleString('en-US')} XP remaining`, barX + barW - 14, barY + 18);
        ctx.textAlign = 'left';

        const rewX = 70;
        const rewY = 280;
        const rewW = width - 140;
        const rewH = 130;

        ctx.save();
        roundRect(rewX, rewY, rewW, rewH, 20);
        ctx.fillStyle = 'rgba(23, 26, 42, 0.7)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        ctx.font = 'bold 17px sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('LEVEL REWARDS', rewX + 24, rewY + 36);

        const xpBonus = opts.xpReward ?? 200;
        const coinBonus = opts.coinsReward ?? 100;

        ctx.font = 'bold 30px sans-serif';
        ctx.fillStyle = '#fbbf24';
        ctx.shadowColor = 'rgba(251, 191, 36, 0.5)';
        ctx.shadowBlur = 10;
        ctx.fillText(`✨ +${xpBonus} XP`, rewX + 24, rewY + 80);

        ctx.fillStyle = '#f59e0b';
        ctx.shadowColor = 'rgba(245, 158, 11, 0.5)';
        ctx.shadowBlur = 10;
        ctx.fillText(`🪙 +${coinBonus} COINS`, rewX + 260, rewY + 80);
        ctx.restore();

        ctx.font = '14px sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText('Victus Cloud cross-guild progression: real COINS deposited to your wallet for free server hosting.', rewX + 24, rewY + 110);

        const buffer = canvas.toBuffer('image/png');
        return new AttachmentBuilder(buffer, { name: 'level_up_card.png' });
    } catch (err) {
        logger.warn('[CardRenderer] Level card canvas renderer unavailable; skipping image generation:', err);
        return null;
    }
}

export async function generateBattlePassCardAttachment(opts) {
    try {
        const { createCanvas, loadImage } = await import('@napi-rs/canvas');

        const width = 960;
        const height = 480;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        const bgGradient = ctx.createLinearGradient(0, 0, width, height);
        bgGradient.addColorStop(0, '#100f17');
        bgGradient.addColorStop(0.5, '#191523');
        bgGradient.addColorStop(1, '#0c0a12');
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, width, height);

        const goldGlow = ctx.createRadialGradient(width / 2, 80, 10, width / 2, 80, 350);
        goldGlow.addColorStop(0, 'rgba(245, 158, 11, 0.22)');
        goldGlow.addColorStop(1, 'rgba(245, 158, 11, 0)');
        ctx.fillStyle = goldGlow;
        ctx.fillRect(0, 0, width, height);

        function roundRect(x, y, w, h, r) {
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

        ctx.save();
        roundRect(24, 24, width - 48, height - 48, 28);
        ctx.fillStyle = 'rgba(20, 18, 28, 0.85)';
        ctx.fill();
        ctx.lineWidth = 2;
        const borderGrad = ctx.createLinearGradient(0, 0, width, height);
        borderGrad.addColorStop(0, 'rgba(245, 158, 11, 0.6)');
        borderGrad.addColorStop(0.5, 'rgba(239, 68, 68, 0.3)');
        borderGrad.addColorStop(1, 'rgba(245, 158, 11, 0.5)');
        ctx.strokeStyle = borderGrad;
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = 'bold 44px sans-serif';
        ctx.fillText('🎖️', width / 2, 85);

        ctx.font = 'bold 36px sans-serif';
        ctx.fillStyle = '#fef08a';
        ctx.shadowColor = 'rgba(250, 204, 21, 0.6)';
        ctx.shadowBlur = 14;
        ctx.fillText('SERVER BATTLE PASS: LEVEL UP!', width / 2, 140);
        ctx.restore();

        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${opts.guildName} has reached Battle Pass Level ${opts.level}!`, width / 2, 185);

        const pillW = 220;
        const pillH = 38;
        const pillX = width / 2 - pillW / 2;
        const pillY = 210;

        roundRect(pillX, pillY, pillW, pillH, 19);
        ctx.fillStyle = 'rgba(245, 158, 11, 0.15)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.font = 'bold 18px sans-serif';
        ctx.fillStyle = '#fde047';
        ctx.fillText(`Total XP: ${opts.totalXp.toLocaleString('en-US')}`, width / 2, pillY + 25);
        ctx.restore();

        const rewBoxY = 275;
        const boxW = (width - 120) / 2;
        const boxH = 100;

        const leftBoxX = 50;
        const rightBoxX = 50 + boxW + 20;

        roundRect(leftBoxX, rewBoxY, boxW, boxH, 18);
        ctx.fillStyle = 'rgba(28, 23, 38, 0.8)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.font = 'bold 24px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('⚡ FREE RAM BONUS', leftBoxX + 30, rewBoxY + 46);
        ctx.font = '15px sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('Hosting credits for free server expansion', leftBoxX + 30, rewBoxY + 75);

        roundRect(rightBoxX, rewBoxY, boxW, boxH, 18);
        ctx.fillStyle = 'rgba(28, 23, 38, 0.8)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.font = 'bold 24px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('🌐 CUSTOM SUBDOMAIN', rightBoxX + 30, rewBoxY + 46);
        ctx.font = '15px sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('mysmp.victus.gg dedicated DNS address', rightBoxX + 30, rewBoxY + 75);

        ctx.textAlign = 'center';
        ctx.font = '15px sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText('Server owner can view & redeem unlocked milestone rewards on victuscloud.com', width / 2, 425);

        const buffer = canvas.toBuffer('image/png');
        return new AttachmentBuilder(buffer, { name: 'battle_pass_card.png' });
    } catch (err) {
        logger.warn('[CardRenderer] Battle Pass card renderer unavailable; skipping image generation:', err);
        return null;
    }
}
