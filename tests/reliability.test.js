'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript, loadScripts } = require('./helpers/load-script');

function loadGame(Net = {}) {
    return loadScripts(['deck.js', 'game.js'], ['MehGame'], {
        Net,
        Storage: {},
        Sound: {},
        WakeLock: {},
        COLOR_SYMBOLS: {},
        I18n: {
            lang: 'ar',
            t(key, values = {}) { return values.name ? `${key}:${values.name}` : key; },
            cardName(card) { return card.name; },
            colorName(color) { return color; },
        },
    });
}

function visibilityDocument() {
    const listeners = new Map();
    return {
        visibilityState: 'visible',
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) {
            listeners.get(type)?.delete(listener);
        },
        dispatch(type) {
            for (const listener of listeners.get(type) || []) listener();
        },
        listenerCount(type) { return listeners.get(type)?.size || 0; },
        getElementById() { return null; },
        body: { appendChild() {} },
    };
}

function wakeSentinel() {
    const listeners = new Set();
    return {
        released: false,
        releaseCalls: 0,
        addEventListener(type, listener) {
            if (type === 'release') listeners.add(listener);
        },
        async release() {
            if (this.released) return;
            this.released = true;
            this.releaseCalls++;
            for (const listener of listeners) listener();
        },
    };
}

function loadWakeLock(request) {
    const document = visibilityDocument();
    const navigator = { wakeLock: { request } };
    const Storage = { getSettings() { return { wakeLock: true }; } };
    const { WakeLock } = loadScript('features.js', ['WakeLock'], {
        document,
        navigator,
        Storage,
    });
    return { WakeLock, document };
}

test('PLATFORM-02: concurrent enables share one request and disable releases it once', async () => {
    const sentinel = wakeSentinel();
    let requests = 0;
    const { WakeLock, document } = loadWakeLock(async () => {
        requests++;
        return sentinel;
    });

    const first = WakeLock.enable();
    const second = WakeLock.enable();
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(requests, 1);
    assert.equal(document.listenerCount('visibilitychange'), 1);

    await WakeLock.disable();
    assert.equal(sentinel.releaseCalls, 1);
    assert.equal(WakeLock._lock, null);
    assert.equal(document.listenerCount('visibilitychange'), 0);
});

test('PLATFORM-02: a browser-released lock is reacquired only while enabled and visible', async () => {
    const sentinels = [wakeSentinel(), wakeSentinel()];
    let requests = 0;
    const { WakeLock } = loadWakeLock(async () => sentinels[requests++]);

    await WakeLock.enable();
    await sentinels[0].release();
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(requests, 2);
    assert.equal(WakeLock._lock, sentinels[1]);
    await WakeLock.disable();
    assert.equal(sentinels[1].releaseCalls, 1);
});

test('PLATFORM-02: disable wins a race with a pending wake-lock request', async () => {
    const sentinel = wakeSentinel();
    let resolveRequest;
    const pendingRequest = new Promise(resolve => { resolveRequest = resolve; });
    const { WakeLock } = loadWakeLock(() => pendingRequest);

    const enabling = WakeLock.enable();
    const disabling = WakeLock.disable();
    resolveRequest(sentinel);
    await Promise.all([enabling, disabling]);

    assert.equal(sentinel.releaseCalls, 1);
    assert.equal(WakeLock._lock, null);
});

class Emitter {
    constructor() { this.handlers = new Map(); }
    on(type, listener) {
        if (!this.handlers.has(type)) this.handlers.set(type, []);
        this.handlers.get(type).push(listener);
    }
    emit(type, ...args) {
        for (const listener of this.handlers.get(type) || []) listener(...args);
    }
}

class FakeConnection extends Emitter {
    constructor(peer) {
        super();
        this.peer = peer;
        this.open = false;
        this.closeCalls = 0;
    }
    send() {}
    close() { this.closeCalls++; this.open = false; }
}

function peerFactory() {
    const peers = [];
    class FakePeer extends Emitter {
        constructor(...args) {
            super();
            this.args = args;
            this.id = typeof args[0] === 'string' ? args[0] : undefined;
            this.open = false;
            this.disconnected = false;
            this.destroyed = false;
            this.destroyCalls = 0;
            this.reconnectCalls = 0;
            this.connections = [];
            peers.push(this);
        }
        connect(id) {
            const connection = new FakeConnection(id);
            this.connections.push(connection);
            return connection;
        }
        reconnect() { this.reconnectCalls++; this.disconnected = false; }
        destroy() { this.destroyCalls++; this.destroyed = true; }
    }
    return { FakePeer, peers };
}

test('NET-05: PeerJS keeps its production defaults unless runtime options are explicit', () => {
    const { FakePeer, peers } = peerFactory();
    const { Net } = loadScript('net.js', ['Net'], { Peer: FakePeer });

    Net.host(() => {});
    assert.deepEqual(peers[0].args, ['meh-game-' + Net.roomCode]);
    Net.join('ABCDE', () => {});
    assert.deepEqual(peers[1].args, []);
});

