import test from 'node:test';
import assert from 'node:assert/strict';
import { giveawayCommand } from '../dist/commands/giveaway.js';
import { supabase } from '../dist/services/supabase.js';

test('an ineligible giveaway entrant receives a readable reply', async () => {
    const originalGetGiveaway = supabase.getGiveaway;
    const originalGetLinkedAccount = supabase.getLinkedAccount;
    const originalGetUserProfile = supabase.getUserProfile;
    const replies = [];
    const interaction = {
        customId: 'giveaway:enter:test-id',
        guildId: 'guild-id',
        user: { id: 'entrant-id' },
        member: { roles: { cache: { has: () => false } }, premiumSince: null },
        deferReply: async () => {},
        editReply: async (reply) => { replies.push(reply); },
    };

    try {
        supabase.getGiveaway = async () => ({
            id: 'test-id',
            status: 'active',
            participants: [],
            requirements: { level: 3, roles: [], invites: 0, booster: false },
        });
        supabase.getLinkedAccount = async () => ({ user_id: 'panel-user-id' });
        supabase.getUserProfile = async () => ({ total_xp: 0 });

        await giveawayCommand.handleButton(interaction);
        assert.equal(replies.length, 1);
        assert.match(replies[0].content, /Level 3 required/);
        assert.equal(replies[0].components, undefined);
    } finally {
        supabase.getGiveaway = originalGetGiveaway;
        supabase.getLinkedAccount = originalGetLinkedAccount;
        supabase.getUserProfile = originalGetUserProfile;
    }
});
