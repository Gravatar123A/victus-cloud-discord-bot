import assert from 'node:assert/strict';
import test from 'node:test';
import { completeVictusAi, VICTUS_AI_MODEL, VICTUS_AI_FALLBACK_MODEL } from '../dist/services/victusAiCompletion.js';
import { hasReadableTicketAttachment, summarizeTicketLog, ticketAiQueryWithAttachments } from '../dist/services/ticketAiAttachments.js';
import { shouldAutoReplyToTicketMessage } from '../dist/services/discordTicketMessages.js';

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;

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
    process.env.OPENROUTER_API_KEY = 'test-only-key';
    const originalGroqKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: { message: 'limit reached' } }), { status: 429 }); };
    try {
        await assert.rejects(completeVictusAi('Be safe', 'Help'), /429/);
        assert.equal(calls, 1);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = originalKey;
        if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
        else process.env.GROQ_API_KEY = originalGroqKey;
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

test('OpenRouter daily quota falls back to Groq and cools down before retrying OpenRouter', async () => {
    process.env.OPENROUTER_API_KEY = 'test-only-key';
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
        assert.equal(await completeVictusAi('Be safe', 'Help'), 'Groq answer');
        assert.equal(await completeVictusAi('Be safe', 'Help again'), 'Groq answer');
        assert.equal(urls.filter((url) => url.includes('openrouter.ai')).length, 1);
        assert.equal(urls.filter((url) => url.includes('groq.com')).length, 2);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = originalKey;
        if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
        else process.env.GROQ_API_KEY = originalGroqKey;
    }
});
