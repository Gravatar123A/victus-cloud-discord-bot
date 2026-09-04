import { logger } from '../utils/logger.js';

export interface ScrapedResource {
    title: string;
    description: string;
    images: string[];
    category_hint?: string;
    tags_hint?: string[];
    author?: string;
    source_url: string;
    site_name?: string;
}

const DEFAULT_FETCH_TIMEOUT = 8000; // 8 seconds
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 VictusCloudBot/1.0';

/**
 * Utility to decode HTML entities and strip unwanted HTML tags to return clean Markdown text.
 */
function cleanHtmlText(html: string): string {
    if (!html) return '';
    let text = html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return text;
}

/**
 * Safely fetch URL content with timeout and proper User-Agent header.
 */
async function fetchWithTimeout(url: string, timeoutMs = DEFAULT_FETCH_TIMEOUT, customHeaders: Record<string, string> = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
                ...customHeaders,
            },
        });
        return response;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Extract OpenGraph and standard HTML meta tags from raw HTML string.
 */
function parseMetaTags(html: string): {
    title?: string;
    description?: string;
    image?: string;
    siteName?: string;
    author?: string;
    keywords?: string[];
} {
    const getMetaContent = (propertyOrName: string): string | undefined => {
        const regex = new RegExp(`<meta\\s+(?:name|property)=["']${propertyOrName}["']\\s+content=["']([^"']+)["']`, 'i');
        const altRegex = new RegExp(`<meta\\s+content=["']([^"']+)["']\\s+(?:name|property)=["']${propertyOrName}["']`, 'i');
        const match = html.match(regex) || html.match(altRegex);
        return match ? match[1] : undefined;
    };

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = getMetaContent('og:title') || getMetaContent('twitter:title') || (titleMatch ? titleMatch[1].trim() : undefined);
    const description = getMetaContent('og:description') || getMetaContent('description') || getMetaContent('twitter:description');
    const image = getMetaContent('og:image') || getMetaContent('twitter:image');
    const siteName = getMetaContent('og:site_name');
    const author = getMetaContent('author') || getMetaContent('og:article:author');
    const keywordsStr = getMetaContent('keywords');
    const keywords = keywordsStr ? keywordsStr.split(',').map((k) => k.trim()).filter(Boolean) : undefined;

    return {
        title: title ? cleanHtmlText(title) : undefined,
        description: description ? cleanHtmlText(description) : undefined,
        image,
        siteName: siteName ? cleanHtmlText(siteName) : undefined,
        author: author ? cleanHtmlText(author) : undefined,
        keywords,
    };
}

/**
 * Modrinth site parser
 */
async function parseModrinth(url: string): Promise<ScrapedResource | null> {
    try {
        const urlObj = new URL(url);
        const parts = urlObj.pathname.split('/').filter(Boolean);
        if (parts.length < 2) return null;

        const slug = parts[1];
        const apiUrl = `https://api.modrinth.com/v2/project/${slug}`;
        const res = await fetchWithTimeout(apiUrl);
        if (!res.ok) return null;

        const data: any = await res.json();
        const images: string[] = [];
        if (data.icon_url) images.push(data.icon_url);
        if (Array.isArray(data.gallery)) {
            data.gallery.forEach((g: any) => {
                if (g?.url && !images.includes(g.url)) images.push(g.url);
            });
        }

        let categoryHint = 'Mods';
        if (data.project_type === 'plugin') categoryHint = 'Plugins';
        else if (data.project_type === 'datapack') categoryHint = 'Maps';
        else if (data.project_type === 'modpack') categoryHint = 'Mods';
        else if (data.project_type === 'resourcepack') categoryHint = 'Other';

        return {
            title: data.title || slug,
            description: cleanHtmlText(data.summary || data.description || ''),
            images,
            category_hint: categoryHint,
            tags_hint: Array.isArray(data.categories) ? data.categories : [],
            author: data.team || undefined,
            source_url: url,
            site_name: 'Modrinth',
        };
    } catch (error) {
        logger.debug('Modrinth API parsing failed, falling back to generic html:', error);
        return null;
    }
}

/**
 * GitHub repo parser
 */
async function parseGitHub(url: string): Promise<ScrapedResource | null> {
    try {
        const urlObj = new URL(url);
        const parts = urlObj.pathname.split('/').filter(Boolean);
        if (parts.length < 2) return null;

        const owner = parts[0];
        const repo = parts[1];
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
        const res = await fetchWithTimeout(apiUrl, DEFAULT_FETCH_TIMEOUT, {
            'Accept': 'application/vnd.github.v3+json',
        });

        if (!res.ok) return null;
        const data: any = await res.json();

        const images: string[] = [];
        if (data.owner?.avatar_url) images.push(data.owner.avatar_url);

        return {
            title: data.full_name || `${owner}/${repo}`,
            description: data.description ? cleanHtmlText(data.description) : `GitHub repository by ${owner}`,
            images,
            category_hint: 'Codes',
            tags_hint: Array.isArray(data.topics) ? data.topics : [data.language].filter(Boolean),
            author: data.owner?.login || owner,
            source_url: data.html_url || url,
            site_name: 'GitHub',
        };
    } catch (error) {
        logger.debug('GitHub API parsing failed, falling back to generic html:', error);
        return null;
    }
}

/**
 * CurseForge site parser
 */
