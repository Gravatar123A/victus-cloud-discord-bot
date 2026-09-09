import crypto from 'crypto';
/**
 * Generate a secure random token for account linking
 */
export function generateLinkToken() {
    return crypto.randomBytes(32).toString('hex');
}
/**
 * Generate a short, user-friendly code for account linking
 */
export function generateShortCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}
/**
 * Hash a token for secure storage
 */
export function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}
/**
 * Calculate expiry time for a token
 */
export function getExpiryTime(minutes) {
    return new Date(Date.now() + minutes * 60 * 1000);
}
/**
 * Check if a token has expired
 */
export function isTokenExpired(expiryDate) {
    const expiry = new Date(expiryDate);
    return expiry < new Date();
}
