'use strict';

const crypto = require('node:crypto');
const { StoreConflict } = require('./memory-store');

const BACKUP_TABLES = [
    'accounts', 'account_sessions', 'majalis', 'majlis_memberships', 'majlis_invitations',
    'majlis_reminders', 'rooms', 'seats', 'request_idempotency', 'match_actions',
    'majlis_sessions', 'majlis_session_players', 'moderation_reports', 'audit_log',
    'tamashi_wallets', 'card_unlocks', 'verified_iap_receipts', 'match_reward_settlements',
    'tamashi_reward_cohorts', 'tamashi_reward_accounts', 'tamashi_ledger_entries',
    'deletion_tombstones',
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
                `INSERT INTO majalis (majlis_id, display_name, revision, created_at, updated_at,
                    owner_account_id, source_room_id, banner_id, table_theme_id, majlis_status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [majlis.majlisId, majlis.displayName, majlis.revision, majlis.createdAt, majlis.updatedAt,
                    majlis.ownerAccountId || null, majlis.sourceRoomId || null, majlis.bannerId || 'pearl',
                    majlis.tableThemeId || 'classic', majlis.majlisStatus || 'active'],
            );
            for (const membership of memberships) {
                await client.query(
                    `INSERT INTO majlis_memberships (majlis_id, account_id, member_role,
                        membership_status, consented_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
                    [majlis.majlisId, membership.accountId, membership.memberRole,
                        membership.membershipStatus, membership.consentedAt, membership.updatedAt],
                );
            }
            if (majlis.sourceRoomId) {
                const linked = await client.query(
                    `UPDATE rooms SET majlis_id=$1 WHERE room_id=$2 AND majlis_id IS NULL RETURNING room_id`,
                    [majlis.majlisId, majlis.sourceRoomId],
                );
                if (!linked.rows.length) throw new StoreConflict('SOURCE_ROOM_UNAVAILABLE');
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
            `SELECT m.majlis_id AS "majlisId"
             FROM majlis_memberships mm JOIN majalis m ON m.majlis_id=mm.majlis_id
             WHERE mm.account_id=$1 AND mm.membership_status='active' AND m.majlis_status='active'
             ORDER BY m.updated_at DESC LIMIT 8`,
            [accountId],
        );
        return Promise.all(result.rows.map(row => this.getMajlisForMember(row.majlisId, accountId)));
    }

    async findActiveMajlisRoom(majlisId, excludeRoomId = null) {
        const result = await this.pool.query(
            `SELECT room_id FROM rooms WHERE majlis_id=$1 AND closed_at IS NULL
                AND phase IN ('FORMING','IN_MATCH') AND ($2::text IS NULL OR room_id<>$2)
             ORDER BY last_activity_at DESC LIMIT 1`,
            [majlisId, excludeRoomId],
        );
        return result.rows.length ? this.getRoom(result.rows[0].room_id) : null;
    }

    async getMajlisDefinition(majlisId) {
        const result = await this.pool.query(
            `SELECT majlis_id AS "majlisId", display_name AS "displayName",
                    owner_account_id AS "ownerAccountId", source_room_id AS "sourceRoomId",
                    banner_id AS "bannerId", table_theme_id AS "tableThemeId",
                    majlis_status AS "majlisStatus", revision, created_at AS "createdAt",
                    updated_at AS "updatedAt"
             FROM majalis WHERE majlis_id=$1`, [majlisId]);
        return result.rows.length ? { ...result.rows[0], revision: Number(result.rows[0].revision) } : null;
    }

    async isMajlisMember(majlisId, accountId) {
        const result = await this.pool.query(
            `SELECT 1 FROM majlis_memberships mm JOIN majalis m ON m.majlis_id=mm.majlis_id
             WHERE mm.majlis_id=$1 AND mm.account_id=$2 AND mm.membership_status='active'
                   AND m.majlis_status='active'`, [majlisId, accountId]);
        return result.rows.length > 0;
    }

    async acceptMajlisMembership(majlisId, accountId, nowIso) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO majlis_memberships (majlis_id, account_id, member_role,
                    membership_status, consented_at, updated_at)
                 VALUES ($1,$2,'member','active',$3,$3)
                 ON CONFLICT (majlis_id, account_id) DO UPDATE SET membership_status='active', updated_at=$3`,
                [majlisId, accountId, nowIso]);
            await client.query(
                `UPDATE majalis SET revision=revision+1, updated_at=$2
                 WHERE majlis_id=$1 AND majlis_status='active'`, [majlisId, nowIso]);
            await client.query('COMMIT');
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async getMajlisForMember(majlisId, accountId) {
        const membership = await this.pool.query(
            `SELECT m.majlis_id AS "majlisId", m.display_name AS "displayName",
                    m.banner_id AS "bannerId", m.table_theme_id AS "tableThemeId",
                    m.revision, m.updated_at AS "updatedAt", mm.member_role AS "memberRole",
                    mm.consented_at AS "consentedAt"
             FROM majalis m JOIN majlis_memberships mm ON mm.majlis_id=m.majlis_id
             WHERE m.majlis_id=$1 AND mm.account_id=$2 AND mm.membership_status='active'
                   AND m.majlis_status='active'`, [majlisId, accountId]);
        if (!membership.rows.length) return null;
        const [members, scores, sessions, invitations, activeRoom] = await Promise.all([
            this.pool.query(
                `SELECT a.display_name AS "displayName", mm.member_role AS "memberRole"
                 FROM majlis_memberships mm JOIN accounts a ON a.account_id=mm.account_id
                 WHERE mm.majlis_id=$1 AND mm.membership_status='active'
                 ORDER BY mm.consented_at`, [majlisId]),
            this.pool.query(
                `SELECT p.display_name AS "displayName", count(*)::int AS matches,
                        count(*) FILTER (WHERE p.won)::int AS wins
                 FROM majlis_session_players p
                 JOIN majlis_sessions s ON s.majlis_session_id=p.majlis_session_id
                 WHERE s.majlis_id=$1
                 GROUP BY p.account_id, p.display_name
                 ORDER BY wins DESC, matches DESC, p.display_name`, [majlisId]),
            this.pool.query(
                `SELECT majlis_session_id AS "majlisSessionId", completed_at AS "completedAt"
                 FROM majlis_sessions WHERE majlis_id=$1 ORDER BY completed_at DESC LIMIT 10`, [majlisId]),
            this.pool.query(
                `SELECT i.invitation_id AS "invitationId", i.scheduled_for AS "scheduledFor",
                        i.expires_at AS "expiresAt", COALESCE(r.enabled, false) AS "reminderEnabled"
                 FROM majlis_invitations i LEFT JOIN majlis_reminders r
                   ON r.invitation_id=i.invitation_id AND r.account_id=$2
                 WHERE i.majlis_id=$1 AND i.canceled_at IS NULL AND i.expires_at>now()
                 ORDER BY i.scheduled_for`, [majlisId, accountId]),
            this.findActiveMajlisRoom(majlisId),
        ]);
        const recentSessions = [];
        for (const session of sessions.rows) {
            const players = await this.pool.query(
                `SELECT display_name AS "displayName", won FROM majlis_session_players
                 WHERE majlis_session_id=$1 ORDER BY display_name`, [session.majlisSessionId]);
            recentSessions.push({ ...session, players: players.rows });
        }
        const row = membership.rows[0];
        return {
            ...row,
            revision: Number(row.revision),
            members: members.rows,
            sessionScore: scores.rows.map(item => ({
                ...item, matches: Number(item.matches), wins: Number(item.wins),
            })),
            recentSessions,
            upcomingInvitations: invitations.rows,
            activeRoom: activeRoom ? {
                roomCode: activeRoom.room.roomCode,
                phase: activeRoom.room.phase,
            } : null,
        };
    }

    async createMajlisInvitation(invitation) {
        await this.pool.query(
            `INSERT INTO majlis_invitations (invitation_id, majlis_id, created_by_account_id,
                scheduled_for, expires_at, created_at, canceled_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [invitation.invitationId, invitation.majlisId, invitation.createdByAccountId,
                invitation.scheduledFor, invitation.expiresAt, invitation.createdAt, invitation.canceledAt],
        );
        return invitation;
    }

    async getMajlisInvitation(invitationId) {
        const result = await this.pool.query(
            `SELECT invitation_id AS "invitationId", majlis_id AS "majlisId",
                    created_by_account_id AS "createdByAccountId", scheduled_for AS "scheduledFor",
                    expires_at AS "expiresAt", created_at AS "createdAt", canceled_at AS "canceledAt"
             FROM majlis_invitations WHERE invitation_id=$1 AND canceled_at IS NULL`, [invitationId]);
        return result.rows[0] || null;
    }

    async setMajlisReminder(reminder) {
        const result = await this.pool.query(
            `INSERT INTO majlis_reminders
                (invitation_id, account_id, remind_at, enabled, notified_at, updated_at)
             VALUES ($1,$2,$3,$4,NULL,$5)
             ON CONFLICT (invitation_id, account_id) DO UPDATE SET
                remind_at=$3, enabled=$4, notified_at=NULL, updated_at=$5
             RETURNING invitation_id AS "invitationId", account_id AS "accountId",
                remind_at AS "remindAt", enabled, notified_at AS "notifiedAt",
                updated_at AS "updatedAt"`,
            [reminder.invitationId, reminder.accountId, reminder.remindAt,
                reminder.enabled, reminder.updatedAt]);
        return result.rows[0];
    }

    async claimDueMajlisReminders(accountId, nowIso) {
        const result = await this.pool.query(
            `UPDATE majlis_reminders r SET notified_at=$2
             FROM majlis_invitations i, majalis m
             WHERE r.invitation_id=i.invitation_id AND i.majlis_id=m.majlis_id
               AND r.account_id=$1 AND r.enabled=true AND r.notified_at IS NULL
               AND r.remind_at <= $2 AND i.canceled_at IS NULL AND i.expires_at > $2
             RETURNING i.invitation_id AS "invitationId", i.majlis_id AS "majlisId",
                m.display_name AS "majlisDisplayName", i.scheduled_for AS "scheduledFor"`,
            [accountId, nowIso],
        );
        return result.rows;
    }

    async recordMajlisSession(session) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const inserted = await client.query(
                `INSERT INTO majlis_sessions (majlis_session_id, majlis_id, room_id, match_id, completed_at)
                 VALUES ($1,$2,$3,$4,$5) ON CONFLICT (room_id, match_id) DO NOTHING
                 RETURNING majlis_session_id`,
                [session.majlisSessionId, session.majlisId, session.roomId,
                    session.matchId, session.completedAt]);
            if (!inserted.rows.length) {
                await client.query('COMMIT');
                return null;
            }
            for (const player of session.players) {
                await client.query(
                    `INSERT INTO majlis_session_players
                        (majlis_session_id, player_index, account_id, display_name, won)
                     VALUES ($1,$2,$3,$4,$5)`,
                    [session.majlisSessionId, player.playerIndex, player.accountId,
                        player.displayName, player.won]);
            }
            await client.query(
                `UPDATE majalis SET revision=revision+1, updated_at=$2 WHERE majlis_id=$1`,
                [session.majlisId, session.completedAt]);
            await client.query('COMMIT');
            return session;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async createModerationReport(report) {
        try {
            await this.pool.query(
                `INSERT INTO moderation_reports (report_id, room_id, match_id, reporter_account_id,
                    reported_account_id, reason_code, report_status, created_at, reviewed_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [report.reportId, report.roomId, report.matchId, report.reporterAccountId,
                    report.reportedAccountId, report.reasonCode, report.reportStatus,
                    report.createdAt, report.reviewedAt]);
            return report;
        } catch (error) {
            if (error.code === '23505') throw new StoreConflict('REPORT_ALREADY_SUBMITTED');
            throw error;
        }
    }

    async listModerationReports(limit = 100) {
        const result = await this.pool.query(
            `SELECT report_id AS "reportId", room_id AS "roomId", match_id AS "matchId",
                    reporter_account_id AS "reporterAccountId",
                    reported_account_id AS "reportedAccountId", reason_code AS "reasonCode",
                    report_status AS "reportStatus", created_at AS "createdAt",
                    reviewed_at AS "reviewedAt"
             FROM moderation_reports WHERE report_status IN ('open', 'reviewing')
             ORDER BY created_at LIMIT $1`,
            [Math.max(1, Math.min(100, limit))],
        );
        return result.rows;
    }

    async updateModerationReport(reportId, reportStatus, reviewedAt) {
        const result = await this.pool.query(
            `UPDATE moderation_reports SET report_status=$2, reviewed_at=$3 WHERE report_id=$1
             RETURNING report_id AS "reportId", room_id AS "roomId", match_id AS "matchId",
                reason_code AS "reasonCode", report_status AS "reportStatus",
                created_at AS "createdAt", reviewed_at AS "reviewedAt"`,
            [reportId, reportStatus, reviewedAt],
        );
        if (!result.rows.length) throw new StoreConflict('REPORT_NOT_FOUND');
        return result.rows[0];
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
                    deck_recipe_id, match_id, match_state, state_version, server_seq, created_at,
                    last_activity_at, majlis_id, base_recipe_id, recipe_contributions,
                    recipe_snapshot, recipe_locked_at, match_participants)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,$19::jsonb)`,
                [room.roomId, room.roomCode, room.mode, room.phase, room.rulesVersion, room.catalogVersion,
                    room.deckRecipeId, room.matchId || null, JSON.stringify(room.matchState || null), room.stateVersion,
                    room.serverSeq, room.createdAt, room.lastActivityAt, room.majlisId || null,
                    room.baseRecipeId || room.deckRecipeId, JSON.stringify(room.recipeContributions || []),
                    JSON.stringify(room.recipeSnapshot || null), room.recipeLockedAt || null,
                    JSON.stringify(room.matchParticipants || [])],
            );
            for (const seat of seats) await this._insertSeat(client, room.roomId, seat);
            await client.query('COMMIT');
            return { room, seats };
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505' && room.majlisId
                && await this.findActiveMajlisRoom(room.majlisId)) {
                throw new StoreConflict('MAJLIS_ROOM_EXISTS');
            }
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
            majlisId: row.majlis_id,
            baseRecipeId: row.base_recipe_id || row.deck_recipe_id,
            recipeContributions: row.recipe_contributions || [], recipeSnapshot: row.recipe_snapshot || null,
            recipeLockedAt: row.recipe_locked_at || null, matchParticipants: row.match_participants || [],
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
                    server_seq=$6, last_activity_at=$7, closed_at=$8, catalog_version=$9,
                    deck_recipe_id=$10, base_recipe_id=$11, recipe_contributions=$12::jsonb,
                    recipe_snapshot=$13::jsonb, recipe_locked_at=$14, match_participants=$15::jsonb
                 WHERE room_id=$1`,
                [room.roomId, room.phase, room.matchId || null, JSON.stringify(room.matchState || null),
                    room.stateVersion, room.serverSeq, room.lastActivityAt, room.closedAt || null,
                    room.catalogVersion, room.deckRecipeId, room.baseRecipeId || room.deckRecipeId,
                    JSON.stringify(room.recipeContributions || []), JSON.stringify(room.recipeSnapshot || null),
                    room.recipeLockedAt || null, JSON.stringify(room.matchParticipants || [])],
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

    _wallet(row) {
        return {
            accountId: row.account_id,
            balance: Number(row.balance),
            lifetimeGameplay: Number(row.lifetime_gameplay),
            lifetimePurchased: Number(row.lifetime_purchased),
            lifetimeSpent: Number(row.lifetime_spent),
            revision: Number(row.revision),
            updatedAt: row.updated_at,
        };
    }

    async getEconomyState(accountId) {
        const [walletResult, unlockResult, ledgerResult] = await Promise.all([
            this.pool.query(
                `SELECT a.account_id, COALESCE(w.balance, 0)::bigint AS balance,
                        COALESCE(w.lifetime_gameplay, 0)::bigint AS lifetime_gameplay,
                        COALESCE(w.lifetime_purchased, 0)::bigint AS lifetime_purchased,
                        COALESCE(w.lifetime_spent, 0)::bigint AS lifetime_spent,
                        COALESCE(w.revision, 0)::bigint AS revision, w.updated_at
                 FROM accounts a LEFT JOIN tamashi_wallets w ON w.account_id=a.account_id
                 WHERE a.account_id=$1`,
                [accountId],
            ),
            this.pool.query(
                `SELECT account_id AS "accountId", definition_id AS "definitionId",
                    acquired_with AS "acquiredWith", tamashi_price AS "tamashiPrice",
                    unlocked_at AS "unlockedAt"
                 FROM card_unlocks WHERE account_id=$1 ORDER BY unlocked_at DESC`, [accountId]),
            this.pool.query(
                `SELECT ledger_id AS "ledgerId", direction, amount, source_type AS "sourceType",
                    definition_id AS "definitionId", created_at AS "createdAt"
                 FROM tamashi_ledger_entries WHERE account_id=$1
                 ORDER BY created_at DESC LIMIT 50`, [accountId]),
        ]);
        if (!walletResult.rows.length) throw new StoreConflict('ACCOUNT_NOT_FOUND');
        return {
            wallet: this._wallet(walletResult.rows[0]),
            unlocks: unlockResult.rows.map(item => ({ ...item, tamashiPrice: Number(item.tamashiPrice) })),
            ledger: ledgerResult.rows.map(item => ({ ...item, amount: Number(item.amount) })),
        };
    }

    async hasCardUnlock(accountId, definitionId, catalogManifest) {
        const definition = catalogManifest.definitions.find(item => item.definitionId === definitionId);
        if (!definition) return false;
        if (definition.availableByDefault === true) return true;
        const result = await this.pool.query(
            'SELECT 1 FROM card_unlocks WHERE account_id=$1 AND definition_id=$2',
            [accountId, definitionId],
        );
        return result.rows.length > 0;
    }

    async getMatchRewardContext(roomId) {
        const current = await this.getRoom(roomId);
        if (!current) return null;
        const [result, timedOut] = await Promise.all([
            this.pool.query(
            `SELECT account_id, count(*)::int AS action_count FROM match_actions
             WHERE room_id=$1 AND match_id=$2 AND account_id IS NOT NULL GROUP BY account_id`,
            [roomId, current.room.matchId],
            ),
            this.pool.query(
                `SELECT DISTINCT action->>'actorId' AS seat_id FROM match_actions
                 WHERE room_id=$1 AND match_id=$2 AND account_id IS NULL
                    AND action->>'automatic'='true' AND action->>'actorId' IS NOT NULL`,
                [roomId, current.room.matchId],
            ),
        ]);
        return {
            ...current,
            actionCounts: Object.fromEntries(result.rows.map(item => [item.account_id, Number(item.action_count)])),
            timedOutSeatIds: timedOut.rows.map(item => item.seat_id),
        };
    }

    async settleGameplayRewards(input) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const lockedRoom = await client.query(
                'SELECT room_id FROM rooms WHERE room_id=$1 FOR UPDATE', [input.roomId]);
            if (!lockedRoom.rows.length) throw new StoreConflict('ROOM_NOT_FOUND');
            const existing = await client.query(
                'SELECT * FROM match_reward_settlements WHERE match_id=$1 FOR UPDATE', [input.matchId]);
            if (existing.rows.length) {
                await client.query('COMMIT');
                return {
                    matchId: input.matchId,
                    roomId: existing.rows[0].room_id,
                    participantHash: existing.rows[0].participant_hash,
                    status: existing.rows[0].reward_status,
                    settledAt: existing.rows[0].settled_at,
                    duplicate: true,
                    grants: [],
                };
            }
            let status = 'granted';
            const grants = [];
            if (!input.rewards.length) {
                status = 'no_eligible_players';
            } else {
                const cohort = await client.query(
                    `INSERT INTO tamashi_reward_cohorts (participant_hash, window_started_at, match_count)
                     VALUES ($1,$2,1)
                     ON CONFLICT (participant_hash) DO UPDATE SET
                        window_started_at=CASE WHEN tamashi_reward_cohorts.window_started_at < $3
                            THEN EXCLUDED.window_started_at ELSE tamashi_reward_cohorts.window_started_at END,
                        match_count=CASE WHEN tamashi_reward_cohorts.window_started_at < $3
                            THEN 1 ELSE tamashi_reward_cohorts.match_count + 1 END
                     WHERE tamashi_reward_cohorts.window_started_at < $3
                        OR tamashi_reward_cohorts.match_count < $4
                     RETURNING match_count`,
                    [input.participantHash, input.nowIso, input.cohortWindowStartedBefore, input.cohortCap],
                );
                if (!cohort.rows.length) {
                    status = 'suppressed_group_cap';
                } else {
                    for (const reward of input.rewards) {
                        const accountBucket = await client.query(
                            `INSERT INTO tamashi_reward_accounts (account_id, bucket_date, match_count)
                             VALUES ($1,$2,1)
                             ON CONFLICT (account_id, bucket_date) DO UPDATE
                                SET match_count=tamashi_reward_accounts.match_count + 1
                             WHERE tamashi_reward_accounts.match_count < $3
                             RETURNING match_count`,
                            [reward.accountId, input.accountBucketDate, input.accountCap],
                        );
                        if (!accountBucket.rows.length) continue;
                        await client.query(
                            `INSERT INTO tamashi_wallets (account_id)
                             SELECT account_id FROM accounts WHERE account_id=$1
                             ON CONFLICT (account_id) DO NOTHING`, [reward.accountId]);
                        const wallet = await client.query(
                            `UPDATE tamashi_wallets SET balance=balance+$2,
                                lifetime_gameplay=lifetime_gameplay+$2, revision=revision+1, updated_at=$3
                             WHERE account_id=$1 RETURNING *`,
                            [reward.accountId, reward.amount, input.nowIso],
                        );
                        if (!wallet.rows.length) throw new StoreConflict('ACCOUNT_NOT_FOUND');
                        const balance = Number(wallet.rows[0].balance);
                        const ledgerId = `ledger_${crypto.createHash('sha256')
                            .update(`${input.matchId}:${reward.accountId}`).digest('hex').slice(0, 24)}`;
                        await client.query(
                            `INSERT INTO tamashi_ledger_entries (ledger_id, account_id, direction, amount,
                                source_type, idempotency_key, balance_after, room_id, match_id,
                                participant_hash, metadata, wallet_revision, created_at)
                             VALUES ($1,$2,'credit',$3,'verified_gameplay',$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
                            [ledgerId, reward.accountId, reward.amount,
                                `match_${input.matchId}_${reward.accountId}`, balance, input.roomId,
                                input.matchId, input.participantHash, JSON.stringify({
                                    healthyParticipation: reward.healthyParticipation,
                                    won: reward.won,
                                    actionCount: reward.actionCount,
                                }), wallet.rows[0].revision, input.nowIso],
                        );
                        grants.push({ accountId: reward.accountId, amount: reward.amount, balance });
                    }
                    if (!grants.length) status = 'suppressed_account_cap';
                }
            }
            await client.query(
                `INSERT INTO match_reward_settlements
                    (match_id, room_id, participant_hash, reward_status, settled_at)
                 VALUES ($1,$2,$3,$4,$5)`,
                [input.matchId, input.roomId, input.participantHash, status, input.nowIso],
            );
            await client.query('COMMIT');
            return {
                matchId: input.matchId, roomId: input.roomId, participantHash: input.participantHash,
                status, settledAt: input.nowIso, duplicate: false, grants,
            };
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505') throw new StoreConflict('ECONOMY_CONFLICT');
            throw error;
        } finally {
            client.release();
        }
    }

    async purchaseCardUnlock(input) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO tamashi_wallets (account_id)
                 SELECT account_id FROM accounts WHERE account_id=$1
                 ON CONFLICT (account_id) DO NOTHING`, [input.accountId]);
            const walletResult = await client.query(
                'SELECT * FROM tamashi_wallets WHERE account_id=$1 FOR UPDATE', [input.accountId]);
            if (!walletResult.rows.length) throw new StoreConflict('ACCOUNT_NOT_FOUND');
            const unlocked = await client.query(
                'SELECT * FROM card_unlocks WHERE account_id=$1 AND definition_id=$2',
                [input.accountId, input.definitionId],
            );
            if (unlocked.rows.length) {
                await client.query('COMMIT');
                return { duplicate: true, wallet: this._wallet(walletResult.rows[0]) };
            }
            const idempotent = await client.query(
                'SELECT 1 FROM tamashi_ledger_entries WHERE account_id=$1 AND idempotency_key=$2',
                [input.accountId, input.idempotencyKey]);
            if (idempotent.rows.length) throw new StoreConflict('IDEMPOTENCY_CONFLICT');
            if (Number(walletResult.rows[0].balance) < input.price) throw new StoreConflict('INSUFFICIENT_TAMASHI');
            const wallet = await client.query(
                `UPDATE tamashi_wallets SET balance=balance-$2, lifetime_spent=lifetime_spent+$2,
                    revision=revision+1, updated_at=$3 WHERE account_id=$1 RETURNING *`,
                [input.accountId, input.price, input.nowIso]);
            await client.query(
                `INSERT INTO card_unlocks
                    (account_id, definition_id, acquired_with, tamashi_price, unlocked_at)
                 VALUES ($1,$2,'tamashi',$3,$4)`,
                [input.accountId, input.definitionId, input.price, input.nowIso]);
            await client.query(
                `INSERT INTO tamashi_ledger_entries (ledger_id, account_id, direction, amount,
                    source_type, idempotency_key, balance_after, definition_id, wallet_revision, created_at)
                 VALUES ($1,$2,'debit',$3,'card_unlock',$4,$5,$6,$7,$8)`,
                [input.ledgerId, input.accountId, input.price, input.idempotencyKey,
                    wallet.rows[0].balance, input.definitionId, wallet.rows[0].revision, input.nowIso]);
            await client.query('COMMIT');
            return {
                duplicate: false,
                unlocked: {
                    accountId: input.accountId, definitionId: input.definitionId,
                    acquiredWith: 'tamashi', tamashiPrice: input.price, unlockedAt: input.nowIso,
                },
                wallet: this._wallet(wallet.rows[0]),
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async creditVerifiedPurchase(input) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO tamashi_wallets (account_id)
                 SELECT account_id FROM accounts WHERE account_id=$1
                 ON CONFLICT (account_id) DO NOTHING`, [input.accountId]);
            const existingWallet = await client.query(
                'SELECT * FROM tamashi_wallets WHERE account_id=$1 FOR UPDATE', [input.accountId]);
            if (!existingWallet.rows.length) throw new StoreConflict('ACCOUNT_NOT_FOUND');
            const receipt = await client.query(
                `SELECT * FROM verified_iap_receipts
                 WHERE provider=$1 AND provider_transaction_id=$2`,
                [input.provider, input.providerTransactionId]);
            if (receipt.rows.length) {
                if (receipt.rows[0].account_id !== input.accountId
                    || receipt.rows[0].product_sku !== input.productSku) {
                    throw new StoreConflict('PURCHASE_ALREADY_CLAIMED');
                }
                await client.query('COMMIT');
                return { duplicate: true, wallet: this._wallet(existingWallet.rows[0]) };
            }
            const idempotent = await client.query(
                'SELECT 1 FROM tamashi_ledger_entries WHERE account_id=$1 AND idempotency_key=$2',
                [input.accountId, input.idempotencyKey]);
            if (idempotent.rows.length) throw new StoreConflict('IDEMPOTENCY_CONFLICT');
            await client.query(
                `INSERT INTO verified_iap_receipts (provider, provider_transaction_id, account_id,
                    product_sku, tamashi_amount, receipt_hash, verified_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [input.provider, input.providerTransactionId, input.accountId, input.productSku,
                    input.amount, input.receiptHash, input.nowIso]);
            const wallet = await client.query(
                `UPDATE tamashi_wallets SET balance=balance+$2, lifetime_purchased=lifetime_purchased+$2,
                    revision=revision+1, updated_at=$3 WHERE account_id=$1 RETURNING *`,
                [input.accountId, input.amount, input.nowIso]);
            await client.query(
                `INSERT INTO tamashi_ledger_entries (ledger_id, account_id, direction, amount,
                    source_type, idempotency_key, balance_after, provider, provider_transaction_id,
                    wallet_revision, created_at)
                 VALUES ($1,$2,'credit',$3,'verified_in_app_purchase',$4,$5,$6,$7,$8,$9)`,
                [input.ledgerId, input.accountId, input.amount, input.idempotencyKey,
                    wallet.rows[0].balance, input.provider, input.providerTransactionId,
                    wallet.rows[0].revision, input.nowIso]);
            await client.query('COMMIT');
            return { duplicate: false, wallet: this._wallet(wallet.rows[0]) };
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505') throw new StoreConflict('PURCHASE_ALREADY_CLAIMED');
            throw error;
        } finally {
            client.release();
        }
    }

    async creditCatchUp(input) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO tamashi_wallets (account_id)
                 SELECT account_id FROM accounts WHERE account_id=$1
                 ON CONFLICT (account_id) DO NOTHING`, [input.accountId]);
            const current = await client.query(
                'SELECT * FROM tamashi_wallets WHERE account_id=$1 FOR UPDATE', [input.accountId]);
            if (!current.rows.length) throw new StoreConflict('ACCOUNT_NOT_FOUND');
            const existing = await client.query(
                `SELECT 1 FROM tamashi_ledger_entries
                 WHERE account_id=$1 AND idempotency_key=$2`,
                [input.accountId, input.idempotencyKey]);
            if (existing.rows.length) {
                await client.query('COMMIT');
                return { duplicate: true, wallet: this._wallet(current.rows[0]) };
            }
            const wallet = await client.query(
                `UPDATE tamashi_wallets SET balance=balance+$2, revision=revision+1, updated_at=$3
                 WHERE account_id=$1 RETURNING *`, [input.accountId, input.amount, input.nowIso]);
            await client.query(
                `INSERT INTO tamashi_ledger_entries (ledger_id, account_id, direction, amount,
                    source_type, idempotency_key, balance_after, wallet_revision, created_at)
                 VALUES ($1,$2,'credit',$3,'catch_up_adjustment',$4,$5,$6,$7)`,
                [input.ledgerId, input.accountId, input.amount, input.idempotencyKey,
                    wallet.rows[0].balance, wallet.rows[0].revision, input.nowIso]);
            await client.query('COMMIT');
            return { duplicate: false, wallet: this._wallet(wallet.rows[0]) };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async getEconomyReconciliationSnapshot() {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
            const wallets = await client.query(
            `SELECT account_id AS "accountId", balance, lifetime_gameplay AS "lifetimeGameplay",
                    lifetime_purchased AS "lifetimePurchased", lifetime_spent AS "lifetimeSpent",
                    revision, updated_at AS "updatedAt"
             FROM tamashi_wallets ORDER BY account_id`,
            );
            const ledger = await client.query(
            `SELECT ledger_id AS "ledgerId", account_id AS "accountId", direction, amount,
                    source_type AS "sourceType", idempotency_key AS "idempotencyKey",
                    balance_after AS "balanceAfter", room_id AS "roomId", match_id AS "matchId",
                    definition_id AS "definitionId", provider,
                    provider_transaction_id AS "providerTransactionId",
                    participant_hash AS "participantHash", metadata,
                    wallet_revision AS "walletRevision", created_at AS "createdAt"
             FROM tamashi_ledger_entries ORDER BY ledger_id`,
            );
            const unlocks = await client.query(
            `SELECT account_id AS "accountId", definition_id AS "definitionId",
                    acquired_with AS "acquiredWith", tamashi_price AS "tamashiPrice",
                    unlocked_at AS "unlockedAt"
             FROM card_unlocks ORDER BY account_id, definition_id`,
            );
            const receipts = await client.query(
            `SELECT provider, provider_transaction_id AS "providerTransactionId",
                    account_id AS "accountId", product_sku AS "productSku",
                    tamashi_amount AS "tamashiAmount", receipt_hash AS "receiptHash",
                    verified_at AS "verifiedAt"
             FROM verified_iap_receipts ORDER BY provider, provider_transaction_id`,
            );
            const settlements = await client.query(
            `SELECT match_id AS "matchId", room_id AS "roomId",
                    participant_hash AS "participantHash", reward_status AS status,
                    settled_at AS "settledAt"
             FROM match_reward_settlements ORDER BY match_id`,
            );
            await client.query('COMMIT');
            return {
                wallets: wallets.rows,
                ledger: ledger.rows,
                unlocks: unlocks.rows,
                receipts: receipts.rows,
                settlements: settlements.rows,
            };
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
            await client.query(
                `DELETE FROM majlis_invitations
                 WHERE expires_at < $1::timestamptz - interval '30 days'`, [nowIso]);
            await client.query(
                `DELETE FROM moderation_reports
                 WHERE report_status IN ('closed', 'dismissed')
                   AND created_at < $1::timestamptz - interval '180 days'`, [nowIso]);
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
