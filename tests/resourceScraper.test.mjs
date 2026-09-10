import assert from 'node:assert/strict';
import test from 'node:test';
import { scrapeResourceUrl } from '../dist/services/resourceScraper.js';

test('resourceScraper parses GitHub repository URLs', async () => {
    const result = await scrapeResourceUrl('https://github.com/octocat/Hello-World');
    assert.ok(result);
    assert.equal(result.site_name, 'GitHub');
    assert.equal(result.category_hint, 'Codes');
    assert.ok(result.title);
});

test('resourceScraper handles generic URLs gracefully', async () => {
    const result = await scrapeResourceUrl('https://example.com');
    assert.ok(result);
    assert.ok(result.source_url.includes('example.com'));
});

test('resourceScraper rejects invalid URLs', async () => {
    await assert.rejects(async () => {
        await scrapeResourceUrl('not-a-valid-url');
    });
});

test('resourceScraper parses CurseForge links and extracts categories/tags', async (t) => {
    const originalFetch = globalThis.fetch;
    const mockHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>JEI - Just Enough Items - Minecraft Mods - CurseForge</title>
            <meta property="og:title" content="JEI - Just Enough Items" />
            <meta property="og:description" content="A great Minecraft mod" />
            <meta property="og:image" content="https://media.forgecdn.net/avatars/123.png" />
            <meta name="author" content="mezz" />
        </head>
        <body>
            <a href="/minecraft/mc-mods/item-valuation">Item Valuation</a>
            <a href="/minecraft/mc-mods/map-information">Map Information</a>
            <a href="/minecraft/mc-mods/jei/files">Files (ignored)</a>
            <a href="https://www.curseforge.com/minecraft/mc-mods/technology">Technology</a>
        </body>
        </html>
    `;

    globalThis.fetch = async (url) => {
        return {
            ok: true,
            text: async () => mockHtml,
            json: async () => ({}),
        };
    };

    try {
        const result = await scrapeResourceUrl('https://www.curseforge.com/minecraft/mc-mods/jei');
        assert.ok(result);
        assert.equal(result.site_name, 'CurseForge');
        assert.equal(result.category_hint, 'Mods');
        assert.equal(result.author, 'mezz');
        assert.ok(result.tags_hint);
        
        const tags = result.tags_hint;
        assert.ok(tags.includes('item-valuation'));
        assert.ok(tags.includes('item valuation'));
        assert.ok(tags.includes('map-information'));
        assert.ok(tags.includes('map information'));
        assert.ok(tags.includes('technology'));
        
        assert.ok(!tags.includes('files'));
        assert.ok(!tags.includes('jei'));
    } finally {
        globalThis.fetch = originalFetch;
    }
});