async function parseCurseForge(url: string, html: string): Promise<ScrapedResource | null> {
    const meta = parseMetaTags(html);
    if (!meta.title) return null;

    let categoryHint = 'Mods';
    if (url.includes('/minecraft/mc-mods')) categoryHint = 'Mods';
    else if (url.includes('/minecraft/texture-packs')) categoryHint = 'Other';
    else if (url.includes('/minecraft/worlds') || url.includes('/minecraft/customization')) categoryHint = 'Maps';

    const authorMatch = html.match(/class=["']author-tag["'][^>]*>([^<]+)</i) || html.match(/by\s+<span[^>]*>([^<]+)<\/span>/i);
    const author = authorMatch ? authorMatch[1].trim() : meta.author;

    return {
        title: meta.title.replace(/\s*-\s*Minecraft\s*Mods\s*-\s*CurseForge/i, '').replace(/\s*-\s*CurseForge/i, ''),
        description: meta.description || 'Minecraft resource on CurseForge',
        images: meta.image ? [meta.image] : [],
        category_hint: categoryHint,
        tags_hint: meta.keywords || [],
        author,
        source_url: url,
        site_name: 'CurseForge',
    };
}

/**
 * SpigotMC site parser
 */
async function parseSpigotMC(url: string, html: string): Promise<ScrapedResource | null> {
    const meta = parseMetaTags(html);
    if (!meta.title) return null;

    const authorMatch = html.match(/class=["']username["'][^>]*>([^<]+)</i);
    const author = authorMatch ? authorMatch[1].trim() : meta.author;

    return {
        title: meta.title.replace(/\s*\|\s*SpigotMC\s*-\s*High Performance Minecraft/i, '').replace(/\s*\|\s*SpigotMC/i, ''),
        description: meta.description || 'SpigotMC Minecraft Resource',
        images: meta.image ? [meta.image] : [],
        category_hint: 'Plugins',
        tags_hint: meta.keywords || ['spigot', 'plugin', 'minecraft'],
        author,
        source_url: url,
        site_name: 'SpigotMC',
    };
}

/**
 * Planet Minecraft parser
 */
async function parsePlanetMinecraft(url: string, html: string): Promise<ScrapedResource | null> {
    const meta = parseMetaTags(html);
    if (!meta.title) return null;

    let categoryHint = 'Maps';
    if (url.includes('/projects/') || url.includes('/map/')) categoryHint = 'Maps';
    else if (url.includes('/texture-packs/')) categoryHint = 'Other';
    else if (url.includes('/data-packs/')) categoryHint = 'Plugins';
    else if (url.includes('/mods/')) categoryHint = 'Mods';

    return {
        title: meta.title.replace(/\s*Minecraft\s*Map/i, '').replace(/\s*Planet\s*Minecraft\s*Community/i, '').trim(),
        description: meta.description || 'Planet Minecraft Resource',
        images: meta.image ? [meta.image] : [],
        category_hint: categoryHint,
        tags_hint: meta.keywords || ['planetminecraft', 'minecraft'],
        author: meta.author,
        source_url: url,
        site_name: 'Planet Minecraft',
    };
}

/**
 * Main Web Scraper entry point. Accepts any HTTP/HTTPS URL and returns structured resource metadata.
 */
export async function scrapeResourceUrl(rawUrl: string): Promise<ScrapedResource> {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(rawUrl.trim());
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            throw new Error('URL must start with http:// or https://');
        }
    } catch {
        throw new Error('Invalid URL provided. Please enter a valid HTTP/HTTPS web address.');
    }

    const cleanUrl = parsedUrl.toString();
    const hostname = parsedUrl.hostname.toLowerCase();

    if (hostname.includes('modrinth.com')) {
        const modrinthResult = await parseModrinth(cleanUrl);
        if (modrinthResult) return modrinthResult;
    }

    if (hostname.includes('github.com')) {
        const githubResult = await parseGitHub(cleanUrl);
        if (githubResult) return githubResult;
    }

    let html = '';
    try {
        const res = await fetchWithTimeout(cleanUrl);
        if (!res.ok) {
            logger.warn(`Resource scraper HTTP error ${res.status} for ${cleanUrl}`);
        } else {
            html = await res.text();
        }
    } catch (error: any) {
        logger.warn(`Failed to fetch HTML for ${cleanUrl}:`, error?.message || error);
    }

    if (html) {
        if (hostname.includes('curseforge.com')) {
            const result = await parseCurseForge(cleanUrl, html);
            if (result) return result;
        }

        if (hostname.includes('spigotmc.org')) {
            const result = await parseSpigotMC(cleanUrl, html);
            if (result) return result;
        }

        if (hostname.includes('planetminecraft.com')) {
            const result = await parsePlanetMinecraft(cleanUrl, html);
            if (result) return result;
        }
    }

    if (html) {
        const meta = parseMetaTags(html);
        if (meta.title || meta.description) {
            const images: string[] = [];
            if (meta.image) images.push(meta.image);

            return {
                title: meta.title || cleanUrl,
                description: meta.description || 'No description provided.',
                images,
                category_hint: 'Other',
                tags_hint: meta.keywords || [],
                author: meta.author,
                source_url: cleanUrl,
                site_name: meta.siteName || hostname,
            };
        }
    }

    return {
        title: parsedUrl.pathname.split('/').filter(Boolean).pop() || hostname,
        description: `Resource from ${hostname}`,
        images: [],
        category_hint: 'Other',
        tags_hint: [],
        source_url: cleanUrl,
        site_name: hostname,
    };
}
