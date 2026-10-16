import { victusDocsManifest } from './victusDocsManifest.js';

type Doc = (typeof victusDocsManifest)[number];
export type KnowledgeSnippet = { title: string; url: string; text: string };
const cached = new Map<string, { text: string; expires: number }>();
const STOP = new Set('the and for with from this that have your what when where how can are you our was were does not but into about server support ticket issue help please need want'.split(' '));

function terms(input: string): string[] {
    return [...new Set((input.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w)))].slice(0, 30);
}

export function rankVictusDocs(query: string): Doc[] {
    const queryTerms = terms(query);
    if (!queryTerms.length) return [];
    return [...victusDocsManifest]
        .map((doc) => {
            const title = doc.title.toLowerCase();
            const desc = doc.description.toLowerCase();
            const tags = doc.tags.join(' ').toLowerCase();
            const score = queryTerms.reduce((total, term) => total +
                (title.includes(term) ? 5 : 0) + (tags.includes(term) ? 3 : 0) +
                (desc.includes(term) ? 2 : 0), 0);
            return { doc, score };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(({ doc }) => doc);
}

async function fetchArticle(doc: Doc): Promise<KnowledgeSnippet | null> {
    const url = `https://victuscloud.com/documentation/${encodeURIComponent(doc.slug)}`;
    const existing = cached.get(url);
    if (existing && existing.expires > Date.now()) return { title: doc.title, url, text: existing.text };
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'VictusDiscordSupportBot/1.0' },
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) return null;
        const html = await response.text();
        if (html.length > 1_500_000) return null;
        // The website publishes articleBody in a TechArticle JSON-LD block.
        const scripts = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
        let text = '';
        for (const script of scripts) {
            const json = script.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
            try {
                const article = JSON.parse(json);
                if (article?.['@type'] === 'TechArticle' && typeof article.articleBody === 'string') {
                    text = article.articleBody;
                    break;
                }
            } catch { /* Ignore unrelated JSON-LD blocks. */ }
        }
        if (!text) return null;
        text = text.replace(/\s+/g, ' ').slice(0, 2400);
        cached.set(url, { text, expires: Date.now() + 30 * 60_000 });
        return { title: doc.title, url, text };
    } catch {
        return null;
    }
}

/** Relevant live, public Victus docs only. Failed fetches are omitted, never invented. */
export async function getTicketKnowledge(query: string): Promise<KnowledgeSnippet[]> {
    const ranked = rankVictusDocs(query);
    const results = await Promise.all(ranked.map(fetchArticle));
    return results.filter((result): result is KnowledgeSnippet => result !== null);
}
