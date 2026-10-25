import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAiImages } from '../dist/services/aiImages.js';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

test('Discord image loader sends verified bytes and rejects unsafe sources', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        return new Response(png, { headers: { 'content-length': String(png.length) } });
    };
    try {
        const attachment = { url: 'https://cdn.discordapp.com/attachments/1/2/example.png', name: 'example.png', contentType: 'image/png', size: png.length };
        const result = await loadAiImages([attachment]);
        assert.equal(result.length, 1);
        assert.equal(result[0].dataUrl, `data:image/png;base64,${png.toString('base64')}`);
        assert.equal(calls, 1);
        await assert.rejects(loadAiImages([{ ...attachment, url: 'https://example.com/attachments/1/2/example.png' }]), /Discord attachment/);
        assert.equal(calls, 1);
        await assert.rejects(loadAiImages([{ ...attachment, contentType: 'image/gif' }]), /PNG, JPG, or WebP/);
        assert.equal(calls, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
