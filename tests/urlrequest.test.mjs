import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildUrlRequestGuide, urlRequestCommand } from '../dist/commands/urlrequest.js';

test('/urlrequest is a staff-only guild command with an attached visual guide', async () => {
    assert.equal(urlRequestCommand.adminOnly, true);
    assert.equal(urlRequestCommand.data.toJSON().name, 'urlrequest');

    const guide = buildUrlRequestGuide();
    const embed = guide.embeds[0].toJSON();
    assert.match(embed.description, /private support ticket/);
    assert.match(embed.fields.map((field) => field.value).join(' '), /your-server-id/);
    assert.equal(embed.image.url, 'attachment://urlrequest-panel.png');
    assert.equal(guide.files[0].name, 'urlrequest-panel.png');
    assert.deepEqual([...await readFile(guide.files[0].attachment)].slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(guide.components[0].components[0].data.url, 'https://control.victuscloud.com/');
    assert.deepEqual(guide.allowedMentions.parse, []);

    let reply;
    await urlRequestCommand.execute({ reply: async (payload) => { reply = payload; } });
    assert.equal(reply.embeds[0].toJSON().title, '🧭 Where to find your server URL');
    assert.equal(reply.flags, undefined);
});
