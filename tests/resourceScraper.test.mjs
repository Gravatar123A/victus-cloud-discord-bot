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
