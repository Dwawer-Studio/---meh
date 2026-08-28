'use strict';

const crypto = require('node:crypto');
const { MatchReducer } = require('../shared/match-reducer');
const { MEH_CORE_MANIFEST, MEH_CATALOG_MANIFEST } = require('../game/game-manifests');
const { planBotAction } = require('./bot-policy');
const { serverMessage } = require('./protocol');
const { KeyedSerialExecutor } = require('./serial-executor');
const {
    hashSecret, normalizeDisplayName, randomId, randomToken, safeEqual,
} = require('./security');

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class RoomError extends Error {
    constructor(code) {
        super(code);
        this.name = 'RoomError';
        this.code = code;
    }
}

class RoomService {
    constructor(store, options = {}) {
        this.store = store;
        this.reducer = options.reducer || MatchReducer;
        this.coreManifest = options.coreManifest || MEH_CORE_MANIFEST;
        this.catalogManifest = options.catalogManifest || MEH_CATALOG_MANIFEST;
        this.pepper = options.pepper || '';
        this.now = options.now || Date.now;
        this.metrics = options.metrics || null;
        this.authorizeMajlisMembership = options.authorizeMajlisMembership || (async () => false);
        this.onMatchCompleted = options.onMatchCompleted || (async () => null);
        this.analyticsToken = options.analyticsToken || (() => null);
        this.serial = new KeyedSerialExecutor(depth => {
            if (this.metrics) this.metrics.gauge('room.queue_depth', depth);
        });
        this.seatLeaseMs = options.seatLeaseMs || 30_000;
    }

    async createRoom(account, connectionSessionId, options = {}) {
        if (!account || !account.accountId) throw new RoomError('UNAUTHENTICATED');
        const mode = options.mode === 'quick' ? 'quick' : 'private';
        const majlisId = options.majlisId || null;
        if (majlisId !== null) {
            if (typeof majlisId !== 'string' || !/^majlis_[A-Za-z0-9_-]{8,96}$/.test(majlisId)) {
                throw new RoomError('BAD_MAJLIS_ID');
            }
            let authorized = false;
            try { authorized = await this.authorizeMajlisMembership(majlisId, account.accountId); }
            catch (error) { authorized = false; }
            if (!authorized) {
                throw new RoomError('MAJLIS_MEMBERS_ONLY');
            }
            const active = await this.store.findActiveMajlisRoom(majlisId);
            if (active && active.room.phase === 'FORMING') {
                return this.joinRoom(active.room.roomCode, account, connectionSessionId, options.clientSeq || 0);
            }
            if (active) throw new RoomError('MAJLIS_SESSION_ACTIVE');
        }
        const nowIso = new Date(this.now()).toISOString();
        for (let attempt = 0; attempt < 8; attempt++) {
            const room = {
                roomId: randomId('room'), roomCode: this._roomCode(), mode,
                phase: 'FORMING', rulesVersion: this.coreManifest.rulesVersion,
                catalogVersion: this.catalogManifest.catalogVersion,
                deckRecipeId: this.catalogManifest.activeRecipeId, matchId: null,
                majlisId,
                matchState: null, stateVersion: 0, serverSeq: 0,
                createdAt: nowIso, lastActivityAt: nowIso, closedAt: null,
            };
            const issued = this._humanSeat(0, account, connectionSessionId, nowIso, options.clientSeq || 0);
            const seats = [issued.seat];
            for (let index = 1; index < 4; index++) seats.push(this._botSeat(index));
            try {
                await this.store.createRoom(room, seats);
                if (mode === 'quick') await this.startMatch(room.roomId, connectionSessionId);
                const created = await this.store.getRoom(room.roomId);
                this._metric('room.created', { mode });
                await this._audit('room.created', account.accountId, room.roomId, { mode });
                return {
                    room: created.room,
                    seats: this._publicSeats(created.seats),
                    seatId: issued.seat.seatId,
                    recoveryToken: issued.recoveryToken,
                };
            } catch (error) {
                if (error.code === 'MAJLIS_ROOM_EXISTS' && majlisId) {
                    const active = await this.store.findActiveMajlisRoom(majlisId);
                    if (active && active.room.phase === 'FORMING') {
                        return this.joinRoom(
                            active.room.roomCode, account, connectionSessionId, options.clientSeq || 0,
                        );
                    }
                    throw new RoomError('MAJLIS_SESSION_ACTIVE');
                }
                if (!['ROOM_CODE_EXISTS', 'ROOM_OR_CODE_EXISTS'].includes(error.code) || attempt === 7) throw error;
            }
        }
        throw new RoomError('ROOM_CODE_EXHAUSTED');
    }

