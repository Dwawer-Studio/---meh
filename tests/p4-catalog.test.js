'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
    CatalogRegistry, compileFriendlyRecipe,
    validateCatalogManifest, verifySignedEnvelope,
} = require('../catalog/catalog-registry');
const { MEH_CORE_MANIFEST, MEH_CATALOG_MANIFEST } = require('../game/game-manifests');
const { createSignedEnvelope } = require('../tools/sign-catalog');
const { expansionCatalog } = require('./helpers/p4-fixture');

test('P4 catalog accepts the immutable classic baseline without changing its cards or art', () => {
    assert.equal(validateCatalogManifest(MEH_CORE_MANIFEST, MEH_CATALOG_MANIFEST), true);
    assert.equal(MEH_CATALOG_MANIFEST.catalogVersion, '1.0.0');
    assert.equal(MEH_CATALOG_MANIFEST.activeRecipeId, 'classic-60-v1');
    assert.equal(MEH_CATALOG_MANIFEST.definitions.length, 22);
    assert.throws(() => validateCatalogManifest(
        { ...MEH_CORE_MANIFEST, openingCardType: 'unavailable-opening' },
        MEH_CATALOG_MANIFEST,
    ), /BAD_RECIPE_OPENING_CARD/);
});

test('P4 expansion definitions require decision, counterplay, accessibility, rollout, and gameplay access', () => {
    assert.equal(validateCatalogManifest(MEH_CORE_MANIFEST, expansionCatalog()), true);
    for (const overrides of [
        { design: null },
        { paidExclusive: true },
        { gameplayEarnable: false },
        { trialEligible: false },
        { releaseStatus: 'instant-live' },
        { contentFlag: '' },
        { nameAr: '\u202Eunsafe' },
    ]) {
        assert.throws(() => validateCatalogManifest(MEH_CORE_MANIFEST, expansionCatalog(overrides)));
    }
    const missingContract = expansionCatalog();
    missingContract.definitionFields = [];
    assert.throws(
        () => validateCatalogManifest(MEH_CORE_MANIFEST, missingContract),
        /BAD_DEFINITION_FIELDS/,
    );
    const oversizedVersion = expansionCatalog();
    oversizedVersion.catalogVersion = '9999999.1.0';
    assert.throws(() => validateCatalogManifest(MEH_CORE_MANIFEST, oversizedVersion), /BAD_CATALOG_VERSION/);

    const hiddenDesignField = expansionCatalog();
    hiddenDesignField.definitions.at(-1).design.internalPayload = 'not allowed';
    assert.throws(
        () => validateCatalogManifest(MEH_CORE_MANIFEST, hiddenDesignField),
        /UNKNOWN_CARD_DESIGN_FIELD/,
    );
    const tooManyEdgeCases = expansionCatalog();
    tooManyEdgeCases.definitions.at(-1).design.edgeCases = Array.from(
        { length: 17 }, (_, index) => `edge-${index}`,
    );
    assert.throws(
        () => validateCatalogManifest(MEH_CORE_MANIFEST, tooManyEdgeCases),
        /CARD_EDGE_CASES_REQUIRED/,
    );
});

test('P4 signed catalogs reject tampering and can roll back instantly to embedded classic', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const manifest = expansionCatalog();
    const envelope = createSignedEnvelope(manifest, privateKey);
    assert.equal(envelope.signature.length, 86);
    assert.equal(verifySignedEnvelope(envelope, publicKey).catalogVersion, '1.1.0');
    const tampered = JSON.parse(JSON.stringify(envelope));
    tampered.manifest.definitions.at(-1).tamashiPrice = 1;
    assert.throws(() => verifySignedEnvelope(tampered, publicKey), /CATALOG_SIGNATURE_INVALID/);
    assert.throws(
        () => verifySignedEnvelope({ ...envelope, signature: 'a'.repeat(10_000) }, publicKey),
        /BAD_CATALOG_ENVELOPE/,
    );

    const registry = new CatalogRegistry({ publicKey, expansionEnabled: true });
    registry.registerSigned(envelope);
    assert.equal(registry.activate('1.1.0').catalogVersion, '1.1.0');
    assert.equal(registry.rollback().catalogVersion, '1.0.0');
    assert.equal(registry.current().activeRecipeId, 'classic-60-v1');
});

test('P4 signer accepts only Ed25519 keys and never signs an invalid catalog', () => {
    const ed25519 = crypto.generateKeyPairSync('ed25519');
    assert.equal(createSignedEnvelope(expansionCatalog(), ed25519.privateKey).algorithm, 'Ed25519');
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    assert.throws(() => createSignedEnvelope(expansionCatalog(), rsa.privateKey),
        /CATALOG_KEY_MUST_BE_ED25519/);
    assert.throws(() => createSignedEnvelope(
        expansionCatalog({ paidExclusive: true }), ed25519.privateKey,
    ), /PAID_EXCLUSIVE_CARD_FORBIDDEN/);
});

