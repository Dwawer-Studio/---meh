'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadScripts } = require('./helpers/load-script');

function loadGuidance(vibrate = () => true) {
    const document = {
        addEventListener() {},
        removeEventListener() {},
        getElementById() { return null; },
        querySelectorAll() { return []; },
        documentElement: {},
        body: { classList: { add() {}, remove() {}, toggle() {} } },
    };
    const I18n = { t: key => key };
    const { MehGame } = loadScripts(['game.js'], ['MehGame'], {
        document,
        I18n,
        navigator: { vibrate },
        Storage: { getSettings: () => ({}), getCurrentProfile: () => null },
        Sound: { play() {} },
    });
    const game = Object.create(MehGame.prototype);
    game._initializeGuidance();
    game.settings = { haptics: false };
    return game;
}

test('P1 action journal is bounded and records public explanations only', () => {
    const game = loadGuidance();
    for (let index = 0; index < 25; index++) {
        game._recordActionJournal(`public-${index}`, `reason-${index}`, 'play');
    }
    assert.equal(game._actionJournal.length, 20);
    assert.equal(game._actionJournal[0].text, 'public-5');
    assert.equal(game._latestActionReason, 'reason-24');
    assert.doesNotMatch(JSON.stringify(game._actionJournal), /hand|cardId/);
});

test('P1 contextual guidance appears once per structural situation', () => {
    const game = loadGuidance();
    game._guidanceSeen.add('first-turn');
    assert.equal(game._showGuidance('first-turn', 'tip', 'reason'), false);
});

test('P1 haptics are strictly opt-in', () => {
    let calls = 0;
    const game = loadGuidance(() => { calls++; return true; });
    assert.equal(game._haptic(60), false);
    assert.equal(calls, 0);
    game.settings.haptics = true;
    assert.equal(game._haptic([80, 40, 80]), true);
    assert.equal(calls, 1);
});
