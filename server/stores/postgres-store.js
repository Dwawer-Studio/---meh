'use strict';

const crypto = require('node:crypto');
const { StoreConflict } = require('./memory-store');

const BACKUP_TABLES = [
    'accounts', 'account_sessions', 'majalis', 'majlis_memberships', 'rooms', 'seats', 'request_idempotency',
    'match_actions', 'audit_log', 'deletion_tombstones',
];

class PostgresStore {
    constructor(pool) {
        this.pool = pool;
    }

    async createAccount(account) {
        try {
            await this.pool.query(
                `INSERT INTO accounts (account_id, account_kind, display_name, credential_hash, settings, created_at)
                 VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
                [account.accountId, account.accountKind, account.displayName, account.credentialHash || null,
                    JSON.stringify(account.settings || {}), account.createdAt],
            );
            return account;
        } catch (error) {
            if (error.code === '23505') throw new StoreConflict('ACCOUNT_EXISTS');
            throw error;
        }
    }

    async getAccount(accountId) {
        const result = await this.pool.query(
            `SELECT account_id AS "accountId", account_kind AS "accountKind", display_name AS "displayName",
                    credential_hash AS "credentialHash", settings, sync_revision AS "syncRevision",
                    created_at AS "createdAt",
                    upgraded_at AS "upgradedAt", deleted_at AS "deletedAt"
             FROM accounts WHERE account_id = $1 AND deleted_at IS NULL`,
            [accountId],
        );
        return result.rows[0] || null;
    }

    async upgradeAccount(accountId, fields) {
        const result = await this.pool.query(
            `UPDATE accounts SET account_kind = 'registered', credential_hash = $2,
                    display_name = $3, upgraded_at = $4, sync_revision=sync_revision+1
             WHERE account_id = $1 AND account_kind = 'guest' AND deleted_at IS NULL
             RETURNING account_id AS "accountId", account_kind AS "accountKind",
                       display_name AS "displayName", settings, sync_revision AS "syncRevision",
                       upgraded_at AS "upgradedAt"`,
            [accountId, fields.credentialHash, fields.displayName, fields.upgradedAt],
        );
        if (!result.rows.length) throw new StoreConflict('ACCOUNT_NOT_FOUND_OR_UPGRADED');
        return result.rows[0];
    }

    async updateAccountSettings(accountId, settings) {
        const result = await this.pool.query(
            `UPDATE accounts SET settings=$2::jsonb, sync_revision=sync_revision+1
             WHERE account_id=$1 AND deleted_at IS NULL
             RETURNING account_id AS "accountId", account_kind AS "accountKind",
                       display_name AS "displayName", settings, sync_revision AS "syncRevision"`,
            [accountId, JSON.stringify(settings)],
        );
        if (!result.rows.length) throw new StoreConflict('ACCOUNT_NOT_FOUND');
        return result.rows[0];
    }

    async createMajlis(majlis, memberships) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO majalis (majlis_id, display_name, revision, created_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5)`,
                [majlis.majlisId, majlis.displayName, majlis.revision, majlis.createdAt, majlis.updatedAt],
            );
            for (const membership of memberships) {
                await client.query(
                    `INSERT INTO majlis_memberships (majlis_id, account_id, member_role,
                        membership_status, consented_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
                    [majlis.majlisId, membership.accountId, membership.memberRole,
                        membership.membershipStatus, membership.consentedAt, membership.updatedAt],
                );
            }
            await client.query('COMMIT');
            return majlis;
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505') throw new StoreConflict('MAJLIS_EXISTS');
            throw error;
        } finally {
            client.release();
        }
    }

    async listAccountMajalis(accountId) {
        const result = await this.pool.query(
            `SELECT m.majlis_id AS "majlisId", m.display_name AS "displayName",
                    m.revision, mm.member_role AS "memberRole", mm.consented_at AS "consentedAt",
                    mm.updated_at AS "updatedAt"
             FROM majlis_memberships mm JOIN majalis m ON m.majlis_id=mm.majlis_id
             WHERE mm.account_id=$1 AND mm.membership_status='active'
             ORDER BY mm.updated_at DESC`,
            [accountId],
        );
        return result.rows.map(row => ({ ...row, revision: Number(row.revision) }));
    }

    async createSession(session) {
        await this.pool.query(
            `INSERT INTO account_sessions (session_id, account_id, token_hash, expires_at, created_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [session.sessionId, session.accountId, session.tokenHash, session.expiresAt, session.createdAt],
        );
        return session;
    }

    async authenticateSession(tokenHash, nowMs) {
        const result = await this.pool.query(
            `SELECT s.session_id AS "sessionId", s.account_id AS "accountId", s.expires_at AS "expiresAt",
                    a.account_kind AS "accountKind", a.display_name AS "displayName", a.settings,
                    a.sync_revision AS "syncRevision"
             FROM account_sessions s JOIN accounts a ON a.account_id = s.account_id
             WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2
                   AND a.deleted_at IS NULL`,
            [tokenHash, new Date(nowMs).toISOString()],
        );
        if (!result.rows.length) return null;
        const row = result.rows[0];
        return {
            session: { sessionId: row.sessionId, accountId: row.accountId, expiresAt: row.expiresAt },
            account: {
                accountId: row.accountId,
                accountKind: row.accountKind,
                displayName: row.displayName,
                settings: row.settings,
                syncRevision: Number(row.syncRevision),
            },
        };
    }

    async revokeSession(sessionId, nowIso) {
        await this.pool.query('UPDATE account_sessions SET revoked_at = $2 WHERE session_id = $1', [sessionId, nowIso]);
    }

    async createRoom(room, seats) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO rooms (room_id, room_code, mode, phase, rules_version, catalog_version,
                    deck_recipe_id, match_id, match_state, state_version, server_seq, created_at, last_activity_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)`,
                [room.roomId, room.roomCode, room.mode, room.phase, room.rulesVersion, room.catalogVersion,
                    room.deckRecipeId, room.matchId || null, JSON.stringify(room.matchState || null), room.stateVersion,
                    room.serverSeq, room.createdAt, room.lastActivityAt],
            );
            for (const seat of seats) await this._insertSeat(client, room.roomId, seat);
            await client.query('COMMIT');
            return { room, seats };
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505') throw new StoreConflict('ROOM_OR_CODE_EXISTS');
            throw error;
        } finally {
            client.release();
        }
    }

    async _insertSeat(client, roomId, seat) {
        await client.query(
            `INSERT INTO seats (room_id, seat_id, seat_index, account_id, display_name, is_bot, status, ready,
                lease_token_hash, lease_expires_at, connection_session_id, last_client_seq)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [roomId, seat.seatId, seat.seatIndex, seat.accountId || null, seat.displayName, seat.isBot,
                seat.status, seat.ready === true, seat.leaseTokenHash || null, seat.leaseExpiresAt || null,
                seat.connectionSessionId || null, seat.lastClientSeq || 0],
        );
    }

    async getRoom(roomId) {
        const roomResult = await this.pool.query('SELECT * FROM rooms WHERE room_id = $1', [roomId]);
        if (!roomResult.rows.length) return null;
        return { room: this._room(roomResult.rows[0]), seats: await this._seats(roomId) };
    }

    async findRoomByCode(roomCode) {
        const result = await this.pool.query(
            'SELECT room_id FROM rooms WHERE room_code = $1 AND closed_at IS NULL',
            [roomCode],
        );
        return result.rows.length ? this.getRoom(result.rows[0].room_id) : null;
    }

    async _seats(roomId) {
        const result = await this.pool.query('SELECT * FROM seats WHERE room_id = $1 ORDER BY seat_index', [roomId]);
        return result.rows.map(this._seat);
    }

    _room(row) {
        return {
            roomId: row.room_id, roomCode: row.room_code, mode: row.mode, phase: row.phase,
            rulesVersion: row.rules_version, catalogVersion: row.catalog_version,
            deckRecipeId: row.deck_recipe_id, matchId: row.match_id, matchState: row.match_state,
            stateVersion: Number(row.state_version), serverSeq: Number(row.server_seq),
            createdAt: row.created_at, lastActivityAt: row.last_activity_at, closedAt: row.closed_at,
        };
    }

    _seat(row) {
        return {
            seatId: row.seat_id, seatIndex: row.seat_index, accountId: row.account_id,
            displayName: row.display_name, isBot: row.is_bot, status: row.status, ready: row.ready,
            leaseTokenHash: row.lease_token_hash, leaseExpiresAt: row.lease_expires_at,
            connectionSessionId: row.connection_session_id, lastClientSeq: Number(row.last_client_seq),
        };
    }

    async updateRoomAndSeats(room, seats) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `UPDATE rooms SET phase=$2, match_id=$3, match_state=$4::jsonb, state_version=$5,
                    server_seq=$6, last_activity_at=$7, closed_at=$8 WHERE room_id=$1`,
                [room.roomId, room.phase, room.matchId || null, JSON.stringify(room.matchState || null),
                    room.stateVersion, room.serverSeq, room.lastActivityAt, room.closedAt || null],
            );
            await client.query('DELETE FROM seats WHERE room_id = $1', [room.roomId]);
            for (const seat of seats) await this._insertSeat(client, room.roomId, seat);
            await client.query('COMMIT');
            return { room, seats };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async getIdempotent(roomId, requestId, accountId) {
        const result = await this.pool.query(
            `SELECT response FROM request_idempotency
             WHERE room_id=$1 AND request_id=$2 AND account_id IS NOT DISTINCT FROM $3`,
            [roomId, requestId, accountId || null],
        );
        return result.rows[0] || null;
    }

