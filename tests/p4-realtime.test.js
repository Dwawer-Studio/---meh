'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { WebSocket } = require('ws');
const { CatalogRegistry } = require('../catalog/catalog-registry');
const { RealtimeRuntime } = require('../server/runtime');
const { MemoryStore } = require('../server/stores/memory-store');
const { expansionCatalog } = require('./helpers/p4-fixture');

const ORIGIN = 'http://127.0.0.1:4173';

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
                const waiter = { predicate, resolve, timer: null };
                waiter.timer = setTimeout(() => {
                    const current = waiters.indexOf(waiter);
                    if (current >= 0) waiters.splice(current, 1);
                    reject(new Error(`Timed out waiting for P4 realtime message: ${buffered
                        .map(message => `${message.type}:${message.payload && message.payload.code || '-'}`)
                        .join(',')}`));
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
    socket.send(JSON.stringify({ v: 1, type, requestId, clientSeq, lastServerSeq, payload }));
}

async function guest(baseUrl, displayName) {
    const response = await fetch(`${baseUrl}/v1/guest`, {
        method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ displayName }),
    });
    assert.equal(response.status, 201);
    return response.json();
}

test('P4 realtime rejects legacy or incomplete clients from a contributed recipe',
    { timeout: 30_000 }, async () => {
        const catalog = expansionCatalog();
        const registry = new CatalogRegistry({
            catalogManifest: catalog,
            expansionEnabled: true,
            enabledContentFlags: ['card_test_strategist'],
            freeRotationDefinitionIds: ['test-strategist'],
        });
        const runtime = new RealtimeRuntime({
            store: new MemoryStore(),
            pepper: 'p4-realtime-pepper-at-least-32-characters',
            allowedOrigins: [ORIGIN],
            catalogRegistry: registry,
            p4Features: {
                cardCatalog: true, tamashiWallet: true, friendlyRecipes: true, verifiedIap: false,
            },
        });
        const address = await runtime.listen(0, '127.0.0.1');
        const baseUrl = `http://127.0.0.1:${address.port}`;
        const wsUrl = `ws://127.0.0.1:${address.port}/v1/realtime`;
        const sockets = [];
        try {
            const [host, incomplete, legacy, compatible] = await Promise.all([
                guest(baseUrl, 'P4 Host'), guest(baseUrl, 'P4 Incomplete'),
                guest(baseUrl, 'P4 Legacy'), guest(baseUrl, 'P4 Compatible'),
            ]);
            const definitionIds = catalog.definitions.map(item => item.definitionId);
            const fullCapability = {
                rulesVersion: '1.0.0', catalogVersion: '1.1.0', definitionIds,
            };

            const hostSocket = await open(wsUrl);
            sockets.push(hostSocket);
            const hostMessages = queue(hostSocket);
            send(hostSocket, 'session.hello', 'request_p4_host_hello', 1, {
                accessToken: host.accessToken, catalogCapability: fullCapability,
            });
            await hostMessages.next(message => message.ackRequestId === 'request_p4_host_hello');
            send(hostSocket, 'room.create', 'request_p4_room_create', 2, { mode: 'private' });
            const lease = await hostMessages.next(message => message.ackRequestId === 'request_p4_room_create');
            const room = lease.payload.snapshot.payload.room;
            send(hostSocket, 'recipe.contribute', 'request_p4_contribute', 3, {
                definitionId: 'test-strategist', replacesDefinitionId: 'dafour',
            }, lease.serverSeq);
            const recipe = await hostMessages.next(message => message.ackRequestId === 'request_p4_contribute');
            assert.equal(recipe.payload.room.recipe.contributions[0].definitionId, 'test-strategist');
            const contributedRecipeId = recipe.payload.room.deckRecipeId;

            const joinAttempt = async (account, capability, requestId) => {
                const socket = await open(wsUrl);
                sockets.push(socket);
                const messages = queue(socket);
                const helloPayload = { accessToken: account.accessToken };
                if (capability) helloPayload.catalogCapability = capability;
                send(socket, 'session.hello', `${requestId}_hello`, 1, helloPayload);
                await messages.next(message => message.ackRequestId === `${requestId}_hello`);
                send(socket, 'room.join', requestId, 2, { roomCode: room.roomCode });
                return messages.next(message => message.ackRequestId === requestId);
            };

            const missingDefinition = await joinAttempt(incomplete, {
                ...fullCapability,
                definitionIds: definitionIds.filter(id => id !== 'test-strategist'),
            }, 'request_p4_join_incomplete');
            assert.equal(missingDefinition.type, 'match.rejected');
            assert.equal(missingDefinition.payload.code, 'CATALOG_UPDATE_REQUIRED');

            const noCapability = await joinAttempt(legacy, null, 'request_p4_join_legacy');
            assert.equal(noCapability.type, 'match.rejected');
            assert.equal(noCapability.payload.code, 'CATALOG_UPDATE_REQUIRED');

            const accepted = await joinAttempt(compatible, fullCapability, 'request_p4_join_compatible');
            assert.equal(accepted.type, 'seat.lease');
            assert.equal(accepted.payload.snapshot.payload.room.deckRecipeId, contributedRecipeId);
        } finally {
            for (const socket of sockets) socket.close();
            await runtime.close();
        }
    });
