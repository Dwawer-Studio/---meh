'use strict';

class AuthoritativeClientError extends Error {
    constructor(code, details = null) {
        super(code);
        this.name = 'AuthoritativeClientError';
        this.code = code;
        this.details = details;
    }
}

class AuthoritativeGameClient {
    constructor(options = {}) {
        this.url = options.url;
        this.WebSocketClass = options.WebSocketClass || WebSocket;
        this.requestTimeoutMs = options.requestTimeoutMs || 8_000;
        this.socket = null;
        this.clientSeq = 0;
        this.lastServerSeq = 0;
        this.pending = new Map();
        this.accessToken = null;
        this.recoveryToken = null;
        this.roomCode = null;
        this.seatId = null;
        this.onSnapshot = options.onSnapshot || (() => {});
        this.onConnectionState = options.onConnectionState || (() => {});
        this.onRejected = options.onRejected || (() => {});
        this.reconnectWindowMs = options.reconnectWindowMs || 29_000;
        this.reconnectDelaysMs = options.reconnectDelaysMs || [250, 500, 1_000, 2_000, 4_000];
        this.manualClose = false;
        this.recovering = false;
        this.recoveryGeneration = 0;
    }

    async connect(accessToken) {
        if (typeof this.url !== 'string' || !/^wss?:\/\//.test(this.url)) {
            throw new AuthoritativeClientError('BAD_SERVICE_URL');
        }
        this.accessToken = accessToken;
        this.manualClose = false;
        await this._open();
        return this._request('session.hello', {
            accessToken,
            clientVersion: '0.1.0',
        });
    }

    createRoom(mode = 'private') {
        return this._request('room.create', { mode }).then(message => this._acceptLease(message));
    }

    joinRoom(roomCode) {
        return this._request('room.join', { roomCode }).then(message => this._acceptLease(message));
    }

    resumeSeat(roomCode = this.roomCode, recoveryToken = this.recoveryToken) {
        return this._request('seat.resume', { roomCode, recoveryToken }).then(message => this._acceptLease(message));
    }

    setReady(ready = true) {
        return this._request('seat.ready', { ready });
    }

    play(cardId, turnId, decision) {
        const payload = { action: 'play', cardId, turnId };
        if (decision) payload.decision = decision;
        return this._request('match.action', payload);
    }

    draw(turnId) {
        return this._request('match.action', { action: 'draw', turnId });
    }

    requestSnapshot() {
        return this._request('snapshot.request', {});
    }

    async leave() {
        if (this.socket && this.socket.readyState === this.WebSocketClass.OPEN) {
            try { await this._request('seat.leave', {}); } catch (error) {}
        }
        this.close();
    }

    close() {
        this.manualClose = true;
        this.recoveryGeneration++;
        const socket = this.socket;
        this.socket = null;
        if (socket) socket.close(1000, 'client close');
        this._rejectPending('CONNECTION_CLOSED');
    }

    async _open() {
        if (this.socket && this.socket.readyState === this.WebSocketClass.OPEN) return;
        this.clientSeq = 0;
        await new Promise((resolve, reject) => {
            const socket = new this.WebSocketClass(this.url);
            this.socket = socket;
            const fail = () => reject(new AuthoritativeClientError('CONNECTION_FAILED'));
            socket.addEventListener('open', () => {
                socket.removeEventListener('error', fail);
                this.onConnectionState('connected');
                resolve();
            }, { once: true });
            socket.addEventListener('error', fail, { once: true });
            socket.addEventListener('message', event => this._message(event.data));
            socket.addEventListener('close', () => {
                if (this.socket === socket) this.socket = null;
                this.onConnectionState('disconnected');
                this._rejectPending('CONNECTION_CLOSED');
                if (!this.manualClose && !this.recovering && this.recoveryToken && this.accessToken) {
                    this._recoverSeat();
                }
            });
        });
    }

    async _recoverSeat() {
        if (this.recovering || this.manualClose || !this.recoveryToken || !this.accessToken) return false;
        this.recovering = true;
        const generation = ++this.recoveryGeneration;
        const deadline = Date.now() + this.reconnectWindowMs;
        let attempt = 0;
        this.onConnectionState('reconnecting');
        try {
            while (!this.manualClose && generation === this.recoveryGeneration && Date.now() < deadline) {
                const delay = this.reconnectDelaysMs[Math.min(attempt++, this.reconnectDelaysMs.length - 1)];
                await new Promise(resolve => setTimeout(resolve, delay));
                if (this.manualClose || generation !== this.recoveryGeneration) return false;
                try {
                    await this._open();
                    await this._request('session.hello', {
                        accessToken: this.accessToken,
                        clientVersion: '0.1.0',
                    });
                    await this.resumeSeat(this.roomCode, this.recoveryToken);
                    this.onConnectionState('recovered');
                    return true;
                } catch (error) {
                    const socket = this.socket;
                    this.socket = null;
                    if (socket) socket.close();
                    this._rejectPending('CONNECTION_CLOSED');
                }
            }
            this.onConnectionState('recovery_failed');
            return false;
        } finally {
            this.recovering = false;
        }
    }

