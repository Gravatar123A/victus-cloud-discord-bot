import { config } from '../config.js';
import { logger } from '../utils/logger.js';
/**
 * AI update contract: the deployed website endpoint is the source of truth.
 * If a future change edits pricing on the website, update the website's
 * discordPricingCatalog.ts and version first; keep this fallback in sync so
 * the bot remains truthful during a temporary website/API outage.
 */
export const PRICING_CATALOG_UPDATE_CONTRACT = 'Website /api/discord-pricing is authoritative; update this fallback whenever website pricing changes.';
const FALLBACK = {
    version: 'fallback-2026-09',
    updatedAt: '2026-09-07T00:00:00.000Z',
    source: `${config.branding.website}/pricing`,
    categories: [
        {
            id: 'free',
            name: 'Free game hosting',
            description: 'Create a free server and upgrade when you need more resources.',
            plans: [{ id: 'free', name: 'Free Server', priceUsd: 0, billing: 'free', features: ['Quick deployment', 'Victus Cloud panel access', 'Wake-on-join support', 'Java and Bedrock network support'] }],
        },
        {
            id: 'web',
            name: 'Web hosting',
            description: 'Managed NVMe web hosting with backups and support.',
            plans: [
                ['lite', 'Lite', 3.2, '2 GB RAM', '20 GB NVMe', '1 database'],
                ['basic', 'Plus', 5.4, '4 GB RAM', '40 GB NVMe', '2 databases'],
                ['standard', 'Boost', 8.3, '6 GB RAM', '60 GB NVMe', '3 databases'],
                ['elite', 'Elite', 13.8, '8 GB RAM', '100 GB NVMe', '5 databases'],
                ['infinity', 'Infinity', 21.1, '12 GB RAM', '150 GB NVMe', 'unlimited databases'],
            ].map(([id, name, price, ram, storage, database]) => ({ id: String(id), name: String(name), priceUsd: Number(price), billing: 'per month', features: [String(ram), String(storage), String(database), 'Free SSL and automated backups', 'Priority Discord support'] })),
        },
        {
            id: 'discord-bot',
            name: 'Discord bot hosting',
            description: 'Managed Victus Cloud hosting for Discord bots.',
            plans: [
                ['lite', 'Lite', 2], ['basic', 'Plus', 3.5], ['standard', 'Boost', 5.5], ['elite', 'Elite', 9.5], ['infinity', 'Infinity', 14.5],
            ].map(([id, name, price]) => ({ id: String(id), name: String(name), priceUsd: Number(price), billing: 'per month', features: ['Managed bot process', 'Automatic restarts', 'Panel access', 'Discord support'] })),
        },
        {
            id: 'code-hosting',
            name: 'Code and microservices hosting',
            description: 'Full-stack application and API hosting for Node.js, Python, Go, and Docker.',
            plans: [
                ['lite', 'Lite', 3.2, '2 GB RAM', '20 GB NVMe', '1 database'],
                ['basic', 'Plus', 5.4, '4 GB RAM', '40 GB NVMe', '2 databases'],
                ['standard', 'Boost', 8.3, '6 GB RAM', '60 GB NVMe', '3 databases'],
                ['elite', 'Elite', 13.8, '8 GB RAM', '100 GB NVMe', '5 databases'],
                ['infinity', 'Infinity', 21.1, '12 GB RAM', '150 GB NVMe', 'unlimited databases'],
            ].map(([id, name, price, ram, storage, database]) => ({ id: String(id), name: String(name), priceUsd: Number(price), billing: 'per month', features: [String(ram), String(storage), String(database), 'Git auto-deploy', 'Environment variables vault', 'Health checks'] })),
        },
        {
            id: 'game-de',
            name: 'Game hosting - Germany',
            description: 'Frankfurt game hosting plans with Java/Bedrock support.',
            plans: [
                ['budget', 'Budget SMP', 2.4, '4 GB RAM', '1 vCore', '20 GB storage'],
                ['starter', 'Starter', 5.2, '8 GB RAM', '2 vCores', '40 GB storage'],
                ['performance', 'Performance', 7.2, '12 GB RAM', '3 vCores', '60 GB storage'],
                ['professional', 'Professional', 9.6, '16 GB RAM', '4 vCores', '80 GB storage'],
                ['enterprise', 'Enterprise', 14.4, '24 GB RAM', '6 vCores', '120 GB storage'],
                ['ultimate', 'Ultimate', 19.2, '32 GB RAM', '8 vCores', '160 GB storage'],
            ].map(([id, name, price, ram, cpu, storage]) => ({ id: String(id), name: String(name), priceUsd: Number(price), billing: 'per month', features: [String(ram), String(cpu), String(storage), 'NVMe storage', 'DDoS protection', 'Game panel access'] })),
        },
        {
            id: 'game-sg',
            name: 'Game hosting - Singapore',
            description: 'Singapore game hosting plans with low-latency Asia routing.',
            plans: [
                ['budget', 'Budget SMP', 2.75, '4 GB RAM', '1 vCore', '20 GB storage'],
                ['starter', 'Starter', 5.66, '8 GB RAM', '2 vCores', '40 GB storage'],
                ['performance', 'Performance', 8.19, '12 GB RAM', '3 vCores', '60 GB storage'],
                ['professional', 'Professional', 10.92, '16 GB RAM', '4 vCores', '80 GB storage'],
                ['enterprise', 'Enterprise', 16.38, '24 GB RAM', '6 vCores', '120 GB storage'],
                ['ultimate', 'Ultimate', 21.84, '32 GB RAM', '8 vCores', '160 GB storage'],
            ].map(([id, name, price, ram, cpu, storage]) => ({ id: String(id), name: String(name), priceUsd: Number(price), billing: 'per month', features: [String(ram), String(cpu), String(storage), 'Low-latency Asia routing', 'DDoS protection', 'Game panel access'] })),
        },
        {
            id: 'vps',
            name: 'VPS hosting',
            description: 'Ryzen VPS plans in Germany and Singapore.',
            plans: [
                ['rx-2', 'RX-2 Germany', 2.5, '2 GB RAM', '1 core', '25 GB storage'], ['rx-4', 'RX-4 Germany', 4.5, '4 GB RAM', '2 cores', '50 GB storage'], ['rx-8', 'RX-8 Germany', 5.8, '8 GB RAM', '2 cores', '80 GB storage'], ['rx-12', 'RX-12 Germany', 8.7, '12 GB RAM', '3 cores', '120 GB storage'], ['rx-16', 'RX-16 Germany', 11.6, '16 GB RAM', '4 cores', '160 GB storage'], ['rx-24', 'RX-24 Germany', 17.4, '24 GB RAM', '6 cores', '240 GB storage'], ['rx-32', 'RX-32 Germany', 23.2, '32 GB RAM', '8 cores', '320 GB storage'], ['rx-64', 'RX-64 Germany', 38.8, '64 GB RAM', '12 cores', '500 GB storage'],
                ['sg-2', 'SG-2 Singapore', 2.9, '2 GB RAM', '1 core', '25 GB storage'], ['sg-4', 'SG-4 Singapore', 5.2, '4 GB RAM', '2 cores', '50 GB storage'], ['sg-8', 'SG-8 Singapore', 6.7, '8 GB RAM', '2 cores', '80 GB storage'], ['sg-12', 'SG-12 Singapore', 9.9, '12 GB RAM', '3 cores', '120 GB storage'], ['sg-16', 'SG-16 Singapore', 13.4, '16 GB RAM', '4 cores', '160 GB storage'], ['sg-24', 'SG-24 Singapore', 19.8, '24 GB RAM', '6 cores', '240 GB storage'], ['sg-32', 'SG-32 Singapore', 26.2, '32 GB RAM', '8 cores', '320 GB storage'], ['sg-64', 'SG-64 Singapore', 43.5, '64 GB RAM', '12 cores', '500 GB storage'],
            ].map(([id, name, price, ram, cores, storage]) => ({ id: String(id), name: String(name), priceUsd: Number(price), billing: 'per month', features: [String(ram), String(cores), String(storage), '1 Gbps networking', 'Ryzen compute'] })),
        },
    ],
};
let cached = null;
export async function fetchPricingCatalog() {
    if (cached && cached.expiresAt > Date.now())
        return cached.catalog;
    const endpoint = `${config.branding.website.replace(/\/$/, '')}/api/discord-pricing`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7_000);
    try {
        const response = await fetch(endpoint, { signal: controller.signal, headers: { Accept: 'application/json' } });
        const payload = await response.json();
        if (!response.ok || !payload?.version || !Array.isArray(payload.categories))
            throw new Error('Invalid pricing catalog');
        cached = { catalog: payload, expiresAt: Date.now() + 5 * 60_000 };
        return payload;
    }
    catch (error) {
        logger.warn(`Pricing catalog fetch failed; using fallback: ${error.message}`);
        cached = { catalog: FALLBACK, expiresAt: Date.now() + 60_000 };
        return FALLBACK;
    }
    finally {
        clearTimeout(timeout);
    }
}
export { FALLBACK as FALLBACK_PRICING_CATALOG };
