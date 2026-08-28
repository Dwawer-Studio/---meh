'use strict';

const http = require('node:http');
const net = require('node:net');
const { URL } = require('node:url');
const { WebSocket, WebSocketServer } = require('ws');
const { AccountService } = require('./account-service');
const { MajlisError, MajlisService } = require('./majlis-service');
const { ServiceMetrics } = require('./metrics');
const {
    MAX_MESSAGE_BYTES, ProtocolError, parseClientMessage, serverMessage,
} = require('./protocol');
const { TokenBucketLimiter } = require('./rate-limiter');
const { RoomError, RoomService } = require('./room-service');
const {
    ipHash, randomId, safeEqual,
} = require('./security');

const JSON_LIMIT = 8 * 1024;
const HELLO_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 10_000;
const TURN_DURATION_MS = 10_000;

function json(response, status, body) {
    const data = Buffer.from(JSON.stringify(body));
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': data.length,
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
    });
    response.end(data);
}

async function readJson(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > JSON_LIMIT) throw Object.assign(new Error('BODY_TOO_LARGE'), { status: 413 });
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch (error) {
        throw Object.assign(new Error('BAD_JSON'), { status: 400 });
    }
}

function bearer(request) {
    const header = request.headers.authorization;
    const match = typeof header === 'string' && header.match(/^Bearer ([A-Za-z0-9_-]{24,256})$/);
    return match ? match[1] : null;
}

class RealtimeRuntime {
    constructor(options) {
        this.store = options.store;
        this.pepper = options.pepper;
        this.allowedOrigins = new Set(options.allowedOrigins || []);
        this.requireTls = options.requireTls === true;
        this.trustProxy = options.trustProxy === true;
        this.internalAdminToken = options.internalAdminToken || null;
        this.metrics = options.metrics || new ServiceMetrics();
        this.accounts = options.accounts || new AccountService(this.store, { pepper: this.pepper });
        const analyticsToken = (value, domain) => ipHash(`${domain}:${value}`, this.pepper);
        this.majalis = options.majalis || new MajlisService(this.store, {
            metrics: this.metrics, analyticsToken,
        });
        this.rooms = options.rooms || new RoomService(this.store, {
            pepper: this.pepper,
            metrics: this.metrics,
            authorizeMajlisMembership: (majlisId, accountId) => this.majalis.assertMembership(majlisId, accountId),
            onMatchCompleted: roomId => this.majalis.recordCompletedMatch(roomId),
            analyticsToken,
        });
        this.joinLimiter = new TokenBucketLimiter({ capacity: 10, refillPerSecond: 10 / 60 });
        this.accountLimiter = new TokenBucketLimiter({ capacity: 10, refillPerSecond: 10 / 60 });
        this.actionLimiter = new TokenBucketLimiter({ capacity: 8, refillPerSecond: 4 });
        this.contexts = new Map();
        this.turnTimers = new Map();
        this.server = http.createServer((request, response) => this._http(request, response));
        this.wss = new WebSocketServer({
            noServer: true,
            clientTracking: true,
            maxPayload: MAX_MESSAGE_BYTES,
            perMessageDeflate: false,
        });
        this.server.on('upgrade', (request, socket, head) => this._upgrade(request, socket, head));
        this.wss.on('connection', (socket, request) => this._connected(socket, request));
        this.heartbeat = null;
        this.maintenance = null;
    }

    async listen(port = 8787, host = '127.0.0.1') {
        await new Promise((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(port, host, () => {
                this.server.off('error', reject);
                resolve();
            });
        });
        this.heartbeat = setInterval(() => this._heartbeat(), HEARTBEAT_MS);
        if (this.heartbeat.unref) this.heartbeat.unref();
        this.maintenance = setInterval(() => this.store.prune(Date.now()).catch(() => {
            this.metrics.increment('maintenance.prune_error');
        }), 60 * 60 * 1000);
        if (this.maintenance.unref) this.maintenance.unref();
        return this.server.address();
    }

    async close() {
        if (this.heartbeat) clearInterval(this.heartbeat);
        if (this.maintenance) clearInterval(this.maintenance);
        for (const timer of this.turnTimers.values()) clearTimeout(timer.handle);
        for (const socket of this.wss.clients) socket.close(1001, 'server shutdown');
        await new Promise(resolve => this.wss.close(resolve));
        await new Promise(resolve => this.server.close(resolve));
    }

