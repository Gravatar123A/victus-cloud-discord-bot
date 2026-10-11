import test from 'node:test';
import assert from 'node:assert/strict';
import { rpgCommand, sellCommand, mineCommand } from '../dist/commands/rpg.js';
import { rpgService } from '../dist/services/rpgService.js';

test('sell alias and RPG subcommand expose identical selection and quantity options', () => {
    const alias = sellCommand.data.toJSON();
    const sub = rpgCommand.data.toJSON().options.find(option => option.name === 'sell');
    assert.deepEqual(alias.options, sub.options);
    assert.deepEqual(alias.options.map(option => option.name), ['item', 'quantity', 'category']);
    assert.ok(alias.options.every(option => !option.required));
    assert.equal(mineCommand.cooldown, undefined, 'service owns the shared mining guard');
});

test('another player cannot use mining buttons or material selectors', async () => {
    const replies = [];
    const interaction = { user: { id: 'attacker' }, reply: async value => replies.push(value) };
    await rpgCommand.handleButton({ ...interaction, customId: 'rpg:mine:owner' });
    await rpgCommand.handleSelectMenu({ ...interaction, customId: 'rpg:sellselect:owner', values: ['common'] });
    assert.equal(replies.length, 2);
    assert.match(replies[0].content, /someone else/);
});

test('mining button acknowledges immediately and updates the same panel with a reusable button', async t => {
    const original = rpgService.gather;
    t.after(() => { rpgService.gather = original; });
    const calls = [];
    rpgService.gather = async () => {
        assert.deepEqual(calls, ['defer']);
        return { item: 'coal', activityXp: 0, inventory: { pickaxe_tier: 'wood', rod_tier: 'wood', ores_json: { coal: 1 }, fish_json: {} } };
    };
    let response;
    await rpgCommand.handleButton({ customId: 'rpg:mine:owner', user: { id: 'owner' },
        isMessageComponent: () => true, deferUpdate: async () => { calls.push('defer'); },
        editReply: async payload => { response = payload; }, followUp: async () => assert.fail('unexpected error') });
    const rendered = JSON.stringify(response.components.map(c => c.toJSON()));
    assert.match(rendered, /rpg:mine:owner/);
    assert.match(rendered, /\+1 coal/);
});
