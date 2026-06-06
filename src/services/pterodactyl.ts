import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export type PowerSignal = 'start' | 'stop' | 'restart' | 'kill';

type PanelResponse = {
    error?: string;
    errors?: { detail?: string; code?: string }[];
};

function normalizeBaseUrl(url: string): string {
    return url.replace(/\/+$/, '');
}

function errorMessage(payload: PanelResponse | null, fallback: string): string {
    const detail = payload?.errors?.find((item) => item.detail)?.detail;
    return detail || payload?.error || fallback;
}

class PterodactylService {
    isPowerConfigured(): boolean {
        return !!config.pterodactyl.url && !!config.pterodactyl.clientApiKey;
    }

    async sendPowerSignal(serverIdentifier: string, signal: PowerSignal): Promise<void> {
        if (!config.pterodactyl.url) {
            throw new Error('Pterodactyl URL is not configured. Set PTERODACTYL_URL.');
        }

        if (!config.pterodactyl.clientApiKey) {
            throw new Error('Panel power actions need PTERODACTYL_CLIENT_API_KEY.');
        }

        const response = await fetch(
            `${normalizeBaseUrl(config.pterodactyl.url)}/api/client/servers/${encodeURIComponent(serverIdentifier)}/power`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.pterodactyl.clientApiKey}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ signal }),
            }
        );

        if (!response.ok) {
            const payload = await response.json().catch(() => null) as PanelResponse | null;
            const message = errorMessage(payload, `Panel returned ${response.status}`);
            logger.warn(`Power signal ${signal} failed for ${serverIdentifier}: ${message}`);
            throw new Error(message);
        }
    }
}

export const pterodactyl = new PterodactylService();
