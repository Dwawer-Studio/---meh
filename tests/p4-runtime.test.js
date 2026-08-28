'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { CatalogRegistry } = require('../catalog/catalog-registry');
const { RealtimeRuntime } = require('../server/runtime');
const { MemoryStore } = require('../server/stores/memory-store');
const { expansionCatalog } = require('./helpers/p4-fixture');
const { createSignedEnvelope } = require('../tools/sign-catalog');

const ORIGIN = 'http://127.0.0.1:4173';
const ADMIN = 'p4-internal-admin-token-at-least-32-characters';

test('P4 runtime rejects partial economy feature configurations', () => {
    const base = {
        store: new MemoryStore(),
        pepper: 'p4-runtime-dependency-pepper-at-least-32-characters',
    };
    assert.throws(
        () => new RealtimeRuntime({ ...base, p4Features: { cardCatalog: true } }),
        /P4_FEATURE_DEPENDENCY_MISMATCH/,
    );
    assert.throws(
        () => new RealtimeRuntime({ ...base, p4Features: { friendlyRecipes: true } }),
        /P4_FEATURE_DEPENDENCY_MISMATCH/,
    );
    assert.throws(
        () => new RealtimeRuntime({ ...base, p4Features: { verifiedIap: true } }),
        /P4_FEATURE_DEPENDENCY_MISMATCH/,
    );
    assert.throws(
        () => new RealtimeRuntime({ ...base, p4Features: { tamashiWallet: 'true' } }),
        /P4_FEATURE_CONFIGURATION_INVALID/,
    );
    assert.throws(
        () => new RealtimeRuntime({ ...base, p4Features: { tamashiWallet: true, typoFlag: false } }),
        /P4_FEATURE_CONFIGURATION_INVALID/,
    );
});

test('P4 runtime activates only the signed envelope before applying card flags and rotation', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const runtime = new RealtimeRuntime({
        store: new MemoryStore(),
        pepper: 'p4-runtime-envelope-pepper-at-least-32-characters',
        catalogExpansionEnabled: true,
        catalogPublicKey: publicKey,
        catalogEnvelope: createSignedEnvelope(expansionCatalog(), privateKey),
        enabledContentFlags: ['card_test_strategist'],
        freeRotationDefinitionIds: ['test-strategist'],
    });
    assert.equal(runtime.catalogRegistry.current().catalogVersion, '1.1.0');
    assert.equal(runtime.catalogRegistry.isDefinitionEnabled('test-strategist'), true);
    assert.equal(runtime.catalogRegistry.isInFreeRotation('test-strategist'), true);
});

test('P4 cold-start rollback loads the signed history but keeps new rooms on embedded classic', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const envelope = createSignedEnvelope(expansionCatalog(), privateKey);
    const runtime = new RealtimeRuntime({
        store: new MemoryStore(),
        pepper: 'p4-runtime-rollback-pepper-at-least-32-characters',
        catalogExpansionEnabled: false,
        catalogPublicKey: publicKey,
        catalogEnvelope: envelope,
    });
    assert.equal(runtime.catalogRegistry.current().catalogVersion, '1.0.0');
    assert.equal(runtime.catalogRegistry.manifests.has('1.1.0'), true);
    const oldRecipe = runtime.catalogRegistry.manifestForRoom({
        catalogVersion: '1.1.0', deckRecipeId: 'classic-60-v1', recipeSnapshot: null,
    });
    assert.equal(oldRecipe.definitions.some(item => item.definitionId === 'test-strategist'), true);
});

