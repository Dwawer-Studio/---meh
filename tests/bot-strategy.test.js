'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BotStrategy } = require('../shared/bot-strategy');
const { observeBotState, planBotAction } = require('../server/bot-policy');
const { MatchReducer } = require('../shared/match-reducer');
const { MEH_CORE_MANIFEST, MEH_CATALOG_MANIFEST } = require('../game/game-manifests');
const { loadScripts } = require('./helpers/load-script');
const card = (id, type, color = 'orange') => ({ id, type, color, definitionId: type, name: type });
const observe = (hand, patch = {}) => ({ hand, legalIds: hand.map(held => held.id), actorIndex: 0,
    players: [0, 1, 2, 3].map(index => ({ id: `s${index}`, count: index ? 5 : hand.length, shield: false })),
    style: 'tactician', pending: 0, direction: 1, powersDisabled: false,
    top: card('top', 'normal'), discard: [card('top', 'normal')],
    colors: ['orange', 'gray', 'purple'], activeColor: 'orange', ...patch });

test('policy finishes with a known extra-discard combination and sheds burdens instead of useful wilds', () => {
    const o = observe([card('shed', 'boShlakh'), card('cost', 'sorry')]);
    assert.equal(BotStrategy.choosePlay(o), 'shed');
    const hand = [card('cost', 'sorry'), card('wild', 'wild', 'black'), card('plain', 'normal')];
    assert.equal(BotStrategy.chooseDecision(observe(hand), 'card', { ids: hand.map(held => held.id) }), 'cost');
    assert.equal(BotStrategy.choosePlay(observe([card('cost', 'sorry'), card('plain', 'normal')])), 'plain');
});

test('policy reacts to the next leader, respects reverse direction, and never gifts a discard win', () => {
    const o = observe([card('plain', 'normal'), card('stop', 'skip'), card('cost', 'sorry')]);
    o.players[1].count = 1;
    assert.equal(BotStrategy.choosePlay(o), 'stop');
    assert.equal(BotStrategy.chooseDecision(o, 'target', { targetIds: ['s1', 's2', 's3'], sourceType: 'umWajhain' }), 's1');
    assert.equal(BotStrategy.chooseDecision(o, 'choice', { sourceType: 'umWajhain' }), 1);
    o.direction = -1;
    const reverse = card('reverse', 'reverse');
    o.hand = [reverse, card('plain', 'normal'), card('cost', 'sorry')]; o.legalIds = o.hand.map(held => held.id);
    // Reversing here would bring the one-card leader next, so normal is safer.
    assert.equal(BotStrategy.choosePlay(o), 'plain');
});

test('pending penalties, disabled powers and undefined character names cannot invent a winning follow-up', () => {
    const o = observe([card('cancel', 'phantom'), card('plus', 'draw2'), card('plain', 'normal')],
        { pending: 8, legalIds: ['cancel', 'plus'], style: 'guardian' });
    assert.equal(BotStrategy.choosePlay(o), 'cancel');
    assert.equal(BotStrategy.choosePlay({ ...o, legalIds: [] }), null);
    const noNames = observe([{ id: 'captain', type: 'nokhtha', color: 'orange' }, { id: 'normal', type: 'normal', color: 'gray' }]);
    assert.ok(BotStrategy.rankPlays(noNames).find(item => item.cardId === 'captain').score < 1000);
    const disabled = observe([card('shed', 'boShlakh'), card('cost', 'sorry')], { powersDisabled: true });
    assert.ok(BotStrategy.rankPlays(disabled).every(item => item.score < 1000));
});

test('server and local projections never read opponent card contents or deck order, and produce the same decisions', () => {
    const state = MatchReducer.createMatch({ seed: 71, matchId: 'fair-policy',
        coreManifest: MEH_CORE_MANIFEST, catalogManifest: MEH_CATALOG_MANIFEST,
        players: [0, 1, 2, 3].map(index => ({ id: `s${index}`, isBot: true })) });
    const expected = planBotAction(state, MatchReducer);
    const guarded = structuredClone(state);
    const lengthOnly = hand => new Proxy(hand, { get(target, key) {
        if (key === 'length') return target.length;
        throw new Error(`Read private card content: ${String(key)}`);
    } });
    guarded.players.forEach((player, index) => { if (index !== guarded.currentPlayerIndex) player.hand = lengthOnly(player.hand); });
    Object.defineProperty(guarded, 'deck', { get() { throw new Error('Read deck order'); } });
    assert.deepEqual(planBotAction(guarded, MatchReducer), expected);
    const { MehGame } = loadScripts(['i18n.js', 'deck.js', 'game.js'], ['MehGame']);
    const game = Object.create(MehGame.prototype);
    Object.assign(game, { players: guarded.players, currentPlayerIndex: guarded.currentPlayerIndex,
        discardPile: guarded.discard, activeColor: guarded.activeColor, direction: guarded.direction,
        pendingDraws: guarded.pendingDraws, superpowersDisabled: guarded.superpowersDisabled,
        drawImmune: {}, skipNextMap: {} });
    game.isCardPlayableNow = held => MatchReducer.isPlayable(guarded, held);
    const local = JSON.parse(JSON.stringify(game._botObservation()));
    const server = JSON.parse(JSON.stringify(observeBotState(guarded, MatchReducer)));
    assert.deepEqual(local, server);
    assert.equal(BotStrategy.choosePlay(local), expected.cardId || null);
    const before = JSON.stringify(server);
    for (const style of Object.keys(BotStrategy.styles)) BotStrategy.choosePlay({ ...server, style });
    assert.equal(JSON.stringify(server), before);
});

test('tie breaking is reproducible and styles have distinct tactical priorities', () => {
    const o = observe([card('normal', 'normal'), card('skip', 'skip'), card('draw2', 'draw2')]);
    const first = BotStrategy.rankPlays(o);
    assert.deepEqual(BotStrategy.rankPlays(o), first);
    assert.notDeepEqual(BotStrategy.rankPlays({ ...o, style: 'racer' }), BotStrategy.rankPlays({ ...o, style: 'guardian' }));
});
