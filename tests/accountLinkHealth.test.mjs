import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.DISCORD_CLIENT_ID ||= '123456789012345678';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';

const { supabase } = await import('../dist/services/supabase.js');

test('link lookup distinguishes an existing link, no link, and database outage', async t => {
    const original = supabase.client;
    t.after(() => { supabase.client = original; });

    for (const [response, expected] of [
        [{ data: { discord_id: '123', user_id: 'user-1' }, error: null }, 'linked'],
        [{ data: null, error: null }, 'unlinked'],
        [{ data: null, error: { code: 'PGRST002', message: 'Schema cache unavailable' } }, 'unavailable'],
    ]) {
        supabase.client = {
            from(table) {
                assert.equal(table, 'discord_linked_accounts');
                return { select() { return this; }, eq() { return this; }, async maybeSingle() { return response; } };
            },
        };
        const result = await supabase.lookupLinkedAccount('123');
        assert.equal(result.status, expected);
    }
});

test('token creation does not insert after failed invalidation', async t => {
    const original = supabase.client;
    t.after(() => { supabase.client = original; });
    let inserted = false;
    supabase.client = {
        from(table) {
            assert.equal(table, 'discord_link_tokens');
            return {
                delete() { return this; },
                async eq() { return { error: { code: 'PGRST002', message: 'Database unavailable' } }; },
                insert() { inserted = true; throw new Error('Insert must not run'); },
            };
        },
    };

    assert.equal(await supabase.createLinkToken('123', 'test', 'token', new Date()), null);
    assert.equal(inserted, false);
});
