import assert from 'node:assert/strict';
import test from 'node:test';
import { isCurrentPaidService, customerMayRequestHuman, isPremiumSupportCategory } from '../dist/services/premiumSupport.js';
import { rankVictusDocs } from '../dist/services/ticketKnowledge.js';
import { isTicketAiLocallyPaused, redactTicketText, resumeTicketAiLocally, TICKET_AI_MODEL } from '../dist/services/discordTicketAi.js';
import { createTicketControlPanel } from '../dist/commands/ticket.js';
import { handleDiscordTicketMessage, shouldAutoReplyToTicketMessage } from '../dist/services/discordTicketMessages.js';
import { ticketAiCommand } from '../dist/commands/ticketai.js';
import { supabase } from '../dist/services/supabase.js';
import { ticketTranslationService } from '../dist/services/ticketTranslationService.js';

test('paid support requires an active, unexpired, positively priced service', () => {
    const active = { status: 'active', plan_type: 'recurring', price: '3.00', expires_at: '2099-01-01' };
    assert.equal(isCurrentPaidService(active), true);
    for (const change of [
        { status: 'cancelled' }, { plan_type: 'free' }, { price: '0.00' },
        { expires_at: '2020-01-01' }, { expires_at: 'not-a-date' },
    ]) assert.equal(isCurrentPaidService({ ...active, ...change }), false);
    assert.equal(isPremiumSupportCategory({ name: 'Premium Support' }), true);
    assert.equal(isPremiumSupportCategory({ name: 'Priority Care', premium_support: true }), true);
    assert.equal(customerMayRequestHuman({ name: 'Billing Tickets' }), true);
    assert.equal(customerMayRequestHuman({ name: 'Partnership Tickets' }), true);
    assert.equal(customerMayRequestHuman({ name: 'Support Tickets' }), false);
});

test('ticket prompts redact common personal data and secrets', () => {
    const clean = redactTicketText('Email a@b.com, password: hunter2, IP 10.1.2.3, token=abcdef, card 4111 1111 1111 1111');
    for (const secret of ['a@b.com', 'hunter2', '10.1.2.3', 'abcdef', '4111']) assert.equal(clean.includes(secret), false);
    assert.equal(TICKET_AI_MODEL, 'nvidia/nemotron-3.5-super-vl:free');
});

test('retrieval ranks relevant canonical docs without sending the whole library', () => {
    const docs = rankVictusDocs('Minecraft server backup restore');
    assert.ok(docs.length > 0 && docs.length <= 3);
    assert.ok(docs.some((doc) => /backup/i.test(doc.title)));
});

test('customer handoff controls appear only in sensitive categories', () => {
    const base = {
        id: '00000000-0000-4000-8000-000000000000', ticket_number: 1, status: 'open', priority: 'medium',
        discord_id: '123', subject: 'Problem', description: 'Please help', created_at: new Date().toISOString(),
    };
    const normal = JSON.stringify(createTicketControlPanel({ ...base, category: { name: 'Support Tickets' } }, {}));
    const billing = JSON.stringify(createTicketControlPanel({ ...base, category: { name: 'Billing Tickets' } }, {}));
    assert.equal(normal.includes('ticket_disable_ai_'), false);
    assert.equal(normal.includes('ticket_ping_staff_'), false);
    assert.equal(billing.includes('ticket_disable_ai_'), true);
    assert.equal(billing.includes('ticket_ping_staff_'), true);
});

test('ticket owner receives AI replies even when they also have a staff role', () => {
    assert.equal(shouldAutoReplyToTicketMessage('owner', 'owner', 'my server is crashing'), true);
    assert.equal(shouldAutoReplyToTicketMessage('owner', 'staff', 'please check this'), false);
    assert.equal(shouldAutoReplyToTicketMessage('owner', 'owner', '/ticketai pause'), false);
});

test('a staff reply pauses ticket AI until staff resumes it', async () => {
    const originals = {
        getTicketByChannel: supabase.getTicketByChannel,
        getBotSettings: supabase.getBotSettings,
        getDiscordTicketAiState: supabase.getDiscordTicketAiState,
        setDiscordTicketAiEnabled: supabase.setDiscordTicketAiEnabled,
        logTicketMessage: supabase.logTicketMessage,
        getTranslationState: ticketTranslationService.getState,
    };
    const ticketId = '00000000-0000-4000-8000-000000000001';
    const updates = [];
    const notices = [];
    try {
        supabase.getTicketByChannel = async () => ({ id: ticketId, guild_id: 'guild', discord_id: 'owner', status: 'open' });
        supabase.getBotSettings = async () => ({ ticket_staff_role_ids: ['staff-role'], ticket_admin_role_ids: [] });
        supabase.getDiscordTicketAiState = async () => ({ enabled: true, staff_pinged_at: null });
        supabase.setDiscordTicketAiEnabled = async (...args) => { updates.push(args); return true; };
        supabase.logTicketMessage = async () => null;
        ticketTranslationService.getState = async () => null;
        const message = {
            author: { id: 'staff', username: 'Staff', bot: false },
            channelId: 'channel', guildId: 'guild', content: 'I can take this one.',
            createdTimestamp: Date.now(), attachments: new Map(),
            channel: { name: 'ticket-123', send: async (payload) => { notices.push(payload); return {}; } },
            member: { displayName: 'Staff', permissions: { has: () => false }, roles: { cache: { has: (id) => id === 'staff-role' } } },
            inGuild: () => true,
        };
        assert.equal(await handleDiscordTicketMessage(message), true);
        assert.deepEqual(updates, [[ticketId, false, 'staff']]);
        assert.equal(isTicketAiLocallyPaused(ticketId), true);
        assert.match(notices[0].content, /ticketai resume/);
    } finally {
        Object.assign(supabase, {
            getTicketByChannel: originals.getTicketByChannel,
            getBotSettings: originals.getBotSettings,
            getDiscordTicketAiState: originals.getDiscordTicketAiState,
            setDiscordTicketAiEnabled: originals.setDiscordTicketAiEnabled,
            logTicketMessage: originals.logTicketMessage,
        });
        ticketTranslationService.getState = originals.getTranslationState;
        resumeTicketAiLocally(ticketId);
    }
    assert.equal(isTicketAiLocallyPaused(ticketId), false);
    assert.ok(ticketAiCommand.data.toJSON().options.some((option) => option.name === 'resume'));
});
