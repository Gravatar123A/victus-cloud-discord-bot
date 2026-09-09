import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ticketTranslationService,
    TOP_10_LANGUAGES,
} from '../dist/services/ticketTranslationService.js';
import { memberStatsService } from '../dist/services/memberStatsService.js';
import { leaderboardService } from '../dist/services/leaderboardService.js';

test('TOP_10_LANGUAGES contains the 10 most common world languages', () => {
    assert.equal(TOP_10_LANGUAGES.length, 10);
    const codes = TOP_10_LANGUAGES.map((l) => l.code);
    assert.ok(codes.includes('en'));
    assert.ok(codes.includes('es'));
    assert.ok(codes.includes('zh-CN'));
    assert.ok(codes.includes('hi'));
    assert.ok(codes.includes('ar'));
    assert.ok(codes.includes('fr'));
    assert.ok(codes.includes('pt'));
    assert.ok(codes.includes('ru'));
    assert.ok(codes.includes('de'));
    assert.ok(codes.includes('ja'));

    for (const lang of TOP_10_LANGUAGES) {
        assert.ok(lang.name, `Missing name for ${lang.code}`);
        assert.ok(lang.nativeName, `Missing nativeName for ${lang.code}`);
        assert.ok(lang.emoji, `Missing emoji for ${lang.code}`);
    }
});

test('ticketTranslationService resolves languages correctly', () => {
    assert.equal(ticketTranslationService.getLanguage('es').code, 'es');
    assert.equal(ticketTranslationService.getLanguage('ES').name, 'Spanish');
    assert.equal(ticketTranslationService.getLanguage('ja').name, 'Japanese');
    assert.equal(ticketTranslationService.getLanguage('unknown-xyz').code, 'en');
});

test('ticketTranslationService translates text accurately', async () => {
    // 1. English to Spanish
    const esResult = await ticketTranslationService.translate('Hello, how can I help you?', 'es', 'en');
    assert.ok(esResult && esResult.length > 0);
    assert.match(esResult.toLowerCase(), /hola|cómo|ayudar/);

    // 2. Spanish to English
    const enResult = await ticketTranslationService.translate('Hola, mi servidor no enciende', 'en', 'es');
    assert.ok(enResult && enResult.length > 0);
    assert.match(enResult.toLowerCase(), /hello|hi|server|turn on|start/);

    // 3. French to English
    const frResult = await ticketTranslationService.translate('Merci beaucoup pour votre aide', 'en', 'fr');
    assert.ok(frResult && frResult.length > 0);
    assert.match(frResult.toLowerCase(), /thank/);
});

test('ticketTranslationService formats notices properly', () => {
    const customerNotice = ticketTranslationService.formatTranslationNotice({
        isCustomer: true,
        authorName: 'Carlos',
        authorId: '123456789',
        sourceLanguage: ticketTranslationService.getLanguage('es'),
        targetLanguage: ticketTranslationService.getLanguage('en'),
        originalText: 'No puedo acceder a mi panel',
        translatedText: 'I cannot access my panel',
    });
    assert.ok(customerNotice.includes('Customer Translation'));
    assert.ok(customerNotice.includes('I cannot access my panel'));
    assert.ok(customerNotice.includes('No puedo acceder a mi panel'));

    const staffNotice = ticketTranslationService.formatTranslationNotice({
        isCustomer: false,
        authorName: 'SupportAgent',
        authorId: '123456789',
        sourceLanguage: ticketTranslationService.getLanguage('en'),
        targetLanguage: ticketTranslationService.getLanguage('es'),
        originalText: 'We have restarted your service.',
        translatedText: 'Hemos reiniciado su servicio.',
    });
    assert.ok(staffNotice.includes('Staff Translation'));
    assert.ok(staffNotice.includes('Hemos reiniciado su servicio.'));
});

test('ticketTranslationService builds language selector Components V2 card', () => {
    const card = ticketTranslationService.buildLanguageSelector('ticket_123', 'user_456');
    assert.ok(card);
    const json = card.toJSON();
    assert.ok(json.components);
    assert.ok(json.components.length > 0);
});

test('memberStatsService tracks messages and voice airtime accurately', async () => {
    const testGuild = 'test_guild_999';
    const userA = 'user_aaa';
    const userB = 'user_bbb';

    // Record messages
    await memberStatsService.recordMessage(testGuild, userA);
    await memberStatsService.recordMessage(testGuild, userA);
    await memberStatsService.recordMessage(testGuild, userB);

    const statsA = await memberStatsService.getUserStats(testGuild, userA);
    assert.ok(statsA.messages >= 2);

    const topMessages = await memberStatsService.getTopMessages(testGuild, 5);
    assert.ok(topMessages.length >= 2);
    assert.equal(topMessages[0].userId, userA);

    // Record voice minutes
    await memberStatsService.recordVoiceMinute(testGuild, userB, 15);
    await memberStatsService.recordVoiceMinute(testGuild, userA, 5);

    const topVoice = await memberStatsService.getTopVoice(testGuild, 5);
    assert.ok(topVoice.length >= 2);
    assert.equal(topVoice[0].userId, userB);
    assert.ok(topVoice[0].minutes >= 15);
});

test('leaderboardService builds Components V2 layouts for all categories', async () => {
    const testGuild = 'test_guild_999';

    for (const view of ['overview', 'coins', 'xp', 'messages', 'voice']) {
        const container = await leaderboardService.buildLeaderboardContainer(testGuild, view);
        assert.ok(container, `Container failed for view: ${view}`);
        const json = container.toJSON();
        assert.ok(json.components);
        assert.ok(json.components.length > 0);
    }
});
