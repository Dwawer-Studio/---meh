'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { WebSocket } = require('ws');
const { RealtimeRuntime } = require('../server/runtime');
const { MemoryStore } = require('../server/stores/memory-store');

const ORIGIN = 'http://127.0.0.1:4173';
const INTERNAL_ADMIN_TOKEN = 'p3-internal-admin-token-at-least-32-characters';

function queue(socket) {
    const buffered = [];
    const waiters = [];
    socket.on('message', raw => {
        const message = JSON.parse(raw.toString());
        const index = waiters.findIndex(waiter => waiter.predicate(message));
        if (index < 0) return buffered.push(message);
        const waiter = waiters.splice(index, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(message);
    });
    return {
        next(predicate, timeoutMs = 4_000) {
            const index = buffered.findIndex(predicate);
            if (index >= 0) return Promise.resolve(buffered.splice(index, 1)[0]);
            return new Promise((resolve, reject) => {
                const waitingAt = new Error('wait registered').stack;
                const waiter = { predicate, resolve, timer: null };
                waiter.timer = setTimeout(() => {
                    const current = waiters.indexOf(waiter);
                    if (current >= 0) waiters.splice(current, 1);
                    reject(new Error(`Timed out waiting for P3 realtime message; buffered=${buffered
                        .map(message => `${message.type}:${message.ackRequestId || '-'}`).join(',')}\n${waitingAt}`));
                }, timeoutMs);
                waiters.push(waiter);
            });
        },
    };
}

function open(url) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url, { origin: ORIGIN });
        socket.once('open', () => resolve(socket));
        socket.once('error', reject);
    });
}

function send(socket, type, requestId, clientSeq, payload, lastServerSeq = 0) {
    socket.send(JSON.stringify({
        v: 1, type, requestId, clientSeq, lastServerSeq, payload,
    }));
}

async function guest(baseUrl, displayName) {
    const response = await fetch(`${baseUrl}/v1/guest`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ displayName }),
    });
    assert.equal(response.status, 201);
    return response.json();
}

