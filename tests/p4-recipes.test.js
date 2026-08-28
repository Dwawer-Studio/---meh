'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { CatalogRegistry } = require('../catalog/catalog-registry');
const { AccountService } = require('../server/account-service');
const { RoomService } = require('../server/room-service');
const { MemoryStore } = require('../server/stores/memory-store');
const { expansionCatalog } = require('./helpers/p4-fixture');

test('P4 friendly rooms authorize one unlocked contribution and expose the shared recipe before ready', async () => {
    const store = new MemoryStore();
    const accounts = new AccountService(store, { pepper: 'p4-recipe-test-pepper-at-least-32-chars' });
    const host = await accounts.createGuest('Recipe Host');
    const guest = await accounts.createGuest('Recipe Guest');
    const catalog = expansionCatalog();
    const registry = new CatalogRegistry({
        catalogManifest: catalog,
        expansionEnabled: true,
        enabledContentFlags: ['card_test_strategist'],
    });
    store.cardUnlocks.set(`${host.account.accountId}:test-strategist`, {
        accountId: host.account.accountId, definitionId: 'test-strategist',
        acquiredWith: 'tamashi', tamashiPrice: 1_200, unlockedAt: new Date().toISOString(),
    });
    const rooms = new RoomService(store, {
        pepper: 'p4-recipe-test-pepper-at-least-32-chars',
        catalogRegistry: registry, friendlyRecipesEnabled: true,
    });
    const capability = {
        rulesVersion: '1.0.0', catalogVersion: '1.1.0',
        definitionIds: catalog.definitions.map(item => item.definitionId),
    };
    const created = await rooms.createRoom(host.account, 'conn_recipe_host_0001', {
        clientSeq: 1, catalogCapability: capability,
    });
    const joined = await rooms.joinRoom(
        created.room.roomCode, guest.account, 'conn_recipe_guest_001', 1, capability,
    );
    const views = await rooms.setRecipeContribution(created.room.roomId, 'conn_recipe_host_0001', {
        definitionId: 'test-strategist', replacesDefinitionId: 'dafour',
    });
    const room = views.conn_recipe_host_0001.payload.room;
    assert.match(room.deckRecipeId, /^friendly-/);
    assert.equal(room.recipe.locked, false);
    assert.equal(room.recipe.contributions.length, 1);
    assert.equal(room.recipe.contributions[0].definitionId, 'test-strategist');
    await rooms.disconnect(created.room.roomId, 'conn_recipe_guest_001');
    await assert.rejects(
        () => rooms.resume(
            created.room.roomCode, joined.recoveryToken, guest.account,
            'conn_recipe_guest_002', 2, {
                ...capability,
                definitionIds: capability.definitionIds.filter(id => id !== 'test-strategist'),
            },
        ),
        error => error.code === 'CATALOG_UPDATE_REQUIRED',
    );
    const resumed = await rooms.resume(
        created.room.roomCode, joined.recoveryToken, guest.account,
        'conn_recipe_guest_002', 2, capability,
    );
    assert.equal(resumed.seatId, joined.seatId);
    await rooms.ready(created.room.roomId, 'conn_recipe_host_0001', true, 2);
    await rooms.ready(created.room.roomId, 'conn_recipe_guest_002', true, 3);
    const started = await store.getRoom(created.room.roomId);
    assert.equal(started.room.phase, 'IN_MATCH');
    assert.ok(started.room.recipeLockedAt);
    assert.equal(started.room.matchState.deckRecipeId, room.deckRecipeId);
    assert.equal(started.room.matchState.catalogVersion, '1.1.0');
    assert.equal(started.room.matchState.deck.concat(
        started.room.matchState.discard,
        ...started.room.matchState.players.map(player => player.hand),
    ).some(card => card.definitionId === 'test-strategist'), true);
});

