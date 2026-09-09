import { config } from '../config.js';
import { logger } from '../utils/logger.js';
function normalizeBaseUrl(url) {
    return url.replace(/\/+$/, '');
}
function errorMessage(payload, fallback) {
    const detail = payload?.errors?.find((item) => item.detail)?.detail;
    return detail || payload?.error || fallback;
}
class PterodactylService {
    isPowerConfigured() {
        return !!config.pterodactyl.url && !!config.pterodactyl.clientApiKey;
    }
    async sendPowerSignal(serverIdentifier, signal) {
        if (!config.pterodactyl.url) {
            throw new Error('Pterodactyl URL is not configured. Set PTERODACTYL_URL.');
        }
        if (!config.pterodactyl.clientApiKey) {
            throw new Error('Panel power actions need PTERODACTYL_CLIENT_API_KEY.');
        }
        const response = await fetch(`${normalizeBaseUrl(config.pterodactyl.url)}/api/client/servers/${encodeURIComponent(serverIdentifier)}/power`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.pterodactyl.clientApiKey}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ signal }),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            const message = errorMessage(payload, `Panel returned ${response.status}`);
            logger.warn(`Power signal ${signal} failed for ${serverIdentifier}: ${message}`);
            throw new Error(message);
        }
    }
}
export const pterodactyl = new PterodactylService();
