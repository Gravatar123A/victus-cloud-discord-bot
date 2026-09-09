const FISHY_PATTERNS = [
    /^user\d{3,}$/i,
    /^test\d+$/i,
    /^temp\d+$/i,
    /^alt\d+$/i,
    /^fake\d+$/i,
    /^discord$/i,
    /^[a-z]+[_-]?[0-9]{5,}$/i,
    /^[a-z0-9]{12,}$/i,
    /(.)\1{4,}/,
    /^\d+$/,
    /^qwerty/i,
    /^asdf/i,
    /^aaaa/i,
    /^1234/,
];
export function isFishyUsername(username, displayName, globalName) {
    const u = (username || '').trim().toLowerCase();
    const d = (displayName || '').trim().toLowerCase();
    const g = (globalName || '').trim().toLowerCase();
    if (!u || u.length < 3)
        return true;
    if (u.length > 32)
        return true;
    for (const re of FISHY_PATTERNS) {
        if (re.test(u))
            return true;
    }
    if (/\d{6,}/.test(u))
        return true;
    if (u === d && u === g && /^[a-z]+\d+$/.test(u))
        return true;
    if (g && g.length >= 3 && !FISHY_PATTERNS.some(r => r.test(g)))
        return false;
    if (d && d !== u && d.length >= 3)
        return false;
    return false;
}
export function hasAvatar(member) {
    const avatar = member.user.avatar;
    if (!avatar)
        return false;
    const url = member.user.displayAvatarURL();
    if (url.includes('embed/avatars') || url.includes('/avatars/embed'))
        return false;
    return true;
}
export function hasBioLike(member) {
    if (member.user.globalName && member.user.globalName.trim().length >= 2)
        return true;
    if (member.nickname && member.nickname.trim().length >= 2)
        return true;
    if (member.displayName && member.displayName !== member.user.username && member.displayName.trim().length >= 2)
        return true;
    if (member.user.banner)
        return true;
    if (member.user.bio)
        return true;
    if (member.user.accentColor !== null && member.user.accentColor !== undefined)
        return true;
    return false;
}
export function validateInvitee(member, minAgeDays = 30, requireAvatar = true, requireBio = true, strictUsername = true) {
    const ageDays = (Date.now() - member.user.createdTimestamp) / (24 * 60 * 60 * 1000);
    if (ageDays < minAgeDays)
        return { valid: false, reason: `account age ${ageDays.toFixed(1)}d < ${minAgeDays}d` };
    if (requireAvatar && !hasAvatar(member))
        return { valid: false, reason: 'no custom avatar' };
    if (strictUsername && isFishyUsername(member.user.username, member.displayName, member.user.globalName)) {
        return { valid: false, reason: `fishy username ${member.user.username}` };
    }
    if (requireBio && !hasBioLike(member))
        return { valid: false, reason: 'no bio/display name' };
    return { valid: true };
}
