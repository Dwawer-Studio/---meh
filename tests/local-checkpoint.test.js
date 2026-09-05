'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers/load-script');
const { Deck, LocalCheckpoint, MEH_CORE_MANIFEST: core, MEH_CATALOG_MANIFEST: catalog } = loadScripts(
    ['deck.js', 'game/local-checkpoint.js'], ['Deck', 'LocalCheckpoint', 'MEH_CORE_MANIFEST', 'MEH_CATALOG_MANIFEST']);

function fixture() {
    const deck = new Deck();
    const players = Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, hand: deck.cards.splice(0, 7) }));
    return { deck, players, discardPile: [deck.draw()], humanProfile: { id: 'tester' }, _localRunId: 'solo-test',
        currentPlayerIndex: 0, direction: -1, activeColor: 'gray', pendingDraws: 6,
        _pendingDrawReason: 'A counter returned the penalty', _lastSkipReason: { p1: 'Plato' },
        skipNextMap: { p1: true }, drawImmune: { p2: true }, superpowersDisabled: true, _sugarOwnerId: 'p3',
        _actionJournal: [{ text: 'Counter', reason: 'Penalty', kind: 'effect' }] };
}

test('checkpoint roundtrip retains all 60 exact identities, order and public status causes without trusting stored artwork', () => {
    const game = fixture();
    const raw = LocalCheckpoint.capture(game, { kind: 'turn' }, core, catalog);
    const saved = LocalCheckpoint.validate(raw, 'tester', core, catalog);
    assert.ok(saved);
    assert.deepEqual(JSON.parse(JSON.stringify(raw)), JSON.parse(JSON.stringify(saved)));
    assert.equal(saved.pendingReason, 'A counter returned the penalty');
    assert.equal(saved.skipReasons[1], 'Plato');
    assert.equal(JSON.stringify(raw).includes('svgFile'), false);
    saved.deck.reverse(); assert.notDeepEqual(saved.deck, raw.deck);
});

test('checkpoint rejects wrong profile/version, duplicates, recipe substitutions, malformed decisions and counts', () => {
    const game = fixture();
    const raw = LocalCheckpoint.capture(game, { kind: 'play', cardId: game.players[0].hand[0].id,
        decisions: [{ kind: 'target', value: 1 }, { kind: 'card', value: game.players[0].hand[1].id }] }, core, catalog);
    assert.ok(LocalCheckpoint.validate(raw, 'tester', core, catalog));
    const corruptions = [saved => { saved.profileId = 'other'; }, saved => { saved.rulesVersion = 'future'; },
        saved => { saved.deck[0].id = saved.deck[1].id; }, saved => { delete saved.deck[0].id; },
        saved => { saved.deck[0].definitionId = 'fake'; }, saved => { saved.hands[0].pop(); },
        saved => { saved.resume.decisions[0].value = 0; }, saved => { saved.resume.decisions[1].value = saved.deck[0].id; },
        saved => { saved.pending = -1; }, saved => { saved.sugarOwner = -1; }];
    for (const corrupt of corruptions) {
        const saved = JSON.parse(JSON.stringify(raw)); corrupt(saved);
        assert.equal(LocalCheckpoint.validate(saved, 'tester', core, catalog), null);
    }
});

test('a stale second tab cannot overwrite a save advanced by the first tab, even within the same run', () => {
    const memory = new Map();
    const { MehGame } = loadScripts(['i18n.js', 'deck.js', 'game.js'], ['MehGame'], {
        Storage: { _getItem: key => memory.get(key) || null,
            _write: (key, value) => { memory.set(key, JSON.stringify(value)); return true; } },
    });
    const game = Object.assign(Object.create(MehGame.prototype), fixture());
    game._renderLocalSaveStatus = () => {};
    game._beginLocalSession(); assert.equal(game._checkpointLocal('turn'), true);
    const second = Object.assign(Object.create(MehGame.prototype), game);
    game.pendingDraws = 8; assert.equal(game._checkpointLocal('turn'), true);
    second.pendingDraws = 10; assert.equal(second._checkpointLocal('turn'), false);
    assert.equal(second._localSaveFailed, true);
    assert.equal(game._readLocalCheckpoint().pending, 8);
});

test('control-wait telemetry excludes pauses, own decisions and training, with no recording before consent', () => {
    let now = 1;
    const { MehGame, ProductTelemetry } = loadScripts(['i18n.js', 'deck.js', 'game.js'], ['MehGame', 'ProductTelemetry'], {
        Date: { now: () => now }, document: { addEventListener() {}, getElementById: () => ({ classList: { contains: () => true } }) },
    });
    const game = Object.assign(Object.create(MehGame.prototype), fixture());
    game._measureSoloWait(); now += 100; game._measureSoloWait(true);
    assert.equal(ProductTelemetry.queue.length, 0);
    ProductTelemetry.setConsent('granted');
    game._measureSoloWait(); now += 200; game._localPaused = true; game._measureSoloWait();
    now += 5000; game._measureSoloWait();
    game._localPaused = false; game._decisionContext = { actorId: game.players[0].id };
    game._measureSoloWait(); now += 4000; game._measureSoloWait();
    game._practice = { step: 0 }; game._trackProductEvent('match.started', { mode: 'local', humanSeats: 1, botSeats: 3, rematch: false });
    game._trackProductEvent('practice.step_started', { step: 1 });
    assert.deepEqual(Array.from(ProductTelemetry.queue, event => event.name), ['solo.control_wait', 'practice.step_started']);
    assert.equal(ProductTelemetry.queue[0].properties.durationMs, 200);
});
