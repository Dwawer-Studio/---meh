'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { loadScripts } = require('./helpers/load-script');

function makeElement(tagName = 'div') {
    const element = {
        tagName: tagName.toUpperCase(),
        children: [],
        className: '',
        classList: { add() {}, remove() {}, toggle() {} },
        style: {},
        textContent: '',
        appendChild(child) { this.children.push(child); return child; },
        replaceChildren(...children) { this.children = children; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
    };
    Object.defineProperty(element, 'innerHTML', {
        get() { return ''; },
        set() { throw new Error('innerHTML must not receive untrusted data'); },
    });
    return element;
}

function loadGame(overrides = {}) {
    return loadScripts(['deck.js', 'game.js'], ['Card', 'Deck', 'MehGame'], {
        COLOR_SYMBOLS: {},
        I18n: {
            lang: 'ar',
            t(key) { return key; },
            cardName(card) { return card.name; },
            colorName(color) { return color; },
        },
        Net: {},
        Storage: {},
        Sound: {},
        WakeLock: {},
        ...overrides,
    });
}

function loadNet(overrides = {}) {
    return loadScripts('net.js', ['Net'], {
        window: {},
        ...overrides,
    });
}

test('SEC-01: lobby player data is rendered with text nodes, never innerHTML', () => {
    const lobby = makeElement();
    const document = {
        addEventListener() {},
        createElement: makeElement,
        getElementById(id) { return id === 'lobby-players' ? lobby : null; },
        querySelectorAll() { return []; },
        body: makeElement('body'),
    };
    const { MehGame } = loadGame({ document });
    const game = Object.create(MehGame.prototype);
    game.lobbyPlayers = [{
        id: 'peer-1',
        name: '<img src=x onerror=alert(1)>',
        avatar: '<svg onload=alert(1)>',
        host: false,
    }];

    game.renderLobby();

    assert.equal(lobby.children.length, 1);
    assert.equal(lobby.children[0].children[0].textContent, '<svg onload=alert(1)>');
    assert.equal(lobby.children[0].children[1].textContent, '<img src=x onerror=alert(1)>');
});

test('SEC-01: card fallback never interpolates remote card fields into innerHTML', () => {
    const document = {
        addEventListener() {},
        createElement: makeElement,
        getElementById() { return null; },
        querySelectorAll() { return []; },
        body: makeElement('body'),
    };
    const { MehGame } = loadGame({ document });
    const game = Object.create(MehGame.prototype);
    game.players = [{ isBot: false }];
    game.currentPlayerIndex = 0;
    game.settings = { colorblind: false };

    const card = {
        color: 'orange',
        name: '<img src=x onerror=alert(1)>',
        emoji: '<svg onload=alert(1)>',
        svgFile: 'missing.webp',
    };
    const cardElement = game.createCardElement(card);
    const image = cardElement.children[0];

    assert.doesNotThrow(() => image.onerror());
    assert.equal(cardElement.children[0].children[0].textContent, card.emoji);
    assert.equal(cardElement.children[1].textContent, card.name);
});

test('NET-01: an invalid remote play does not cancel the active turn timer', () => {
    const { MehGame } = loadGame();
    const game = Object.create(MehGame.prototype);
    const seat = { connPeer: 'peer-1', hand: [] };
    game.online = true;
    game.isHost = true;
    game.players = [seat];
    game.currentPlayerIndex = 0;
    game.awaitingRemote = true;
    game.actionInProgress = false;
    game.turnTimer = { active: true };
    game.clearTurnTimer = () => { game.turnTimer = null; };

    game.applyRemoteAction({ peer: 'peer-1' }, { t: 'play', cardId: 'missing' });

    assert.deepEqual(game.turnTimer, { active: true });
    assert.equal(game.awaitingRemote, true);
});

test('NET-01: a valid remote play cancels the timer only after validation', () => {
    const { MehGame } = loadGame();
    const game = Object.create(MehGame.prototype);
    const card = { id: 'card123', isPlayable() { return true; } };
    const seat = { connPeer: 'peer-1', hand: [card] };
    let playedIndex = null;
    game.online = true;
    game.isHost = true;
    game.players = [seat];
    game.currentPlayerIndex = 0;
    game.awaitingRemote = true;
    game.actionInProgress = false;
    game.pendingDraws = 0;
    game.activeColor = 'orange';
    game.discardPile = [card];
    game.turnTimer = { active: true };
    game.clearTurnTimer = () => { game.turnTimer = null; };
    game.playCard = (_seat, index) => { playedIndex = index; };

    game.applyRemoteAction({ peer: 'peer-1' }, { t: 'play', cardId: 'card123' });

    assert.equal(game.turnTimer, null);
    assert.equal(game.awaitingRemote, false);
    assert.equal(game.actionInProgress, true);
    assert.equal(playedIndex, 0);
});

test('NET-02: stale prompt responses cannot resolve the current prompt', () => {
    const { MehGame } = loadGame();
    const game = Object.create(MehGame.prototype);
    let resolved = null;
    game.players = [{ connPeer: 'peer-1' }];
    game.currentPlayerIndex = 0;
    game._remoteResolve = (value) => { resolved = value; };
    game._remoteKind = 'choice';
    game._remotePromptId = 8;
    game._remotePromptPeer = 'peer-1';
    game._promptTimer = { active: true };

    game.resolveRemotePrompt({ promptId: 7, value: 1 }, { peer: 'peer-1' });
    assert.equal(resolved, null);
    assert.deepEqual(game._promptTimer, { active: true });

    game.resolveRemotePrompt({ promptId: 8, value: 1 }, { peer: 'peer-1' });
    assert.equal(resolved, 1);
    assert.equal(game._promptTimer, null);
});

test('NET-02: invalid values cannot consume the current prompt', () => {
    const { MehGame } = loadGame();
    const game = Object.create(MehGame.prototype);
    let resolved = false;
    game.players = [{ connPeer: 'peer-1' }];
    game.currentPlayerIndex = 0;
    game._remoteResolve = () => { resolved = true; };
    game._remoteKind = 'color';
    game._remotePromptId = 3;
    game._remotePromptPeer = 'peer-1';
    game._promptTimer = { active: true };

    game.resolveRemotePrompt({ promptId: 3, value: 'red' }, { peer: 'peer-1' });

    assert.equal(resolved, false);
    assert.deepEqual(game._promptTimer, { active: true });
    assert.equal(game._remotePromptId, 3);
});

test('RULE-02: a remote card decision accepts only an offered card id', () => {
    const { MehGame } = loadGame();
    const game = Object.create(MehGame.prototype);
    let resolved = null;
    game.players = [{ connPeer: 'peer-1' }];
    game.currentPlayerIndex = 0;
    game._remoteResolve = value => { resolved = value; };
    game._remoteKind = 'card';
    game._remotePromptId = 9;
    game._remotePromptPeer = 'peer-1';
    game._remoteAllowedValues = ['card123', 'card456'];
    game._promptTimer = { active: true };

    assert.equal(game.resolveRemotePrompt(
        { promptId: 9, value: 'not-offered' },
        { peer: 'peer-1' },
    ), false);
    assert.equal(resolved, null);
    assert.equal(game._remotePromptId, 9);

    assert.equal(game.resolveRemotePrompt(
        { promptId: 9, value: 'card456' },
        { peer: 'peer-1' },
    ), true);
    assert.equal(resolved, 'card456');
    assert.equal(game._remotePromptId, null);
});

test('RULE-02: remote card prompts reject malformed or duplicate options', () => {
    const { MehGame } = loadGame();
    const game = Object.create(MehGame.prototype);
    const valid = {
        t: 'prompt',
        kind: 'card',
        promptId: 4,
        title: 'اختر بطاقة',
        options: [
            { id: 'card123', name: 'بطاقة أولى' },
            { id: 'card456', name: 'بطاقة ثانية' },
        ],
    };

    assert.deepEqual(
        JSON.parse(JSON.stringify(game._normalizeRemotePrompt(valid))),
        { kind: 'card', promptId: 4, title: valid.title, options: valid.options },
    );
    assert.equal(game._normalizeRemotePrompt({
        ...valid,
        options: [{ id: 'card123', name: 'بطاقة' }, { id: 'card123', name: 'مكررة' }],
    }), null);
    assert.equal(game._normalizeRemotePrompt({
        ...valid,
        options: [{ id: '../escape', name: 'بطاقة' }],
    }), null);
});

test('RULE-02: a remote player can choose the exact card used by an effect', () => {
    const picker = makeElement();
    const pickerList = makeElement();
    const sent = [];
    const document = {
        addEventListener() {},
        createElement: makeElement,
        getElementById(id) {
            if (id === 'player-picker') return picker;
            if (id === 'player-picker-list') return pickerList;
            return null;
        },
        querySelectorAll() { return []; },
        body: makeElement('body'),
    };
    const { MehGame } = loadGame({
        document,
        Net: { send(message) { sent.push(message); } },
    });
    const game = Object.create(MehGame.prototype);

    assert.equal(game.showRemotePrompt({
        t: 'prompt',
        kind: 'card',
        promptId: 12,
        title: 'اختر بطاقة',
        options: [
            { id: 'card123', name: 'بطاقة أولى' },
            { id: 'card456', name: 'بطاقة ثانية' },
        ],
    }), true);
    assert.equal(pickerList.children.length, 2);

    pickerList.children[1].onclick();

    assert.deepEqual(
        JSON.parse(JSON.stringify(sent)),
        [{ t: 'choice', promptId: 12, value: 'card456' }],
    );
});

test('NET-03: full rooms and late joins are rejected without changing the lobby', () => {
    const sent = [];
    const disconnected = [];
    const Net = {
        sendTo(conn, message) { sent.push({ conn, message }); },
        disconnect(conn) { disconnected.push(conn); },
    };
    const { MehGame } = loadGame({ Net });
    const game = Object.create(MehGame.prototype);
    game.lobbyPlayers = [
        { id: 'host' },
        { id: 'peer-1' },
        { id: 'peer-2' },
        { id: 'peer-3' },
    ];
    game.online = false;

    game.handleHostMessage({ t: 'hello', name: 'fifth', avatar: '😎' }, { peer: 'peer-4' });
    assert.equal(game.lobbyPlayers.length, 4);
    assert.equal(sent.at(-1).message.reason, 'full');
    assert.equal(disconnected.at(-1).peer, 'peer-4');

    game.online = true;
    game.handleHostMessage({ t: 'hello', name: 'late', avatar: '😎' }, { peer: 'peer-5' });
    assert.equal(game.lobbyPlayers.length, 4);
    assert.equal(sent.at(-1).message.reason, 'started');
    assert.equal(disconnected.at(-1).peer, 'peer-5');
});

test('NET-03: the same rejected connection is notified and closed only once', () => {
    let sends = 0;
    let disconnects = 0;
    const Net = {
        sendTo() { sends++; },
        disconnect() { disconnects++; },
    };
    const { MehGame } = loadGame({ Net });
    const game = Object.create(MehGame.prototype);
    const conn = { peer: 'peer-4' };

    game._rejectConnection(conn, 'full');
    game._rejectConnection(conn, 'full');

    assert.equal(sends, 1);
    assert.equal(disconnects, 1);
});

test('SEC-01: remote card state is rebuilt from the trusted local catalogue', () => {
    const { Deck, MehGame } = loadGame();
    const game = Object.create(MehGame.prototype);
    const cards = new Deck().cards;
    const handCard = cards[0];
    const topCard = cards[1];
    const state = {
        me: { name: 'Player', avatar: '😎' },
        hand: [{ color: handCard.color, name: handCard.name, id: 'hand123', svgFile: 'https://evil.invalid/x.webp' }],
        others: [{ name: 'Bot', avatar: '🤖', count: 7, isBot: true }],
        top: { color: topCard.color, name: topCard.name, id: 'top123', emoji: '<svg onload=alert(1)>' },
        second: null,
        activeColor: topCard.color === 'black' ? 'orange' : topCard.color,
        direction: 1,
        current: 0,
        pending: 0,
        skipped: [],
        canPlay: true,
    };

    const normalized = game._normalizeGameState(state);

    assert.ok(normalized);
    assert.match(normalized.hand[0].svgFile, /^assets\/cards\//);
    assert.notEqual(normalized.hand[0].svgFile, state.hand[0].svgFile);
    assert.notEqual(normalized.top.emoji, state.top.emoji);

    state.hand[0].name = '<img src=x onerror=alert(1)>';
    assert.equal(game._normalizeGameState(state), null);
});

test('NET-03: malformed room codes are rejected before creating a Peer connection', () => {
    let peerCreated = false;
    let errorType = null;
    const { Net } = loadNet({
        Peer: function Peer() { peerCreated = true; },
    });
    Net.onError = (error) => { errorType = error.type; };

    Net.join('BAD!', () => {});

    assert.equal(peerCreated, false);
    assert.equal(errorType, 'invalid-code');
});

test('NET-03: disconnect removes a rejected peer from broadcasts before closing it', async () => {
    let closed = false;
    const conn = { close() { closed = true; } };
    const { Net } = loadNet();
    Net.conns = [conn];

    Net.disconnect(conn);

    assert.deepEqual(Net.conns, []);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(closed, true);
});
