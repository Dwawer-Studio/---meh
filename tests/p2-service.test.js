'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AccountService } = require('../server/account-service');
const { BackupService } = require('../server/backup-service');
const { planBotAction } = require('../server/bot-policy');
const { RoomService } = require('../server/room-service');
const { MemoryStore } = require('../server/stores/memory-store');
const { MatchReducer } = require('../shared/match-reducer');

const PEPPER = 'test-pepper-that-is-long-and-never-production';

test('guest upgrade, settings and majlis sync, actual deletion, and secret hashing', async () => {
    let now = Date.parse('2026-08-28T00:00:00Z');
    const store = new MemoryStore();
    const accounts = new AccountService(store, { pepper: PEPPER, now: () => now });
    const created = await accounts.createGuest('لاعب اختبار');
    assert.equal(created.account.accountKind, 'guest');
    assert.equal(JSON.stringify([...store.sessions.values()]).includes(created.accessToken), false);
    const authenticated = await accounts.authenticate(created.accessToken);
    assert.equal(authenticated.account.accountId, created.account.accountId);

    const synced = await accounts.updateSettings(created.account.accountId, { lang: 'en', sound: false });
    assert.deepEqual(synced.settings, { lang: 'en', sound: false });
    assert.equal(synced.syncRevision, 1);
    const consentedAt = new Date(now).toISOString();
    await store.createMajlis({
        majlisId: 'majlis_test_000001', displayName: 'مجلس الاختبار', revision: 1,
        createdAt: consentedAt, updatedAt: consentedAt,
    }, [{
        accountId: created.account.accountId, memberRole: 'owner', membershipStatus: 'active',
        consentedAt, updatedAt: consentedAt,
    }]);
    const syncState = await accounts.syncState(created.account.accountId);
    assert.deepEqual(syncState.account.settings, { lang: 'en', sound: false });
    assert.equal(syncState.majalis.length, 1);
    assert.equal(syncState.majalis[0].majlisId, 'majlis_test_000001');
    assert.equal(syncState.majalis[0].memberRole, 'owner');
    const upgraded = await accounts.upgrade(created.account.accountId, 'a-long-test-credential', 'Player');
    assert.equal(upgraded.accountKind, 'registered');
    assert.equal(upgraded.syncRevision, 2);
    const stored = await store.getAccount(created.account.accountId);
    assert.match(stored.credentialHash, /^scrypt\$/);
    assert.equal(stored.credentialHash.includes('a-long-test-credential'), false);
    await assert.rejects(
        () => accounts.login(created.account.accountId, 'wrong-test-credential'),
        error => error.message === 'INVALID_CREDENTIALS',
    );
    await assert.rejects(
        () => accounts.login('acct_0000000000000000', 'wrong-test-credential'),
        error => error.message === 'INVALID_CREDENTIALS',
    );
    const loggedIn = await accounts.login(created.account.accountId, 'a-long-test-credential');
    assert.equal(loggedIn.account.accountId, created.account.accountId);
    assert.equal((await accounts.authenticate(loggedIn.accessToken)).account.accountKind, 'registered');

    now += 1_000;
    assert.equal(await accounts.deleteAccount(created.account.accountId), true);
    assert.equal(await accounts.authenticate(created.accessToken), null);
    const counts = await store.snapshotCounts();
    assert.equal(counts.accounts, 0);
    assert.equal(counts.sessions, 0);
    assert.equal(counts.majlisMemberships, 0);
    assert.equal(counts.majalis, 1);
    assert.equal(counts.tombstones, 1);
});

test('encrypted logical backup restores exactly and rejects tampering', async () => {
    const source = new MemoryStore();
    const accounts = new AccountService(source, { pepper: PEPPER, now: () => 1_777_000_000_000 });
    await accounts.createGuest('Backup Player');
    const backupService = new BackupService(source, { now: () => 1_777_000_001_000 });
    const encrypted = await backupService.createEncrypted('backup-passphrase-with-more-than-24-chars');
    assert.equal(encrypted.includes(Buffer.from('Backup Player')), false);

    const target = new MemoryStore();
    const restore = new BackupService(target);
    assert.equal(await restore.restoreEncrypted(encrypted, 'backup-passphrase-with-more-than-24-chars'), true);
    assert.deepEqual(await target.snapshotCounts(), await source.snapshotCounts());

    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 8] ^= 1;
    await assert.rejects(() => new BackupService(new MemoryStore()).restoreEncrypted(
        tampered, 'backup-passphrase-with-more-than-24-chars'));
});