test('NET-05: explicit PeerJS runtime options reach both host and client', () => {
    const { FakePeer, peers } = peerFactory();
    const peerOptions = {
        host: '127.0.0.1',
        port: 9001,
        path: '/meh',
        secure: false,
    };
    const { Net } = loadScript('net.js', ['Net'], {
        Peer: FakePeer,
        window: { MEH_PEER_OPTIONS: peerOptions },
    });

    Net.host(() => {});
    const hostPeerId = 'meh-game-' + Net.roomCode;
    Net.join('ABCDE', () => {});

    assert.equal(peers[0].args[0], hostPeerId);
    assert.equal(peers[0].args[1].host, peerOptions.host);
    assert.equal(peers[0].args[1].port, peerOptions.port);
    assert.equal(peers[0].args[1].path, peerOptions.path);
    assert.equal(peers[0].args[1].secure, peerOptions.secure);
    assert.equal(peers[1].args[0].host, peerOptions.host);
    assert.equal(peers[1].args[0].port, peerOptions.port);
    assert.equal(peers[1].args[0].path, peerOptions.path);
    assert.equal(peers[1].args[0].secure, peerOptions.secure);
    assert.notEqual(peers[0].args[1], peerOptions);
});

test('NET-04: callbacks from a closed network session cannot mutate the next session', () => {
    const { FakePeer, peers } = peerFactory();
    const { Net } = loadScript('net.js', ['Net'], { Peer: FakePeer });
    let opened = 0;
    let errors = 0;
    Net.onError = () => { errors++; };

    Net.host(() => { opened++; });
    const oldPeer = peers[0];
    Net.close();
    oldPeer.emit('open');
    oldPeer.emit('error', { type: 'late' });

    assert.equal(oldPeer.destroyCalls, 1);
    assert.equal(opened, 0);
    assert.equal(errors, 0);
    assert.equal(Net.peer, null);
});

test('NET-04: signalling disconnect attempts PeerJS reconnection for the active session', () => {
    const { FakePeer, peers } = peerFactory();
    const { Net } = loadScript('net.js', ['Net'], {
        Peer: FakePeer,
        setTimeout(callback) { callback(); return 1; },
        clearTimeout() {},
    });

    Net.host(() => {});
    const peer = peers[0];
    peer.disconnected = true;
    peer.emit('disconnected');

    assert.equal(peer.reconnectCalls, 1);
});

test('NET-04: a dropped client data channel reconnects and reports recovery', () => {
    const { FakePeer, peers } = peerFactory();
    const { Net } = loadScript('net.js', ['Net'], {
        Peer: FakePeer,
        setTimeout(callback) { callback(); return 1; },
        clearTimeout() {},
    });
    let initialConnections = 0;
    let reconnecting = 0;
    let recovered = 0;
    Net.onReconnecting = () => { reconnecting++; };
    Net.onReconnect = () => { recovered++; };

    Net.join('ABCDE', () => { initialConnections++; });
    const peer = peers[0];
    peer.open = true;
    peer.emit('open');
    const first = peer.connections[0];
    first.open = true;
    first.emit('open');
    first.emit('close');

    assert.equal(initialConnections, 1);
    assert.equal(reconnecting, 1);
    assert.equal(peer.connections.length, 2);
    const second = peer.connections[1];
    second.open = true;
    second.emit('open');
    assert.equal(recovered, 1);
    assert.equal(Net.hostConn, second);
});

test('NET-04: repeated data-channel failures stop at the retry limit', () => {
    const { FakePeer, peers } = peerFactory();
    const { Net } = loadScript('net.js', ['Net'], {
        Peer: FakePeer,
        setTimeout(callback) { callback(); return 1; },
        clearTimeout() {},
    });
    const errors = [];
    Net.onError = error => { errors.push(error); };

    Net.join('ABCDE', () => {});
    const peer = peers[0];
    peer.open = true;
    peer.emit('open');
    peer.connections[0].open = true;
    peer.connections[0].emit('open');

    for (let index = 0; index <= Net._maxReconnectAttempts; index++) {
        peer.connections.at(-1).emit('close');
    }

    assert.equal(peer.connections.length, 1 + Net._maxReconnectAttempts);
    assert.equal(errors.at(-1).type, 'reconnect-failed');
});

test('NET-04: peer-unavailable closes a stuck attempt and continues reconnecting', () => {
    const { FakePeer, peers } = peerFactory();
    const { Net } = loadScript('net.js', ['Net'], {
        Peer: FakePeer,
        setTimeout(callback) { callback(); return 1; },
        clearTimeout() {},
    });

    Net.join('ABCDE', () => {});
    const peer = peers[0];
    peer.open = true;
    peer.emit('open');
    const first = peer.connections[0];
    first.open = true;
    first.emit('open');
    first.emit('close');
    const stuck = peer.connections[1];

    peer.emit('error', { type: 'peer-unavailable' });

    assert.equal(stuck.closeCalls, 1);
    assert.equal(peer.connections.length, 3);
    assert.equal(Net.hostConn, peer.connections[2]);
});

