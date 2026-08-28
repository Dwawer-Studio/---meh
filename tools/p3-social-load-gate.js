'use strict';

const { MajlisService } = require('../server/majlis-service');
const { RoomService } = require('../server/room-service');
const { MemoryStore } = require('../server/stores/memory-store');

const groupCount = Number(process.env.MEH_P3_LOAD_GROUPS || 1_000);
const regroupCount = Number(process.env.MEH_P3_REGROUP_GROUPS || 200);
const localP95BudgetMs = Number(process.env.MEH_P3_LOCAL_P95_BUDGET_MS || 250);

if (!Number.isSafeInteger(groupCount) || groupCount < 1
    || !Number.isSafeInteger(regroupCount) || regroupCount < 1 || regroupCount > groupCount
    || !Number.isFinite(localP95BudgetMs) || localP95BudgetMs <= 0) {
    throw new Error('Invalid P3 load configuration');
}

function percentile(values, fraction) {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function account(groupIndex, memberIndex) {
    return {
        accountId: `account_p3_load_${groupIndex}_${memberIndex}`,
        displayName: memberIndex === 0 ? 'Load Owner' : 'Load Member',
        accountKind: 'guest',
        createdAt: '2026-08-28T10:00:00.000Z',
        updatedAt: '2026-08-28T10:00:00.000Z',
        deletedAt: null,
        syncRevision: 1,
    };
}

function sourceRoom(groupIndex, owner, member) {
    const roomId = `room_p3_load_source_${groupIndex}`;
    const seats = [owner, member].map((player, seatIndex) => ({
        seatId: `seat_p3_load_${groupIndex}_${seatIndex}`,
        seatIndex,
        accountId: player.accountId,
        displayName: player.displayName,
        isBot: false,
        status: 'CONNECTED',
        ready: false,
        leaseTokenHash: null,
        leaseExpiresAt: null,
        connectionSessionId: `conn_p3_load_source_${groupIndex}_${seatIndex}`,
        lastClientSeq: 1,
    }));
    for (let seatIndex = 2; seatIndex < 4; seatIndex++) {
        seats.push({
            seatId: `seat_p3_load_${groupIndex}_${seatIndex}`,
            seatIndex,
            accountId: null,
            displayName: `Bot ${seatIndex}`,
            isBot: true,
            status: 'BOT',
            ready: true,
            leaseTokenHash: null,
            leaseExpiresAt: null,
            connectionSessionId: null,
            lastClientSeq: 0,
        });
    }
    return {
        room: {
            roomId,
            roomCode: `L${String(groupIndex).padStart(4, '0')}`,
            mode: 'private',
            phase: 'RESULTS',
            rulesVersion: '1.0.0',
            catalogVersion: '1.0.0',
            deckRecipeId: 'meh-core-60-v1',
            matchId: `match_p3_load_${groupIndex}`,
            matchState: { phase: 'COMPLETE', winnerId: seats[0].seatId },
            stateVersion: 1,
            serverSeq: 1,
            majlisId: null,
            createdAt: '2026-08-28T10:00:00.000Z',
            lastActivityAt: '2026-08-28T10:00:00.000Z',
            closedAt: null,
        },
        seats,
    };
}

(async () => {
    const store = new MemoryStore();
    const majalis = new MajlisService(store, {
        now: () => Date.parse('2026-08-28T10:00:00.000Z'),
    });
    const rooms = new RoomService(store, {
        pepper: 'p3-load-pepper-that-is-long-enough',
        authorizeMajlisMembership: (majlisId, accountId) => (
            majalis.assertMembership(majlisId, accountId)
        ),
    });
    const fixtures = [];
    const socialLatencies = [];

    for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
        const owner = account(groupIndex, 0);
        const member = account(groupIndex, 1);
        await store.createAccount(owner);
        await store.createAccount(member);
        const source = sourceRoom(groupIndex, owner, member);
        await store.createRoom(source.room, source.seats);
        const started = process.hrtime.bigint();
        const created = await majalis.createFromRoom(owner, source.room.roomId, {
            displayName: `Load Majlis ${groupIndex}`,
        });
        await majalis.acceptFromSourceRoom(member, source.room.roomId, created.majlisId);
        await majalis.recordCompletedMatch(source.room.roomId);
        socialLatencies.push(Number(process.hrtime.bigint() - started) / 1e6);
        fixtures.push({ owner, member, majlisId: created.majlisId });
    }

    const regroupLatencies = [];
    const regrouped = await Promise.all(fixtures.slice(0, regroupCount).map(async (fixture, index) => {
        const started = process.hrtime.bigint();
        const [ownerRoom, memberRoom] = await Promise.all([
            rooms.createRoom(fixture.owner, `conn_p3_regroup_${index}_0`, {
                majlisId: fixture.majlisId, clientSeq: 2,
            }),
            rooms.createRoom(fixture.member, `conn_p3_regroup_${index}_1`, {
                majlisId: fixture.majlisId, clientSeq: 2,
            }),
        ]);
        regroupLatencies.push(Number(process.hrtime.bigint() - started) / 1e6);
        const stored = await store.getRoom(ownerRoom.room.roomId);
        return ownerRoom.room.roomId === memberRoom.room.roomId
            && stored.seats.filter(seat => !seat.isBot).length === 2;
    }));

    const socialP95Ms = percentile(socialLatencies, 0.95);
    const regroupP95Ms = percentile(regroupLatencies, 0.95);
    const passed = store.majalis.size === groupCount
        && store.majlisMemberships.size === groupCount * 2
        && store.majlisSessions.length === groupCount
        && regrouped.every(Boolean)
        && socialP95Ms <= localP95BudgetMs
        && regroupP95Ms <= localP95BudgetMs;
    const report = {
        generatedAt: new Date().toISOString(),
        scope: 'local in-process regression gate; not a production capacity claim',
        groupCount,
        memberships: store.majlisMemberships.size,
        sessions: store.majlisSessions.length,
        simultaneousRegroups: regroupCount,
        singleRoomRegroups: regrouped.filter(Boolean).length,
        localP95BudgetMs,
        socialP95Ms,
        regroupP95Ms,
        heapUsedBytes: process.memoryUsage().heapUsed,
        passed,
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (!passed) process.exitCode = 1;
})().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
