'use strict';

const { AccountService } = require('../server/account-service');
const { RoomService } = require('../server/room-service');
const { MemoryStore } = require('../server/stores/memory-store');

const attempts = Number(process.env.MEH_P2_RECOVERY_ATTEMPTS || 1_000);
if (!Number.isSafeInteger(attempts) || attempts < 1) throw new Error('Invalid recovery attempt count');

function percentile(values, fraction) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

(async () => {
    let now = Date.parse('2026-08-28T00:00:00Z');
    let successes = 0;
    const latencies = [];
    for (let index = 0; index < attempts; index++) {
        const store = new MemoryStore();
        const accounts = new AccountService(store, {
            pepper: 'recovery-gate-pepper-at-least-32-characters', now: () => now,
        });
        const rooms = new RoomService(store, {
            pepper: 'recovery-gate-pepper-at-least-32-characters', now: () => now, seatLeaseMs: 30_000,
        });
        const guest = await accounts.createGuest(`Recovery ${index}`);
        const oldConnection = `recovery_old_${String(index).padStart(16, '0')}`;
        const created = await rooms.createRoom(guest.account, oldConnection, { clientSeq: 2 });
        await rooms.disconnect(created.room.roomId, oldConnection);
        now += index % 29_000;
        const started = process.hrtime.bigint();
        const resumed = await rooms.resume(created.room.roomCode, created.recoveryToken, guest.account,
            `recovery_new_${String(index).padStart(16, '0')}`, 2);
        latencies.push(Number(process.hrtime.bigint() - started) / 1e6);
        if (resumed.seatId === created.seatId && resumed.recoveryToken !== created.recoveryToken) successes++;
        now += 31_000;
    }
    const rcr = successes / attempts;
    const report = {
        attempts,
        successes,
        rcr,
        withinSeconds: 30,
        p50Ms: percentile(latencies, 0.5),
        p95Ms: percentile(latencies, 0.95),
        p99Ms: percentile(latencies, 0.99),
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (rcr < 0.95) process.exitCode = 1;
})().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
