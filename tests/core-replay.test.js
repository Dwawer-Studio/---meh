'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadScripts } = require('./helpers/load-script');

function makeClassList() {
    const values = new Set();
    return {
        add(...items) { items.forEach(item => values.add(item)); },
        remove(...items) { items.forEach(item => values.delete(item)); },
        toggle(item, force) {
            if (force === true) values.add(item);
            else if (force === false) values.delete(item);
            else if (values.has(item)) values.delete(item);
            else values.add(item);
            return values.has(item);
        },
        contains(item) { return values.has(item); },
    };
}

function makeElement() {
    return {
        classList: makeClassList(),
        children: [],
        style: {},
        dataset: {},
        disabled: false,
        appendChild(child) { this.children.push(child); return child; },
        replaceChildren(...children) { this.children = children; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        setAttribute() {},
        toggleAttribute() {},
        focus() {},
        remove() {},
        getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    };
}

const elements = new Map();
const document = {
    body: makeElement(),
    documentElement: makeElement(),
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement() { return makeElement(); },
    getElementById(id) {
        if (!elements.has(id)) elements.set(id, makeElement());
        return elements.get(id);
    },
};

function createScheduler() {
    let nextId = 1;
    const queue = [];
    const cancelled = new Set();
    const schedule = (callback, repeating) => {
        const id = nextId++;
        if (typeof callback === 'function') queue.push({ id, callback, repeating });
        return id;
    };
    return {
        setTimeout(callback) { return schedule(callback, false); },
        clearTimeout(id) { cancelled.add(id); },
        setInterval(callback) { return schedule(callback, true); },
        clearInterval(id) { cancelled.add(id); },
        drain(shouldStop, limit = 50000) {
            let count = 0;
            while (queue.length && !shouldStop()) {
                if (++count > limit) throw new Error(`Scheduler exceeded ${limit} tasks`);
                const task = queue.shift();
                if (cancelled.has(task.id)) continue;
                task.callback();
                if (task.repeating && !cancelled.has(task.id)) queue.push(task);
            }
            return count;
        },
    };
}

let activeRandom = Math.random;
let activeScheduler = createScheduler();
const deterministicMath = Object.create(Math);
deterministicMath.random = () => activeRandom();

const runtime = loadScripts(
    ['deck.js', 'game.js'],
    ['MehGame', 'CoreEvidence', 'playersConfig'],
    {
        Math: deterministicMath,
        document,
        setTimeout(callback) { return activeScheduler.setTimeout(callback); },
        clearTimeout(id) { activeScheduler.clearTimeout(id); },
        setInterval(callback) { return activeScheduler.setInterval(callback); },
        clearInterval(id) { activeScheduler.clearInterval(id); },
        I18n: {
            t(key) { return key; },
            colorName(color) { return color; },
            cardName(card) { return card.name; },
        },
        Net: { conns: [], close() {}, broadcast() {}, sendTo() {} },
        WakeLock: { enable() {}, disable() {} },
        Sound: { play() {} },
        Storage: { recordResult() {}, getCurrentProfile() { return null; } },
        spawnEmoji() {},
    },
);

runtime.playersConfig.forEach(player => { player.isBot = true; });

function initializeGame(game) {
    Object.assign(game, {
        settings: { batterySaver: true, wakeLock: false },
        humanProfile: { name: 'Evidence', avatar: '🤖' },
        online: false,
        isHost: false,
        awaitingRemote: false,
        turnTimer: null,
        _promptTimer: null,
        _bcTimer: null,
        _disconnectTurnTimer: null,
        _remoteResolve: null,
        _remotePromptSeq: 0,
        _remotePromptId: null,
        _remotePromptPeer: null,
        _remoteAllowedValues: null,
        _colorCallback: null,
    });
    game.showScreen = () => {};
    game.bindGameEvents = () => {};
    game.updateUI = () => {};
    game.hideConfirmBar = () => {};
    game.showGameMessage = () => {};
    game.showToast = () => {};
    game.screenFx = () => {};
    game.animateCardFly = () => {};
    game.showDrawPenalty = () => {};
    game.setDialogOpen = () => {};
    game.botMaybeEmoji = () => {};
}

function runBotMatch(seed) {
    activeRandom = runtime.CoreEvidence.createSeededRandom(seed);
    activeScheduler = createScheduler();
    const replay = runtime.CoreEvidence.createReplay(seed, 'four-bot-headless');
    const game = Object.create(runtime.MehGame.prototype);
    initializeGame(game);

    let winnerId = null;
    const originalPlayCard = game.playCard;
    game.playCard = function recordPlay(player, cardIndex) {
        const card = player.hand[cardIndex];
        runtime.CoreEvidence.recordAction(replay, 'action.play', {
            actorId: player.id,
            cardId: card.id,
            definitionId: card.definitionId,
        });
        return originalPlayCard.call(this, player, cardIndex);
    };
    const originalDraw = game.handleDrawCard;
    game.handleDrawCard = function recordDraw(player) {
        runtime.CoreEvidence.recordAction(replay, 'action.draw', { actorId: player.id });
        return originalDraw.call(this, player);
    };
    const originalDecision = game.requestEffectDecision;
    game.requestEffectDecision = function recordDecision(player, kind, data, resolve) {
        return originalDecision.call(this, player, kind, data, value => {
            runtime.CoreEvidence.recordAction(replay, 'effect.decision', {
                actorId: player.id,
                kind,
                value,
            });
            resolve(value);
        });
    };
    game.endGame = winner => {
        winnerId = winner.id;
        runtime.CoreEvidence.recordAction(replay, 'match.completed', { winnerId });
    };

    game.startGame();
    runtime.CoreEvidence.setInitialState(replay, runtime.CoreEvidence.snapshot(game));
    activeScheduler.drain(() => winnerId !== null);
    assert.notEqual(winnerId, null, `seed ${seed} did not finish`);

    const finalState = runtime.CoreEvidence.snapshot(game);
    const cards = [
        ...game.deck.cards,
        ...game.discardPile,
        ...game.players.flatMap(player => player.hand),
    ];
    assert.equal(cards.length, 60, `seed ${seed} changed card count`);
    assert.equal(new Set(cards.map(card => card.id)).size, 60, `seed ${seed} lost or duplicated a card`);
    return runtime.CoreEvidence.completeReplay(replay, finalState);
}

test('P0 1000 seeded full matches replay with identical actions and final state', { timeout: 120000 }, () => {
    for (let seed = 1; seed <= 1000; seed++) {
        const first = runBotMatch(seed);
        const second = runBotMatch(seed);
        assert.equal(runtime.CoreEvidence.validateReplay(first), true, `seed ${seed} replay invalid`);
        assert.deepEqual(second.actions, first.actions, `seed ${seed} action trace changed`);
        assert.equal(second.initialFingerprint, first.initialFingerprint, `seed ${seed} initial state changed`);
        assert.equal(second.finalFingerprint, first.finalFingerprint, `seed ${seed} final state changed`);
    }
});