    async joinRoom(roomCode, account, connectionSessionId, clientSeq = 0) {
        const normalized = typeof roomCode === 'string' ? roomCode.trim().toUpperCase() : '';
        if (!/^[A-HJ-NP-Z2-9]{5}$/.test(normalized)) throw new RoomError('BAD_ROOM_CODE');
        const found = await this.store.findRoomByCode(normalized);
        if (!found) throw new RoomError('ROOM_NOT_FOUND');
        return this.serial.run(found.room.roomId, async () => {
            const current = await this.store.getRoom(found.room.roomId);
            if (!current || current.room.phase !== 'FORMING') throw new RoomError('ROOM_STARTED');
            if (current.room.majlisId) {
                let authorized = false;
                try {
                    authorized = await this.authorizeMajlisMembership(
                        current.room.majlisId, account.accountId,
                    );
                } catch (error) { authorized = false; }
                if (!authorized) throw new RoomError('MAJLIS_MEMBERS_ONLY');
            }
            const existing = current.seats.find(seat => seat.accountId === account.accountId && seat.status !== 'LEFT');
            if (existing) throw new RoomError('ALREADY_SEATED');
            const botIndex = current.seats.findIndex(seat => seat.isBot);
            if (botIndex < 0) throw new RoomError('ROOM_FULL');
            const issued = this._humanSeat(current.seats[botIndex].seatIndex, account, connectionSessionId,
                new Date(this.now()).toISOString(), clientSeq);
            current.seats[botIndex] = issued.seat;
            current.room.lastActivityAt = new Date(this.now()).toISOString();
            current.room.serverSeq++;
            await this.store.updateRoomAndSeats(current.room, current.seats);
            this._metric('room.joined');
            await this._audit('room.joined', account.accountId, current.room.roomId);
            return {
                room: current.room,
                seats: this._publicSeats(current.seats),
                seatId: issued.seat.seatId,
                recoveryToken: issued.recoveryToken,
            };
        });
    }

    async startMatch(roomId, connectionSessionId) {
        return this.serial.run(roomId, async () => {
            const current = await this.store.getRoom(roomId);
            if (!current || current.room.phase !== 'FORMING') throw new RoomError('BAD_ROOM_PHASE');
            const owner = current.seats.find(seat => seat.seatIndex === 0);
            if (!owner || owner.connectionSessionId !== connectionSessionId) throw new RoomError('HOST_ONLY');
            return this._startMatch(current);
        });
    }

    async ready(roomId, connectionSessionId, ready = true, clientSeq = null) {
        return this.serial.run(roomId, async () => {
            const current = await this.store.getRoom(roomId);
            if (!current || !['FORMING', 'RESULTS'].includes(current.room.phase)) {
                throw new RoomError('BAD_ROOM_PHASE');
            }
            const seat = current.seats.find(item => item.connectionSessionId === connectionSessionId
                && item.status === 'CONNECTED' && !item.isBot);
            if (!seat) throw new RoomError('SEAT_NOT_CONNECTED');
            seat.ready = ready === true;
            if (Number.isSafeInteger(clientSeq)) seat.lastClientSeq = clientSeq;
            current.room.lastActivityAt = new Date(this.now()).toISOString();
            const humans = current.seats.filter(item => !item.isBot && item.status === 'CONNECTED');
            if (humans.length && humans.every(item => item.ready)) return this._startMatch(current);
            current.room.serverSeq++;
            await this.store.updateRoomAndSeats(current.room, current.seats);
            return this._views(current.room, current.seats);
        });
    }