test('NET-04: a returning peer reclaims its bot seat and receives fresh state', () => {
    const sent = [];
    let broadcasts = 0;
    const Net = {
        sendTo(conn, message) { sent.push({ conn, message }); },
        disconnect() { throw new Error('returning peer must not be rejected'); },
    };
    const { MehGame } = loadGame(Net);
    const game = Object.create(MehGame.prototype);
    const seat = {
        connPeer: 'peer-1',
        isBot: true,
        isRemote: false,
        name: 'لاعب',
        avatar: '😎',
        hand: [],
    };
    game.online = true;
    game.isHost = true;
    game.players = [seat];
    game.currentPlayerIndex = 0;
    game.lobbyPlayers = [{ id: 'host' }, { id: 'peer-1' }];
    game.actionInProgress = true;
    game.showToast = () => {};
    game.updateUI = () => {};
    game._doBroadcast = () => { broadcasts++; };

    const accepted = game.handleHostMessage(
        { t: 'hello', name: 'اسم مختلف', avatar: '🤖' },
        { peer: 'peer-1', open: true },
    );

    assert.equal(accepted, true);
    assert.equal(seat.isBot, false);
    assert.equal(seat.isRemote, true);
    assert.equal(seat.name, 'لاعب');
    assert.equal(sent.at(-1).message.t, 'resumed');
    assert.equal(broadcasts, 1);
});

test('NET-04: a returning lobby peer receives the current lobby snapshot immediately', () => {
    const sent = [];
    const Net = { sendTo(conn, message) { sent.push({ conn, message }); } };
    const { MehGame } = loadGame(Net);
    const game = Object.create(MehGame.prototype);
    game.online = false;
    game.lobbyPlayers = [
        { id: 'host', name: 'مضيف', avatar: '😎', host: true },
        { id: 'peer-1', name: 'لاعب', avatar: '🤖', host: false },
    ];

    const accepted = game.handleHostMessage(
        { t: 'hello', name: 'لاعب', avatar: '🤖' },
        { peer: 'peer-1', open: true },
    );

    assert.equal(accepted, true);
    assert.equal(sent.at(-1).message.t, 'lobby');
    assert.equal(sent.at(-1).message.players.length, 2);
});

test('NET-04: disconnect during a remote prompt resolves immediately with the bot fallback', () => {
    const { MehGame } = loadGame();
    const game = Object.create(MehGame.prototype);
    const seat = { connPeer: 'peer-1', isBot: false, isRemote: true, name: 'لاعب', hand: [] };
    let resolved = null;
    game.online = true;
    game.isHost = true;
    game.players = [seat];
    game.currentPlayerIndex = 0;
    game.awaitingRemote = false;
    game._remoteResolve = value => { resolved = value; };
    game._remoteKind = 'choice';
    game._remotePromptId = 4;
    game._remotePromptPeer = 'peer-1';
    game._remoteAllowedValues = null;
    game._promptTimer = setTimeout(() => {}, 1000);
    game._autoPromptValue = () => 0;
    game.showToast = () => {};
    game.updateUI = () => {};

    game._handleHostPlayerLeave({ peer: 'peer-1' });

    assert.equal(resolved, 0);
    assert.equal(seat.isBot, true);
    assert.equal(seat.isRemote, false);
    assert.equal(seat.connPeer, 'peer-1');
    assert.equal(game._remoteResolve, null);
    assert.equal(game._promptTimer, null);
});

test('NET-04: ending an online session clears every game-owned timer and prompt', async () => {
    const { MehGame } = loadGame();
    const game = Object.create(MehGame.prototype);
    let fired = 0;
    game.turnTimer = setTimeout(() => { fired++; }, 20);
    game._promptTimer = setTimeout(() => { fired++; }, 20);
    game._bcTimer = setTimeout(() => { fired++; }, 20);
    game._disconnectTurnTimer = setTimeout(() => { fired++; }, 20);
    game._remoteResolve = () => {};
    game._remoteKind = 'color';
    game._remotePromptId = 2;
    game._remotePromptPeer = 'peer-1';
    game._remoteAllowedValues = ['orange'];

    game._clearOnlineRuntime();
    await new Promise(resolve => setTimeout(resolve, 35));

    assert.equal(fired, 0);
    assert.equal(game.turnTimer, null);
    assert.equal(game._promptTimer, null);
    assert.equal(game._bcTimer, null);
    assert.equal(game._disconnectTurnTimer, null);
    assert.equal(game._remoteResolve, null);
    assert.equal(game._remotePromptId, null);
});
