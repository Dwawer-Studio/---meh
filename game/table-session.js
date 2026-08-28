'use strict';

const TABLE_PHASES = Object.freeze({
    FORMING: 'FORMING',
    IN_MATCH: 'IN_MATCH',
    RESULTS: 'RESULTS',
    CLOSED: 'CLOSED',
});

class TableSession {
    constructor(options = {}) {
        this.tableId = options.tableId || 'local-table';
        this.hostOwnerId = options.hostOwnerId || 'host';
        this.maxSeats = Number.isSafeInteger(options.maxSeats) ? options.maxSeats : 4;
        this.reconnectWindowMs = Number.isSafeInteger(options.reconnectWindowMs)
            ? options.reconnectWindowMs : 15_000;
        this.now = typeof options.now === 'function' ? options.now : () => Date.now();
        this.phase = TABLE_PHASES.FORMING;
        this.matchNumber = 0;
        this.seats = [];
    }

    _assertOpen() {
        if (this.phase === TABLE_PHASES.CLOSED) throw new Error('Table is closed');
    }

    _safeSeat(seat) {
        return seat && {
            seatId: seat.seatId,
            ownerId: seat.ownerId,
            displayName: seat.displayName,
            avatar: seat.avatar,
            host: seat.host,
            kind: seat.kind,
            controller: seat.controller,
            connected: seat.connected,
            ready: seat.ready,
            score: seat.score,
            wins: seat.wins,
            reconnectDeadline: seat.reconnectDeadline,
            leaseExpired: seat.leaseExpired,
            returnAfterMatch: seat.returnAfterMatch,
        };
    }

    _newSeat(index, options) {
        const isBot = options.kind === 'bot';
        return {
            seatId: `seat-${index}`,
            ownerId: isBot ? null : options.ownerId,
            displayName: options.displayName,
            avatar: options.avatar,
            host: !isBot && options.ownerId === this.hostOwnerId,
            kind: isBot ? 'bot' : 'human',
            controller: isBot ? 'bot' : 'human',
            connected: !isBot,
            ready: isBot,
            score: 0,
            wins: 0,
            reconnectDeadline: null,
            leaseExpired: false,
            returnAfterMatch: false,
        };
    }

    addHuman(options) {
        this._assertOpen();
        if (![TABLE_PHASES.FORMING, TABLE_PHASES.RESULTS].includes(this.phase)) {
            return { ok: false, reason: 'match-in-progress' };
        }
        if (!options || typeof options.ownerId !== 'string') return { ok: false, reason: 'invalid-owner' };
        const existing = this.seats.find(seat => seat.ownerId === options.ownerId);
        if (existing) return { ok: true, seat: this._safeSeat(existing), resumed: true };

        let index = this.seats.findIndex(seat => seat.kind === 'bot');
        if (index < 0 && this.seats.length < this.maxSeats) index = this.seats.length;
        if (index < 0) return { ok: false, reason: 'table-full' };
        const previous = this.seats[index];
        const seat = this._newSeat(index, { ...options, kind: 'human' });
        if (previous) {
            seat.score = previous.score;
            seat.wins = previous.wins;
            this.seats[index] = seat;
        } else {
            this.seats.push(seat);
        }
        return { ok: true, seat: this._safeSeat(seat), resumed: false };
    }

    fillBots(factory = index => ({ displayName: `Bot ${index + 1}`, avatar: '🤖' })) {
        this._assertOpen();
        while (this.seats.length < this.maxSeats) {
            const index = this.seats.length;
            this.seats.push(this._newSeat(index, { ...factory(index), kind: 'bot' }));
        }
        return this.snapshot();
    }

    removeHuman(ownerId) {
        this._assertOpen();
        if (![TABLE_PHASES.FORMING, TABLE_PHASES.RESULTS].includes(this.phase)) return false;
        const index = this.seats.findIndex(seat => seat.ownerId === ownerId);
        if (index < 0) return false;
        const previous = this.seats[index];
        const bot = this._newSeat(index, { kind: 'bot', displayName: 'Bot', avatar: '🤖' });
        bot.score = previous.score;
        bot.wins = previous.wins;
        this.seats[index] = bot;
        return true;
    }

    abandon(ownerId) {
        this._assertOpen();
        const index = this.seats.findIndex(seat => seat.ownerId === ownerId);
        if (index < 0) return false;
        const previous = this.seats[index];
        const bot = this._newSeat(index, { kind: 'bot', displayName: 'Bot', avatar: '🤖' });
        bot.score = previous.score;
        bot.wins = previous.wins;
        bot.ready = this.phase === TABLE_PHASES.RESULTS;
        this.seats[index] = bot;
        return true;
    }

