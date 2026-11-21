import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.DISCORD_CLIENT_ID ||= '123456789012345678';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';

const { resilientFetch, isSupabaseCircuitOpen, resetSupabaseCircuit } = await import('../dist/services/supabase.js');

test('Edge Function failure does not block ticket database requests', async t => {
    const originalFetch = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = originalFetch;
        resetSupabaseCircuit();
    });
    globalThis.fetch = async () => new Response('origin timeout', {
        status: 522,
        headers: { 'content-type': 'text/html' },
    });

    const response = await resilientFetch('https://example.supabase.co/functions/v1/admin-pterodactyl');
    assert.equal(response.status, 522);
    assert.equal(isSupabaseCircuitOpen(), false);
});

test('PostgREST origin failure still trips the database circuit breaker', async t => {
    const originalFetch = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = originalFetch;
        resetSupabaseCircuit();
    });
    globalThis.fetch = async () => new Response('origin timeout', {
        status: 522,
        headers: { 'content-type': 'text/html' },
    });

    const response = await resilientFetch('https://example.supabase.co/rest/v1/tickets');
    assert.equal(response.status, 522);
    assert.equal(isSupabaseCircuitOpen(), true);
});
