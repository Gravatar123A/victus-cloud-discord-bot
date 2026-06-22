// VCCRS — Victus Cloud Contribution & Rank System.
// Ported 1:1 from the website (src/lib/vccrs.ts) so CP, levels and tiers match
// exactly across the bot and the site. Icons are Discord-friendly emojis.

export interface Tier {
    name: string;
    emoji: string;
    minLevel: number;
    color: number; // embed accent
}

export const TIERS: Tier[] = [
    { name: 'Initiate', emoji: '🌱', minLevel: 1, color: 0xa1a1aa },
    { name: 'Vanguard', emoji: '🛡️', minLevel: 6, color: 0x34d399 },
    { name: 'Stormborn', emoji: '⚡', minLevel: 11, color: 0x60a5fa },
    { name: 'Celestial', emoji: '🌌', minLevel: 21, color: 0xa78bfa },
    { name: 'Titan', emoji: '🔥', minLevel: 36, color: 0xfbbf24 },
    { name: 'Aethel', emoji: '👑', minLevel: 51, color: 0xfb7185 },
];

// CP required to reach a given level: 100 × level^1.2
export function cpRequiredForLevel(level: number): number {
    return Math.floor(100 * Math.pow(level, 1.2));
}

// Cumulative CP needed from 0 to reach a level.
export function totalCPForLevel(level: number): number {
    let total = 0;
    for (let i = 1; i <= level; i++) total += cpRequiredForLevel(i);
    return total;
}

export function calculateLevel(totalCP: number): number {
    let level = 1;
    let accumulated = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const needed = cpRequiredForLevel(level);
        if (accumulated + needed > totalCP) break;
        accumulated += needed;
        level++;
    }
    return level;
}

export function getTierForLevel(level: number): Tier {
    for (let i = TIERS.length - 1; i >= 0; i--) {
        if (level >= TIERS[i].minLevel) return TIERS[i];
    }
    return TIERS[0];
}

export interface LevelProgress {
    level: number;
    tier: Tier;
    progress: number;        // 0-100
    cpIntoLevel: number;     // CP earned within the current level
    cpForLevel: number;      // CP span of the current level
    cpForNextLevel: number;  // cumulative CP needed to finish this level
    cpToNext: number;        // CP remaining to next level
}

export function getLevelProgress(totalCP: number): LevelProgress {
    const cp = Math.max(0, Math.floor(totalCP || 0));
    const level = calculateLevel(cp);
    const cpForCurrentLevel = totalCPForLevel(level - 1);
    const cpForNextLevel = totalCPForLevel(level);
    const span = Math.max(1, cpForNextLevel - cpForCurrentLevel);
    const into = cp - cpForCurrentLevel;
    return {
        level,
        tier: getTierForLevel(level),
        progress: Math.min(100, Math.max(0, (into / span) * 100)),
        cpIntoLevel: into,
        cpForLevel: span,
        cpForNextLevel,
        cpToNext: Math.max(0, cpForNextLevel - cp),
    };
}

// A text progress bar, e.g. ▰▰▰▰▰▱▱▱▱▱
export function progressBar(percent: number, length = 14): string {
    const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * length);
    return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, length - filled));
}

// Friendly label for a cp_transactions.action_type value.
const ACTION_LABELS: Record<string, string> = {
    file_upload: 'File upload',
    image_upload: 'Image upload',
    gallery_upload: 'Gallery upload',
    post_create: 'Created a post',
    comment_create: 'Commented',
    like_given: 'Liked a post',
    like_received: 'Received a like',
    forum_thread: 'Started a thread',
    forum_reply: 'Forum reply',
    profile_complete: 'Completed profile',
    daily_login: 'Daily login',
    invite: 'Invite reward',
    referral: 'Referral reward',
};

export function actionLabel(action: string): string {
    return ACTION_LABELS[action] || action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