    async _http(request, response) {
        const requestUrl = new URL(request.url, 'http://localhost');
        try {
            if (this.requireTls && requestUrl.pathname.startsWith('/v1/')
                && request.headers['x-forwarded-proto'] !== 'https') {
                return json(response, 403, { error: 'TLS_REQUIRED' });
            }
            const origin = request.headers.origin;
            if (origin) {
                if (!this.allowedOrigins.has(origin)) return json(response, 403, { error: 'ORIGIN_DENIED' });
                response.setHeader('access-control-allow-origin', origin);
                response.setHeader('vary', 'origin');
                response.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
                response.setHeader('access-control-allow-headers', 'authorization,content-type');
            }
            if (request.method === 'OPTIONS') {
                response.writeHead(204, { 'cache-control': 'no-store' });
                response.end();
                return;
            }
            if (request.method === 'GET' && requestUrl.pathname === '/health/live') {
                return json(response, 200, { ok: true });
            }
            if (request.method === 'GET' && requestUrl.pathname === '/health/ready') {
                return json(response, 200, { ok: true, realtimeConnections: this.contexts.size });
            }
            if (request.method === 'GET' && requestUrl.pathname === '/internal/metrics') {
                if (!this._internalAuthorized(request)) return json(response, 404, { error: 'NOT_FOUND' });
                return json(response, 200, this.metrics.snapshot());
            }
            if (request.method === 'GET' && requestUrl.pathname === '/internal/moderation/reports') {
                if (!this._internalAuthorized(request)) return json(response, 404, { error: 'NOT_FOUND' });
                return json(response, 200, { reports: await this.store.listModerationReports(100) });
            }
            const moderationRoute = requestUrl.pathname
                .match(/^\/internal\/moderation\/reports\/(report_[A-Za-z0-9_-]{8,96})$/);
            if (request.method === 'PATCH' && moderationRoute) {
                if (!this._internalAuthorized(request)) return json(response, 404, { error: 'NOT_FOUND' });
                const body = await readJson(request);
                if (!['reviewing', 'closed', 'dismissed'].includes(body.status)) {
                    return json(response, 400, { error: 'INVALID_REPORT_STATUS' });
                }
                const reviewedAt = new Date().toISOString();
                const report = await this.store.updateModerationReport(
                    moderationRoute[1], body.status, reviewedAt,
                );
                await this.store.appendAudit({
                    eventType: 'moderation.report_updated', accountId: null, roomId: report.roomId,
                    ipHash: null, metadata: { reportId: report.reportId, status: body.status },
                    createdAt: reviewedAt,
                });
                this.metrics.increment('moderation.report_updated', { status: body.status });
                return json(response, 200, { report });
            }
            if (request.method === 'POST' && requestUrl.pathname === '/v1/guest') {
                if (this._limitAccountRequest(request, response, 'guest')) return;
                const body = await readJson(request);
                const result = await this.accounts.createGuest(body.displayName);
                this.metrics.increment('account.guest_created');
                return json(response, 201, result);
            }
            if (request.method === 'POST' && requestUrl.pathname === '/v1/account/upgrade') {
                if (this._limitAccountRequest(request, response, 'upgrade')) return;
                const auth = await this.accounts.authenticate(bearer(request));
                if (!auth) return json(response, 401, { error: 'UNAUTHENTICATED' });
                const body = await readJson(request);
                const account = await this.accounts.upgrade(auth.account.accountId, body.credential, body.displayName);
                this.metrics.increment('account.upgraded');
                return json(response, 200, { account });
            }
            if (request.method === 'POST' && requestUrl.pathname === '/v1/account/login') {
                if (this._limitAccountRequest(request, response, 'login')) return;
                const body = await readJson(request);
                const result = await this.accounts.login(body.accountId, body.credential);
                this.metrics.increment('account.login');
                return json(response, 200, result);
            }
            if (request.method === 'PATCH' && requestUrl.pathname === '/v1/account/settings') {
                const auth = await this.accounts.authenticate(bearer(request));
                if (!auth) return json(response, 401, { error: 'UNAUTHENTICATED' });
                const body = await readJson(request);
                const account = await this.accounts.updateSettings(auth.account.accountId, body.settings);
                return json(response, 200, { account });
            }
            if (request.method === 'GET' && requestUrl.pathname === '/v1/account/sync') {
                const auth = await this.accounts.authenticate(bearer(request));
                if (!auth) return json(response, 401, { error: 'UNAUTHENTICATED' });
                return json(response, 200, await this.accounts.syncState(auth.account.accountId));
            }
            if (request.method === 'GET' && requestUrl.pathname === '/v1/majalis') {
                const auth = await this.accounts.authenticate(bearer(request));
                if (!auth) return json(response, 401, { error: 'UNAUTHENTICATED' });
                return json(response, 200, { majalis: await this.majalis.list(auth.account.accountId) });
            }
            if (request.method === 'GET' && requestUrl.pathname === '/v1/reminders/due') {
                const auth = await this.accounts.authenticate(bearer(request));
                if (!auth) return json(response, 401, { error: 'UNAUTHENTICATED' });
                const reminders = await this.majalis.claimDueReminders(auth.account.accountId);
                if (reminders.length) this.metrics.increment('majlis.reminders_delivered', {}, reminders.length);
                return json(response, 200, { reminders });
            }
            const majlisDetailRoute = requestUrl.pathname.match(/^\/v1\/majalis\/(majlis_[A-Za-z0-9_-]{8,96})$/);
            if (request.method === 'GET' && majlisDetailRoute) {
                const auth = await this.accounts.authenticate(bearer(request));
                if (!auth) return json(response, 401, { error: 'UNAUTHENTICATED' });
                return json(response, 200, {
                    majlis: await this.majalis.detail(auth.account.accountId, majlisDetailRoute[1]),
                });
            }
            const majlisScheduleRoute = requestUrl.pathname
                .match(/^\/v1\/majalis\/(majlis_[A-Za-z0-9_-]{8,96})\/invitations$/);
            if (request.method === 'POST' && majlisScheduleRoute) {
                const auth = await this.accounts.authenticate(bearer(request));
                if (!auth) return json(response, 401, { error: 'UNAUTHENTICATED' });
                const body = await readJson(request);
                const invitation = await this.majalis.schedule(
                    auth.account.accountId, majlisScheduleRoute[1], body.scheduledFor,
                );
                this.metrics.increment('majlis.invitation_created');
                return json(response, 201, { invitation });
            }
            const reminderRoute = requestUrl.pathname
                .match(/^\/v1\/invitations\/(invite_[A-Za-z0-9_-]{8,96})\/reminder$/);
            if (request.method === 'PATCH' && reminderRoute) {
                const auth = await this.accounts.authenticate(bearer(request));
                if (!auth) return json(response, 401, { error: 'UNAUTHENTICATED' });
                const body = await readJson(request);
                const reminder = await this.majalis.setReminder(
                    auth.account.accountId, reminderRoute[1], body.enabled,
                );
                return json(response, 200, { reminder });
            }
            if (request.method === 'DELETE' && requestUrl.pathname === '/v1/account') {
                const auth = await this.accounts.authenticate(bearer(request));
                if (!auth) return json(response, 401, { error: 'UNAUTHENTICATED' });
                await this.accounts.deleteAccount(auth.account.accountId);
                for (const [socket, context] of this.contexts) {
                    if (context.account && context.account.accountId === auth.account.accountId) socket.close(1008, 'account deleted');
                }
                this.metrics.increment('account.deleted');
                return json(response, 200, { deleted: true });
            }
            return json(response, 404, { error: 'NOT_FOUND' });
        } catch (error) {
            this.metrics.increment('http.error', { code: error.message || 'UNKNOWN' });
            return json(response, error.status || 400, { error: error.message || 'BAD_REQUEST' });
        }
    }

