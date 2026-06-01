import crypto from 'crypto';

/**
 * Generate a secure random token for account linking
 */
export function generateLinkToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a short, user-friendly code for account linking
 */
export function generateShortCode(): string {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

/**
 * Hash a token for secure storage
 */
export function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Calculate expiry time for a token
 */
export function getExpiryTime(minutes: number): Date {
    return new Date(Date.now() + minutes * 60 * 1000);
}

/**
 * Check if a token has expired
 */
export function isTokenExpired(expiryDate: string | Date): boolean {
    const expiry = new Date(expiryDate);
    return expiry < new Date();
}
