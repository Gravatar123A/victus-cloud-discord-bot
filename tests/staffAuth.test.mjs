import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../dist/config.js';
import { supabase } from '../dist/services/supabase.js';
import { verifyStaffOrAdmin, VICTUS_STAFF_ROLE_ID, isVictusStaffComponent } from '../dist/utils/staffAuth.js';
import { requireAdmin } from '../dist/middleware/requireLinked.js';
import { economyCommand } from '../dist/commands/economy.js';
import { gtnCommand } from '../dist/commands/gtn.js';
import { unscrambleCommand } from '../dist/commands/unscramble.js';

test('platform access requires fresh membership in the official staff team', async t => {
    const oldGuild = config.bot.supportGuildId;
    const oldSettings = supabase.getBotSettings;
    config.bot.supportGuildId = 'official';
    supabase.getBotSettings = async id => { assert.equal(id, 'official'); return { ticket_staff_role_ids: ['configured-staff'], ticket_admin_role_ids: [] }; };
    t.after(() => { config.bot.supportGuildId = oldGuild; supabase.getBotSettings = oldSettings; });
    let roles = new Set();
    let present = true;
    let ownerId = 'official-owner';
    const calls = [];
    const client = {
        application: { owner: { id: 'outsider' } },
        guilds: { async fetch(id) {
            assert.equal(id, 'official');
            return { id, ownerId, members: { async fetch(options) {
                calls.push(options);
                if (!present) throw new Error('Not a member');
                return { guild: { id }, roles: { cache: roles }, permissions: { has: () => true } };
            } } };
        } },
    };
    const user = { id: 'outsider', bot: false };
    assert.equal((await verifyStaffOrAdmin(user, client)).authorized, false, 'administrator/application-owner flags cannot substitute for staff');
    roles.add(VICTUS_STAFF_ROLE_ID);
    assert.equal((await verifyStaffOrAdmin(user, client)).authorized, true);
    roles.clear(); roles.add('configured-staff');
    assert.equal((await verifyStaffOrAdmin(user, client)).authorized, true);
    roles.clear();
    assert.equal((await verifyStaffOrAdmin(user, client)).authorized, false, 'removed roles revoke access immediately');
    roles.add(VICTUS_STAFF_ROLE_ID); present = false;
    assert.equal((await verifyStaffOrAdmin(user, client)).authorized, false, 'departed staff cannot use old panels');
    present = true; ownerId = user.id;
    assert.equal((await verifyStaffOrAdmin(user, client)).isSuperOwner, true);
    assert.ok(calls.every(call => call.user === user.id && call.force === true));
    config.bot.supportGuildId = '';
    assert.equal((await verifyStaffOrAdmin(user, client)).authorized, false, 'missing configuration fails closed');
});

test('sensitive announcement, reward approval and staff modals are guarded centrally', () => {
    for (const id of ['announce_confirm_send', 'annc:modal_text', 'staffai_clear_session',
        'victus_res_staff_approve:user:resource', 'victus_res_staff_reject_modal:user:resource',
        'ticket_question_modal:123', 'victus_res_modal_reject:user:resource']) assert.equal(isVictusStaffComponent(id), true);
    for (const id of ['rpg:mine:123', 'econ:bankdep:123', 'ticket_close_123']) assert.equal(isVictusStaffComponent(id), false);
});

test('give/admin middleware and forged economy buttons deny external administrators', async t => {
    const old = config.bot.supportGuildId; config.bot.supportGuildId = 'official';
    t.after(() => { config.bot.supportGuildId = old; });
    const replies = [];
    const interaction = { user: { id: 'external' }, client: { guilds: { fetch: async () => { throw new Error('not in guild'); } } },
        memberPermissions: { has: () => true }, reply: async payload => replies.push(payload),
        showModal: async () => assert.fail('non-staff modal must never open') };
    assert.equal(await requireAdmin(interaction), false);
    await economyCommand.handleButton({ ...interaction, customId: 'econ:adjadj:external' });
    await economyCommand.handleButton({ ...interaction, customId: 'econ:adjfreeze:external:1' });
    assert.equal(replies.length, 3);
});

test('economy adjustments recheck official staff after the confirmation panel was opened', async t => {
    const originals = { guild: config.bot.supportGuildId, settings: supabase.getBotSettings, link: supabase.getLinkedAccount,
        profile: supabase.getUserProfile, adjust: supabase.econAdminAdjustCp };
    config.bot.supportGuildId = 'official';
    supabase.getBotSettings = async () => null;
    supabase.getLinkedAccount = async id => ({ user_id: `victus-${id}` });
    supabase.getUserProfile = async () => ({ is_admin: true });
    supabase.econAdminAdjustCp = async () => assert.fail('revoked staff must not adjust balances');
    t.after(() => { config.bot.supportGuildId = originals.guild; supabase.getBotSettings = originals.settings;
        supabase.getLinkedAccount = originals.link; supabase.getUserProfile = originals.profile; supabase.econAdminAdjustCp = originals.adjust; });
    let active = true;
    const id = '123456789012345678';
    const client = { guilds: { fetch: async () => ({ id: 'official', ownerId: 'someone', members: {
        fetch: async () => ({ guild: { id: 'official' }, roles: { cache: new Set(active ? [VICTUS_STAFF_ROLE_ID] : []) } }),
    } }) } };
    let panel;
    await economyCommand.handleModal({ customId: `econ:m:adjadj:${id}`, isFromMessage: () => true, user: { id }, client,
        fields: { getTextInputValue: key => ({ to: '223456789012345678', delta: '50', reason: 'test' })[key] },
        update: async value => { panel = value; } });
    const data = JSON.stringify(panel.components.map(c => c.toJSON()));
    const customId = data.match(/econ:cfm:[^"\\]+/)[0];
    active = false;
    await economyCommand.handleButton({ customId, user: { id }, client, update: async value => { panel = value; } });
    assert.match(JSON.stringify(panel.components.map(c => c.toJSON())), /Official staff membership is required/);
});

test('external server administrators cannot configure minted game rewards', async t => {
    const old = config.bot.supportGuildId; config.bot.supportGuildId = 'official';
    t.after(() => { config.bot.supportGuildId = old; });
    const replies = [];
    const interaction = { user: { id: 'external' }, guild: { id: 'external-server' },
        client: { guilds: { fetch: async () => { throw new Error('not official staff'); } } },
        options: { getSubcommand: () => 'coins', getInteger: () => 1000 },
        reply: async value => replies.push(value), memberPermissions: { has: () => true } };
    await gtnCommand.execute(interaction);
    await unscrambleCommand.execute(interaction);
    assert.equal(replies.length, 2);
    assert.ok(replies.every(reply => /Official Victus Cloud Staff/.test(reply.content)));
});