    _limitAccountRequest(request, response, scope) {
        const key = `${scope}:${ipHash(this._clientAddress(request), this.pepper)}`;
        const limited = this.accountLimiter.consume(key);
        if (limited.allowed) return false;
        response.setHeader('retry-after', String(Math.max(1, Math.ceil(limited.retryAfterMs / 1000))));
        this.metrics.increment('http.rate_limited', { scope });
        json(response, 429, { error: 'RATE_LIMITED' });
        return true;
    }

    _upgrade(request, socket, head) {
        const requestUrl = new URL(request.url, 'http://localhost');
        const remoteHash = ipHash(this._clientAddress(request), this.pepper);
        const limited = this.joinLimiter.consume(remoteHash);
        if (requestUrl.pathname !== '/v1/realtime' || !limited.allowed || !this._originAllowed(request)
            || (this.requireTls && request.headers['x-forwarded-proto'] !== 'https')) {
            socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            socket.destroy();
            this.metrics.increment('realtime.upgrade_rejected');
            return;
        }
        this.wss.handleUpgrade(request, socket, head, ws => this.wss.emit('connection', ws, request));
    }

    _connected(socket, request) {
        const context = {
            connectionSessionId: randomId('conn'),
            account: null,
            roomId: null,
            seatId: null,
            lastClientSeq: 0,
            lastServerSeq: 0,
            responseCache: new Map(),
            alive: true,
            ipHash: ipHash(this._clientAddress(request), this.pepper),
        };
        this.contexts.set(socket, context);
        const helloTimer = setTimeout(() => {
            if (!context.account) socket.close(1008, 'hello timeout');
        }, HELLO_TIMEOUT_MS);
        socket.on('pong', () => { context.alive = true; });
        socket.on('message', data => this._message(socket, context, data));
        socket.on('close', async () => {
            clearTimeout(helloTimer);
            this.contexts.delete(socket);
            if (context.roomId) {
                await this.rooms.disconnect(context.roomId, context.connectionSessionId).catch(() => {});
                const leaseTimer = setTimeout(() => this._expireLease(context.roomId), this.rooms.seatLeaseMs + 25);
                if (leaseTimer.unref) leaseTimer.unref();
            }
            this.metrics.gauge('realtime.connections', this.contexts.size);
        });
        socket.on('error', () => this.metrics.increment('realtime.socket_error'));
        this.metrics.gauge('realtime.connections', this.contexts.size);
    }

