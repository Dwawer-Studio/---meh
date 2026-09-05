'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PublicJournal } = require('../server/public-journal');
const { MatchReducer } = require('../shared/match-reducer');
const { planBotAction } = require('../server/bot-policy');
const { MEH_CORE_MANIFEST, MEH_CATALOG_MANIFEST } = require('../game/game-manifests');
const { loadScripts } = require('./helpers/load-script');

test('service journal records real committed events, is bounded and never exposes private card ids or action decisions', () => {
    let state = MatchReducer.createMatch({ seed: 17, matchId: 'journal-test',
        coreManifest: MEH_CORE_MANIFEST, catalogManifest: MEH_CATALOG_MANIFEST,
        players: [0, 1, 2, 3].map(index => ({ id: `seat-${index}`, isBot: true })) });
    const journal = new PublicJournal();
    const ids = [...state.deck, ...state.discard, ...state.players.flatMap(player => player.hand)].map(card => card.id);
    let steps = 0;
    while (state.phase === 'ACTIVE' && steps++ < 300) {
        const action = planBotAction(state, MatchReducer);
        const reduced = MatchReducer.reduce(state, action);
        assert.equal(reduced.ok, true);
        const oldView = journal.recent(state.matchId);
        const oldFingerprint = JSON.stringify(oldView);
        journal.record(state, reduced, { ...action, decision: { ...action.decision, privateSentinel: 'DO-NOT-LEAK' } });
        assert.equal(JSON.stringify(oldView), oldFingerprint, 'later events cannot mutate an already fingerprinted snapshot');
        journal.record(state, reduced, action);
        assert.ok(journal.recent(state.matchId).length <= 20);
        state = reduced.state;
    }
    const entries = journal.recent(state.matchId);
    assert.ok(entries.length > 3);
    const serialized = JSON.stringify(entries);
    assert.doesNotMatch(serialized, /DO-NOT-LEAK|cardId|hand|deck/);
    for (const id of ids) assert.equal(serialized.includes(`"${id}"`), false);
    assert.equal(new Set(entries.map(entry => entry.version)).size, entries.length);
});

test('real service events render in the actual AR/EN journal once, with named targets and counts', () => {
    const { MehGame, I18n } = loadScripts(['i18n.js', 'deck.js', 'game.js'], ['MehGame', 'I18n']);
    const game = Object.create(MehGame.prototype);
    game._productFeatureEnabled = () => true;
    game._renderActionJournal = () => {};
    const definition = MEH_CATALOG_MANIFEST.definitions.find(card => card.type === 'counterAttack');
    const seats = ['You', 'Ahmed', 'Noura', 'Khaled'].map((name, index) => ({ seatId: `s${index}`, displayName: name }));
    const match = { matchId: 'real-public', journal: [{ version: 2, actorId: 's0',
        card: { definitionId: definition.definitionId, color: 'orange' },
        before: { direction: 1, pendingDraws: 4, superpowersDisabled: false },
        events: [{ type: 'card.committed', seatId: 's0' }, { type: 'effect.applied', seatId: 's0' },
            { type: 'cards.drawn', seatId: 's3', count: 6 }] }] };
    for (const locale of ['ar', 'en']) {
        I18n.lang = locale;
        game._actionJournal = [];
        game._serviceJournalCursor = null;
        game._consumeServiceJournal(match, seats);
        game._consumeServiceJournal(match, seats);
        assert.equal(game._actionJournal.length, 3);
        const text = game._actionJournal.map(entry => entry.text).join(' ');
        assert.match(text, /Khaled/);
        assert.match(text, /6/);
        assert.doesNotMatch(text, /undefined|journal_|insight_|\{\w+\}/);
    }
});