    startMatch() {
        this._assertOpen();
        if (![TABLE_PHASES.FORMING, TABLE_PHASES.RESULTS].includes(this.phase)) {
            return { ok: false, reason: 'invalid-phase' };
        }
        if (!this.seats.some(seat => seat.kind === 'human')) return { ok: false, reason: 'no-human-seat' };
        if (this.phase === TABLE_PHASES.RESULTS && !this.allHumansReady()) {
            return { ok: false, reason: 'not-ready' };
        }
        this.fillBots();
        this.matchNumber++;
        this.phase = TABLE_PHASES.IN_MATCH;
        this.seats.forEach(seat => {
            seat.ready = false;
            if (seat.kind === 'bot') seat.controller = 'bot';
        });
        return { ok: true, matchNumber: this.matchNumber, snapshot: this.snapshot() };
    }

    endMatch(winnerSeatId) {
        this._assertOpen();
        if (this.phase !== TABLE_PHASES.IN_MATCH) return { ok: false, reason: 'invalid-phase' };
        const winner = this.seats.find(seat => seat.seatId === winnerSeatId);
        if (!winner) return { ok: false, reason: 'unknown-winner' };
        winner.score++;
        winner.wins++;
        this.phase = TABLE_PHASES.RESULTS;
        this.seats.forEach(seat => {
            seat.ready = seat.kind === 'bot';
            if (seat.returnAfterMatch && seat.ownerId) {
                seat.kind = seat.connected ? 'human' : 'bot';
                seat.controller = seat.connected ? 'human' : 'bot';
                seat.returnAfterMatch = false;
                seat.leaseExpired = false;
            }
        });
        return { ok: true, snapshot: this.snapshot() };
    }

    setReady(ownerId, ready = true) {
        this._assertOpen();
        if (this.phase !== TABLE_PHASES.RESULTS) return false;
        const seat = this.seats.find(item => item.ownerId === ownerId && item.kind === 'human');
        if (!seat || !seat.connected) return false;
        seat.ready = ready === true;
        return true;
    }

    allHumansReady() {
        const humans = this.seats.filter(seat => seat.kind === 'human');
        return humans.length > 0 && humans.every(seat => seat.ready);
    }

    disconnect(ownerId) {
        this._assertOpen();
        const seat = this.seats.find(item => item.ownerId === ownerId);
        if (!seat) return false;
        seat.connected = false;
        seat.ready = false;
        if (this.phase === TABLE_PHASES.IN_MATCH) {
            seat.reconnectDeadline = this.now() + this.reconnectWindowMs;
            seat.leaseExpired = false;
        } else {
            seat.controller = 'bot';
        }
        return true;
    }

    reconnect(ownerId) {
        this._assertOpen();
        const seat = this.seats.find(item => item.ownerId === ownerId);
        if (!seat) return { ok: false, reason: 'unknown-seat' };
        const beforeDeadline = !seat.leaseExpired
            && (seat.reconnectDeadline === null || this.now() <= seat.reconnectDeadline);
        seat.connected = true;
        seat.reconnectDeadline = null;
        if (this.phase !== TABLE_PHASES.IN_MATCH || beforeDeadline) {
            seat.kind = 'human';
            seat.controller = 'human';
            seat.returnAfterMatch = false;
            seat.leaseExpired = false;
            return { ok: true, mode: 'current-match', seat: this._safeSeat(seat) };
        }
        seat.returnAfterMatch = true;
        return { ok: true, mode: 'next-match', seat: this._safeSeat(seat) };
    }

    expireLeases() {
        this._assertOpen();
        if (this.phase !== TABLE_PHASES.IN_MATCH) return [];
        const expired = [];
        for (const seat of this.seats) {
            if (seat.connected || seat.reconnectDeadline === null || this.now() <= seat.reconnectDeadline) continue;
            seat.controller = 'bot';
            seat.kind = 'bot';
            seat.returnAfterMatch = true;
            seat.leaseExpired = true;
            seat.reconnectDeadline = null;
            expired.push(seat.seatId);
        }
        return expired;
    }

    close() {
        if (this.phase === TABLE_PHASES.CLOSED) return false;
        this.phase = TABLE_PHASES.CLOSED;
        return true;
    }

    snapshot() {
        return Object.freeze({
            schemaVersion: 1,
            tableId: this.tableId,
            phase: this.phase,
            matchNumber: this.matchNumber,
            maxSeats: this.maxSeats,
            seats: Object.freeze(this.seats.map(seat => Object.freeze(this._safeSeat(seat)))),
        });
    }
}

if (typeof window !== 'undefined') {
    window.TABLE_PHASES = TABLE_PHASES;
    window.TableSession = TableSession;
}
