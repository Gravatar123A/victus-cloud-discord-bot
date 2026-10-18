import assert from 'node:assert/strict';
import test from 'node:test';
import { structureStaffKnowledge } from '../dist/services/staffKnowledge.js';

test('staff can provide one informal note and AI structures it for search', async () => {
    const entry = await structureStaffKnowledge(
        'If a server gets stuck starting, ask for the latest console error before changing settings.',
        async (_system, prompt) => {
            assert.match(prompt, /latest console error/);
            return JSON.stringify({
                title: 'Server startup errors',
                question: 'What should I send when my server is stuck starting?',
                answer: 'Send the latest console error before changing startup settings.',
                category: 'Server support',
            });
        },
    );
    assert.equal(entry.title, 'Server startup errors');
    assert.match(entry.rawNote, /If a server gets stuck/);
});

test('staff guidance refuses secrets and unclear notes', async () => {
    await assert.rejects(() => structureStaffKnowledge('API key: sk-abcdefghijklmnop and use this for support',
        async () => '{}'), /Remove personal details/);
    await assert.rejects(() => structureStaffKnowledge('This should be answered by someone on the team.',
        async () => '{"needs_detail":true}'), /include the fact/);
});
