'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AccountService } = require('../server/account-service');
const { MajlisService } = require('../server/majlis-service');
const { RoomService } = require('../server/room-service');
const { MemoryStore } = require('../server/stores/memory-store');

const PEPPER = 'p3-test-pepper-that-is-long-enough-for-tests';

function roomRecord(roomId, mode, phase, humans, matchId = 'match_p3_00000001') {
    const seats = humans.map((account, seatIndex) => ({
        seatId: `seat_p3_${seatIndex}_00000001`, seatIndex, accountId: account.accountId,
        displayName: account.displayName, isBot: false, status: 'CONNECTED', ready: false,
        connectionSessionId: `conn_p3_${seatIndex}_00000001`, lastClientSeq: 0,
    }));
    for (let seatIndex = seats.length; seatIndex < 4; seatIndex++) {
        seats.push({
            seatId: `seat_p3_${seatIndex}_00000001`, seatIndex, accountId: null,
            displayName: `Bot ${seatIndex}`, isBot: true, status: 'BOT', ready: true,
            connectionSessionId: null, lastClientSeq: 0,
        });
    }
    return {
        room: {
            roomId, roomCode: mode === 'quick' ? 'Q3ABC' : 'P3ABC', mode, phase,
            rulesVersion: '1.0.0', catalogVersion: '1.0.0',
            deckRecipeId: 'meh-core-60-v1', matchId,
            matchState: phase === 'RESULTS' ? {
                phase: 'COMPLETE', winnerId: seats[0].seatId,
            } : { phase: 'ACTIVE', winnerId: null },
            stateVersion: 1, serverSeq: 1, majlisId: null,
            createdAt: '2026-08-28T00:00:00.000Z', lastActivityAt: '2026-08-28T00:00:00.000Z',
            closedAt: null,
        },
        seats,
    };
}

async function fixture() {
    let now = Date.parse('2026-08-28T10:00:00.000Z');
    const store = new MemoryStore();
    const accounts = new AccountService(store, { pepper: PEPPER, now: () => now });
    const owner = await accounts.createGuest('Owner');
    const member = await accounts.createGuest('Member');
    const outsider = await accounts.createGuest('Outsider');
    const source = roomRecord('room_p3_source_0001', 'private', 'RESULTS', [owner.account, member.account]);
    await store.createRoom(source.room, source.seats);
    const majalis = new MajlisService(store, { now: () => now, chatCooldownMs: 4_000 });
    return { store, accounts, owner, member, outsider, majalis, source, now: () => now, advance: ms => { now += ms; } };
}

test('P3 Majlis creation is result-bound, consent-based, safe, and durable on the source room', async () => {
    const f = await fixture();
    await assert.rejects(
        () => f.majalis.createFromRoom(f.owner.account, f.source.room.roomId, {
            displayName: 'Bad\u202eName',
        }),
        error => error.code === 'INVALID_MAJLIS_NAME',
    );
    const created = await f.majalis.createFromRoom(f.owner.account, f.source.room.roomId, {
        displayName: 'مجلس الجمعة الطويل الجميل', bannerId: 'dhow', tableThemeId: 'sea',
    });
    assert.equal(created.members.length, 1);
    assert.equal(created.memberRole, 'owner');
    assert.equal(created.bannerId, 'dhow');
    assert.equal((await f.store.getRoom(f.source.room.roomId)).room.majlisId, created.majlisId);
    assert.equal(await f.store.isMajlisMember(created.majlisId, f.member.account.accountId), false);
    await assert.rejects(
        () => f.majalis.acceptFromSourceRoom(f.outsider.account, f.source.room.roomId, created.majlisId),
        error => error.code === 'ROOM_MEMBERSHIP_REQUIRED',
    );
    const accepted = await f.majalis.acceptFromSourceRoom(
        f.member.account, f.source.room.roomId, created.majlisId,
    );
    assert.equal(accepted.members.length, 2);
    assert.equal(JSON.stringify(accepted).includes(f.owner.account.accountId), false);
    await assert.rejects(
        () => f.majalis.createFromRoom(f.member.account, f.source.room.roomId, { displayName: 'Duplicate' }),
        error => error.code === 'ROOM_ALREADY_LINKED',
    );
});

test('P3 concurrent Majlis proposals yield one council and one recoverable product error', async () => {
    const f = await fixture();
    const attempts = await Promise.allSettled([
        f.majalis.createFromRoom(f.owner.account, f.source.room.roomId, { displayName: 'First Proposal' }),
        f.majalis.createFromRoom(f.member.account, f.source.room.roomId, { displayName: 'Second Proposal' }),
    ]);
    assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
    const rejected = attempts.find(item => item.status === 'rejected');
    assert.equal(rejected.reason.code, 'ROOM_ALREADY_LINKED');
    assert.equal(f.store.majalis.size, 1);
    assert.ok((await f.store.getRoom(f.source.room.roomId)).room.majlisId);
});