    _clientAddress(request) {
        if (this.trustProxy) {
            const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
            if (net.isIP(forwarded)) return forwarded;
        }
        return request.socket.remoteAddress || 'unknown';
    }

    async _message(socket, context, raw) {
        const startedAt = Date.now();
        let message;
        try {
            message = parseClientMessage(raw);
            const cached = context.responseCache.get(message.requestId);
            if (cached) return this._send(socket, cached);
            if (message.clientSeq !== context.lastClientSeq + 1) throw new ProtocolError('BAD_SEQUENCE');
            if (!this.actionLimiter.consume(context.connectionSessionId).allowed) throw new ProtocolError('RATE_LIMITED');
            let response;
            if (message.type === 'session.hello') {
                if (context.account) throw new ProtocolError('ALREADY_AUTHENTICATED');
                const auth = await this.accounts.authenticate(message.payload.accessToken);
                if (!auth) throw new ProtocolError('UNAUTHENTICATED');
                context.account = auth.account;
                response = serverMessage('session.welcome', {
                    ackRequestId: message.requestId,
                    payload: { connectionSessionId: context.connectionSessionId, account: auth.account },
                });
            } else {
                if (!context.account) throw new ProtocolError('HELLO_REQUIRED');
                response = await this._dispatch(socket, context, message);
            }
            context.lastClientSeq = message.clientSeq;
            if (response) {
                context.responseCache.set(message.requestId, response);
                this._trimCache(context.responseCache);
                this._send(socket, response);
            }
            this.metrics.observe('realtime.action_ack_ms', Date.now() - startedAt, { type: message.type });
        } catch (error) {
            const code = error.code || 'SERVER_ERROR';
            if (!(error instanceof ProtocolError) && !(error instanceof RoomError)
                && !(error instanceof MajlisError) && context.roomId) {
                this.metrics.increment('room.failure', { operation: message && message.type || 'unparsed' });
            }
            if (message && code !== 'BAD_SEQUENCE') context.lastClientSeq = message.clientSeq;
            const responseType = error instanceof MajlisError
                ? 'social.rejected'
                : (error instanceof ProtocolError || error instanceof RoomError ? 'match.rejected' : 'server.error');
            const response = serverMessage(
                responseType,
                { ackRequestId: message && message.requestId, payload: { code } },
            );
            if (message && code !== 'BAD_SEQUENCE') context.responseCache.set(message.requestId, response);
            this._send(socket, response);
            this.metrics.increment('realtime.message_rejected', { code });
            this.store.appendAudit({
                eventType: 'protocol.rejected',
                accountId: context.account && context.account.accountId,
                roomId: context.roomId,
                ipHash: context.ipHash,
                metadata: { code, type: message && message.type || 'unparsed' },
                createdAt: new Date().toISOString(),
            }).catch(() => this.metrics.increment('audit.write_error'));
        }
    }

