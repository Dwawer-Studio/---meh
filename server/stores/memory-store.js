'use strict';

const crypto = require('node:crypto');

function copy(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class StoreConflict extends Error {
    constructor(code) {
        super(code);
        this.name = 'StoreConflict';
        this.code = code;
    }
}

class MemoryStore {
    constructor() {
        this.accounts = new Map();
        this.sessions = new Map();
        this.majalis = new Map();
        this.majlisMemberships = new Map();
        this.majlisSessions = [];
        this.majlisInvitations = new Map();
        this.majlisReminders = new Map();
        this.moderationReports = new Map();
        this.rooms = new Map();
        this.seats = new Map();
        this.idempotency = new Map();
        this.actions = [];
        this.audit = [];
        this.tombstones = new Map();
    }

    async createAccount(account) {
        if (this.accounts.has(account.accountId)) throw new StoreConflict('ACCOUNT_EXISTS');
        this.accounts.set(account.accountId, copy(account));
        return copy(account);
    }

    async getAccount(accountId) {
        return copy(this.accounts.get(accountId) || null);
    }

    async upgradeAccount(accountId, fields) {
        const account = this.accounts.get(accountId);
        if (!account) throw new StoreConflict('ACCOUNT_NOT_FOUND');
        if (account.accountKind !== 'guest') throw new StoreConflict('ALREADY_UPGRADED');
        Object.assign(account, copy(fields), {
            accountKind: 'registered',
            syncRevision: Number(account.syncRevision || 0) + 1,
        });
        return copy(account);
    }

    async updateAccountSettings(accountId, settings) {
        const account = this.accounts.get(accountId);
        if (!account) throw new StoreConflict('ACCOUNT_NOT_FOUND');
        account.settings = copy(settings);
        account.syncRevision = Number(account.syncRevision || 0) + 1;
        return copy(account);
    }

    async createMajlis(majlis, memberships) {
        if (this.majalis.has(majlis.majlisId)) throw new StoreConflict('MAJLIS_EXISTS');
        const sourceRoom = majlis.sourceRoomId ? this.rooms.get(majlis.sourceRoomId) : null;
        if (majlis.sourceRoomId && (!sourceRoom || sourceRoom.majlisId)) {
            throw new StoreConflict('SOURCE_ROOM_UNAVAILABLE');
        }
        this.majalis.set(majlis.majlisId, copy(majlis));
        for (const membership of memberships) {
            this.majlisMemberships.set(`${majlis.majlisId}:${membership.accountId}`, copy({
                ...membership,
                majlisId: majlis.majlisId,
            }));
        }
        if (sourceRoom) sourceRoom.majlisId = majlis.majlisId;
        return copy(majlis);
    }

    async listAccountMajalis(accountId) {
        const items = [...this.majlisMemberships.values()]
            .filter(item => item.accountId === accountId && item.membershipStatus === 'active')
            .sort((left, right) => {
                const leftUpdatedAt = (this.majalis.get(left.majlisId) || {}).updatedAt || left.updatedAt;
                const rightUpdatedAt = (this.majalis.get(right.majlisId) || {}).updatedAt || right.updatedAt;
                return rightUpdatedAt.localeCompare(leftUpdatedAt);
            })
            .slice(0, 8);
        return Promise.all(items.map(item => this.getMajlisForMember(item.majlisId, accountId)));
    }

    async findActiveMajlisRoom(majlisId, excludeRoomId = null) {
        const room = [...this.rooms.values()]
            .filter(item => item.majlisId === majlisId && item.roomId !== excludeRoomId
                && !item.closedAt && ['FORMING', 'IN_MATCH'].includes(item.phase))
            .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))[0];
        return room ? this.getRoom(room.roomId) : null;
    }

    async getMajlisDefinition(majlisId) {
        return copy(this.majalis.get(majlisId) || null);
    }

    async isMajlisMember(majlisId, accountId) {
        const membership = this.majlisMemberships.get(`${majlisId}:${accountId}`);
        return !!membership && membership.membershipStatus === 'active';
    }

    async acceptMajlisMembership(majlisId, accountId, nowIso) {
        if (!this.majalis.has(majlisId) || !this.accounts.has(accountId)) {
            throw new StoreConflict('MAJLIS_OR_ACCOUNT_NOT_FOUND');
        }
        const key = `${majlisId}:${accountId}`;
        const existing = this.majlisMemberships.get(key);
        this.majlisMemberships.set(key, {
            majlisId,
            accountId,
            memberRole: existing && existing.memberRole || 'member',
            membershipStatus: 'active',
            consentedAt: existing && existing.consentedAt || nowIso,
            updatedAt: nowIso,
        });
        const majlis = this.majalis.get(majlisId);
        majlis.revision = Number(majlis.revision || 0) + 1;
        majlis.updatedAt = nowIso;
        return true;
    }

    async getMajlisForMember(majlisId, accountId) {
        const membership = this.majlisMemberships.get(`${majlisId}:${accountId}`);
        const majlis = this.majalis.get(majlisId);
        if (!majlis || !membership || membership.membershipStatus !== 'active') return null;
        const members = [...this.majlisMemberships.values()]
            .filter(item => item.majlisId === majlisId && item.membershipStatus === 'active')
            .map(item => ({
                displayName: (this.accounts.get(item.accountId) || {}).displayName || 'Former player',
                memberRole: item.memberRole,
            }));
        const sessions = this.majlisSessions.filter(item => item.majlisId === majlisId)
            .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
        const score = new Map();
        for (const session of sessions) {
            for (const player of session.players) {
                const key = player.accountId || `former:${player.displayName}`;
                const value = score.get(key) || { displayName: player.displayName, matches: 0, wins: 0 };
                value.matches++;
                if (player.won) value.wins++;
                score.set(key, value);
            }
        }
        const invitations = [...this.majlisInvitations.values()]
            .filter(item => item.majlisId === majlisId && !item.canceledAt)
            .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor))
            .map(item => ({
                invitationId: item.invitationId,
                scheduledFor: item.scheduledFor,
                expiresAt: item.expiresAt,
                reminderEnabled: !!(this.majlisReminders.get(`${item.invitationId}:${accountId}`) || {}).enabled,
            }));
        return copy({
            majlisId: majlis.majlisId,
            displayName: majlis.displayName,
            bannerId: majlis.bannerId || 'pearl',
            tableThemeId: majlis.tableThemeId || 'classic',
            revision: Number(majlis.revision),
            memberRole: membership.memberRole,
            consentedAt: membership.consentedAt,
            updatedAt: majlis.updatedAt || membership.updatedAt,
            members,
            sessionScore: [...score.values()].sort((left, right) => right.wins - left.wins
                || right.matches - left.matches || left.displayName.localeCompare(right.displayName)),
            recentSessions: sessions.slice(0, 10).map(item => ({
                majlisSessionId: item.majlisSessionId,
                completedAt: item.completedAt,
                players: item.players.map(player => ({ displayName: player.displayName, won: player.won })),
            })),
            upcomingInvitations: invitations,
            activeRoom: await this.findActiveMajlisRoom(majlisId).then(active => active ? ({
                roomCode: active.room.roomCode,
                phase: active.room.phase,
            }) : null),
        });
    }

    async createMajlisInvitation(invitation) {
        if (this.majlisInvitations.has(invitation.invitationId)) throw new StoreConflict('INVITATION_EXISTS');
        this.majlisInvitations.set(invitation.invitationId, copy(invitation));
        return copy(invitation);
    }

    async getMajlisInvitation(invitationId) {
        return copy(this.majlisInvitations.get(invitationId) || null);
    }

    async setMajlisReminder(reminder) {
        const stored = { ...copy(reminder), notifiedAt: null };
        this.majlisReminders.set(`${reminder.invitationId}:${reminder.accountId}`, stored);
        return copy(stored);
    }

    async claimDueMajlisReminders(accountId, nowIso) {
        const due = [];
        for (const reminder of this.majlisReminders.values()) {
            if (reminder.accountId !== accountId || !reminder.enabled || reminder.notifiedAt
                || reminder.remindAt > nowIso) continue;
            const invitation = this.majlisInvitations.get(reminder.invitationId);
            if (!invitation || invitation.canceledAt || invitation.expiresAt <= nowIso) continue;
            const majlis = this.majalis.get(invitation.majlisId);
            if (!majlis) continue;
            reminder.notifiedAt = nowIso;
            due.push({
                invitationId: invitation.invitationId,
                majlisId: invitation.majlisId,
                majlisDisplayName: majlis.displayName,
                scheduledFor: invitation.scheduledFor,
            });
        }
        return copy(due);
    }

    async recordMajlisSession(session) {
        const existing = this.majlisSessions.find(item => item.roomId === session.roomId
            && item.matchId === session.matchId);
        if (existing) return copy(existing);
        this.majlisSessions.push(copy(session));
        const majlis = this.majalis.get(session.majlisId);
        if (majlis) {
            majlis.revision = Number(majlis.revision || 0) + 1;
            majlis.updatedAt = session.completedAt;
        }
        return copy(session);
    }

    async createModerationReport(report) {
        const duplicate = [...this.moderationReports.values()].find(item => item.roomId === report.roomId
            && item.matchId === report.matchId
            && item.reporterAccountId === report.reporterAccountId
            && item.reportedAccountId === report.reportedAccountId);
        if (duplicate) throw new StoreConflict('REPORT_ALREADY_SUBMITTED');
        this.moderationReports.set(report.reportId, copy(report));
        return copy(report);
    }

    async listModerationReports(limit = 100) {
        return copy([...this.moderationReports.values()]
            .filter(report => ['open', 'reviewing'].includes(report.reportStatus))
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
            .slice(0, Math.max(1, Math.min(100, limit))));
    }

    async updateModerationReport(reportId, reportStatus, reviewedAt) {
        const report = this.moderationReports.get(reportId);
        if (!report) throw new StoreConflict('REPORT_NOT_FOUND');
        report.reportStatus = reportStatus;
        report.reviewedAt = reviewedAt;
        return copy(report);
    }

    async createSession(session) {
        if (this.sessions.has(session.tokenHash)) throw new StoreConflict('SESSION_EXISTS');
        this.sessions.set(session.tokenHash, copy(session));
        return copy(session);
    }

    async authenticateSession(tokenHash, nowMs) {
        const session = this.sessions.get(tokenHash);
        if (!session || session.revokedAt || Date.parse(session.expiresAt) <= nowMs) return null;
        const account = this.accounts.get(session.accountId);
        if (!account || account.deletedAt) return null;
        return { session: copy(session), account: copy(account) };
    }

    async revokeSession(sessionId, nowIso) {
        for (const session of this.sessions.values()) {
            if (session.sessionId === sessionId) session.revokedAt = nowIso;
        }
    }

    async createRoom(room, seats) {
        if (this.rooms.has(room.roomId)) throw new StoreConflict('ROOM_EXISTS');
        if ([...this.rooms.values()].some(item => item.roomCode === room.roomCode && !item.closedAt)) {
            throw new StoreConflict('ROOM_CODE_EXISTS');
        }
        if (room.majlisId && [...this.rooms.values()].some(item => item.majlisId === room.majlisId
            && !item.closedAt && item.phase === 'FORMING')) {
            throw new StoreConflict('MAJLIS_ROOM_EXISTS');
        }
        this.rooms.set(room.roomId, copy(room));
        this.seats.set(room.roomId, copy(seats));
        return { room: copy(room), seats: copy(seats) };
    }

    async getRoom(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return null;
        return { room: copy(room), seats: copy(this.seats.get(roomId) || []) };
    }

    async findRoomByCode(roomCode) {
        const room = [...this.rooms.values()].find(item => item.roomCode === roomCode && !item.closedAt);
        return room ? this.getRoom(room.roomId) : null;
    }

    async updateRoomAndSeats(room, seats) {
        if (!this.rooms.has(room.roomId)) throw new StoreConflict('ROOM_NOT_FOUND');
        this.rooms.set(room.roomId, copy(room));
        this.seats.set(room.roomId, copy(seats));
        return { room: copy(room), seats: copy(seats) };
    }

    async getIdempotent(roomId, requestId, accountId) {
        const record = this.idempotency.get(`${roomId}:${requestId}`) || null;
        return record && record.accountId === accountId ? copy(record) : null;
    }

    async commitMatchAction(input) {
        const room = this.rooms.get(input.roomId);
        const seats = this.seats.get(input.roomId) || [];
        if (!room) throw new StoreConflict('ROOM_NOT_FOUND');
        const seat = seats.find(item => item.connectionSessionId === input.connectionSessionId);
        if (!seat || seat.status !== 'CONNECTED') throw new StoreConflict('SEAT_NOT_CONNECTED');
        const key = `${input.roomId}:${input.requestId}`;
        const duplicate = this.idempotency.get(key);
        if (duplicate && duplicate.seatId === seat.seatId) {
            return { duplicate: true, response: copy(duplicate.response) };
        }
        if (room.stateVersion !== input.expectedStateVersion) throw new StoreConflict('STATE_CONFLICT');
        if (input.clientSeq <= seat.lastClientSeq) throw new StoreConflict('BAD_SEQUENCE');
        const serverSeq = room.serverSeq + 1;
        const response = { ...copy(input.ackBase), serverSeq };
        room.matchState = copy(input.nextState);
        room.stateVersion = input.nextState.stateVersion;
        room.serverSeq = serverSeq;
        room.lastActivityAt = input.nowIso;
        if (input.nextState.phase === 'COMPLETE') room.phase = 'RESULTS';
        seat.lastClientSeq = input.clientSeq;
        this.idempotency.set(key, {
            roomId: input.roomId,
            seatId: seat.seatId,
            accountId: seat.accountId,
            connectionSessionId: input.connectionSessionId,
            requestId: input.requestId,
            clientSeq: input.clientSeq,
            response: copy(response),
            createdAt: input.nowIso,
        });
        this.actions.push({
            roomId: input.roomId,
            matchId: room.matchId,
            actionSequence: input.nextState.actionCount,
            accountId: seat.accountId,
            requestId: input.requestId,
            action: copy(input.action),
            resultFingerprint: input.resultFingerprint,
            createdAt: input.nowIso,
        });
        return { duplicate: false, response: copy(response) };
    }

    async commitSystemMatchAction(input) {
        const room = this.rooms.get(input.roomId);
        if (!room) throw new StoreConflict('ROOM_NOT_FOUND');
        if (room.stateVersion !== input.expectedStateVersion) throw new StoreConflict('STATE_CONFLICT');
        room.matchState = copy(input.nextState);
        room.stateVersion = input.nextState.stateVersion;
        room.serverSeq++;
        room.lastActivityAt = input.nowIso;
        if (input.nextState.phase === 'COMPLETE') room.phase = 'RESULTS';
        this.actions.push({
            roomId: input.roomId,
            matchId: room.matchId,
            actionSequence: input.nextState.actionCount,
            accountId: null,
            requestId: input.requestId,
            action: copy(input.action),
            resultFingerprint: input.resultFingerprint,
            createdAt: input.nowIso,
        });
        return { serverSeq: room.serverSeq };
    }

    async appendAudit(entry) {
        this.audit.push({ auditId: this.audit.length + 1, ...copy(entry) });
    }

    async deleteAccount(accountId, tombstone, nowIso) {
        if (!this.accounts.has(accountId)) return false;
        this.accounts.delete(accountId);
        for (const [key, session] of this.sessions) {
            if (session.accountId === accountId) this.sessions.delete(key);
        }
        for (const [key, membership] of this.majlisMemberships) {
            if (membership.accountId === accountId) this.majlisMemberships.delete(key);
        }
        for (const session of this.majlisSessions) {
            for (const player of session.players) if (player.accountId === accountId) player.accountId = null;
        }
        for (const invitation of this.majlisInvitations.values()) {
            if (invitation.createdByAccountId === accountId) invitation.createdByAccountId = null;
        }
        for (const [key, reminder] of this.majlisReminders) {
            if (reminder.accountId === accountId) this.majlisReminders.delete(key);
        }
        for (const report of this.moderationReports.values()) {
            if (report.reporterAccountId === accountId) report.reporterAccountId = null;
            if (report.reportedAccountId === accountId) report.reportedAccountId = null;
        }
        for (const seats of this.seats.values()) {
            for (const seat of seats) if (seat.accountId === accountId) seat.accountId = null;
        }
        for (const action of this.actions) if (action.accountId === accountId) action.accountId = null;
        for (const event of this.audit) if (event.accountId === accountId) event.accountId = null;
        this.tombstones.set(tombstone.subjectHash, copy(tombstone));
        this.audit.push({ auditId: this.audit.length + 1, eventType: 'account.deleted', createdAt: nowIso });
        return true;
    }

    async prune(nowMs) {
        const replayCutoff = nowMs - 30 * 24 * 60 * 60 * 1000;
        for (const [key, value] of this.idempotency) {
            if (nowMs - Date.parse(value.createdAt) > 86_400_000) this.idempotency.delete(key);
        }
        for (const [key, value] of this.sessions) {
            if (Date.parse(value.expiresAt) <= nowMs
                || (value.revokedAt && Date.parse(value.revokedAt) <= nowMs - 86_400_000)) {
                this.sessions.delete(key);
            }
        }
        this.actions = this.actions.filter(value => Date.parse(value.createdAt) >= replayCutoff);
        this.audit = this.audit.filter(value => Date.parse(value.createdAt) >= replayCutoff);
        for (const [roomId, room] of this.rooms) {
            if (Date.parse(room.lastActivityAt) < replayCutoff) {
                this.rooms.delete(roomId);
                this.seats.delete(roomId);
                for (const session of this.majlisSessions) {
                    if (session.roomId === roomId) session.roomId = null;
                }
                for (const majlis of this.majalis.values()) {
                    if (majlis.sourceRoomId === roomId) majlis.sourceRoomId = null;
                }
                for (const report of this.moderationReports.values()) {
                    if (report.roomId === roomId) report.roomId = null;
                }
                for (const key of this.idempotency.keys()) {
                    if (key.startsWith(`${roomId}:`)) this.idempotency.delete(key);
                }
            }
        }
        for (const [majlisId, majlis] of this.majalis) {
            const hasMembership = [...this.majlisMemberships.values()]
                .some(membership => membership.majlisId === majlisId);
            if (!hasMembership && Date.parse(majlis.updatedAt) < replayCutoff) this.majalis.delete(majlisId);
        }
        for (const [invitationId, invitation] of this.majlisInvitations) {
            if (Date.parse(invitation.expiresAt) < replayCutoff) {
                this.majlisInvitations.delete(invitationId);
                for (const key of this.majlisReminders.keys()) {
                    if (key.startsWith(`${invitationId}:`)) this.majlisReminders.delete(key);
                }
            }
        }
        const reportCutoff = nowMs - 180 * 24 * 60 * 60 * 1000;
        for (const [reportId, report] of this.moderationReports) {
            if (['closed', 'dismissed'].includes(report.reportStatus)
                && Date.parse(report.createdAt) < reportCutoff) this.moderationReports.delete(reportId);
        }
        for (const [key, value] of this.tombstones) {
            if (Date.parse(value.expiresAt) <= nowMs) this.tombstones.delete(key);
        }
    }

    async exportLogicalBackup(nowIso) {
        const payload = {
            formatVersion: 1,
            createdAt: nowIso,
            accounts: [...this.accounts.values()],
            sessions: [...this.sessions.values()],
            majalis: [...this.majalis.values()],
            majlisMemberships: [...this.majlisMemberships.values()],
            majlisSessions: this.majlisSessions,
            majlisInvitations: [...this.majlisInvitations.values()],
            majlisReminders: [...this.majlisReminders.values()],
            moderationReports: [...this.moderationReports.values()],
            rooms: [...this.rooms.values()],
            seats: [...this.seats.entries()],
            idempotency: [...this.idempotency.values()],
            actions: this.actions,
            audit: this.audit,
            tombstones: [...this.tombstones.values()],
        };
        const serialized = JSON.stringify(payload);
        return {
            payload: copy(payload),
            checksum: crypto.createHash('sha256').update(serialized).digest('hex'),
        };
    }

    async restoreLogicalBackup(backup) {
        if (this.accounts.size || this.rooms.size || this.sessions.size) throw new StoreConflict('TARGET_NOT_EMPTY');
        const serialized = JSON.stringify(backup && backup.payload);
        const checksum = crypto.createHash('sha256').update(serialized).digest('hex');
        if (!backup || checksum !== backup.checksum || backup.payload.formatVersion !== 1) {
            throw new StoreConflict('INVALID_BACKUP');
        }
        const payload = copy(backup.payload);
        this.accounts = new Map(payload.accounts.map(item => [item.accountId, item]));
        this.sessions = new Map(payload.sessions.map(item => [item.tokenHash, item]));
        this.majalis = new Map(payload.majalis.map(item => [item.majlisId, item]));
        this.majlisMemberships = new Map(payload.majlisMemberships.map(
            item => [`${item.majlisId}:${item.accountId}`, item],
        ));
        this.majlisSessions = payload.majlisSessions || [];
        this.majlisInvitations = new Map((payload.majlisInvitations || []).map(item => [item.invitationId, item]));
        this.majlisReminders = new Map((payload.majlisReminders || []).map(
            item => [`${item.invitationId}:${item.accountId}`, item],
        ));
        this.moderationReports = new Map((payload.moderationReports || []).map(item => [item.reportId, item]));
        this.rooms = new Map(payload.rooms.map(item => [item.roomId, item]));
        this.seats = new Map(payload.seats);
        this.idempotency = new Map(payload.idempotency.map(item => [`${item.roomId}:${item.requestId}`, item]));
        this.actions = payload.actions;
        this.audit = payload.audit;
        this.tombstones = new Map(payload.tombstones.map(item => [item.subjectHash, item]));
        return true;
    }

    async snapshotCounts() {
        return {
            accounts: this.accounts.size,
            sessions: this.sessions.size,
            majalis: this.majalis.size,
            majlisMemberships: this.majlisMemberships.size,
            majlisSessions: this.majlisSessions.length,
            majlisInvitations: this.majlisInvitations.size,
            moderationReports: this.moderationReports.size,
            rooms: this.rooms.size,
            seats: [...this.seats.values()].reduce((sum, seats) => sum + seats.length, 0),
            actions: this.actions.length,
            tombstones: this.tombstones.size,
        };
    }
}

module.exports = { MemoryStore, StoreConflict };
