'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScripts } = require('./helpers/load-script');

function createGameHarness() {
    const events = {
        netClosed: 0,
        screens: [],
        sounds: [],
        processedCards: [],
        playTurns: 0,
        uiUpdates: 0,
    };
    const classList = { add() {}, remove() {}, toggle() {} };
    const document = {
        addEventListener() {},
        removeEventListener() {},
        getElementById() { return null; },
        querySelectorAll() { return []; },
        documentElement: {},
        body: { classList },
    };
    const Net = { close() { events.netClosed++; } };
    const WakeLock = { enable() {}, disable() {} };
    const Sound = { play(name) { events.sounds.push(name); } };

    const { MehGame } = loadScripts(['deck.js', 'game.js'], ['MehGame'], {
        document,
        Net,
        WakeLock,
        Sound,
    });
    const game = Object.create(MehGame.prototype);
    game.settings = { wakeLock: false, batterySaver: true, confirmPlay: true };
    game.humanProfile = { id: 'profile-1', name: 'لاعب الاختبار', avatar: '🤖' };
    game.turnTimer = null;
    game.showScreen = (id) => events.screens.push(id);
    game.bindGameEvents = () => {};
    game.hideConfirmBar = () => {};
    game.updateUI = () => { events.uiUpdates++; };
    game.playTurn = () => { events.playTurns++; };
    game.animateCardFly = () => {};
    game.processEffect = (card) => events.processedCards.push(card);

    return { game, events };
}

function countCards(game) {
    return game.deck.cards.length
        + game.discardPile.length
        + game.players.reduce((total, player) => total + player.hand.length, 0);
}

test('local flow starts, deals, draws, plays, and restarts a game', () => {
    const { game, events } = createGameHarness();

    game.startGame();
    assert.deepEqual(events.screens, ['game-screen']);
    assert.equal(events.netClosed, 1);
    assert.equal(game.players.length, 4);
    assert.deepEqual(Array.from(game.players, (player) => player.hand.length), [7, 7, 7, 7]);
    assert.equal(game.players[0].name, 'لاعب الاختبار');
    assert.equal(game.players[0].avatar, '🤖');
    assert.equal(game.discardPile.length, 1);
    assert.notEqual(game.topCard.color, 'black');
    assert.equal(game.activeColor, game.topCard.color);
    assert.equal(countCards(game), 60);
    assert.equal(events.playTurns, 1);

    const human = game.players[0];
    const deckBeforeDraw = game.deck.cards.length;
    game.handleDrawCard(human);
    assert.equal(human.hand.length, 8);
    assert.equal(game.deck.cards.length, deckBeforeDraw - 1);
    assert.equal(countCards(game), 60);

    const playableIndex = human.hand.findIndex((card) => card.color !== 'black');
    const playedCard = human.hand[playableIndex];
    const discardBeforePlay = game.discardPile.length;
    game.playCard(human, playableIndex);
    assert.equal(human.hand.length, 7);
    assert.equal(game.discardPile.length, discardBeforePlay + 1);
    assert.equal(game.topCard.id, playedCard.id);
    assert.equal(game.activeColor, playedCard.color);
    assert.equal(events.processedCards.at(-1).id, playedCard.id);
    assert.equal(countCards(game), 60);

    const previousDeck = game.deck;
    game.startGame();
    assert.notEqual(game.deck, previousDeck);
    assert.equal(events.netClosed, 2);
    assert.equal(events.playTurns, 2);
    assert.deepEqual(Array.from(game.players, (player) => player.hand.length), [7, 7, 7, 7]);
    assert.equal(game.discardPile.length, 1);
    assert.equal(countCards(game), 60);
});