    async _dispatch(socket, context, message) {
        if (message.type === 'room.create') {
            const created = await this.rooms.createRoom(context.account, context.connectionSessionId, {
                mode: message.payload.mode,
                majlisId: message.payload.majlisId,
                clientSeq: message.clientSeq,
            });
            context.roomId = created.room.roomId;
            context.seatId = created.seatId;
            const snapshot = await this.rooms.snapshot(context.roomId, context.connectionSessionId);
            context.lastServerSeq = snapshot.serverSeq;
            this._scheduleFromView(context.roomId, snapshot);
            return serverMessage('seat.lease', {
                serverSeq: snapshot.serverSeq,
                ackRequestId: message.requestId,
                stateVersion: snapshot.stateVersion,
                payload: { roomCode: created.room.roomCode, seatId: created.seatId,
                    recoveryToken: created.recoveryToken, snapshot },
            });
        }
        if (message.type === 'room.join') {
            const joined = await this.rooms.joinRoom(message.payload.roomCode, context.account,
                context.connectionSessionId, message.clientSeq);
            context.roomId = joined.room.roomId;
            context.seatId = joined.seatId;
            const snapshot = await this.rooms.snapshot(context.roomId, context.connectionSessionId);
            await this._broadcastRoom(context.roomId, socket);
            return serverMessage('seat.lease', {
                serverSeq: snapshot.serverSeq, ackRequestId: message.requestId,
                stateVersion: snapshot.stateVersion,
                payload: { roomCode: joined.room.roomCode, seatId: joined.seatId,
                    recoveryToken: joined.recoveryToken, snapshot },
            });
        }
        if (message.type === 'seat.resume') {
            const resumed = await this.rooms.resume(message.payload.roomCode, message.payload.recoveryToken,
                context.account, context.connectionSessionId, message.clientSeq);
            context.roomId = resumed.roomId;
            context.seatId = resumed.seatId;
            this._scheduleFromView(context.roomId, resumed.snapshot);
            return serverMessage('seat.lease', {
                serverSeq: resumed.snapshot.serverSeq, ackRequestId: message.requestId,
                stateVersion: resumed.snapshot.stateVersion,
                payload: { roomCode: resumed.roomCode, seatId: resumed.seatId,
                    recoveryToken: resumed.recoveryToken, snapshot: resumed.snapshot },
            });
        }
        if (!context.roomId) throw new RoomError('ROOM_REQUIRED');
        if (message.type === 'majlis.create') {
            let majlis = await this.majalis.createFromRoom(context.account, context.roomId, message.payload);
            await this.majalis.recordCompletedMatch(context.roomId);
            majlis = await this.majalis.detail(context.account.accountId, majlis.majlisId);
            await this._broadcastRoom(context.roomId, socket);
            this.metrics.increment('majlis.created');
            return serverMessage('majlis.created', {
                ackRequestId: message.requestId,
                payload: { majlis },
            });
        }
        if (message.type === 'majlis.accept') {
            const majlis = await this.majalis.acceptFromSourceRoom(
                context.account, context.roomId, message.payload.majlisId,
            );
            this.metrics.increment('majlis.membership_accepted');
            return serverMessage('majlis.accepted', {
                ackRequestId: message.requestId,
                payload: { majlis },
            });
        }
        if (message.type === 'chat.send') {
            const chat = await this.majalis.sendQuickChat(
                context.account.accountId, context.roomId, message.payload.phraseId,
            );
            this._broadcastEvent(context.roomId, serverMessage('chat.phrase', { payload: chat }), socket);
            this.metrics.increment('chat.phrase_sent', { phraseId: chat.phraseId });
            return serverMessage('chat.ack', { ackRequestId: message.requestId, payload: chat });
        }
        if (message.type === 'report.submit') {
            const report = await this.majalis.submitReport(
                context.account.accountId, context.roomId,
                message.payload.reportedSeatId, message.payload.reasonCode,
            );
            this.metrics.increment('moderation.report_submitted', { reasonCode: report.reasonCode });
            return serverMessage('report.ack', {
                ackRequestId: message.requestId,
                payload: { reportId: report.reportId, submitted: true },
            });
        }
        if (message.type === 'snapshot.request') {
            const snapshot = await this.rooms.snapshot(context.roomId, context.connectionSessionId);
            context.lastServerSeq = snapshot.serverSeq;
            return { ...snapshot, ackRequestId: message.requestId };
        }
        if (message.type === 'seat.ready') {
            const views = await this.rooms.ready(context.roomId, context.connectionSessionId,
                message.payload.ready !== false, message.clientSeq);
            this._sendViews(views);
            const own = views[context.connectionSessionId];
            this._scheduleFromView(context.roomId, own);
            return { ...own, ackRequestId: message.requestId };
        }
        if (message.type === 'seat.leave') {
            await this.rooms.leave(context.roomId, context.connectionSessionId);
            const oldRoomId = context.roomId;
            context.roomId = null;
            context.seatId = null;
            await this._broadcastRoom(oldRoomId);
            return serverMessage('seat.left', { ackRequestId: message.requestId, payload: { left: true } });
        }
        if (message.type === 'match.action') {
            const before = await this.rooms.snapshot(context.roomId, context.connectionSessionId);
            if (message.lastServerSeq !== before.serverSeq) {
                this.metrics.increment('match.desync_detected');
                return serverMessage('server.resync_required', {
                    serverSeq: before.serverSeq, ackRequestId: message.requestId,
                    stateVersion: before.stateVersion, payload: { snapshot: before },
                });
            }
            const result = await this.rooms.applyMatchAction(context.roomId, context.connectionSessionId, message);
            context.responseCache.set(message.requestId, result.response);
            this._trimCache(context.responseCache);
            this._send(socket, result.response);
            if (!result.duplicate) {
                this._sendViews(result.humanBroadcasts);
                for (const item of result.systemBroadcasts || []) this._sendViews(item.views);
            }
            const own = result.broadcasts && result.broadcasts[context.connectionSessionId];
            if (own) this._scheduleFromView(context.roomId, own);
            return null;
        }
        throw new ProtocolError('BAD_TYPE');
    }