test('P4 signed expansion is forward-only and cannot mutate embedded cards or recipes', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const registry = new CatalogRegistry({ publicKey, expansionEnabled: true });
    const changedCard = expansionCatalog();
    changedCard.definitions.find(item => item.definitionId === 'dafour').assetBase = 'other-art';
    assert.throws(
        () => registry.registerSigned(createSignedEnvelope(changedCard, privateKey)),
        /EMBEDDED_DEFINITION_IMMUTABLE/,
    );
    const changedRecipe = expansionCatalog();
    changedRecipe.recipes[0].coloredDefinitionIds[0] = 'test-strategist';
    assert.throws(
        () => registry.registerSigned(createSignedEnvelope(changedRecipe, privateKey)),
        /EMBEDDED_RECIPE_IMMUTABLE/,
    );
    const reusedVersion = expansionCatalog();
    reusedVersion.catalogVersion = '1.0.0';
    assert.throws(
        () => registry.registerSigned(createSignedEnvelope(reusedVersion, privateKey)),
        /CATALOG_VERSION_NOT_FORWARD/,
    );

    const defaultedExpansion = expansionCatalog({
        availableByDefault: true,
        tamashiPrice: 0,
    });
    assert.throws(
        () => createSignedEnvelope(defaultedExpansion, privateKey),
        /NEW_DEFAULT_DEFINITION_FORBIDDEN/,
    );

    const badAnchor = expansionCatalog();
    badAnchor.definitions.at(-1).design.replacementAnchorDefinitionId = 'skip';
    assert.throws(
        () => createSignedEnvelope(badAnchor, privateKey),
        /INVALID_REPLACEMENT_ANCHOR/,
    );
});

test('P4 every signed version extends the latest registered catalog monotonically', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const registry = new CatalogRegistry({ publicKey, expansionEnabled: true });
    registry.registerSigned(createSignedEnvelope(expansionCatalog(), privateKey));

    const removed = expansionCatalog();
    removed.catalogVersion = '1.2.0';
    removed.definitions.pop();
    assert.throws(
        () => registry.registerSigned(createSignedEnvelope(removed, privateKey)),
        /CATALOG_DEFINITION_REMOVED/,
    );

    const modified = expansionCatalog();
    modified.catalogVersion = '1.2.0';
    modified.definitions.at(-1).tamashiPrice = 1_201;
    assert.throws(
        () => registry.registerSigned(createSignedEnvelope(modified, privateKey)),
        /REGISTERED_DEFINITION_IMMUTABLE/,
    );

    const promoted = expansionCatalog();
    promoted.catalogVersion = '1.2.0';
    promoted.definitions.at(-1).releaseStatus = 'live';
    assert.equal(registry.registerSigned(createSignedEnvelope(promoted, privateKey)), '1.2.0');

    const demoted = JSON.parse(JSON.stringify(promoted));
    demoted.catalogVersion = '1.3.0';
    demoted.definitions.at(-1).releaseStatus = 'candidate';
    assert.throws(
        () => registry.registerSigned(createSignedEnvelope(demoted, privateKey)),
        /REGISTERED_DEFINITION_IMMUTABLE/,
    );
});

test('P4 friendly recipe is deterministic, shared, and exactly one-for-one in class and budget', () => {
    const catalog = expansionCatalog();
    const input = [{
        seatId: 'seat_owner_00000001',
        definitionId: 'test-strategist',
        replacesDefinitionId: 'dafour',
    }];
    const first = compileFriendlyRecipe(catalog, 'classic-60-v1', input);
    const second = compileFriendlyRecipe(catalog, 'classic-60-v1', [...input]);
    assert.deepEqual(first, second);
    assert.match(first.recipeId, /^friendly-[a-f0-9]{16}$/);
    assert.equal(first.coloredDefinitionIds.includes('test-strategist'), true);
    assert.equal(first.coloredDefinitionIds.includes('dafour'), false);
    assert.equal(first.coloredDefinitionIds.length * 3 + first.blackDefinitionIds.length, 60);

    assert.throws(() => compileFriendlyRecipe(catalog, 'classic-60-v1', [
        { ...input[0], replacesDefinitionId: 'skip' },
    ]), /REPLACEMENT_BUDGET_MISMATCH/);
    assert.throws(() => compileFriendlyRecipe(catalog, 'classic-60-v1', [input[0], {
        ...input[0], definitionId: 'test-strategist', replacesDefinitionId: 'box-man',
    }]), /ONE_CONTRIBUTION_PER_SEAT/);
});

test('P4 clients that lack a contributed definition cannot join that recipe', () => {
    const manifest = expansionCatalog();
    const registry = new CatalogRegistry({ catalogManifest: manifest });
    const recipe = compileFriendlyRecipe(manifest, 'classic-60-v1', [{
        seatId: 'seat_owner_00000001', definitionId: 'test-strategist', replacesDefinitionId: 'dafour',
    }]);
    const room = {
        rulesVersion: '1.0.0', catalogVersion: '1.1.0', deckRecipeId: recipe.recipeId,
        recipeSnapshot: recipe,
    };
    const definitionIds = manifest.definitions.map(item => item.definitionId);
    assert.equal(registry.assertClientCapability(room, {
        rulesVersion: '1.0.0', catalogVersion: '1.1.0', definitionIds,
    }), true);
    assert.throws(() => registry.assertClientCapability(room, {
        rulesVersion: '1.0.0', catalogVersion: '1.1.0',
        definitionIds: definitionIds.filter(id => id !== 'test-strategist'),
    }), /CATALOG_UPDATE_REQUIRED/);
});

test('P4 per-card content flag stops purchase and future recipes without touching classic', () => {
    const registry = new CatalogRegistry({
        catalogManifest: expansionCatalog(),
        expansionEnabled: true,
        enabledContentFlags: ['card_test_strategist'],
    });
    assert.equal(registry.isDefinitionEnabled('test-strategist'), true);
    assert.throws(() => registry.enableContentFlag('card_typo'), /UNKNOWN_CARD_CONTENT_FLAG/);
    registry.disableContentFlag('card_test_strategist');
    assert.equal(registry.isDefinitionEnabled('test-strategist'), false);
    assert.equal(registry.isDefinitionEnabled('dafour'), true);
    assert.equal(registry.current().activeRecipeId, 'classic-60-v1');
});
