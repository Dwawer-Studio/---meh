'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { AccountService } = require('../server/account-service');
const { BackupService } = require('../server/backup-service');
const { MajlisService } = require('../server/majlis-service');
const { runMigrations } = require('../server/migration-runner');
const { RoomService } = require('../server/room-service');
const { PostgresStore } = require('../server/stores/postgres-store');

class PGlitePool {
    constructor(database) { this.database = database; }
    query(text, values) { return this._query(this.database, text, values); }
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

test('P3 PostgreSQL persists consent, duplicate display names, reminders, and circular backup links',
    { timeout: 30_000 }, async () => {
        let now = Date.parse('2026-08-28T10:00:00.000Z');
        const sourceDb = new PGlite();
        const targetDb = new PGlite();
        await Promise.all([sourceDb.waitReady, targetDb.waitReady]);
        try {
            const sourcePool = new PGlitePool(sourceDb);
            await runMigrations(sourcePool);
            const sourceStore = new PostgresStore(sourcePool);
            const accounts = new AccountService(sourceStore, {
                pepper: 'p3-postgres-pepper-that-is-long-enough', now: () => now,
            });
            const owner = await accounts.createGuest('Same Name');
            const member = await accounts.createGuest('Same Name');
            const roomId = 'room_p3_postgres_0001';
            const matchId = 'match_p3_postgres_001';
            const nowIso = new Date(now).toISOString();
            const seats = [owner.account, member.account].map((account, seatIndex) => ({
                seatId: `seat_p3_pg_${seatIndex}_000001`, seatIndex, accountId: account.accountId,
                displayName: account.displayName, isBot: false, status: 'CONNECTED', ready: false,
                leaseTokenHash: null, leaseExpiresAt: null,
                connectionSessionId: `conn_p3_pg_${seatIndex}_000001`, lastClientSeq: 1,
            }));
            for (let seatIndex = 2; seatIndex < 4; seatIndex++) {
                seats.push({
                    seatId: `seat_p3_pg_${seatIndex}_000001`, seatIndex, accountId: null,
                    displayName: `Bot ${seatIndex}`, isBot: true, status: 'BOT', ready: true,
                    leaseTokenHash: null, leaseExpiresAt: null, connectionSessionId: null, lastClientSeq: 0,
                });
            }
            await sourceStore.createRoom({
                roomId, roomCode: 'P3PG1', mode: 'quick', phase: 'RESULTS',
                rulesVersion: '1.0.0', catalogVersion: '1.0.0', deckRecipeId: 'meh-core-60-v1',
                matchId, matchState: { phase: 'COMPLETE', winnerId: seats[0].seatId },
                stateVersion: 1, serverSeq: 1, createdAt: nowIso, lastActivityAt: nowIso,
            }, seats);
            const majalis = new MajlisService(sourceStore, { now: () => now });
            const created = await majalis.createFromRoom(owner.account, roomId, {
                displayName: 'Postgres Council', bannerId: 'falcon', tableThemeId: 'night',
            });
            await majalis.acceptFromSourceRoom(member.account, roomId, created.majlisId);
            await majalis.recordCompletedMatch(roomId);
            const detail = await majalis.detail(owner.account.accountId, created.majlisId);
            assert.equal(detail.members.length, 2);
            assert.equal(detail.recentSessions[0].players.length, 2);
            assert.equal((await sourceDb.query(
                'SELECT count(*)::int AS count FROM majlis_session_players')).rows[0].count, 2);
            const report = await majalis.submitReport(
                owner.account.accountId, roomId, seats[1].seatId, 'stalling',
            );
            assert.equal((await sourceStore.listModerationReports())[0].reportId, report.reportId);
            assert.equal((await sourceStore.updateModerationReport(
                report.reportId, 'reviewing', new Date(now + 1_000).toISOString())).reportStatus, 'reviewing');

            const invitation = await majalis.schedule(owner.account.accountId, created.majlisId,
                new Date(now + 20 * 60 * 1000).toISOString());
            await majalis.setReminder(owner.account.accountId, invitation.invitationId, true);
            now += 6 * 60 * 1000;
            assert.equal((await majalis.claimDueReminders(owner.account.accountId)).length, 1);
            assert.equal((await majalis.claimDueReminders(owner.account.accountId)).length, 0);

            const rooms = new RoomService(sourceStore, {
                pepper: 'p3-postgres-pepper-that-is-long-enough',
                now: () => now,
                authorizeMajlisMembership: (majlisId, accountId) => (
                    majalis.assertMembership(majlisId, accountId)
                ),
            });
            const regrouped = await rooms.createRoom(owner.account, 'conn_p3_pg_regroup_001', {
                majlisId: created.majlisId, clientSeq: 2,
            });
            const joined = await rooms.createRoom(member.account, 'conn_p3_pg_regroup_002', {
                majlisId: created.majlisId, clientSeq: 2,
            });
            assert.equal(joined.room.roomId, regrouped.room.roomId);
            assert.equal((await sourceStore.getRoom(regrouped.room.roomId))
                .seats.filter(seat => !seat.isBot).length, 2);
            await assert.rejects(
                () => sourceStore.createRoom({
                    ...regrouped.room,
                    roomId: 'room_p3_pg_duplicate_001', roomCode: 'DUPG3',
                }, seats),
                error => error.code === 'MAJLIS_ROOM_EXISTS',
            );

            const encrypted = await new BackupService(sourceStore).createEncrypted(
                'p3-postgres-backup-passphrase-32-characters',
            );
            const targetPool = new PGlitePool(targetDb);
            await runMigrations(targetPool);
            const targetStore = new PostgresStore(targetPool);
            await new BackupService(targetStore).restoreEncrypted(
                encrypted, 'p3-postgres-backup-passphrase-32-characters',
            );
            const restoredRoom = await targetStore.getRoom(roomId);
            assert.equal(restoredRoom.room.majlisId, created.majlisId);
            const restoredMajlis = await targetStore.getMajlisDefinition(created.majlisId);
            assert.equal(restoredMajlis.sourceRoomId, roomId);
            assert.equal((await targetStore.getMajlisForMember(
                created.majlisId, owner.account.accountId)).recentSessions.length, 1);
            assert.equal((await targetStore.listModerationReports())[0].reportStatus, 'reviewing');
            await sourceStore.prune(now + 31 * 24 * 60 * 60 * 1000);
            assert.equal((await sourceDb.query('SELECT count(*)::int AS count FROM rooms')).rows[0].count, 0);
            assert.equal((await sourceDb.query(
                'SELECT count(*)::int AS count FROM majlis_sessions')).rows[0].count, 1);
            assert.equal((await sourceDb.query(
                'SELECT count(*)::int AS count FROM moderation_reports')).rows[0].count, 1);
        } finally {
            await Promise.all([sourceDb.close(), targetDb.close()]);
        }
    });
