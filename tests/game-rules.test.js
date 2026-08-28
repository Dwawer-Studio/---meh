'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { loadScripts } = require('./helpers/load-script');

const deterministicMath = Object.create(Math);
deterministicMath.random = () => 0.75;

const { Deck, MehGame } = loadScripts(['deck.js', 'game.js'], ['Deck', 'MehGame'], {
    Math: deterministicMath,
    I18n: {
        t(key) { return key; },
        colorName(color) { return color; },
        cardName(card) { return card.name; },
    },
    Net: { conns: [] },
    Sound: { play() {} },
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
});

const effectTypes = [...new Set(new Deck().cards.map(card => card.type))].sort();
const actorRoles = ['host', 'bot', 'remote'];

function makeCardSet() {
    return new Deck().cards.map((card, index) => ({
        color: card.color,
        name: card.name,
        type: card.type,
        emoji: card.emoji,
        svgFile: card.svgFile,
        id: `card-${String(index).padStart(2, '0')}`,
    }));
}

function makeScenario(effectType, role) {
    const cards = makeCardSet();
    const effectIndex = cards.findIndex(card => card.type === effectType);
    assert.notEqual(effectIndex, -1, `missing effect card ${effectType}`);
    const effectCard = cards.splice(effectIndex, 1)[0];

    const priorDiscards = cards.splice(0, 4);
    const actorHand = cards.splice(0, 5);
    const targetHands = [cards.splice(0, 5), cards.splice(0, 5), cards.splice(0, 5)];
    const actor = {
        id: 'actor', name: 'Actor', avatar: '😎', containerId: 'human-hand',
        isBot: role === 'bot', isRemote: role === 'remote', hand: actorHand,
    };
    const players = [actor, ...targetHands.map((hand, index) => ({
        id: `target-${index}`, name: `Target ${index}`, avatar: '🤖',
        containerId: `bot-${index + 1}-hand`, isBot: true, isRemote: false, hand,
    }))];

    const game = Object.create(MehGame.prototype);
    game.deck = { cards, shuffle() {} };
    game.discardPile = [...priorDiscards, effectCard];
    game.players = players;
    game.currentPlayerIndex = 0;
    game.direction = 1;
    game.pendingDraws = 0;
    game.activeColor = effectCard.color === 'black' ? 'orange' : effectCard.color;
    game.skipNextMap = {};
    game.drawImmune = {};
    game.superpowersDisabled = false;
    game.online = role === 'remote';
    game.isHost = role !== 'bot';
    game.settings = { batterySaver: true };

    game.showGameMessage = () => {};
    game.showToast = () => {};
    game.screenFx = () => {};
    game.updateUI = () => {};
    game.finishTurn = () => {};
    game.advanceTurn = () => {};
    game.playTurn = () => {};
    game.drawMultiple = (player, count, callback) => {
        for (let index = 0; index < count; index++) {
            const card = game.deck.cards.pop();
            if (card) player.hand.push(card);
        }
        if (callback) callback();
    };
    game.requestEffectDecision = (_player, kind, data, resolve) => {
        if (kind === 'color') resolve('purple');
        else if (kind === 'target') resolve(1);
        else if (kind === 'choice') resolve(0);
        else if (kind === 'card') resolve(data.owner.hand[0].id);
        else throw new Error(`unexpected decision kind: ${kind}`);
    };

    return { game, actor, effectCard };
}

function cardLocations(game) {
    return [
        ...game.deck.cards,
        ...game.discardPile,
        ...game.players.flatMap(player => player.hand),
    ];
}

function rulesSnapshot(game) {
    return {
        deck: game.deck.cards.map(card => card.id),
        discard: game.discardPile.map(card => card.id),
        hands: game.players.map(player => player.hand.map(card => card.id)),
        activeColor: game.activeColor,
        direction: game.direction,
        pendingDraws: game.pendingDraws,
        skipped: Object.keys(game.skipNextMap).sort(),
        immune: Object.keys(game.drawImmune).sort(),
        superpowersDisabled: game.superpowersDisabled,
        sugarOwner: game._sugarOwnerId,
    };
}

