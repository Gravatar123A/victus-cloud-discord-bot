import assert from 'node:assert/strict';
import test from 'node:test';
import { completeVictusAi, VICTUS_AI_MODEL, VICTUS_AI_FALLBACK_MODEL } from '../dist/services/victusAiCompletion.js';
import { normalizeVictusLinks } from '../dist/services/victusLinks.js';
import { hasReadableTicketAttachment, summarizeTicketLog, ticketAiQueryWithAttachments } from '../dist/services/ticketAiAttachments.js';
import { shouldAutoReplyToTicketMessage } from '../dist/services/discordTicketMessages.js';
import { supabase } from '../dist/services/supabase.js';

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;
const originalFallbackKey = process.env.OPENROUTER_FALLBACK_API_KEY;

test('Victus URLs use verified domains and canonical destinations', () => {
    assert.equal(normalizeVictusLinks('Visit victorcloud.com/free.'), 'Visit https://victuscloud.com/free.');
    assert.equal(normalizeVictusLinks('[Billing](https://billing.victorcloud.com)'), '[Billing](https://billing.victuscloud.com)');
    assert.equal(normalizeVictusLinks('https://victorcloud.com/knowledgebase'), 'https://victuscloud.com/documentation');
    assert.equal(normalizeVictusLinks('https://support.victorcloud.com/tickets'), 'https://victuscloud.com/support/tickets');
    assert.equal(normalizeVictusLinks('https://victuscloud.com.evil.com/free'), 'https://victuscloud.com');
    assert.equal(normalizeVictusLinks('https://example.org/docs'), 'https://example.org/docs');
    assert.equal(normalizeVictusLinks('https://example.org/?search=victorcloud.com'), 'https://example.org/?search=victorcloud.com');
    assert.equal(normalizeVictusLinks('support@victuscloud.com'), 'support@victuscloud.com');
    assert.equal(normalizeVictusLinks('https://victuscloud.com@evil.com'), 'https://victuscloud.com');
    assert.equal(normalizeVictusLinks('https://victuscloud.com/documentation/example'), 'https://victuscloud.com/documentation/example');
});

test('model replies correct a hallucinated Victus domain before delivery', async () => {
    process.env.OPENROUTER_API_KEY = 'test-only-key';
    globalThis.fetch = async () => new Response(JSON.stringify({
        choices: [{ message: { content: 'Open https://victorcloud.com/support/tickets for staff help.' } }],
    }), { status: 200 });
    try {
        assert.equal(await completeVictusAi('Use accurate links', 'Where are tickets?'),
            'Open https://victuscloud.com/support/tickets for staff help.');
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = originalKey;
    }
});

test('OpenRouter gets a second verified free model and retries one transient 502', async () => {
    process.env.OPENROUTER_API_KEY = 'test-only-key';
    const calls = [];
    globalThis.fetch = async (_url, options) => {
        calls.push(JSON.parse(options.body));
        return calls.length === 1
            ? new Response(JSON.stringify({ error: { message: 'Provider returned error' } }), { status: 502 })
            : new Response(JSON.stringify({ choices: [{ message: { content: 'Try checking the console error header.' } }] }), { status: 200 });
    };
    try {
        const answer = await completeVictusAi('Be safe', 'Server failed');
        assert.match(answer, /console error header/);
        assert.deepEqual(calls[0].models, [VICTUS_AI_MODEL, VICTUS_AI_FALLBACK_MODEL]);
        assert.deepEqual(calls[1].models, [VICTUS_AI_FALLBACK_MODEL]);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = originalKey;
    }
});

test('quota errors do not spend another free request', async () => {
    process.env.OPENROUTER_API_KEY = 'test-quota-key';
    const originalClient = supabase.client;
    supabase.client = { from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }) }; } };
    const originalGroqKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: { message: 'limit reached' } }), { status: 429 }); };
    try {
        await assert.rejects(completeVictusAi('Be safe', 'Help'), /429/);
        assert.equal(calls, 1);
    } finally {
        supabase.client = originalClient;
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = originalKey;
        if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
        else process.env.GROQ_API_KEY = originalGroqKey;
    }
});

