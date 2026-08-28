'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MEH_CORE_MANIFEST, MEH_CATALOG_MANIFEST } = require('../game/game-manifests');
const { MatchReducer } = require('../shared/match-reducer');
const { planBotAction } = require('../server/bot-policy');

function create(seed, bots = true) {
    return MatchReducer.createMatch({
        seed,
        matchId: `test-${seed}`,
        coreManifest: MEH_CORE_MANIFEST,
        catalogManifest: MEH_CATALOG_MANIFEST,
        players: [0, 1, 2, 3].map(index => ({ id: `player-${index}`, isBot: bots })),
    });
}

function complete(seed) {
    let state = create(seed);
    const actions = [];
    for (let step = 0; step < 5_000 && state.phase === 'ACTIVE'; step++) {
        const action = planBotAction(state, MatchReducer);
        assert.ok(action, `seed ${seed} has no planned action`);
        const result = MatchReducer.reduce(state, action);
        assert.equal(result.ok, true, `seed ${seed}: ${result.code}`);
        state = result.state;
        MatchReducer.assertCardConservation(state);
        actions.push(action);
    }
    assert.equal(state.phase, 'COMPLETE', `seed ${seed} did not complete`);
    return { state, actions };
}

test('shared reducer creates the locked 60-card recipe deterministically', () => {
    const first = create(17);
    const second = create(17);
    assert.equal(MatchReducer.fingerprint(first), MatchReducer.fingerprint(second));
    assert.equal(first.players.length, 4);
    assert.ok(first.players.every(player => player.hand.length === 7));
    assert.equal(first.discard.length, 1);
    assert.equal(first.discard[0].type, 'normal');
    MatchReducer.assertCardConservation(first);
});

test('shared reducer recovers when every normal opening card was dealt', () => {
    const first = create(80_736);
    const second = create(80_736);
    assert.equal(first.discard[0].type, 'normal');
    assert.ok(first.players.every(player => player.hand.length === 7));
    assert.equal(MatchReducer.fingerprint(first), MatchReducer.fingerprint(second));
    MatchReducer.assertCardConservation(first);
});

test('rejected actions do not mutate or advance authoritative state', () => {
    const state = create(9, false);
    const before = JSON.stringify(state);
    const wrongActor = MatchReducer.reduce(state, {
        type: 'draw', actorId: 'player-2', turnId: state.turnId,
    });
    assert.equal(wrongActor.ok, false);
    assert.equal(wrongActor.code, 'OUT_OF_TURN');
    assert.equal(JSON.stringify(state), before);
    assert.strictEqual(wrongActor.state, state);

    const stale = MatchReducer.reduce(state, {
        type: 'draw', actorId: 'player-0', turnId: state.turnId + 1,
    });
    assert.equal(stale.code, 'STALE_TURN');
    assert.equal(JSON.stringify(state), before);

    const notOwned = MatchReducer.reduce(state, {
        type: 'play', actorId: 'player-0', turnId: state.turnId, cardId: state.players[1].hand[0].id,
    });
    assert.equal(notOwned.code, 'CARD_NOT_OWNED');
    assert.equal(JSON.stringify(state), before);

    const illegalCard = state.players[0].hand.find(card => !MatchReducer.isPlayable(state, card));
    assert.ok(illegalCard, 'seed must expose an illegal card for this authority test');
    const illegal = MatchReducer.reduce(state, {
        type: 'play', actorId: 'player-0', turnId: state.turnId, cardId: illegalCard.id,
    });
    assert.equal(illegal.code, 'ILLEGAL_CARD');
    assert.equal(JSON.stringify(state), before);
});

test('public views contain one hand and never reveal deck order or opponent hands', () => {
    const state = create(22, false);
    const view = MatchReducer.publicView(state, 'player-1');
    assert.equal(view.me.hand.length, 7);
    assert.equal(view.others.length, 3);
    assert.ok(view.others.every(player => Number.isInteger(player.handCount) && !Object.hasOwn(player, 'hand')));
    assert.equal(Object.hasOwn(view, 'deck'), false);
    assert.equal(Object.hasOwn(view, 'rngState'), false);
    assert.equal(JSON.stringify(view).includes(state.players[0].hand[0].id), false);
});

test('100 seeded matches complete deterministically with card conservation', { timeout: 120_000 }, () => {
    for (let seed = 1; seed <= 100; seed++) {
        const first = complete(seed);
        const second = complete(seed);
        assert.equal(MatchReducer.fingerprint(first.state), MatchReducer.fingerprint(second.state), `seed ${seed}`);
        assert.deepEqual(first.actions, second.actions, `seed ${seed} trace`);
    }
});
