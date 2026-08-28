'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { AccountService } = require('../server/account-service');
const { BackupService } = require('../server/backup-service');
const { runMigrations } = require('../server/migration-runner');
const { RoomService } = require('../server/room-service');
const { PostgresStore } = require('../server/stores/postgres-store');

class PGlitePool {
    constructor(database) {
        this.database = database;
    }

    query(text, values) {
        return this._query(this.database, text, values);
    }

    async connect() {
        return { query: (text, values) => this._query(this.database, text, values), release() {} };
    }

    _query(database, text, values) {
        const statements = text.split(';').filter(statement => statement.trim()).length;
        return values === undefined && statements > 1
            ? database.exec(text).then(results => results.at(-1) || { rows: [] })
            : database.query(text, values);
    }
}

test('PostgreSQL idempotency returns a committed duplicate before stale-state rejection', async () => {
    const calls = [];
    const client = {
        async query(text) {
            calls.push(text);
            if (text.startsWith('SELECT * FROM rooms')) return { rows: [{ state_version: 9 }] };
            if (text.startsWith('SELECT * FROM seats')) return { rows: [{ seat_id: 'seat_1' }] };
            if (text.includes('SELECT response FROM request_idempotency')) {
                return { rows: [{ response: { type: 'match.ack', serverSeq: 9 } }] };
            }
            return { rows: [] };
        },
        release() {},
    };
    const store = new PostgresStore({ connect: async () => client });
    const result = await store.commitMatchAction({
        roomId: 'room_1', connectionSessionId: 'conn_1', requestId: 'request_1',
        expectedStateVersion: 8,
    });
    assert.equal(result.duplicate, true);
    assert.equal(result.response.serverSeq, 9);
    assert.ok(calls.includes('COMMIT'));
    assert.equal(calls.some(text => text.startsWith('UPDATE rooms')), false);
});

test('PostgreSQL adapter applies migrations, commits a room, deletes identity, and restores backup',
    { timeout: 30_000 }, async () => {
        const sourceDb = new PGlite();
        const targetDb = new PGlite();
        await Promise.all([sourceDb.waitReady, targetDb.waitReady]);
        try {
            const sourcePool = new PGlitePool(sourceDb);
            await runMigrations(sourcePool);
            await runMigrations(sourcePool);
            const sourceStore = new PostgresStore(sourcePool);
            const accounts = new AccountService(sourceStore, {
                pepper: 'postgres-test-pepper-at-least-32-characters',
            });
            const guest = await accounts.createGuest('Postgres Player');
            await accounts.updateSettings(guest.account.accountId, { lang: 'ar', haptics: false });
            const consentedAt = new Date().toISOString();
            await sourceStore.createMajlis({
                majlisId: 'majlis_postgres_0001', displayName: 'Postgres Majlis', revision: 1,
                createdAt: consentedAt, updatedAt: consentedAt,
            }, [{
                accountId: guest.account.accountId, memberRole: 'owner', membershipStatus: 'active',
                consentedAt, updatedAt: consentedAt,
            }]);
            const syncState = await accounts.syncState(guest.account.accountId);
            assert.equal(syncState.account.syncRevision, 1);
            assert.equal(syncState.majalis[0].majlisId, 'majlis_postgres_0001');
            const rooms = new RoomService(sourceStore, {
                pepper: 'postgres-test-pepper-at-least-32-characters',
            });
            const created = await rooms.createRoom(guest.account, 'postgres_conn_000001', {
                mode: 'quick', clientSeq: 2,
            });
            assert.equal(created.room.phase, 'IN_MATCH');
            const storedRoom = await sourceStore.getRoom(created.room.roomId);
            assert.equal(storedRoom.seats.length, 4);
            assert.equal(storedRoom.room.matchState.players.length, 4);

            const passphrase = 'postgres-backup-passphrase-with-32-characters';
            const encrypted = await new BackupService(sourceStore).createEncrypted(passphrase);
            const targetPool = new PGlitePool(targetDb);
            await runMigrations(targetPool);
            const targetStore = new PostgresStore(targetPool);
            await new BackupService(targetStore).restoreEncrypted(encrypted, passphrase);
            const restored = await targetStore.getRoom(created.room.roomId);
            assert.equal(restored.room.matchId, storedRoom.room.matchId);
            assert.equal(restored.seats.length, 4);
            assert.equal((await targetDb.query('SELECT count(*)::int AS count FROM accounts')).rows[0].count, 1);
            assert.equal((await targetDb.query(
                'SELECT count(*)::int AS count FROM majlis_memberships')).rows[0].count, 1);

            await accounts.deleteAccount(guest.account.accountId);
            assert.equal((await sourceDb.query('SELECT count(*)::int AS count FROM accounts')).rows[0].count, 0);
            assert.equal((await sourceDb.query('SELECT count(*)::int AS count FROM account_sessions')).rows[0].count, 0);
            assert.equal((await sourceDb.query(
                'SELECT count(*)::int AS count FROM majlis_memberships')).rows[0].count, 0);
            assert.equal((await sourceDb.query('SELECT count(*)::int AS count FROM deletion_tombstones')).rows[0].count, 1);
            assert.equal((await sourceDb.query(
                'SELECT count(*)::int AS count FROM seats WHERE account_id IS NOT NULL')).rows[0].count, 0);
            await sourceStore.prune(Date.now() + 31 * 24 * 60 * 60 * 1000);
            assert.equal((await sourceDb.query('SELECT count(*)::int AS count FROM rooms')).rows[0].count, 0);
            assert.equal((await sourceDb.query('SELECT count(*)::int AS count FROM majalis')).rows[0].count, 0);
            assert.equal((await sourceDb.query('SELECT count(*)::int AS count FROM audit_log')).rows[0].count, 0);
            assert.equal((await sourceDb.query(
                'SELECT count(*)::int AS count FROM deletion_tombstones')).rows[0].count, 1);
        } finally {
            await Promise.all([sourceDb.close(), targetDb.close()]);
        }
    });
