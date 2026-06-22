import type { Client } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

// The "Discord Bot Heartbeat" Uptime Kuma monitor runs on a 120s interval, so
// we push at half that to leave headroom for a missed beat.
const PUSH_INTERVAL_MS = 60_000;

/**
 * Periodically pings the Uptime Kuma push endpoint so the Discord Bot monitor
 * shows green while the bot is online. No-op if no push URL is configured.
 */
export function startUptimeHeartbeat(client: Client<true>): void {
    const base = config.bot.uptimePushUrl;
    if (!base) {
        logger.debug('Uptime Kuma push URL not set; bot heartbeat disabled.');
        return;
    }

    const push = async () => {
        try {
            const ping = Math.max(0, Math.round(client.ws.ping));
            const url = `${base}?status=up&msg=OK&ping=${ping}`;
            const res = await fetch(url, { method: 'GET' });
            if (!res.ok) {
                logger.warn(`Uptime Kuma heartbeat returned ${res.status}`);
            }
        } catch (error) {
            // Don't spam logs if the status host isn't reachable yet (e.g. tunnel down).
            logger.debug('Uptime Kuma heartbeat push failed: ' + (error instanceof Error ? error.message : String(error)));
        }
    };

    void push(); // fire one immediately on startup
    setInterval(() => { void push(); }, PUSH_INTERVAL_MS);
    logger.info('Uptime Kuma bot heartbeat started.');
}