test('P3 linked rooms are member-only and completed sessions are idempotent and Majlis-scoped', async () => {
    const f = await fixture();
    const majlis = await f.majalis.createFromRoom(f.owner.account, f.source.room.roomId, {
        displayName: 'Friday Table',
    });
    await f.majalis.acceptFromSourceRoom(f.member.account, f.source.room.roomId, majlis.majlisId);
    await f.majalis.recordCompletedMatch(f.source.room.roomId);
    await f.majalis.recordCompletedMatch(f.source.room.roomId);
    const detail = await f.majalis.detail(f.owner.account.accountId, majlis.majlisId);
    assert.equal(detail.recentSessions.length, 1);
    assert.equal(detail.sessionScore.find(item => item.displayName === 'Owner').wins, 1);
    const rooms = new RoomService(f.store, {
        pepper: PEPPER,
        authorizeMajlisMembership: (majlisId, accountId) => f.majalis.assertMembership(majlisId, accountId),
    });
    const regrouped = await rooms.createRoom(f.owner.account, 'conn_regroup_owner_001', {
        majlisId: majlis.majlisId, clientSeq: 2,
    });
    assert.equal(regrouped.room.majlisId, majlis.majlisId);
    const joinedExisting = await rooms.createRoom(f.member.account, 'conn_regroup_member_01', {
        majlisId: majlis.majlisId, clientSeq: 2,
    });
    assert.equal(joinedExisting.room.roomId, regrouped.room.roomId);
    assert.equal((await f.store.getRoom(regrouped.room.roomId)).seats.filter(seat => !seat.isBot).length, 2);
    await assert.rejects(
        () => rooms.createRoom(f.outsider.account, 'conn_regroup_outside_1', {
            majlisId: majlis.majlisId, clientSeq: 2,
        }),
        error => error.code === 'MAJLIS_MEMBERS_ONLY',
    );
    await assert.rejects(
        () => rooms.joinRoom(regrouped.room.roomCode, f.outsider.account, 'conn_outside_join_01', 2),
        error => error.code === 'MAJLIS_MEMBERS_ONLY',
    );
});

test('P3 invitations, reminders, quick chat, reports, and retention enforce their safety boundaries', async () => {
    const f = await fixture();
    const majlis = await f.majalis.createFromRoom(f.owner.account, f.source.room.roomId, {
        displayName: 'Safe Majlis',
    });
    await f.majalis.acceptFromSourceRoom(f.member.account, f.source.room.roomId, majlis.majlisId);
    await assert.rejects(
        () => f.majalis.schedule(f.outsider.account.accountId, majlis.majlisId,
            new Date(f.now() + 60 * 60 * 1000).toISOString()),
        error => error.code === 'MAJLIS_MEMBERSHIP_REQUIRED',
    );
    const invitation = await f.majalis.schedule(
        f.owner.account.accountId, majlis.majlisId,
        new Date(f.now() + 20 * 60 * 1000).toISOString(),
    );
    const reminder = await f.majalis.setReminder(
        f.owner.account.accountId, invitation.invitationId, true,
    );
    assert.equal(reminder.enabled, true);
    assert.deepEqual(await f.majalis.claimDueReminders(f.owner.account.accountId), []);
    f.advance(6 * 60 * 1000);
    assert.equal((await f.majalis.claimDueReminders(f.owner.account.accountId)).length, 1);
    assert.deepEqual(await f.majalis.claimDueReminders(f.owner.account.accountId), []);

    const quick = roomRecord('room_p3_quick_0001', 'quick', 'IN_MATCH', [f.owner.account, f.member.account]);
    await f.store.createRoom(quick.room, quick.seats);
    const chat = await f.majalis.sendQuickChat(f.owner.account.accountId, quick.room.roomId, 'kafo');
    assert.equal(chat.phraseId, 'kafo');
    await assert.rejects(
        () => f.majalis.sendQuickChat(f.owner.account.accountId, quick.room.roomId, 'free text'),
        error => error.code === 'INVALID_CHAT_PHRASE',
    );
    await assert.rejects(
        () => f.majalis.sendQuickChat(f.owner.account.accountId, quick.room.roomId, 'kafo'),
        error => error.code === 'CHAT_COOLDOWN',
    );
    const report = await f.majalis.submitReport(
        f.owner.account.accountId, quick.room.roomId, quick.seats[1].seatId, 'harassment',
    );
    assert.equal(report.reportStatus, 'open');
    await assert.rejects(
        () => f.majalis.submitReport(
            f.owner.account.accountId, quick.room.roomId, quick.seats[1].seatId, 'harassment',
        ),
        error => error.code === 'REPORT_ALREADY_SUBMITTED',
    );
    await assert.rejects(
        () => f.majalis.submitReport(
            f.owner.account.accountId, f.source.room.roomId, f.source.seats[1].seatId, 'spam',
        ),
        error => error.code === 'PUBLIC_ROOM_REQUIRED',
    );
    await f.majalis.recordCompletedMatch(f.source.room.roomId);
    f.advance(31 * 24 * 60 * 60 * 1000);
    await f.store.prune(f.now());
    const retained = await f.store.snapshotCounts();
    assert.equal(retained.majlisSessions, 1);
    assert.equal(f.store.majlisSessions[0].roomId, null);
    assert.equal(retained.moderationReports, 1);
    assert.equal((await f.store.listModerationReports())[0].roomId, null);
});