    _request(type, payload) {
        if (!this.socket || this.socket.readyState !== this.WebSocketClass.OPEN) {
            return Promise.reject(new AuthoritativeClientError('NOT_CONNECTED'));
        }
        const requestId = this._requestId();
        const message = {
            v: 1,
            type,
            requestId,
            clientSeq: ++this.clientSeq,
            lastServerSeq: this.lastServerSeq,
            payload,
        };
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new AuthoritativeClientError('REQUEST_TIMEOUT'));
            }, this.requestTimeoutMs);
            this.pending.set(requestId, { resolve, reject, timer });
            this.socket.send(JSON.stringify(message));
        });
    }

    _message(raw) {
        let message;
        try {
            message = JSON.parse(typeof raw === 'string' ? raw : String(raw));
        } catch (error) {
            this.close();
            return;
        }
        if (!message || message.v !== 1 || typeof message.type !== 'string') {
            this.close();
            return;
        }
        if (Number.isSafeInteger(message.serverSeq) && message.serverSeq > 0) {
            const isResponseForPending = message.ackRequestId && this.pending.has(message.ackRequestId);
            if (!isResponseForPending && this.lastServerSeq > 0 && message.serverSeq > this.lastServerSeq + 1) {
                this.onConnectionState('resyncing');
                this.requestSnapshot().catch(() => {});
            }
            this.lastServerSeq = Math.max(this.lastServerSeq, message.serverSeq);
        }
        const snapshot = this._snapshotFrom(message);
        if (snapshot) {
            if (!this._validSnapshotFingerprint(message, snapshot)) {
                this.onConnectionState('desync');
                this.requestSnapshot().catch(() => {});
            } else {
                this.onSnapshot(snapshot, message);
            }
        }
        if (message.type === 'match.rejected' || message.type === 'server.error') {
            this.onRejected(message.payload && message.payload.code, message);
        }
        if (message.ackRequestId) {
            const pending = this.pending.get(message.ackRequestId);
            if (pending) {
                clearTimeout(pending.timer);
                this.pending.delete(message.ackRequestId);
                if (message.type === 'match.rejected' || message.type === 'server.error') {
                    pending.reject(new AuthoritativeClientError(message.payload && message.payload.code || 'REJECTED'));
                } else {
                    pending.resolve(message);
                }
            }
        }
    }

    _snapshotFrom(message) {
        if (message.type === 'room.snapshot') return message;
        if (message.payload && message.payload.snapshot && message.payload.snapshot.type === 'room.snapshot') {
            return message.payload.snapshot;
        }
        return null;
    }

    _validSnapshotFingerprint(message, snapshot) {
        if (typeof MatchReducer === 'undefined') return true;
        if (snapshot.stateFingerprint
            && snapshot.stateFingerprint !== MatchReducer.fingerprint(snapshot.payload)) return false;
        if (message.type === 'match.ack' && message.stateFingerprint && message.payload.snapshot) {
            return message.stateFingerprint === MatchReducer.fingerprint(message.payload.snapshot);
        }
        return true;
    }

    _acceptLease(message) {
        const payload = message && message.payload;
        if (!payload || typeof payload.recoveryToken !== 'string' || typeof payload.roomCode !== 'string') {
            throw new AuthoritativeClientError('BAD_LEASE');
        }
        this.recoveryToken = payload.recoveryToken;
        this.roomCode = payload.roomCode;
        this.seatId = payload.seatId;
        return message;
    }

    _requestId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID().replaceAll('-', '');
        }
        return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    }

    _rejectPending(code) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new AuthoritativeClientError(code));
        }
        this.pending.clear();
    }
}

class AuthoritativeAccountClient {
    static async createGuest(baseUrl, displayName) {
        const response = await fetch(`${String(baseUrl).replace(/\/$/, '')}/v1/guest`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ displayName }),
        });
        const body = await response.json();
        if (!response.ok) throw new AuthoritativeClientError(body.error || 'GUEST_FAILED');
        return body;
    }

    static async updateSettings(baseUrl, accessToken, settings) {
        const response = await fetch(`${String(baseUrl).replace(/\/$/, '')}/v1/account/settings`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ settings }),
        });
        const body = await response.json();
        if (!response.ok) throw new AuthoritativeClientError(body.error || 'SETTINGS_SYNC_FAILED');
        return body.account;
    }
}

if (typeof window !== 'undefined') {
    window.AuthoritativeClientError = AuthoritativeClientError;
    window.AuthoritativeGameClient = AuthoritativeGameClient;
    window.AuthoritativeAccountClient = AuthoritativeAccountClient;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AuthoritativeAccountClient, AuthoritativeClientError, AuthoritativeGameClient };
}