test('quota on the primary account uses the second OpenRouter account', async () => {
    process.env.OPENROUTER_API_KEY = 'test-primary-rotation';
    process.env.OPENROUTER_FALLBACK_API_KEY = 'test-secondary-rotation';
    const auth = [];
    globalThis.fetch = async (_url, options) => {
        auth.push(options.headers.Authorization);
        return auth.length === 1
            ? new Response(JSON.stringify({ error: { message: 'limit reached' } }), { status: 429 })
            : new Response(JSON.stringify({ choices: [{ message: { content: 'Fallback account answer' } }] }), { status: 200 });
    };
    try {
        assert.equal(await completeVictusAi('Be safe', 'Help'), 'Fallback account answer');
        assert.deepEqual(auth, ['Bearer test-primary-rotation', 'Bearer test-secondary-rotation']);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = originalKey;
        if (originalFallbackKey === undefined) delete process.env.OPENROUTER_FALLBACK_API_KEY;
        else process.env.OPENROUTER_FALLBACK_API_KEY = originalFallbackKey;
    }
});

test('an empty provider answer retries the fallback model once', async () => {
    process.env.OPENROUTER_API_KEY = 'test-only-key';
    const calls = [];
    globalThis.fetch = async (_url, options) => {
        calls.push(JSON.parse(options.body));
        return new Response(JSON.stringify({
            choices: [{ message: { content: calls.length === 1 ? '' : 'A real answer' } }],
        }), { status: 200 });
    };
    try {
        assert.equal(await completeVictusAi('Be safe', 'Help'), 'A real answer');
        assert.deepEqual(calls[1].models, [VICTUS_AI_FALLBACK_MODEL]);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = originalKey;
    }
});

test('image requests send verified image bytes only to the free vision model', async () => {
    process.env.OPENROUTER_API_KEY = 'test-vision-key';
    const requests = [];
    globalThis.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: 'The screenshot shows a console error.' } }] }), { status: 200 });
    };
    try {
        const image = { name: 'console.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
        assert.match(await completeVictusAi('Be safe', 'What is wrong?', 700, [image]), /console error/);
        assert.deepEqual(requests[0].models, [VICTUS_AI_MODEL]);
        assert.equal(requests[0].messages[1].content[1].image_url.url, image.dataUrl);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = originalKey;
    }
});

test('attached text logs are read as redacted excerpts, including a later cause', async () => {
    const raw = [
        'Starting server',
        ...Array.from({ length: 45 }, (_, index) => `at example.Stack.step(Stack.java:${index + 1})`),
        'Caused by: java.lang.IllegalStateException: LuckPerms formatter failed',
        'password: hunter2',
    ].join('\n');
    assert.match(summarizeTicketLog(raw), /Caused by: java.lang.IllegalStateException/);
    assert.doesNotMatch(summarizeTicketLog(raw), /hunter2/);
    globalThis.fetch = async () => new Response(raw, { status: 200, headers: { 'content-length': String(raw.length) } });
    try {
        const message = {
            content: 'Here are the logs',
            attachments: new Map([['one', { url: 'https://cdn.discordapp.com/attachments/1/2/message.txt', name: 'message.txt', size: raw.length, contentType: 'text/plain' }]]),
        };
        const query = await ticketAiQueryWithAttachments(message);
        assert.match(query, /Here are the logs/);
        assert.match(query, /Caused by: java.lang.IllegalStateException/);
        assert.doesNotMatch(query, /hunter2/);
    } finally {
        globalThis.fetch = originalFetch;
    }
    assert.equal(shouldAutoReplyToTicketMessage('owner', 'owner', '', true), true);
    assert.equal(hasReadableTicketAttachment({ attachments: new Map([['one', {
        url: 'https://example.com/private.txt', name: 'private.txt', size: 10, contentType: 'text/plain',
    }]]) }), false);
});

test('OpenRouter daily quota stops without routing support AI to a paid provider', async () => {
    process.env.OPENROUTER_API_KEY = 'test-groq-primary';
    const originalClient = supabase.client;
    supabase.client = { from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }) }; } };
    const originalGroqKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = 'test-groq-key';
    const urls = [];
    globalThis.fetch = async (url) => {
        urls.push(String(url));
        return String(url).includes('openrouter.ai')
            ? new Response(JSON.stringify({ error: { message: 'free-models-per-day exceeded' } }), { status: 429 })
            : new Response(JSON.stringify({ choices: [{ message: { content: 'Groq answer' } }] }), { status: 200 });
    };
    try {
        await assert.rejects(completeVictusAi('Be safe', 'Help'), /free-models-per-day/);
        await assert.rejects(completeVictusAi('Be safe', 'Help again'));
        assert.equal(urls.filter((url) => url.includes('openrouter.ai')).length, 1);
        assert.equal(urls.filter((url) => url.includes('groq.com')).length, 0);
    } finally {
        supabase.client = originalClient;
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = originalKey;
        if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
        else process.env.GROQ_API_KEY = originalGroqKey;
    }
});
