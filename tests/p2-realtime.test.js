'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { WebSocket } = require('ws');
const { RealtimeRuntime } = require('../server/runtime');
const { TokenBucketLimiter } = require('../server/rate-limiter');
const { MemoryStore } = require('../server/stores/memory-store');

const ORIGIN = 'http://127.0.0.1:4173';

function queue(socket) {
    const buffered = [];
    const waiters = [];
    socket.on('message', raw => {
        const message = JSON.parse(raw.toString());
        const index = waiters.findIndex(waiter => waiter.predicate(message));
        if (index >= 0) {
            const waiter = waiters.splice(index, 1)[0];
            clearTimeout(waiter.timer);
            waiter.resolve(message);
        } else {
            buffered.push(message);
        }
    });
    return {
        next(predicate, timeoutMs = 4_000) {
            const index = buffered.findIndex(predicate);
            if (index >= 0) return Promise.resolve(buffered.splice(index, 1)[0]);
            return new Promise((resolve, reject) => {
                const waiter = { predicate, resolve, reject, timer: null };
                waiter.timer = setTimeout(() => {
                    const current = waiters.indexOf(waiter);
                    if (current >= 0) waiters.splice(current, 1);
                    reject(new Error('Timed out waiting for WebSocket message'));
                }, timeoutMs);
                waiters.push(waiter);
            });
        },
    };
}

function open(url, origin = ORIGIN) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url, { origin });
        socket.once('open', () => resolve(socket));
        socket.once('error', reject);
    });
}

function send(socket, value) {
    socket.send(JSON.stringify(value));
}

test('realtime service authenticates, starts quick play, deduplicates, sequences, and resyncs',
    { timeout: 30_000 }, async () => {
        const runtime = new RealtimeRuntime({
            store: new MemoryStore(),
            pepper: 'runtime-test-pepper-at-least-32-characters',
            allowedOrigins: [ORIGIN],
        });
        const address = await runtime.listen(0, '127.0.0.1');
        let socket;
        try {
            const accountResponse = await fetch(`http://127.0.0.1:${address.port}/v1/guest`, {
                method: 'POST',
                headers: { origin: ORIGIN, 'content-type': 'application/json' },
                body: JSON.stringify({ displayName: 'Realtime Player' }),
            });
            assert.equal(accountResponse.status, 201);
            assert.equal(accountResponse.headers.get('access-control-allow-origin'), ORIGIN);
            const account = await accountResponse.json();
            const unauthorizedSync = await fetch(`http://127.0.0.1:${address.port}/v1/account/sync`, {
                headers: { origin: ORIGIN },
            });
            assert.equal(unauthorizedSync.status, 401);
            const syncResponse = await fetch(`http://127.0.0.1:${address.port}/v1/account/sync`, {
                headers: { origin: ORIGIN, authorization: `Bearer ${account.accessToken}` },
            });
            assert.equal(syncResponse.status, 200);
            assert.deepEqual((await syncResponse.json()).majalis, []);
            runtime.accountLimiter = new TokenBucketLimiter({ capacity: 1, refillPerSecond: 0.0001 });
            const firstLimitedScopeRequest = await fetch(`http://127.0.0.1:${address.port}/v1/guest`, {
                method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' },
                body: JSON.stringify({ displayName: 'Allowed Guest' }),
            });
            assert.equal(firstLimitedScopeRequest.status, 201);
            const rateLimited = await fetch(`http://127.0.0.1:${address.port}/v1/guest`, {
                method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' },
                body: JSON.stringify({ displayName: 'Rejected Guest' }),
            });
            assert.equal(rateLimited.status, 429);
            assert.ok(Number(rateLimited.headers.get('retry-after')) >= 1);

            socket = await open(`ws://127.0.0.1:${address.port}/v1/realtime`);
            const messages = queue(socket);
            const hello = {
                v: 1, type: 'session.hello', requestId: 'request_hello_000001',
                clientSeq: 1, lastServerSeq: 0, payload: { accessToken: account.accessToken },
            };
            send(socket, hello);
            const welcome = await messages.next(message => message.ackRequestId === hello.requestId);
            assert.equal(welcome.type, 'session.welcome');

            const create = {
                v: 1, type: 'room.create', requestId: 'request_create_00001',
                clientSeq: 2, lastServerSeq: 0, payload: { mode: 'quick' },
            };
            send(socket, create);
            const lease = await messages.next(message => message.ackRequestId === create.requestId);
            assert.equal(lease.type, 'seat.lease');
            assert.equal(lease.payload.snapshot.payload.room.phase, 'IN_MATCH');
            assert.equal(lease.payload.snapshot.payload.seats.filter(seat => seat.isBot).length, 3);

            const action = {
                v: 1, type: 'match.action', requestId: 'request_action_00001',
                clientSeq: 3, lastServerSeq: lease.serverSeq,
                payload: { action: 'draw', turnId: lease.payload.snapshot.payload.match.turnId },
            };
            send(socket, action);
            const ack = await messages.next(message => message.ackRequestId === action.requestId);
            assert.equal(ack.type, 'match.ack');

            send(socket, action);
            const duplicate = await messages.next(message => message.ackRequestId === action.requestId);
            assert.deepEqual(duplicate, ack);

            const skipped = {
                v: 1, type: 'snapshot.request', requestId: 'request_skipseq_0001',
                clientSeq: 99, lastServerSeq: ack.serverSeq, payload: {},
            };
            send(socket, skipped);
            const badSequence = await messages.next(message => message.ackRequestId === skipped.requestId);
            assert.equal(badSequence.payload.code, 'BAD_SEQUENCE');

            const stale = {
                v: 1, type: 'match.action', requestId: 'request_resync_00001',
                clientSeq: 4, lastServerSeq: 0,
                payload: { action: 'draw', turnId: ack.stateVersion + 1 },
            };
            send(socket, stale);
            const resync = await messages.next(message => message.ackRequestId === stale.requestId);
            assert.equal(resync.type, 'server.resync_required');
            assert.equal(resync.payload.snapshot.type, 'room.snapshot');

            const forgedTimeout = {
                v: 1, type: 'match.action', requestId: 'request_timeout_0001',
                clientSeq: 5, lastServerSeq: resync.serverSeq,
                payload: { action: 'timeout', turnId: resync.payload.snapshot.payload.match.turnId },
            };
            send(socket, forgedTimeout);
            const rejected = await messages.next(message => message.ackRequestId === forgedTimeout.requestId);
            assert.equal(rejected.type, 'match.rejected');
            assert.equal(rejected.payload.code, 'UNKNOWN_ACTION');

            const originalSnapshot = runtime.rooms.snapshot.bind(runtime.rooms);
            runtime.rooms.snapshot = async () => { throw new Error('simulated persistence outage'); };
            const failedSnapshot = {
                v: 1, type: 'snapshot.request', requestId: 'request_failure_0001',
                clientSeq: 6, lastServerSeq: resync.serverSeq, payload: {},
            };
            send(socket, failedSnapshot);
            const failure = await messages.next(message => message.ackRequestId === failedSnapshot.requestId);
            assert.equal(failure.type, 'server.error');
            assert.equal(failure.payload.code, 'SERVER_ERROR');
            runtime.rooms.snapshot = originalSnapshot;

            const metrics = runtime.metrics.snapshot();
            assert.equal(metrics.counters['match.desync_detected'], 1);
            assert.equal(metrics.counters['room.failure{operation=snapshot.request}'], 1);
            assert.ok(metrics.percentiles['realtime.action_ack_ms{type=match.action}'].count >= 1);
        } finally {
            if (socket) await new Promise(resolve => {
                socket.once('close', resolve);
                socket.close();
            });
            await runtime.close();
        }
    });

