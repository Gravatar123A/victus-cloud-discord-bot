process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { discoveryService, KNOWN_CATEGORIES } from '../dist/services/discoveryService.js';
import { DiscoveryEmbeds } from '../dist/embeds/discoveryEmbeds.js';

console.log('🧪 Starting Victus Cloud Discovery Test Suite...\n');

async function runTests() {
    // Test 1: Fetch servers and verify normalization
    console.log('▶ Test 1: discoveryService.fetchServers()');
    const servers = await discoveryService.fetchServers();
    assert.ok(Array.isArray(servers), 'fetchServers should return an array');
    console.log(`  ✔ Retrieved ${servers.length} discoverable servers`);

    // Test 2: Section 0 Acceptance Check - JSON Dump
    console.log('\n▶ Test 2: Section 0 JSON dump format verification');
    const jsonDumpStr = await discoveryService.dumpDiscoveredServersJson();
    assert.ok(typeof jsonDumpStr === 'string' && jsonDumpStr.length > 0, 'dump should be non-empty string');
    const dump = JSON.parse(jsonDumpStr);

    assert.ok(dump.generated_at, 'dump must contain generated_at');
    assert.strictEqual(typeof dump.total_discoverable_servers, 'number', 'dump must contain total_discoverable_servers');
    assert.ok(Array.isArray(dump.servers), 'dump must contain servers array');

    const requiredKeys = [
        'server_id',
        'server_name',
        'description',
        'game_type',
        'category_label',
        'ip',
        'connect_hostname',
        'direct_address',
        'current_player_count',
        'max_players',
        'status',
        'uptime_percent',
        'created_at',
        'average_player_count',
        'owner_username',
        'owner_id',
        'plan_tier',
        'mc_version',
        'software',
        'banner_image_url',
        'icon_url',
        'featured',
        'boost_level',
        'rating_avg',
        'rating_count',
        'whitelist',
        'suspended',
        'discovery_enabled',
        'forum_thread_id',
        'forum_message_id',
        'assigned_tag_ids',
        'last_synced_at',
    ];

    if (dump.servers.length > 0) {
        const sample = dump.servers[0];
        for (const key of requiredKeys) {
            assert.ok(
                key in sample,
                `Missing required key '${key}' in discovered server schema`
            );
            // Verify value is not undefined (must be populated or explicitly null)
            assert.notStrictEqual(
                sample[key],
                undefined,
                `Key '${key}' cannot be undefined (must be populated or null)`
            );
        }
        console.log(`  ✔ Validated all ${requiredKeys.length} required fields on sample server: "${sample.server_name}"`);
    }

    // Test 3: Filtering & Sorting
    console.log('\n▶ Test 3: Filter & Sort capabilities');
    const allResult = await discoveryService.getFilteredServers({ page: 1, limit: 5 });
    assert.ok(allResult.totalPages >= 1, 'Should have at least 1 page');

    // Filter by online status
    const onlineResult = await discoveryService.getFilteredServers({ status: 'online_only', limit: 10 });
    for (const s of onlineResult.items) {
        assert.strictEqual(s.status, 'online', 'online_only filter must return only online servers');
    }
    console.log(`  ✔ Status filter passed (${onlineResult.totalItems} online servers)`);

    // Default sort: rating_desc (Top Rated + Online priority)
    const defaultSortResult = await discoveryService.getFilteredServers({ pageSize: 10 });
    let seenOffline = false;
    for (const s of defaultSortResult.items) {
        if (s.status !== 'online') {
            seenOffline = true;
        } else if (seenOffline) {
            assert.fail('Online servers must always appear before offline servers');
        }
    }
    console.log('  ✔ Online priority in default sort verified');

    // Sort by players descending
    const sortedResult = await discoveryService.getFilteredServers({ sort: 'players_desc', pageSize: 10 });
    let seenOfflineInPlayers = false;
    for (let i = 0; i < sortedResult.items.length - 1; i++) {
        const cur = sortedResult.items[i];
        const next = sortedResult.items[i + 1];
        if (cur.status === 'online' && next.status === 'online') {
            assert.ok(
                cur.currentPlayerCount >= next.currentPlayerCount,
                'Players desc sort should be in descending order among online servers'
            );
        }
    }
    console.log('  ✔ Sort by players descending verified');

    // Test 4: Autocomplete lookup
    console.log('\n▶ Test 4: Autocomplete suggestions');
    const suggestions = await discoveryService.autocompleteServer('a');
    assert.ok(Array.isArray(suggestions), 'Autocomplete should return array');
    assert.ok(suggestions.length <= 25, 'Autocomplete must never exceed 25 items');
    for (const item of suggestions) {
        assert.ok(item.name && item.value, 'Autocomplete items must have name and value');
    }
    console.log(`  ✔ Autocomplete returned ${suggestions.length} valid suggestions`);

    // Test 5: Exact & Fuzzy lookup
    console.log('\n▶ Test 5: Single server lookup');
    if (servers.length > 0) {
        const target = servers[0];
        const lookup = await discoveryService.getServer(target.serverId);
        assert.ok(lookup.exact, 'Lookup by serverId should find exact server');
        assert.strictEqual(lookup.exact.serverId, target.serverId);
        console.log(`  ✔ Exact lookup succeeded for ID "${target.serverId}" (${target.serverName})`);
    }

    // Test 6: Components V2 Browser Builder
    console.log('\n▶ Test 6: Discord Components V2 Browser View Builder');
    const pageData = await discoveryService.getFilteredServers({ page: 1, limit: 5 });
    const browser = DiscoveryEmbeds.buildBrowser(pageData, {
        page: 1,
        category: 'all',
        sort: 'players_desc',
        status: 'all',
        tier: 'all',
    });
    assert.ok(browser.container, 'Browser must return a ContainerBuilder');
    assert.ok(Array.isArray(browser.actionRows), 'Browser must return actionRows array');
    assert.strictEqual(browser.actionRows.length, 3, 'Browser must have 3 action rows (category, sort, nav)');
    console.log('  ✔ Browser Components V2 structure successfully validated');

    // Test 7: Components V2 Status Card Builder
    console.log('\n▶ Test 7: Single Server Status Card Builder');
    if (servers.length > 0) {
        const card = DiscoveryEmbeds.buildServerStatusCard(servers[0]);
        assert.ok(card.container, 'Card must return container');
        assert.ok(Array.isArray(card.actionRows), 'Card must return actionRows');
        console.log('  ✔ Status Card Components V2 structure successfully validated');
    }

    console.log('\n✨ ALL TESTS PASSED SUCCESSFULLY! ✨\n');
}

runTests().catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