for (const effectType of effectTypes) {
    test(`RULE-01: ${effectType} preserves all 60 unique cards for every actor path`, () => {
        for (const role of actorRoles) {
            const { game, actor, effectCard } = makeScenario(effectType, role);
            game.processEffect(effectCard, actor);
            const cards = cardLocations(game);
            assert.equal(cards.length, 60, `${effectType}/${role} changed the card total`);
            assert.equal(new Set(cards.map(card => card.id)).size, 60,
                `${effectType}/${role} duplicated or lost a card`);
            if (['bestOne', 'boShlakh', 'umWajhain'].includes(effectType)) {
                assert.equal(game.topCard.id, effectCard.id,
                    `${effectType}/${role} replaced the played effect card with an unplayed discard`);
            }
        }
    });

    test(`RULE-02: ${effectType} has the same state transition for host, bot, and remote`, () => {
        const snapshots = actorRoles.map(role => {
            const { game, actor, effectCard } = makeScenario(effectType, role);
            game.processEffect(effectCard, actor);
            return rulesSnapshot(game);
        });
        assert.deepEqual(snapshots[1], snapshots[0], `${effectType}: bot differs from host`);
        assert.deepEqual(snapshots[2], snapshots[0], `${effectType}: remote differs from host`);
    });
}

test('RULE-01: the opening card is a normal card and the rejected candidates stay in the deck', () => {
    const game = Object.create(MehGame.prototype);
    const normal = { id: 'normal', type: 'normal' };
    const power = { id: 'power', type: 'skip' };
    const wild = { id: 'wild', type: 'wild' };
    game.deck = {
        cards: [normal, power, wild],
        draw() { return this.cards.length ? this.cards.pop() : null; },
    };

    const initial = game.drawInitialCard();

    assert.equal(initial.id, 'normal');
    assert.deepEqual(game.deck.cards.map(card => card.id).sort(), ['power', 'wild']);
});

test('RULE-01: opening selection recovers when every normal card was dealt', () => {
    const game = Object.create(MehGame.prototype);
    const normal = { id: 'normal', type: 'normal' };
    game.players = [{ hand: [normal] }, { hand: [] }, { hand: [] }, { hand: [] }];
    game.deck = {
        cards: [{ id: 'power', type: 'skip' }, { id: 'wild', type: 'wild' }],
        draw() { return this.cards.length ? this.cards.pop() : null; },
    };

    const initial = game.drawInitialCard();

    assert.equal(initial.id, 'normal');
    assert.equal(game.players[0].hand.length, 1);
    assert.equal(game.deck.cards.length, 1);
});

test('RULE-02: every actor uses the same explicit response set for a pending draw', () => {
    const game = Object.create(MehGame.prototype);
    const allowed = ['draw2', 'draw4Wild', 'meh', 'counterAttack', 'phantom'];
    for (const type of allowed) assert.equal(game.canRespondToPendingDraw({ type }), true, type);
    for (const type of ['normal', 'skip', 'wild', 'sorry']) {
        assert.equal(game.canRespondToPendingDraw({ type }), false, type);
    }
});

test('RULE-02: sugar disables powers for one complete table cycle', () => {
    const game = Object.create(MehGame.prototype);
    const owner = { id: 'actor' };
    const other = { id: 'target' };
    game.superpowersDisabled = true;
    game._sugarOwnerId = owner.id;

    game.updateSugarLockForTurn(other);
    assert.equal(game.superpowersDisabled, true);
    assert.equal(game._sugarOwnerId, owner.id);

    game.updateSugarLockForTurn(owner);
    assert.equal(game.superpowersDisabled, false);
    assert.equal(game._sugarOwnerId, null);
});
