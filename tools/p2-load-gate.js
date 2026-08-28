'use strict';

const { AccountService } = require('../server/account-service');
const { planBotAction } = require('../server/bot-policy');
const { RoomService } = require('../server/room-service');
const { MemoryStore } = require('../server/stores/memory-store');
const { MatchReducer } = require('../shared/match-reducer');

const steps = String(process.env.MEH_P2_LOAD_STEPS || '8,16,32,64')
    .split(',').map(Number).filter(value => Number.isSafeInteger(value) && value > 0);
const soakMs = Number(process.env.MEH_P2_SOAK_MS || 10_000);
const localAckBudgetMs = Number(process.env.MEH_P2_LOCAL_ACK_BUDGET_MS || 400);
if (!steps.length || !Number.isFinite(soakMs) || soakMs < 0) throw new Error('Invalid load configuration');

function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function runRoom(rooms, store, account, index) {
    const connectionId = `load_conn_${String(index).padStart(16, '0')}`;
    const created = await rooms.createRoom(account, connectionId, { mode: 'quick', clientSeq: 1 });
    let sequence = 1;
    const latencies = [];
    while (true) {
        const current = await store.getRoom(created.room.roomId);
        if (current.room.phase === 'RESULTS' || current.room.matchState.phase === 'COMPLETE') {
            return { completed: true, latencies, state: current.room.matchState };
        }
        const action = planBotAction(current.room.matchState, MatchReducer, { force: true });
        const envelope = {
            requestId: `load_request_${index}_${++sequence}`,
            clientSeq: sequence,
            payload: { action: action.type, turnId: action.turnId },
        };
        if (action.cardId) envelope.payload.cardId = action.cardId;
        if (action.decision) envelope.payload.decision = action.decision;
        const started = process.hrtime.bigint();
        await rooms.applyMatchAction(created.room.roomId, connectionId, envelope);
        latencies.push(Number(process.hrtime.bigint() - started) / 1e6);
        if (sequence > 5_001) throw new Error(`Room ${index} exceeded action limit`);
    }
}

async function runBatch(concurrency, offset = 0) {
    const store = new MemoryStore();
    const accounts = new AccountService(store, { pepper: 'load-test-pepper-at-least-32-characters' });
    const rooms = new RoomService(store, { pepper: 'load-test-pepper-at-least-32-characters' });
    const guest = await accounts.createGuest('Load Player');
    const settled = await Promise.allSettled(
        Array.from({ length: concurrency }, (_, index) => runRoom(rooms, store, guest.account, offset + index)),
    );
    const successful = settled.filter(result => result.status === 'fulfilled' && result.value.completed);
    const latencies = successful.flatMap(result => result.value.latencies);
    const errors = settled.filter(result => result.status === 'rejected').map(result => result.reason.message);
    const mcr = successful.length / concurrency;
    const crashFree = (concurrency - errors.length) / concurrency;
    return {
        concurrency,
        rooms: concurrency,
        completed: successful.length,
        errors,
        mcr,
        crashFree,
        actions: latencies.length,
        p50Ms: percentile(latencies, 0.5),
        p95Ms: percentile(latencies, 0.95),
        p99Ms: percentile(latencies, 0.99),
        heapUsedBytes: process.memoryUsage().heapUsed,
        passed: mcr >= 0.95 && crashFree >= 0.995 && percentile(latencies, 0.95) <= localAckBudgetMs,
    };
}

(async () => {
    const staircase = [];
    for (const step of steps) {
        const result = await runBatch(step, staircase.reduce((sum, item) => sum + item.rooms, 0));
        staircase.push(result);
        process.stdout.write(`load rooms=${step} p95=${result.p95Ms && result.p95Ms.toFixed(2)}ms mcr=${result.mcr}\n`);
        if (!result.passed) break;
    }
    const lastPassing = [...staircase].reverse().find(result => result.passed);
    if (!lastPassing) throw new Error('No staircase step passed');
    const soakConcurrency = Math.max(1, Math.floor(lastPassing.concurrency * 0.6));
    const soakStarted = Date.now();
    const soakRuns = [];
    let offset = 100_000;
    do {
        const result = await runBatch(soakConcurrency, offset);
        soakRuns.push(result);
        offset += soakConcurrency;
        if (!result.passed) break;
    } while (Date.now() - soakStarted < soakMs);
    const report = {
        generatedAt: new Date().toISOString(),
        localAckBudgetMs,
        staircase,
        soak: {
            requestedMs: soakMs,
            actualMs: Date.now() - soakStarted,
            concurrency: soakConcurrency,
            runs: soakRuns.length,
            rooms: soakRuns.reduce((sum, item) => sum + item.rooms, 0),
            completed: soakRuns.reduce((sum, item) => sum + item.completed, 0),
            errors: soakRuns.flatMap(item => item.errors),
            maxHeapUsedBytes: Math.max(...soakRuns.map(item => item.heapUsedBytes)),
        },
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (soakRuns.some(result => !result.passed)) process.exitCode = 1;
})().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
