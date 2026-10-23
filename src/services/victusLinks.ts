const OFFICIAL_HOSTS = new Set([
    'victuscloud.com',
    'billing.victuscloud.com',
    'control.victuscloud.com',
    'drive.victuscloud.com',
    'status.victuscloud.com',
    'tools.victuscloud.com',
    'community.victuscloud.com',
    'engine.victuscloud.com',
]);

const LINK_WITH_SCHEME = /https?:\/\/[^\s<>()\[\]{}]+/gi;
const BARE_VICTUS_DOMAIN = /(?<![\w./@-])(?:[a-z0-9-]+\.)*(?:victorcloud|victuscloud)\.[a-z]{2,}(?:\.[a-z0-9-]+)*(?:\/[^\s<>()\[\]{}]+)?/gi;

export const VICTUS_LINK_GUIDANCE = `When sharing Victus Cloud links, spell the domain exactly victuscloud.com (never victorcloud.com). Verified destinations: website https://victuscloud.com, pricing https://victuscloud.com/pricing, free hosting https://victuscloud.com/free, documentation https://victuscloud.com/documentation, staff tickets https://victuscloud.com/support/tickets, status https://victuscloud.com/status, billing https://billing.victuscloud.com, and control panel https://control.victuscloud.com. You may also cite an exact documentation URL supplied in the retrieved official docs. Do not invent any other Victus URL, path, or subdomain; if no verified link fits, name the destination without a link.`;

function normalizeLink(raw: string): string {
    const suffix = raw.match(/[.,!?;:]+$/)?.[0] || '';
    const address = suffix ? raw.slice(0, -suffix.length) : raw;
    let parsed: URL;
    try {
        parsed = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`);
    } catch {
        return raw;
    }

    const host = parsed.hostname.toLowerCase();
    if (!/victorcloud|victuscloud/i.test(host) && !/victorcloud|victuscloud/i.test(parsed.username)) return raw;
    const correctedHost = host.replace(/victorcloud/g, 'victuscloud');
    const trustedHost = OFFICIAL_HOSTS.has(correctedHost) && !parsed.username && !parsed.password;

    // An invented subdomain or a lookalike URL must not become a clickable link.
    if (!trustedHost) {
        return correctedHost.startsWith('support.')
            ? `https://victuscloud.com/support/tickets${suffix}`
            : `https://victuscloud.com${suffix}`;
    }

    let path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (/^\/knowledgebase\/?$/i.test(parsed.pathname)) path = `/documentation${parsed.search}${parsed.hash}`;
    if (/^\/tickets\/?$/i.test(parsed.pathname) && correctedHost === 'victuscloud.com') {
        path = `/support/tickets${parsed.search}${parsed.hash}`;
    }
    return `https://${correctedHost}${path === '/' ? '' : path}${suffix}`;
}

/** Keep model-generated Victus links on verified domains, including bare domain mentions. */
export function normalizeVictusLinks(answer: string): string {
    let result = '';
    let cursor = 0;
    for (const match of answer.matchAll(LINK_WITH_SCHEME)) {
        const start = match.index;
        result += answer.slice(cursor, start).replace(BARE_VICTUS_DOMAIN, normalizeLink);
        result += normalizeLink(match[0]);
        cursor = start + match[0].length;
    }
    return result + answer.slice(cursor).replace(BARE_VICTUS_DOMAIN, normalizeLink);
}
