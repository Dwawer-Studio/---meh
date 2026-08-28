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
        this.majalis.set(majlis.majlisId, copy(majlis));
        for (const membership of memberships) {
            this.majlisMemberships.set(`${majlis.majlisId}:${membership.accountId}`, copy({
                ...membership,
                majlisId: majlis.majlisId,
            }));
        }
        return copy(majlis);
    }

    async listAccountMajalis(accountId) {
        return [...this.majlisMemberships.values()]
            .filter(item => item.accountId === accountId && item.membershipStatus === 'active')
            .map(membership => {
                const majlis = this.majalis.get(membership.majlisId);
                return {
                    majlisId: majlis.majlisId,
                    displayName: majlis.displayName,
                    revision: Number(majlis.revision),
                    memberRole: membership.memberRole,
                    consentedAt: membership.consentedAt,
                    updatedAt: membership.updatedAt,
                };
            })
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
            rooms: this.rooms.size,
            seats: [...this.seats.values()].reduce((sum, seats) => sum + seats.length, 0),
            actions: this.actions.length,
            tombstones: this.tombstones.size,
        };
    }
}

module.exports = { MemoryStore, StoreConflict };