    async applyMatchAction(roomId, connectionSessionId, envelope) {
        return this.serial.run(roomId, async () => {
            const current = await this.store.getRoom(roomId);
            if (!current || current.room.phase !== 'IN_MATCH' || !current.room.matchState) {
                throw new RoomError('MATCH_NOT_ACTIVE');
            }
            const seat = current.seats.find(item => item.connectionSessionId === connectionSessionId
                && item.status === 'CONNECTED' && !item.isBot);
            if (!seat) throw new RoomError('SEAT_NOT_CONNECTED');
            const duplicate = await this.store.getIdempotent(roomId, envelope.requestId, seat.accountId);
            if (duplicate) return { duplicate: true, response: duplicate.response, broadcasts: null };
            const payload = envelope.payload;
            if (!['play', 'draw'].includes(payload.action)) throw new RoomError('UNKNOWN_ACTION');
            const action = {
                type: payload.action,
                actorId: seat.seatId,
                turnId: payload.turnId,
            };
            if (payload.cardId !== undefined) action.cardId = payload.cardId;
            if (payload.decision !== undefined) action.decision = payload.decision;
            const reduced = this.reducer.reduce(current.room.matchState, action);
            if (!reduced.ok) {
                this._metric('match.action_rejected', { code: reduced.code });
                throw new RoomError(reduced.code);
            }
            this.reducer.assertCardConservation(reduced.state);
            const view = this.reducer.publicView(reduced.state, seat.seatId);
            const ackBase = serverMessage('match.ack', {
                ackRequestId: envelope.requestId,
                stateVersion: reduced.state.stateVersion,
                stateFingerprint: this.reducer.fingerprint(view),
                payload: { duplicate: false, events: reduced.events, snapshot: view },
            });
            const committed = await this.store.commitMatchAction({
                roomId, connectionSessionId, requestId: envelope.requestId,
                clientSeq: envelope.clientSeq, expectedStateVersion: current.room.stateVersion,
                nextState: reduced.state, action,
                resultFingerprint: this.reducer.fingerprint(reduced.state), ackBase,
                nowIso: new Date(this.now()).toISOString(),
            });
            this._metric('match.action_committed');
            let latest = await this.store.getRoom(roomId);
            const humanBroadcasts = this._views(latest.room, latest.seats);
            const systemBroadcasts = await this._settleBots(latest);
            latest = await this.store.getRoom(roomId);
            return {
                duplicate: committed.duplicate,
                response: committed.response,
                broadcasts: this._views(latest.room, latest.seats),
                humanBroadcasts,
                systemBroadcasts,
            };
        });
    }

    async applyTimeout(roomId, expectedTurnId) {
        return this.serial.run(roomId, async () => {
            const current = await this.store.getRoom(roomId);
            const state = current && current.room.matchState;
            if (!state || current.room.phase !== 'IN_MATCH' || state.phase !== 'ACTIVE') return null;
            if (state.turnId !== expectedTurnId) return null;
            const action = planBotAction(state, this.reducer, { force: true });
            const reduced = this.reducer.reduce(state, action);
            if (!reduced.ok) throw new RoomError(`TIMEOUT_${reduced.code}`);
            this.reducer.assertCardConservation(reduced.state);
            const committed = await this.store.commitSystemMatchAction({
                roomId, expectedStateVersion: current.room.stateVersion, nextState: reduced.state,
                action: { ...action, automatic: true }, requestId: randomId('timeout'),
                resultFingerprint: this.reducer.fingerprint(reduced.state),
                nowIso: new Date(this.now()).toISOString(),
            });
            let latest = await this.store.getRoom(roomId);
            const timeoutBroadcast = {
                serverSeq: committed.serverSeq,
                views: this._views(latest.room, latest.seats),
            };
            const systemBroadcasts = await this._settleBots(latest);
            latest = await this.store.getRoom(roomId);
            this._metric('turn.timeout');
            return { timeoutBroadcast, systemBroadcasts, views: this._views(latest.room, latest.seats) };
        });
    }

    async snapshot(roomId, connectionSessionId) {
        const current = await this.store.getRoom(roomId);
        if (!current) throw new RoomError('ROOM_NOT_FOUND');
        const seat = current.seats.find(item => item.connectionSessionId === connectionSessionId);
        if (!seat) throw new RoomError('SEAT_NOT_CONNECTED');
        if (current.room.phase === 'RESULTS') await this._recordCompleted(current);
        return this._oneView(current.room, current.seats, seat);
    }

    async disconnect(roomId, connectionSessionId) {
        if (!roomId) return false;
        return this.serial.run(roomId, async () => {
            const current = await this.store.getRoom(roomId);
            if (!current) return false;
            const seat = current.seats.find(item => item.connectionSessionId === connectionSessionId);
            if (!seat || seat.isBot) return false;
            seat.status = 'LEASED';
            seat.connectionSessionId = null;
            seat.leaseExpiresAt = new Date(this.now() + this.seatLeaseMs).toISOString();
            current.room.serverSeq++;
            current.room.lastActivityAt = new Date(this.now()).toISOString();
            await this.store.updateRoomAndSeats(current.room, current.seats);
            this._metric('seat.disconnected');
            return true;
        });
    }

    async leave(roomId, connectionSessionId) {
        return this.serial.run(roomId, async () => {
            const current = await this.store.getRoom(roomId);
            if (!current) return false;
            const index = current.seats.findIndex(item => item.connectionSessionId === connectionSessionId);
            if (index < 0) return false;
            const old = current.seats[index];
            current.seats[index] = { ...this._botSeat(old.seatIndex), seatId: old.seatId };
            current.room.serverSeq++;
            current.room.lastActivityAt = new Date(this.now()).toISOString();
            await this.store.updateRoomAndSeats(current.room, current.seats);
            if (current.room.phase === 'IN_MATCH') await this._settleBots(await this.store.getRoom(roomId));
            this._metric('seat.left');
            await this._audit('seat.left', old.accountId, roomId);
            return true;
        });
    }

