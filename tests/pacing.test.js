'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers/load-script');

function clock() {
    let now = 0, next = 1;
    const tasks = new Map();
    return {
        Date: { now: () => now },
        setTimeout(callback, delay) { const id = next++; tasks.set(id, { callback, due: now + delay }); return id; },
        clearTimeout(id) { tasks.delete(id); },
        advance(ms) {
            const until = now + ms;
            for (let step = 0; step < 10000; step++) {
                const candidate = [...tasks].sort((a, b) => a[1].due - b[1].due)[0];
                if (!candidate || candidate[1].due > until) break;
                now = candidate[1].due;
                tasks.delete(candidate[0]); candidate[1].callback();
            }
            now = until;
        },
    };
}

function gameWithClock(timer) {
    const drawPile = { classList: { add() {}, remove() {} } };
    const { MehGame, Deck } = loadScripts(['i18n.js', 'deck.js', 'game.js'], ['MehGame', 'Deck'], {
        Date: timer.Date, setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout,
        Sound: { play() {} },
        document: { getElementById: () => drawPile, addEventListener() {} },
    });
    const game = Object.create(MehGame.prototype);
    Object.assign(game, { online: false, settings: { batterySaver: false }, drawImmune: {}, deck: new Deck() });
    for (const name of ['showDrawPenalty', 'animateCardFly', 'updateUI', '_recordActionJournal']) game[name] = () => {};
    return game;
}

test('pausing preserves remaining local time, resumes once, and cancellation prevents stale turn callbacks', () => {
    const timer = clock(), game = gameWithClock(timer);
    let calls = 0;
    game._scheduleTurn(() => calls++, 1000);
    timer.advance(400);
    assert.equal(game._pauseLocalClock(), true);
    timer.advance(10000);
    assert.equal(calls, 0);
    game._resumeLocalClock(); timer.advance(599); assert.equal(calls, 0);
    timer.advance(1); assert.equal(calls, 1);
    game._scheduleTurn(() => calls++, 10); game._cancelTurnWork(); timer.advance(50);
    assert.equal(calls, 1);
    game.online = true;
    assert.equal(game._pauseLocalClock(), false);
    assert.equal(game._pace('bot', 1200), 1200);
});

test('thirteen-card penalty preserves exact draw order and count while compressing routine waiting', () => {
    const localClock = clock(), legacyClock = clock();
    const local = gameWithClock(localClock), legacy = gameWithClock(legacyClock);
    legacy.online = true;
    legacy.deck.cards = local.deck.cards.slice();
    const players = [{ id: 'self', hand: [] }, { id: 'self', hand: [] }];
    let localElapsed = null, legacyElapsed = null;
    local.drawMultiple(players[0], 13, () => { localElapsed = localClock.Date.now(); });
    legacy.drawMultiple(players[1], 13, () => { legacyElapsed = legacyClock.Date.now(); });
    localClock.advance(10000); legacyClock.advance(10000);
    assert.deepEqual(players[0].hand.map(card => card.id), players[1].hand.map(card => card.id));
    assert.equal(players[0].hand.length + local.deck.cards.length, 60);
    assert.equal(localElapsed, 840);
    assert.equal(legacyElapsed, 4660);
});