test('P4 public quick play remains standardized classic and friendly ownership cannot affect it', async () => {
    const store = new MemoryStore();
    const accounts = new AccountService(store, { pepper: 'p4-quick-test-pepper-at-least-32-characters' });
    const player = await accounts.createGuest('Quick Standard');
    const registry = new CatalogRegistry({ catalogManifest: expansionCatalog() });
    const rooms = new RoomService(store, {
        pepper: 'p4-quick-test-pepper-at-least-32-characters',
        catalogRegistry: registry, friendlyRecipesEnabled: true,
    });
    const created = await rooms.createRoom(player.account, 'conn_quick_standard_1', { mode: 'quick' });
    assert.equal(created.room.deckRecipeId, 'classic-60-v1');
    assert.equal(created.room.matchState.deckRecipeId, 'classic-60-v1');
    await assert.rejects(() => rooms.setRecipeContribution(
        created.room.roomId, 'conn_quick_standard_1', {
            definitionId: 'test-strategist', replacesDefinitionId: 'dafour',
        }), error => error.code === 'FRIENDLY_RECIPE_UNAVAILABLE');
});

test('P4 disabling a contributed card blocks match start while classic stays available', async () => {
    const store = new MemoryStore();
    const accounts = new AccountService(store, { pepper: 'p4-kill-switch-pepper-at-least-32-characters' });
    const host = await accounts.createGuest('Kill Switch Host');
    const guest = await accounts.createGuest('Kill Switch Guest');
    const catalog = expansionCatalog();
    const registry = new CatalogRegistry({
        catalogManifest: catalog,
        expansionEnabled: true,
        enabledContentFlags: ['card_test_strategist'],
    });
    store.cardUnlocks.set(`${host.account.accountId}:test-strategist`, {
        accountId: host.account.accountId, definitionId: 'test-strategist',
        acquiredWith: 'tamashi', tamashiPrice: 1_200, unlockedAt: new Date().toISOString(),
    });
    const rooms = new RoomService(store, {
        pepper: 'p4-kill-switch-pepper-at-least-32-characters',
        catalogRegistry: registry, friendlyRecipesEnabled: true,
    });
    const capability = {
        rulesVersion: '1.0.0', catalogVersion: '1.1.0',
        definitionIds: catalog.definitions.map(item => item.definitionId),
    };
    const created = await rooms.createRoom(host.account, 'conn_kill_switch_host', {
        clientSeq: 1, catalogCapability: capability,
    });
    await rooms.joinRoom(created.room.roomCode, guest.account, 'conn_kill_switch_guest', 1, capability);
    await rooms.setRecipeContribution(created.room.roomId, 'conn_kill_switch_host', {
        definitionId: 'test-strategist', replacesDefinitionId: 'dafour',
    });
    await rooms.ready(created.room.roomId, 'conn_kill_switch_host', true, 2);
    registry.disableContentFlag('card_test_strategist');
    await assert.rejects(
        () => rooms.ready(created.room.roomId, 'conn_kill_switch_guest', true, 2),
        error => error.code === 'CARD_CONTENT_DISABLED',
    );
    const stopped = await store.getRoom(created.room.roomId);
    assert.equal(stopped.room.phase, 'FORMING');

    const classic = await rooms.createRoom(host.account, 'conn_kill_switch_classic', {
        mode: 'quick', clientSeq: 1,
    });
    assert.equal(classic.room.phase, 'IN_MATCH');
    assert.equal(classic.room.deckRecipeId, 'classic-60-v1');
});

test('P4 free rotation permits trial contribution without granting permanent ownership', async () => {
    const store = new MemoryStore();
    const accounts = new AccountService(store, { pepper: 'p4-rotation-pepper-at-least-32-characters' });
    const player = await accounts.createGuest('Rotation Player');
    const catalog = expansionCatalog();
    const registry = new CatalogRegistry({
        catalogManifest: catalog,
        expansionEnabled: true,
        enabledContentFlags: ['card_test_strategist'],
        freeRotationDefinitionIds: ['test-strategist'],
    });
    const rooms = new RoomService(store, {
        pepper: 'p4-rotation-pepper-at-least-32-characters',
        catalogRegistry: registry, friendlyRecipesEnabled: true,
    });
    const created = await rooms.createRoom(player.account, 'conn_rotation_player', {
        clientSeq: 1,
        catalogCapability: {
            rulesVersion: '1.0.0', catalogVersion: '1.1.0',
            definitionIds: catalog.definitions.map(item => item.definitionId),
        },
    });
    const views = await rooms.setRecipeContribution(created.room.roomId, 'conn_rotation_player', {
        definitionId: 'test-strategist', replacesDefinitionId: 'dafour',
    });
    assert.equal(views.conn_rotation_player.payload.room.recipe.contributions.length, 1);
    assert.equal(store.cardUnlocks.size, 0);
});
