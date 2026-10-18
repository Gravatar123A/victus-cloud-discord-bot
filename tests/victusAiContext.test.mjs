import assert from 'node:assert/strict';
import test from 'node:test';
import { getAiMemory, mayLearnFromTicket, sanitizeAiText } from '../dist/services/victusAiContext.js';
import { completeVictusAi, VICTUS_AI_MODEL } from '../dist/services/victusAiCompletion.js';
import { supabase } from '../dist/services/supabase.js';

test('ticket learning ignores sensitive categories and account-specific instructions', () => {
    assert.equal(mayLearnFromTicket('Billing', 'Why is my invoice wrong?', 'We will investigate this invoice and refund it.'), false);
    assert.equal(mayLearnFromTicket('Support', 'My Minecraft server cannot boot', 'Check the exact console error and selected software version before editing startup settings.'), true);
    assert.equal(mayLearnFromTicket('Support', 'My password is visible', 'Change your password immediately and contact staff.'), false);
    assert.equal(mayLearnFromTicket('Support Billing question', 'Why is this charge here?', 'Please check the invoice in your billing portal and contact staff.'), false);
});

test('knowledge and memory redaction strips common secrets before storage', () => {
    const value = sanitizeAiText('email a@b.com password: hunter2 IP 10.1.2.3 token=abcdef card 4111 1111 1111 1111');
    for (const secret of ['a@b.com', 'hunter2', '10.1.2.3', 'abcdef', '4111']) {
        assert.equal(value.includes(secret), false);
    }
});

test('customer AI completion requests the ticket Nemotron model', async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.OPENROUTER_API_KEY;
    const originalKeys = process.env.OPENROUTER_API_KEYS;
    process.env.OPENROUTER_API_KEY = 'test-key';
    delete process.env.OPENROUTER_API_KEYS;
    let requested;
    globalThis.fetch = async (_url, options) => {
        requested = JSON.parse(options.body);
        return new Response(JSON.stringify({ choices: [{ message: { content: 'A concise answer' } }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
        assert.equal(await completeVictusAi('Rules', 'Question'), 'A concise answer');
        assert.equal(requested.model, VICTUS_AI_MODEL);
        assert.equal(requested.model, 'nvidia/nemotron-3.5-super-vl:free');
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = originalKey;
        if (originalKeys === undefined) delete process.env.OPENROUTER_API_KEYS;
        else process.env.OPENROUTER_API_KEYS = originalKeys;
    }
});

test('customer AI completion can load the existing private OpenRouter key', async () => {
    const originalClient = supabase.client;
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.OPENROUTER_API_KEY;
    const originalKeys = process.env.OPENROUTER_API_KEYS;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEYS;
    let requestedAuthorization;
    supabase.client = { from(table) {
        assert.equal(table, 'private_config');
        return { select() { return this; }, eq() { return this; },
            maybeSingle: async () => ({ data: { value: 'private-test-key' }, error: null }) };
    } };
    globalThis.fetch = async (_url, options) => {
        requestedAuthorization = options.headers.Authorization;
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Answer' } }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
        assert.equal(await completeVictusAi('Rules', 'Question'), 'Answer');
        assert.equal(requestedAuthorization, 'Bearer private-test-key');
    } finally {
        supabase.client = originalClient;
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = originalKey;
        if (originalKeys === undefined) delete process.env.OPENROUTER_API_KEYS;
        else process.env.OPENROUTER_API_KEYS = originalKeys;
    }
});

test('conversation retrieval is filtered to the asking user and visibility scope', async () => {
    const original = supabase.client;
    const filters = [];
    let searchArgs;
    const recent = [{ id: 2, session_id: 'dm:alice', role: 'user', content: 'public preference', created_at: '2026-10-18T10:00:00Z' }];
    const query = {
        select() { return this; },
        eq(column, value) { filters.push([column, value]); return this; },
        order() { return this; },
        limit() { return Promise.resolve({ data: recent, error: null }); },
    };
    supabase.client = {
        from(table) { assert.equal(table, 'victus_ai_memory'); return query; },
        rpc(name, args) {
            assert.equal(name, 'victus_ai_search_memory');
            searchArgs = args;
            return Promise.resolve({ data: [], error: null });
        },
    };
    try {
        const memory = await getAiMemory('alice', 'dm:alice', 'public', 'preference');
        assert.match(memory, /public preference/);
        assert.deepEqual(filters, [['user_id', 'alice'], ['scope', 'public']]);
        assert.equal(searchArgs.p_user_id, 'alice');
        assert.equal(searchArgs.p_scope, 'public');
    } finally {
        supabase.client = original;
    }
});