    async resume(roomCode, recoveryToken, account, connectionSessionId, clientSeq) {
        const found = await this.store.findRoomByCode(String(roomCode || '').toUpperCase());
        if (!found) throw new RoomError('ROOM_NOT_FOUND');
        return this.serial.run(found.room.roomId, async () => {
            const current = await this.store.getRoom(found.room.roomId);
            const suppliedHash = hashSecret(recoveryToken, this.pepper);
            const seat = current.seats.find(item => item.accountId === account.accountId
                && item.leaseTokenHash && safeEqual(item.leaseTokenHash, suppliedHash));
            if (!seat || seat.status !== 'LEASED' || Date.parse(seat.leaseExpiresAt) <= this.now()) {
                throw new RoomError('RECOVERY_DENIED');
            }
            const nextToken = randomToken('seat_');
            seat.leaseTokenHash = hashSecret(nextToken, this.pepper);
            seat.leaseExpiresAt = null;
            seat.connectionSessionId = connectionSessionId;
            seat.lastClientSeq = clientSeq;
            seat.status = 'CONNECTED';
            seat.isBot = false;
            current.room.serverSeq++;
            current.room.lastActivityAt = new Date(this.now()).toISOString();
            await this.store.updateRoomAndSeats(current.room, current.seats);
            this._metric('seat.recovered');
            await this._audit('seat.recovered', account.accountId, current.room.roomId);
            return {
                roomId: current.room.roomId,
                roomCode: current.room.roomCode,
                seatId: seat.seatId,
                recoveryToken: nextToken,
                snapshot: this._oneView(current.room, current.seats, seat),
            };
        });
    }

    async expireLeases() {
        // Production scheduling supplies active room ids; this method is kept
        // intentionally explicit so a hidden global table scan is not required.
        throw new RoomError('ROOM_ID_REQUIRED');
    }

    async expireRoomLeases(roomId) {
        return this.serial.run(roomId, async () => {
            const current = await this.store.getRoom(roomId);
            if (!current) return 0;
            let expired = 0;
            for (const seat of current.seats) {
                if (seat.status === 'LEASED' && Date.parse(seat.leaseExpiresAt) <= this.now()) {
                    seat.status = 'BOT'; seat.isBot = true; seat.leaseTokenHash = null;
                    seat.leaseExpiresAt = null; seat.connectionSessionId = null; expired++;
                }
            }
            if (!expired) return 0;
            current.room.serverSeq++;
            current.room.lastActivityAt = new Date(this.now()).toISOString();
            await this.store.updateRoomAndSeats(current.room, current.seats);
            await this._settleBots(await this.store.getRoom(roomId));
            this._metric('seat.lease_expired', {}, expired);
            return expired;
        });
    }

    async _settleBots(current) {
        const broadcasts = [];
        for (let step = 0; step < 5_000; step++) {
            const state = current.room.matchState;
            if (!state || state.phase !== 'ACTIVE') {
                if (current.room.phase === 'RESULTS') await this._recordCompleted(current);
                return broadcasts;
            }
            const actor = state.players[state.currentPlayerIndex];
            if (!actor.isBot) return broadcasts;
            const action = planBotAction(state, this.reducer);
            const reduced = this.reducer.reduce(state, action);
            if (!reduced.ok) throw new RoomError(`BOT_${reduced.code}`);
            this.reducer.assertCardConservation(reduced.state);
            const result = await this.store.commitSystemMatchAction({
                roomId: current.room.roomId, expectedStateVersion: current.room.stateVersion,
                nextState: reduced.state, action, requestId: randomId('system'),
                resultFingerprint: this.reducer.fingerprint(reduced.state),
                nowIso: new Date(this.now()).toISOString(),
            });
            current = await this.store.getRoom(current.room.roomId);
            broadcasts.push({ serverSeq: result.serverSeq, views: this._views(current.room, current.seats) });
        }
        throw new RoomError('BOT_SETTLE_LIMIT');
    }

    async _recordCompleted(current) {
        if (!current.room.majlisId || !current.room.matchId || !current.room.matchState) return null;
        try {
            return await this.onMatchCompleted(current.room.roomId);
        } catch (error) {
            this._metric('majlis.session_record_error', { code: error.code || 'UNKNOWN' });
            return null;
        }
    }