    async commitMatchAction(input) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const roomResult = await client.query('SELECT * FROM rooms WHERE room_id=$1 FOR UPDATE', [input.roomId]);
            if (!roomResult.rows.length) throw new StoreConflict('ROOM_NOT_FOUND');
            const room = roomResult.rows[0];
            const seatResult = await client.query(
                `SELECT * FROM seats WHERE room_id=$1 AND connection_session_id=$2 AND status='CONNECTED' FOR UPDATE`,
                [input.roomId, input.connectionSessionId],
            );
            if (!seatResult.rows.length) throw new StoreConflict('SEAT_NOT_CONNECTED');
            const seat = seatResult.rows[0];
            const duplicate = await client.query(
                `SELECT response FROM request_idempotency
                 WHERE room_id=$1 AND request_id=$2 AND seat_id=$3`,
                [input.roomId, input.requestId, seat.seat_id],
            );
            if (duplicate.rows.length) {
                await client.query('COMMIT');
                return { duplicate: true, response: duplicate.rows[0].response };
            }
            if (Number(room.state_version) !== input.expectedStateVersion) throw new StoreConflict('STATE_CONFLICT');
            if (input.clientSeq <= Number(seat.last_client_seq)) throw new StoreConflict('BAD_SEQUENCE');
            const serverSeq = Number(room.server_seq) + 1;
            const response = { ...input.ackBase, serverSeq };
            await client.query(
                `UPDATE rooms SET match_state=$2::jsonb, state_version=$3, server_seq=$4,
                    phase=$5, last_activity_at=$6 WHERE room_id=$1`,
                [input.roomId, JSON.stringify(input.nextState), input.nextState.stateVersion, serverSeq,
                    input.nextState.phase === 'COMPLETE' ? 'RESULTS' : room.phase, input.nowIso],
            );
            await client.query(
                'UPDATE seats SET last_client_seq=$3 WHERE room_id=$1 AND seat_id=$2',
                [input.roomId, seat.seat_id, input.clientSeq],
            );
            await client.query(
                `INSERT INTO match_actions (room_id, match_id, action_sequence, account_id, request_id,
                    action, result_fingerprint, created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
                [input.roomId, room.match_id, input.nextState.actionCount, seat.account_id, input.requestId,
                    JSON.stringify(input.action), input.resultFingerprint, input.nowIso],
            );
            await client.query(
                `INSERT INTO request_idempotency (room_id, seat_id, account_id, connection_session_id,
                    request_id, client_seq, response, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
                [input.roomId, seat.seat_id, seat.account_id, input.connectionSessionId,
                    input.requestId, input.clientSeq, JSON.stringify(response), input.nowIso],
            );
            await client.query('COMMIT');
            return { duplicate: false, response };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async commitSystemMatchAction(input) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query('SELECT * FROM rooms WHERE room_id=$1 FOR UPDATE', [input.roomId]);
            if (!result.rows.length) throw new StoreConflict('ROOM_NOT_FOUND');
            const room = result.rows[0];
            if (Number(room.state_version) !== input.expectedStateVersion) throw new StoreConflict('STATE_CONFLICT');
            const serverSeq = Number(room.server_seq) + 1;
            await client.query(
                `UPDATE rooms SET match_state=$2::jsonb, state_version=$3, server_seq=$4,
                    phase=$5, last_activity_at=$6 WHERE room_id=$1`,
                [input.roomId, JSON.stringify(input.nextState), input.nextState.stateVersion, serverSeq,
                    input.nextState.phase === 'COMPLETE' ? 'RESULTS' : room.phase, input.nowIso],
            );
            await client.query(
                `INSERT INTO match_actions (room_id, match_id, action_sequence, account_id, request_id,
                    action, result_fingerprint, created_at) VALUES ($1,$2,$3,NULL,$4,$5::jsonb,$6,$7)`,
                [input.roomId, room.match_id, input.nextState.actionCount, input.requestId,
                    JSON.stringify(input.action), input.resultFingerprint, input.nowIso],
            );
            await client.query('COMMIT');
            return { serverSeq };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async appendAudit(entry) {
        await this.pool.query(
            `INSERT INTO audit_log (event_type, account_id, room_id, ip_hash, metadata, created_at)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
            [entry.eventType, entry.accountId || null, entry.roomId || null, entry.ipHash || null,
                JSON.stringify(entry.metadata || {}), entry.createdAt],
        );
    }

    async deleteAccount(accountId, tombstone, nowIso) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('UPDATE seats SET account_id=NULL WHERE account_id=$1', [accountId]);
            await client.query('UPDATE match_actions SET account_id=NULL WHERE account_id=$1', [accountId]);
            await client.query('UPDATE audit_log SET account_id=NULL WHERE account_id=$1', [accountId]);
            await client.query('DELETE FROM accounts WHERE account_id=$1', [accountId]);
            await client.query(
                `INSERT INTO deletion_tombstones (subject_hash, deleted_at, expires_at) VALUES ($1,$2,$3)
                 ON CONFLICT (subject_hash) DO UPDATE SET deleted_at=$2, expires_at=$3`,
                [tombstone.subjectHash, nowIso, tombstone.expiresAt],
            );
            await client.query('COMMIT');
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async exportLogicalBackup(nowIso) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
            const tables = {};
            for (const table of BACKUP_TABLES) {
                const result = await client.query(`SELECT * FROM ${table}`);
                tables[table] = result.rows;
            }
            await client.query('COMMIT');
            const payload = { formatVersion: 1, createdAt: nowIso, tables };
            return {
                payload,
                checksum: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async restoreLogicalBackup(backup) {
        const serialized = JSON.stringify(backup && backup.payload);
        const checksum = crypto.createHash('sha256').update(serialized).digest('hex');
        if (!backup || backup.checksum !== checksum || backup.payload.formatVersion !== 1) {
            throw new StoreConflict('INVALID_BACKUP');
        }
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const occupied = await client.query(
                `SELECT (SELECT count(*) FROM accounts) + (SELECT count(*) FROM majalis)
                    + (SELECT count(*) FROM rooms)
                    + (SELECT count(*) FROM deletion_tombstones) AS count`,
            );
            if (Number(occupied.rows[0].count) > 0) throw new StoreConflict('TARGET_NOT_EMPTY');
            for (const table of BACKUP_TABLES) {
                const rows = backup.payload.tables[table];
                if (!Array.isArray(rows)) throw new StoreConflict('INVALID_BACKUP');
                if (rows.length) {
                    await client.query(
                        `INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table}, $1::json)`,
                        [JSON.stringify(rows)],
                    );
                }
            }
            await client.query(
                `SELECT setval(pg_get_serial_sequence('audit_log','audit_id'),
                    COALESCE((SELECT max(audit_id) FROM audit_log), 1),
                    EXISTS(SELECT 1 FROM audit_log))`,
            );
            await client.query('COMMIT');
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async prune(nowMs) {
        const nowIso = new Date(nowMs).toISOString();
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `DELETE FROM request_idempotency
                 WHERE created_at < $1::timestamptz - interval '24 hours'`, [nowIso]);
            await client.query(
                `DELETE FROM account_sessions WHERE expires_at <= $1
                 OR (revoked_at IS NOT NULL AND revoked_at < $1::timestamptz - interval '24 hours')`, [nowIso]);
            await client.query(
                `DELETE FROM match_actions WHERE created_at < $1::timestamptz - interval '30 days'`, [nowIso]);
            await client.query(
                `DELETE FROM audit_log WHERE created_at < $1::timestamptz - interval '30 days'`, [nowIso]);
            await client.query(
                `DELETE FROM rooms WHERE last_activity_at < $1::timestamptz - interval '30 days'`, [nowIso]);
            await client.query(
                `DELETE FROM majalis m WHERE m.updated_at < $1::timestamptz - interval '30 days'
                 AND NOT EXISTS (SELECT 1 FROM majlis_memberships mm WHERE mm.majlis_id=m.majlis_id)`, [nowIso]);
            await client.query('DELETE FROM deletion_tombstones WHERE expires_at <= $1', [nowIso]);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = { PostgresStore };
