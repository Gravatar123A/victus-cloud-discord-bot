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

    async getServerResources(serverIdentifier: string): Promise<{
        current_state: string;
        is_suspended: boolean;
        resources: {
            memory_bytes: number;
            cpu_absolute: number;
            disk_bytes: number;
            network_rx_bytes: number;
            network_tx_bytes: number;
            uptime: number;
        };
    }> {
        if (!config.pterodactyl.url || !config.pterodactyl.clientApiKey) {
            throw new Error('Panel credentials not configured.');
        }

        const response = await fetch(
            `${normalizeBaseUrl(config.pterodactyl.url)}/api/client/servers/${encodeURIComponent(serverIdentifier)}/resources`,
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${config.pterodactyl.clientApiKey}`,
                    Accept: 'application/json',
                },
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to fetch server resources (HTTP ${response.status})`);
        }

        const data = await response.json() as any;
        return data.attributes;
    }

    async sendCommand(serverIdentifier: string, command: string): Promise<void> {
        if (!config.pterodactyl.url || !config.pterodactyl.clientApiKey) {
            throw new Error('Panel credentials not configured.');
        }

        const response = await fetch(
            `${normalizeBaseUrl(config.pterodactyl.url)}/api/client/servers/${encodeURIComponent(serverIdentifier)}/command`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.pterodactyl.clientApiKey}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ command }),
            }
        );

        if (!response.ok) {
            const payload = await response.json().catch(() => null) as PanelResponse | null;
            const message = errorMessage(payload, `Panel returned ${response.status}`);
            throw new Error(message);
        }
    }
}

export const pterodactyl = new PterodactylService();