test('P3 realtime and HTTP contracts execute create, consent, chat, report, schedule, and notification',
    { timeout: 30_000 }, async () => {
        const store = new MemoryStore();
        const runtime = new RealtimeRuntime({
            store,
            pepper: 'p3-runtime-test-pepper-at-least-32-chars',
            allowedOrigins: [ORIGIN],
            internalAdminToken: INTERNAL_ADMIN_TOKEN,
        });
        const address = await runtime.listen(0, '127.0.0.1');
        const baseUrl = `http://127.0.0.1:${address.port}`;
        const wsUrl = `ws://127.0.0.1:${address.port}/v1/realtime`;
        const sockets = [];
        try {
            const owner = await guest(baseUrl, 'Runtime Owner');
            const member = await guest(baseUrl, 'Runtime Member');
            const unauthorized = await fetch(`${baseUrl}/v1/majalis`, { headers: { origin: ORIGIN } });
            assert.equal(unauthorized.status, 401);
            const ownerSocket = await open(wsUrl);
            const memberSocket = await open(wsUrl);
            sockets.push(ownerSocket, memberSocket);
            const ownerMessages = queue(ownerSocket);
            const memberMessages = queue(memberSocket);
            send(ownerSocket, 'session.hello', 'request_p3_owner_hi_01', 1,
                { accessToken: owner.accessToken });
            send(memberSocket, 'session.hello', 'request_p3_member_hi_1', 1,
                { accessToken: member.accessToken });
            await ownerMessages.next(message => message.ackRequestId === 'request_p3_owner_hi_01');
            await memberMessages.next(message => message.ackRequestId === 'request_p3_member_hi_1');

            send(ownerSocket, 'room.create', 'request_p3_room_create', 2, { mode: 'private' });
            const ownerLease = await ownerMessages.next(
                message => message.ackRequestId === 'request_p3_room_create',
            );
            const room = ownerLease.payload.snapshot.payload.room;
            send(memberSocket, 'room.join', 'request_p3_room_join_1', 2, { roomCode: room.roomCode });
            const memberLease = await memberMessages.next(
                message => message.ackRequestId === 'request_p3_room_join_1',
            );
            const joinedSnapshot = await ownerMessages.next(
                message => message.type === 'room.snapshot' && message.payload.seats.filter(seat => !seat.isBot).length === 2,
            );
            send(ownerSocket, 'seat.ready', 'request_p3_owner_ready', 3, { ready: true }, joinedSnapshot.serverSeq);
            await ownerMessages.next(message => message.ackRequestId === 'request_p3_owner_ready');
            const memberReadyView = await memberMessages.next(
                message => message.type === 'room.snapshot' && message.payload.room.phase === 'FORMING',
            );
            send(memberSocket, 'seat.ready', 'request_p3_member_ready', 3, { ready: true },
                memberReadyView.serverSeq);
            await memberMessages.next(message => message.ackRequestId === 'request_p3_member_ready');
            const startedSnapshot = await ownerMessages.next(
                message => message.type === 'room.snapshot' && message.payload.room.phase === 'IN_MATCH',
            );
            const stored = await store.getRoom(room.roomId);
            stored.room.phase = 'RESULTS';
            stored.room.mode = 'quick';
            stored.room.matchState.phase = 'COMPLETE';
            stored.room.matchState.winnerId = stored.seats[0].seatId;
            stored.room.serverSeq++;
            await store.updateRoomAndSeats(stored.room, stored.seats);

            send(ownerSocket, 'majlis.create', 'request_p3_majlis_new1', 4, {
                displayName: 'Runtime Majlis', bannerId: 'pearl', tableThemeId: 'classic',
            }, startedSnapshot.serverSeq);
            const created = await ownerMessages.next(
                message => message.ackRequestId === 'request_p3_majlis_new1',
            );
            assert.equal(created.type, 'majlis.created');
            const majlisId = created.payload.majlis.majlisId;
            await memberMessages.next(
                message => message.type === 'room.snapshot' && message.payload.room.majlisId === majlisId,
            );
            send(memberSocket, 'majlis.accept', 'request_p3_majlis_ok_01', 4, { majlisId },
                memberLease.serverSeq);
            const accepted = await memberMessages.next(
                message => message.ackRequestId === 'request_p3_majlis_ok_01',
            );
            assert.equal(accepted.payload.majlis.members.length, 2);

            send(ownerSocket, 'chat.send', 'request_p3_chat_send01', 5, { phraseId: 'kafo' });
            const chatEvent = await memberMessages.next(message => message.type === 'chat.phrase');
            assert.equal(chatEvent.payload.phraseId, 'kafo');
            assert.equal((await ownerMessages.next(
                message => message.ackRequestId === 'request_p3_chat_send01')).type, 'chat.ack');
            send(memberSocket, 'report.submit', 'request_p3_report_001', 5, {
                reportedSeatId: stored.seats[0].seatId, reasonCode: 'harassment',
            });
            assert.equal((await memberMessages.next(
                message => message.ackRequestId === 'request_p3_report_001')).type, 'report.ack');
            const deniedModerationQueue = await fetch(`${baseUrl}/internal/moderation/reports`);
            assert.equal(deniedModerationQueue.status, 404);
            const operatorHeaders = { authorization: `Bearer ${INTERNAL_ADMIN_TOKEN}` };
            const moderationQueue = await fetch(`${baseUrl}/internal/moderation/reports`, {
                headers: operatorHeaders,
            });
            assert.equal(moderationQueue.status, 200);
            const queuedReport = (await moderationQueue.json()).reports[0];
            assert.equal(queuedReport.reasonCode, 'harassment');
            const reviewing = await fetch(`${baseUrl}/internal/moderation/reports/${queuedReport.reportId}`, {
                method: 'PATCH', headers: {
                    ...operatorHeaders, 'content-type': 'application/json',
                },
                body: JSON.stringify({ status: 'reviewing' }),
            });
            assert.equal(reviewing.status, 200);
            assert.equal((await reviewing.json()).report.reportStatus, 'reviewing');

            const authHeaders = { origin: ORIGIN, authorization: `Bearer ${owner.accessToken}` };
            const listResponse = await fetch(`${baseUrl}/v1/majalis`, { headers: authHeaders });
            assert.equal(listResponse.status, 200);
            assert.equal((await listResponse.json()).majalis[0].majlisId, majlisId);
            const scheduledFor = new Date(Date.now() + 20 * 60 * 1000).toISOString();
            const scheduleResponse = await fetch(`${baseUrl}/v1/majalis/${majlisId}/invitations`, {
                method: 'POST',
                headers: { ...authHeaders, 'content-type': 'application/json' },
                body: JSON.stringify({ scheduledFor }),
            });
            assert.equal(scheduleResponse.status, 201);
            const invitation = (await scheduleResponse.json()).invitation;
            const reminderResponse = await fetch(
                `${baseUrl}/v1/invitations/${invitation.invitationId}/reminder`, {
                    method: 'PATCH',
                    headers: { ...authHeaders, 'content-type': 'application/json' },
                    body: JSON.stringify({ enabled: true }),
                },
            );
            assert.equal(reminderResponse.status, 200);
            const savedReminder = store.majlisReminders.get(
                `${invitation.invitationId}:${owner.account.accountId}`,
            );
            savedReminder.remindAt = new Date(Date.now() - 1_000).toISOString();
            const dueResponse = await fetch(`${baseUrl}/v1/reminders/due`, { headers: authHeaders });
            assert.equal(dueResponse.status, 200);
            assert.equal((await dueResponse.json()).reminders.length, 1);
            const secondDue = await fetch(`${baseUrl}/v1/reminders/due`, { headers: authHeaders });
            assert.equal((await secondDue.json()).reminders.length, 0);
            assert.equal(runtime.metrics.snapshot().counters['moderation.report_submitted{reasonCode=harassment}'], 1);
        } finally {
            for (const socket of sockets) socket.close();
            await runtime.close();
        }
    });
