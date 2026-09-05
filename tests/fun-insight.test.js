'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers/load-script');
const { MEH_CATALOG_MANIFEST } = require('../game/game-manifests');
const { I18n, CardInsight } = loadScripts(['i18n.js', 'ui/experience-copy.js', 'game/card-insight.js'], ['I18n', 'CardInsight']);
const state = { players: ['You', 'Ahmed', 'Noura', 'Khaled'].map(name => ({ name, hand: [] })),
    actorIndex: 0, direction: 1, pendingDraws: 4, discardPile: [1, 2, 3, 4, 5] };
const describe = (type, patch = {}) => CardInsight.describe({ type }, { ...state, ...patch }, (key, params) => I18n.t(key, params));

test('every shipped card has a meaningful AR/EN explanation through the actual dictionary', () => {
    for (const locale of ['ar', 'en']) {
        I18n.lang = locale;
        for (const card of MEH_CATALOG_MANIFEST.definitions) {
            const result = describe(card.type);
            assert.ok(result.description.length > 15, card.definitionId);
            assert.doesNotMatch(result.description, /undefined|insight_|\{\w+\}/);
        }
    }
});

test('counter previews combine the current penalty and reverse the target correctly', () => {
    I18n.lang = 'en';
    assert.match(describe('counterAttack').description, /6 for Khaled/);
    assert.match(describe('counterAttack', { direction: -1 }).description, /6 for Ahmed/);
    assert.match(describe('dramaQueen').description, /Ahmed and Noura/);
    assert.match(describe('draw4Wild').description, /8 for Ahmed/);
});

test('disabled powers, self penalties and uncertain remote discard stacks are explicit', () => {
    I18n.lang = 'en';
    assert.equal(describe('boShlakh', { superpowersDisabled: true }).suppressed, true);
    assert.equal(describe('counterAttack', { superpowersDisabled: true }).suppressed, false);
    assert.match(describe('sorry').detail, /you take this penalty/);
    assert.match(describe('sorry', { selfShield: true }).description, /shield cancels/);
    assert.equal(describe('sorry', { selfShield: true }).detail, '');
    assert.match(describe('hamour', { discardComplete: false }).detail, /depends/);
    assert.match(describe('hamour', { discardPile: [1, 2] }).detail, /2 cards/);
});

test('previews do not mutate game state', () => {
    const before = JSON.stringify(state);
    for (const card of MEH_CATALOG_MANIFEST.definitions) describe(card.type);
    assert.equal(JSON.stringify(state), before);
});

test('an authoritative decision cannot submit an old card using a newer turn token', async () => {
    const { MehGame } = loadScripts(['i18n.js', 'deck.js', 'game.js'], ['MehGame']);
    const game = Object.create(MehGame.prototype);
    let submitted = 0;
    game._authoritativeClient = { play: async () => { submitted++; } };
    game._authoritativeMatchView = { turnId: 4 };
    game.currentPlayerIndex = 1;
    game._authoritativeDecision = async () => {
        game._authoritativeMatchView = { turnId: 5 };
        return { color: 'orange' };
    };
    game.showToast = () => {};
    game.updateUI = () => {};
    assert.equal(await game._submitAuthoritativePlay({ id: 'my-old-card' }), false);
    assert.equal(submitted, 0);
    assert.equal(game.humanCanPlay, false);
});