test('P4 HTTP catalog is authenticated, fixed-price, reversible, and IAP fails closed',
    { timeout: 20_000 }, async () => {
        const registry = new CatalogRegistry({
            catalogManifest: expansionCatalog(),
            expansionEnabled: true,
            enabledContentFlags: ['card_test_strategist'],
        });
        const store = new MemoryStore();
        const runtime = new RealtimeRuntime({
            store,
            pepper: 'p4-runtime-pepper-at-least-32-characters',
            allowedOrigins: [ORIGIN],
            internalAdminToken: ADMIN,
            catalogRegistry: registry,
            p4Features: {
                cardCatalog: true, tamashiWallet: true, friendlyRecipes: true, verifiedIap: false,
            },
        });
        const address = await runtime.listen(0, '127.0.0.1');
        const baseUrl = `http://127.0.0.1:${address.port}`;
        try {
            const createdResponse = await fetch(`${baseUrl}/v1/guest`, {
                method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' },
                body: JSON.stringify({ displayName: 'P4 Runtime' }),
            });
            const created = await createdResponse.json();
            assert.equal((await fetch(`${baseUrl}/v1/catalog`, { headers: { origin: ORIGIN } })).status, 401);
            const headers = { origin: ORIGIN, authorization: `Bearer ${created.accessToken}` };
            const initial = await fetch(`${baseUrl}/v1/catalog`, { headers });
            assert.equal(initial.status, 200);
            const catalog = await initial.json();
            assert.equal(catalog.currency.balance, 0);
            assert.equal(store.tamashiWallets.size, 0);
            assert.equal(catalog.cards.find(item => item.definitionId === 'test-strategist').tamashiPrice, 1_200);
            assert.equal(catalog.policy.randomizedPacks, false);
            assert.deepEqual(catalog.policy.earning, {
                completionReward: 100,
                healthyParticipationReward: 20,
                winBonus: 20,
                minimumHumanSeats: 2,
            });

            const originalEconomyState = store.getEconomyState.bind(store);
            store.getEconomyState = async () => { throw new Error('database secret detail'); };
            const sanitizedFailure = await fetch(`${baseUrl}/v1/catalog`, { headers });
            assert.equal(sanitizedFailure.status, 500);
            assert.deepEqual(await sanitizedFailure.json(), { error: 'SERVER_ERROR' });
            store.getEconomyState = originalEconomyState;

            const deniedCatchUp = await fetch(`${baseUrl}/internal/tamashi/catch-up`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
            });
            assert.equal(deniedCatchUp.status, 404);
            const catchUp = await fetch(`${baseUrl}/internal/tamashi/catch-up`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN}` },
                body: JSON.stringify({
                    accountId: created.account.accountId,
                    campaign: {
                        campaignId: 'runtime_campaign_0001', amount: 1_200,
                        eligibleCreatedAfter: '2026-01-01T00:00:00.000Z',
                        expiresAt: '2027-01-01T00:00:00.000Z',
                    },
                }),
            });
            assert.equal(catchUp.status, 200);
            const unlock = await fetch(`${baseUrl}/v1/catalog/unlocks`, {
                method: 'POST',
                headers: { ...headers, 'content-type': 'application/json' },
                body: JSON.stringify({
                    definitionId: 'test-strategist', idempotencyKey: 'runtime_unlock_000001',
                }),
            });
            assert.equal(unlock.status, 200);
            assert.equal((await unlock.json()).wallet.balance, 0);
            const iap = await fetch(`${baseUrl}/v1/economy/purchases/verify`, {
                method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
                body: JSON.stringify({}),
            });
            assert.equal(iap.status, 404);

            const reconcileHeaders = {
                authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json',
            };
            const healthy = await fetch(`${baseUrl}/internal/tamashi/reconcile`, {
                method: 'POST', headers: reconcileHeaders,
            });
            assert.equal(healthy.status, 200);
            assert.equal((await healthy.json()).ok, true);

            store.tamashiWallets.get(created.account.accountId).balance++;
            const unhealthy = await fetch(`${baseUrl}/internal/tamashi/reconcile`, {
                method: 'POST', headers: reconcileHeaders,
            });
            assert.equal(unhealthy.status, 503);
            const report = await unhealthy.json();
            assert.equal(report.ok, false);
            assert.equal(report.economyFrozen, true);
            assert.ok(report.issues.some(item => item.code === 'WALLET_BALANCE_MISMATCH'));
            const frozen = await fetch(`${baseUrl}/internal/tamashi/catch-up`, {
                method: 'POST', headers: reconcileHeaders,
                body: JSON.stringify({ accountId: created.account.accountId, campaign: {} }),
            });
            assert.equal(frozen.status, 503);
            assert.equal((await frozen.json()).error, 'ECONOMY_FROZEN');
        } finally {
            await runtime.close();
        }
    });
