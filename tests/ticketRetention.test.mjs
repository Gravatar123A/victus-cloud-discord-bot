import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CLOSED_TICKET_RETENTION_MS,
    CUSTOMER_REPLY_TIMEOUT_MS,
    shouldCloseDiscordTicket,
} from '../dist/services/ticketRetentionPolicy.js';

const now = Date.parse('2026-10-24T12:00:00.000Z');
const ago = (milliseconds) => new Date(now - milliseconds).toISOString();

test('ticket retention uses four days awaiting a customer and two days after close', () => {
    assert.equal(CUSTOMER_REPLY_TIMEOUT_MS, 4 * 86400000);
    assert.equal(CLOSED_TICKET_RETENTION_MS, 2 * 86400000);
});

test('an old staff or AI answer awaits the customer for four days', () => {
    assert.equal(shouldCloseDiscordTicket({
        author_discord_id: 'dc:staff', author_is_staff: true,
        created_at: ago(CUSTOMER_REPLY_TIMEOUT_MS),
    }, 'customer', now), true);
    assert.equal(shouldCloseDiscordTicket({
        author_discord_id: 'ai:bot', author_is_staff: false,
        created_at: ago(CUSTOMER_REPLY_TIMEOUT_MS + 1),
    }, 'customer', now), true);
});

test('new replies, customer replies, and tickets without support answers remain open', () => {
    assert.equal(shouldCloseDiscordTicket({
        author_discord_id: 'dc:staff', author_is_staff: true,
        created_at: ago(CUSTOMER_REPLY_TIMEOUT_MS - 1),
    }, 'customer', now), false);
    assert.equal(shouldCloseDiscordTicket({
        author_discord_id: 'dc:customer', author_is_staff: false,
        created_at: ago(CUSTOMER_REPLY_TIMEOUT_MS + 86400000),
    }, 'customer', now), false);
    assert.equal(shouldCloseDiscordTicket(null, 'customer', now), false);
});