test('retention pruning removes expired sessions and 30-day room data', async () => {
    let now = Date.parse('2026-01-01T00:00:00Z');
    const store = new MemoryStore();
    const accounts = new AccountService(store, { pepper: PEPPER, now: () => now });
    const rooms = new RoomService(store, { pepper: PEPPER, now: () => now });
    const guest = await accounts.createGuest('Retention Player');
    const created = await rooms.createRoom(guest.account, 'retention_conn_0001', { mode: 'quick', clientSeq: 2 });
    const current = await store.getRoom(created.room.roomId);
    const action = planBotAction(current.room.matchState, MatchReducer, { force: true });
    await rooms.applyMatchAction(created.room.roomId, 'retention_conn_0001', {
        requestId: 'retention_request_0001', clientSeq: 3,
        payload: { action: action.type, turnId: action.turnId, cardId: action.cardId, decision: action.decision },
    });
    assert.ok((await store.snapshotCounts()).actions > 0);
    now += 31 * 24 * 60 * 60 * 1000;
    await store.prune(now);
    const counts = await store.snapshotCounts();
    assert.equal(counts.sessions, 0);
    assert.equal(counts.rooms, 0);
    assert.equal(counts.seats, 0);
    assert.equal(counts.actions, 0);
    assert.equal(store.audit.length, 0);
});

test('room authority provides immediate quick play, idempotency, recovery rotation, and bot takeover', async () => {
    let now = Date.parse('2026-08-28T00:00:00Z');
    const store = new MemoryStore();
    const accounts = new AccountService(store, { pepper: PEPPER, now: () => now });
    const rooms = new RoomService(store, { pepper: PEPPER, now: () => now, seatLeaseMs: 30_000 });
    const guest = await accounts.createGuest('Quick Player');
    const created = await rooms.createRoom(guest.account, 'conn_0000000000000001', { mode: 'quick', clientSeq: 2 });
    assert.equal(created.room.phase, 'IN_MATCH');
    assert.equal(created.seats.filter(seat => seat.isBot).length, 3);

    const current = await store.getRoom(created.room.roomId);
    const planned = planBotAction(current.room.matchState, MatchReducer, { force: true });
    const envelope = {
        requestId: 'request_000000000001', clientSeq: 3,
        payload: { action: planned.type, turnId: planned.turnId, cardId: planned.cardId, decision: planned.decision },
    };
    const committed = await rooms.applyMatchAction(created.room.roomId, 'conn_0000000000000001', envelope);
    assert.equal(committed.duplicate, false);
    const duplicate = await rooms.applyMatchAction(created.room.roomId, 'conn_0000000000000001', envelope);
    assert.equal(duplicate.duplicate, true);
    assert.deepEqual(duplicate.response, committed.response);

    await assert.rejects(
        () => rooms.applyMatchAction(created.room.roomId, 'conn_0000000000000001', {
            requestId: 'request_000000000002', clientSeq: 4,
            payload: { action: 'timeout', turnId: current.room.matchState.turnId },
        }),
        error => error.code === 'UNKNOWN_ACTION',
    );

    await rooms.disconnect(created.room.roomId, 'conn_0000000000000001');
    now += 5_000;
    const resumed = await rooms.resume(created.room.roomCode, created.recoveryToken, guest.account,
        'conn_0000000000000002', 2);
    assert.notEqual(resumed.recoveryToken, created.recoveryToken);
    const duplicateAfterResume = await rooms.applyMatchAction(
        created.room.roomId,
        'conn_0000000000000002',
        envelope,
    );
    assert.equal(duplicateAfterResume.duplicate, true);
    assert.deepEqual(duplicateAfterResume.response, committed.response);
    await rooms.disconnect(created.room.roomId, 'conn_0000000000000002');
    await assert.rejects(
        () => rooms.resume(created.room.roomCode, created.recoveryToken, guest.account,
            'conn_0000000000000003', 2),
        error => error.code === 'RECOVERY_DENIED',
    );
    now += 31_000;
    assert.equal(await rooms.expireRoomLeases(created.room.roomId), 1);
    const expired = await store.getRoom(created.room.roomId);
    assert.equal(expired.seats[0].isBot, true);
    assert.equal(expired.seats[0].leaseTokenHash, null);
});

test('private table starts only after every connected human is ready', async () => {
    const store = new MemoryStore();
    const accounts = new AccountService(store, { pepper: PEPPER });
    const rooms = new RoomService(store, { pepper: PEPPER });
    const host = await accounts.createGuest('Host');
    const guests = await Promise.all(['Guest 1', 'Guest 2', 'Guest 3', 'Guest 4']
        .map(name => accounts.createGuest(name)));
    const created = await rooms.createRoom(host.account, 'conn_host_00000001', { clientSeq: 2 });
    for (let index = 0; index < 3; index++) {
        await rooms.joinRoom(created.room.roomCode, guests[index].account,
            `conn_guest_000000${index + 1}`, 2);
    }
    await assert.rejects(
        () => rooms.joinRoom(created.room.roomCode, guests[3].account, 'conn_guest_0000004', 2),
        error => error.code === 'ROOM_FULL',
    );
    await rooms.ready(created.room.roomId, 'conn_host_00000001', true, 3);
    assert.equal((await store.getRoom(created.room.roomId)).room.phase, 'FORMING');
    await rooms.ready(created.room.roomId, 'conn_guest_0000001', true, 3);
    await rooms.ready(created.room.roomId, 'conn_guest_0000002', true, 3);
    assert.equal((await store.getRoom(created.room.roomId)).room.phase, 'FORMING');
    await rooms.ready(created.room.roomId, 'conn_guest_0000003', true, 3);
    assert.equal((await store.getRoom(created.room.roomId)).room.phase, 'IN_MATCH');
});
