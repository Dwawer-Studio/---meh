'use strict';

const { WebSocket } = require('ws');
const { AccountService } = require('../server/account-service');
const { TokenBucketLimiter } = require('../server/rate-limiter');
const { RealtimeRuntime } = require('../server/runtime');
const { MemoryStore } = require('../server/stores/memory-store');

const concurrency = Number(process.env.MEH_P2_WS_CONCURRENCY || 64);
const localAckBudgetMs = Number(process.env.MEH_P2_LOCAL_ACK_BUDGET_MS || 400);
const origin = 'http://127.0.0.1:4173';
if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Invalid WebSocket concurrency');

function percentile(values, fraction) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] || null;
}

function messageQueue(socket) {
    const buffered = [];
    const waiters = [];
    socket.on('message', raw => {
        const message = JSON.parse(raw.toString());
        const index = waiters.findIndex(waiter => waiter.predicate(message));
        if (index < 0) buffered.push(message);
        else waiters.splice(index, 1)[0].resolve(message);
    });
    return predicate => {
        const index = buffered.findIndex(predicate);
        if (index >= 0) return Promise.resolve(buffered.splice(index, 1)[0]);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('WebSocket response timeout')), 8_000);
            waiters.push({
                predicate,
                resolve: value => { clearTimeout(timer); resolve(value); },
            });
        });
    };
}

function open(url) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url, { origin });
        socket.once('open', () => resolve(socket));
        socket.once('error', reject);
    });
}

function send(socket, value) {
    socket.send(JSON.stringify(value));
}

async function runClient(url, account, index) {
    const socket = await open(url);
    const next = messageQueue(socket);
    try {
        const helloId = `ws_hello_${String(index).padStart(20, '0')}`;
        send(socket, {
            v: 1, type: 'session.hello', requestId: helloId, clientSeq: 1,
            lastServerSeq: 0, payload: { accessToken: account.accessToken },
        });
        await next(message => message.ackRequestId === helloId);
        const createId = `ws_create_${String(index).padStart(19, '0')}`;
        send(socket, {
            v: 1, type: 'room.create', requestId: createId, clientSeq: 2,
            lastServerSeq: 0, payload: { mode: 'quick' },
        });
        const lease = await next(message => message.ackRequestId === createId);
        const match = lease.payload.snapshot.payload.match;
        if (Object.hasOwn(match, 'deck') || match.others.some(player => Object.hasOwn(player, 'hand'))) {
            throw new Error('Private cards leaked in load snapshot');
        }
        const actionId = `ws_action_${String(index).padStart(19, '0')}`;
        const startedAt = process.hrtime.bigint();
        send(socket, {
            v: 1, type: 'match.action', requestId: actionId, clientSeq: 3,
            lastServerSeq: lease.serverSeq,
            payload: { action: 'draw', turnId: match.turnId },
        });
        const ack = await next(message => message.ackRequestId === actionId);
        if (ack.type !== 'match.ack') throw new Error(`Unexpected action response: ${ack.type}`);
        return Number(process.hrtime.bigint() - startedAt) / 1e6;
    } finally {
        socket.close(1000, 'load complete');
    }
}

(async () => {
    const store = new MemoryStore();
    const pepper = 'websocket-load-pepper-at-least-32-characters';
    const accounts = new AccountService(store, { pepper });
    const runtime = new RealtimeRuntime({ store, pepper, allowedOrigins: [origin] });
    runtime.joinLimiter = new TokenBucketLimiter({ capacity: concurrency * 2, refillPerSecond: concurrency });
    const address = await runtime.listen(0, '127.0.0.1');
    try {
        const identities = await Promise.all(Array.from({ length: concurrency }, (_, index) => (
            accounts.createGuest(`WS Load ${index}`)
        )));
        const settled = await Promise.allSettled(identities.map((account, index) => (
            runClient(`ws://127.0.0.1:${address.port}/v1/realtime`, account, index)
        )));
        const latencies = settled.filter(item => item.status === 'fulfilled').map(item => item.value);
        const errors = settled.filter(item => item.status === 'rejected').map(item => item.reason.message);
        const report = {
            concurrency,
            completed: latencies.length,
            mcr: latencies.length / concurrency,
            crashFree: (concurrency - errors.length) / concurrency,
            errors,
            p50Ms: percentile(latencies, 0.5),
            p95Ms: percentile(latencies, 0.95),
            p99Ms: percentile(latencies, 0.99),
            localAckBudgetMs,
        };
        process.stdout.write(`${JSON.stringify(report)}\n`);
        if (report.mcr < 0.95 || report.crashFree < 0.995 || report.p95Ms > localAckBudgetMs) {
            process.exitCode = 1;
        }
    } finally {
        await runtime.close();
    }
})().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