    _scheduleFromView(roomId, view) {
        const existing = this.turnTimers.get(roomId);
        if (existing) clearTimeout(existing.handle);
        const match = view && view.payload && view.payload.match;
        if (!match || match.phase !== 'ACTIVE') {
            this.turnTimers.delete(roomId);
            return;
        }
        const turnId = match.turnId;
        const handle = setTimeout(async () => {
            try {
                const result = await this.rooms.applyTimeout(roomId, turnId);
                if (!result) return;
                this._sendViews(result.timeoutBroadcast.views);
                for (const item of result.systemBroadcasts || []) this._sendViews(item.views);
                const own = Object.values(result.views)[0];
                this._scheduleFromView(roomId, own);
            } catch (error) {
                this.metrics.increment('turn.timeout_error', { code: error.code || 'UNKNOWN' });
            }
        }, TURN_DURATION_MS);
        if (handle.unref) handle.unref();
        this.turnTimers.set(roomId, { turnId, handle });
    }

    async _broadcastRoom(roomId, except = null) {
        for (const [socket, context] of this.contexts) {
            if (socket === except || context.roomId !== roomId || socket.readyState !== WebSocket.OPEN) continue;
            try {
                this._send(socket, await this.rooms.snapshot(roomId, context.connectionSessionId));
            } catch (error) {}
        }
    }

    _sendViews(views, except = null) {
        if (!views) return;
        for (const [socket, context] of this.contexts) {
            if (socket === except || socket.readyState !== WebSocket.OPEN) continue;
            const view = views[context.connectionSessionId];
            if (view) this._send(socket, view);
        }
    }

    _broadcastEvent(roomId, message, except = null) {
        for (const [socket, context] of this.contexts) {
            if (socket === except || context.roomId !== roomId || socket.readyState !== WebSocket.OPEN) continue;
            this._send(socket, message);
        }
    }

    _send(socket, message) {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    }

    async _expireLease(roomId) {
        try {
            const expired = await this.rooms.expireRoomLeases(roomId);
            if (expired) await this._broadcastRoom(roomId);
        } catch (error) {
            this.metrics.increment('seat.lease_expire_error');
        }
    }

    _heartbeat() {
        for (const [socket, context] of this.contexts) {
            if (!context.alive) {
                socket.terminate();
                continue;
            }
            context.alive = false;
            socket.ping();
        }
        this.joinLimiter.prune();
        this.accountLimiter.prune();
        this.actionLimiter.prune();
    }

    _originAllowed(request) {
        if (!this.allowedOrigins.size) return this._isLoopback(request.socket.remoteAddress);
        return this.allowedOrigins.has(request.headers.origin);
    }

    _isLoopback(address) {
        return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
    }

    _internalAuthorized(request) {
        if (!this._isLoopback(request.socket.remoteAddress)) return false;
        return !this.internalAdminToken || safeEqual(bearer(request), this.internalAdminToken);
    }

    _trimCache(cache) {
        while (cache.size > 128) cache.delete(cache.keys().next().value);
    }
}

module.exports = { RealtimeRuntime };