test('realtime upgrade rejects unapproved origins', { timeout: 10_000 }, async () => {
    const runtime = new RealtimeRuntime({
        store: new MemoryStore(),
        pepper: 'runtime-test-pepper-at-least-32-characters',
        allowedOrigins: [ORIGIN],
    });
    const address = await runtime.listen(0, '127.0.0.1');
    try {
        await assert.rejects(() => open(`ws://127.0.0.1:${address.port}/v1/realtime`, 'https://evil.example'));
    } finally {
        await runtime.close();
    }
});

test('production HTTP requires trusted TLS forwarding metadata', { timeout: 10_000 }, async () => {
    const runtime = new RealtimeRuntime({
        store: new MemoryStore(),
        pepper: 'runtime-test-pepper-at-least-32-characters',
        allowedOrigins: [ORIGIN],
        requireTls: true,
        trustProxy: true,
    });
    const address = await runtime.listen(0, '127.0.0.1');
    try {
        const insecure = await fetch(`http://127.0.0.1:${address.port}/v1/guest`, {
            method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' },
            body: JSON.stringify({ displayName: 'Insecure Guest' }),
        });
        assert.equal(insecure.status, 403);
        assert.equal((await insecure.json()).error, 'TLS_REQUIRED');
        const forwarded = await fetch(`http://127.0.0.1:${address.port}/v1/guest`, {
            method: 'POST',
            headers: {
                origin: ORIGIN,
                'content-type': 'application/json',
                'x-forwarded-proto': 'https',
                'x-forwarded-for': '203.0.113.5',
            },
            body: JSON.stringify({ displayName: 'Forwarded Guest' }),
        });
        assert.equal(forwarded.status, 201);
    } finally {
        await runtime.close();
    }
});