    async _startMatch(current) {
        if (current.room.majlisId && current.room.phase === 'RESULTS'
            && await this.store.findActiveMajlisRoom(current.room.majlisId, current.room.roomId)) {
            throw new RoomError('MAJLIS_SESSION_ACTIVE');
        }
        const seed = crypto.randomBytes(4).readUInt32BE(0);
        const matchId = randomId('match');
        current.seats.forEach(seat => { seat.ready = false; });
        const matchState = this.reducer.createMatch({
            seed, matchId,
            coreManifest: this.coreManifest,
            catalogManifest: this.catalogManifest,
            deckRecipeId: current.room.deckRecipeId,
            players: current.seats.map(seat => ({ id: seat.seatId, isBot: seat.isBot })),
        });
        current.room.phase = 'IN_MATCH';
        current.room.matchId = matchId;
        current.room.matchState = matchState;
        current.room.stateVersion = matchState.stateVersion;
        current.room.serverSeq++;
        current.room.lastActivityAt = new Date(this.now()).toISOString();
        await this.store.updateRoomAndSeats(current.room, current.seats);
        this._metric('match.started', { mode: current.room.mode });
        return this._views(current.room, current.seats);
    }

    _views(room, seats) {
        const views = {};
        for (const seat of seats) {
            if (seat.isBot || !seat.connectionSessionId) continue;
            views[seat.connectionSessionId] = this._oneView(room, seats, seat);
        }
        return views;
    }

    _oneView(room, seats, seat) {
        const payload = room.matchState
            ? { room: this._publicRoom(room), seats: this._publicSeats(seats), match: this.reducer.publicView(room.matchState, seat.seatId) }
            : { room: this._publicRoom(room), seats: this._publicSeats(seats), match: null };
        return serverMessage('room.snapshot', {
            serverSeq: room.serverSeq,
            stateVersion: room.stateVersion,
            stateFingerprint: this.reducer.fingerprint(payload),
            payload,
        });
    }

    _humanSeat(index, account, connectionSessionId, nowIso, lastClientSeq = 0) {
        const recoveryToken = randomToken('seat_');
        return {
            recoveryToken,
            seat: {
                seatId: randomId('seat'), seatIndex: index, accountId: account.accountId,
                displayName: normalizeDisplayName(account.displayName) || 'Guest', isBot: false,
                status: 'CONNECTED', leaseTokenHash: hashSecret(recoveryToken, this.pepper),
                leaseExpiresAt: null, connectionSessionId, lastClientSeq, ready: false, joinedAt: nowIso,
            },
        };
    }

    _botSeat(index) {
        return {
            seatId: randomId('seat'), seatIndex: index, accountId: null,
            displayName: `Bot ${index}`, isBot: true, status: 'BOT', leaseTokenHash: null,
            leaseExpiresAt: null, connectionSessionId: null, lastClientSeq: 0, ready: true,
        };
    }

    _publicRoom(room) {
        const result = {
            roomId: room.roomId, roomCode: room.roomCode, mode: room.mode, phase: room.phase,
            rulesVersion: room.rulesVersion, catalogVersion: room.catalogVersion,
            deckRecipeId: room.deckRecipeId, matchId: room.matchId, majlisId: room.majlisId || null,
        };
        const analyticsGroupToken = room.majlisId && this.analyticsToken(room.majlisId, 'majlis');
        const analyticsMatchToken = room.matchId && this.analyticsToken(room.matchId, 'match');
        if (analyticsGroupToken) result.analyticsGroupToken = analyticsGroupToken;
        if (analyticsMatchToken) result.analyticsMatchToken = analyticsMatchToken;
        return result;
    }

    _publicSeats(seats) {
        return seats.map(seat => ({
            seatId: seat.seatId, seatIndex: seat.seatIndex, displayName: seat.displayName,
            isBot: seat.isBot, status: seat.status, ready: seat.ready === true,
        }));
    }

    _roomCode() {
        const bytes = crypto.randomBytes(5);
        let code = '';
        for (let index = 0; index < 5; index++) code += ROOM_CODE_ALPHABET[bytes[index] % ROOM_CODE_ALPHABET.length];
        return code;
    }

    _metric(name, labels = {}, amount = 1) {
        if (this.metrics) this.metrics.increment(name, labels, amount);
    }

    async _audit(eventType, accountId, roomId, metadata = {}) {
        await this.store.appendAudit({
            eventType,
            accountId: accountId || null,
            roomId: roomId || null,
            ipHash: null,
            metadata,
            createdAt: new Date(this.now()).toISOString(),
        });
    }
}

module.exports = { RoomError, RoomService };
