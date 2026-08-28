'use strict';

const crypto = require('node:crypto');
const { MEH_CORE_MANIFEST, MEH_CATALOG_MANIFEST } = require('../game/game-manifests');

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_PATTERN = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const CONTENT_FLAG_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
const SEAT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const UNSAFE_TEXT_PATTERN = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u;
const RELEASE_STATUSES = new Set(['candidate', 'friendly-5', 'live', 'disabled']);
const RELEASE_TRANSITIONS = Object.freeze({
    candidate: Object.freeze(['candidate', 'friendly-5', 'disabled']),
    'friendly-5': Object.freeze(['friendly-5', 'live', 'disabled']),
    live: Object.freeze(['live', 'disabled']),
    disabled: Object.freeze(['disabled']),
});
const MATCH_LENGTH_RISKS = new Set(['low', 'medium', 'high']);
const MAX_FRIENDLY_CONTRIBUTIONS = 4;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_CATALOG_DEFINITIONS = 256;
const MAX_CATALOG_RECIPES = 128;
const REQUIRED_DEFINITION_FIELDS = Object.freeze([
    'definitionId', 'nameAr', 'type', 'effectOpcode', 'emoji', 'assetBase',
    'replacementClass', 'powerBudget', 'availableByDefault', 'tamashiPrice',
]);
const EXPANSION_DEFINITION_FIELDS = Object.freeze([
    'gameplayTargetMatches', 'gameplayEarnable', 'paidExclusive', 'trialEligible',
    'contentFlag', 'releaseStatus', 'design',
]);
const DESIGN_FIELDS = Object.freeze([
    'replacementAnchorDefinitionId', 'decision', 'effect', 'counterplay',
    'accessibilityLabel', 'edgeCases', 'matchLengthRisk',
]);
const MANIFEST_FIELDS = Object.freeze([
    'schemaVersion', 'catalogVersion', 'activeRecipeId', 'definitionFields',
    'definitions', 'recipes', 'economy',
]);

class CatalogError extends Error {
    constructor(code, message = code) {
        super(message);
        this.name = 'CatalogError';
        this.code = code;
    }
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new CatalogError('NON_FINITE_CATALOG_VALUE');
        return value;
    }
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') throw new CatalogError('UNSUPPORTED_CATALOG_VALUE');
    const result = {};
    for (const key of Object.keys(value).sort()) {
        if (value[key] !== undefined) result[key] = canonicalize(value[key]);
    }
    return result;
}

function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
}

function freezeClone(value) {
    const result = clone(value);
    const freeze = item => {
        if (!item || typeof item !== 'object' || Object.isFrozen(item)) return item;
        Object.values(item).forEach(freeze);
        return Object.freeze(item);
    };
    return freeze(result);
}

function assertLocalizedText(value, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || typeof value.ar !== 'string' || !value.ar.trim()
        || typeof value.en !== 'string' || !value.en.trim()
        || value.ar.length > 280 || value.en.length > 280
        || UNSAFE_TEXT_PATTERN.test(value.ar) || UNSAFE_TEXT_PATTERN.test(value.en)) {
        throw new CatalogError(code);
    }
}

function validateExpansionDefinition(definition) {
    if (definition.availableByDefault === true) return;
    if (Object.keys(definition).some(field => !REQUIRED_DEFINITION_FIELDS.includes(field)
        && !EXPANSION_DEFINITION_FIELDS.includes(field))) {
        throw new CatalogError('UNKNOWN_DEFINITION_FIELD');
    }
    if (!Number.isSafeInteger(definition.tamashiPrice) || definition.tamashiPrice <= 0) {
        throw new CatalogError('EXPANSION_PRICE_REQUIRED');
    }
    const design = definition.design;
    if (!design || typeof design !== 'object' || Array.isArray(design)) {
        throw new CatalogError('CARD_DESIGN_EVIDENCE_REQUIRED');
    }
    if (Object.keys(design).some(field => !DESIGN_FIELDS.includes(field))) {
        throw new CatalogError('UNKNOWN_CARD_DESIGN_FIELD');
    }
    assertLocalizedText(design.decision, 'CARD_DECISION_REQUIRED');
    assertLocalizedText(design.effect, 'CARD_EFFECT_TEXT_REQUIRED');
    assertLocalizedText(design.counterplay, 'CARD_COUNTERPLAY_REQUIRED');
    assertLocalizedText(design.accessibilityLabel, 'CARD_ACCESSIBILITY_LABEL_REQUIRED');
    if (!ID_PATTERN.test(design.replacementAnchorDefinitionId || '')) {
        throw new CatalogError('CARD_REPLACEMENT_ANCHOR_REQUIRED');
    }
    if (!Array.isArray(design.edgeCases) || !design.edgeCases.length || design.edgeCases.length > 16
        || design.edgeCases.some(item => typeof item !== 'string' || !item.trim() || item.length > 240
            || UNSAFE_TEXT_PATTERN.test(item))) {
        throw new CatalogError('CARD_EDGE_CASES_REQUIRED');
    }
    if (!MATCH_LENGTH_RISKS.has(design.matchLengthRisk)) {
        throw new CatalogError('CARD_MATCH_LENGTH_RISK_REQUIRED');
    }
    if (!CONTENT_FLAG_PATTERN.test(definition.contentFlag || '')) {
        throw new CatalogError('CARD_CONTENT_FLAG_REQUIRED');
    }
    if (!RELEASE_STATUSES.has(definition.releaseStatus)) {
        throw new CatalogError('CARD_RELEASE_STATUS_REQUIRED');
    }
    if (!Number.isSafeInteger(definition.gameplayTargetMatches)
        || definition.gameplayTargetMatches < 4 || definition.gameplayTargetMatches > 40) {
        throw new CatalogError('CARD_TARGET_MATCHES_REQUIRED');
    }
    if (definition.paidExclusive === true || definition.gameplayEarnable !== true) {
        throw new CatalogError('PAID_EXCLUSIVE_CARD_FORBIDDEN');
    }
    if (definition.trialEligible !== true) throw new CatalogError('CARD_TRIAL_REQUIRED');
}

function validateCatalogManifest(coreManifest, catalogManifest) {
    const core = coreManifest || MEH_CORE_MANIFEST;
    const catalog = catalogManifest || MEH_CATALOG_MANIFEST;
    if (!core || !catalog || catalog.schemaVersion !== 1) throw new CatalogError('BAD_CATALOG_SCHEMA');
    if (Object.keys(catalog).some(field => !MANIFEST_FIELDS.includes(field))) {
        throw new CatalogError('UNKNOWN_CATALOG_FIELD');
    }
    if (Buffer.byteLength(canonicalJson(catalog), 'utf8') > MAX_CATALOG_BYTES) {
        throw new CatalogError('CATALOG_TOO_LARGE');
    }
    if (!VERSION_PATTERN.test(core.rulesVersion || '') || !VERSION_PATTERN.test(catalog.catalogVersion || '')) {
        throw new CatalogError('BAD_CATALOG_VERSION');
    }
    if (!Array.isArray(catalog.definitions) || !catalog.definitions.length
        || catalog.definitions.length > MAX_CATALOG_DEFINITIONS
        || !Array.isArray(catalog.recipes) || !catalog.recipes.length
        || catalog.recipes.length > MAX_CATALOG_RECIPES) {
        throw new CatalogError('EMPTY_CATALOG');
    }
    if (!Array.isArray(catalog.definitionFields)
        || canonicalJson(catalog.definitionFields) !== canonicalJson(REQUIRED_DEFINITION_FIELDS)) {
        throw new CatalogError('BAD_DEFINITION_FIELDS');
    }
    const definitions = new Map();
    for (const definition of catalog.definitions) {
        if (!definition || !ID_PATTERN.test(definition.definitionId || '')
            || definitions.has(definition.definitionId)) throw new CatalogError('DUPLICATE_OR_BAD_DEFINITION_ID');
        for (const field of REQUIRED_DEFINITION_FIELDS) {
            if (!Object.hasOwn(definition, field)) throw new CatalogError('MISSING_DEFINITION_FIELD');
        }
        if (typeof definition.nameAr !== 'string' || !definition.nameAr.trim()
            || definition.nameAr.length > 100 || UNSAFE_TEXT_PATTERN.test(definition.nameAr)
            || typeof definition.emoji !== 'string' || !definition.emoji.trim()
            || definition.emoji.length > 16 || UNSAFE_TEXT_PATTERN.test(definition.emoji)) {
            throw new CatalogError('BAD_DEFINITION_TEXT');
        }
        if (!core.effectOpcodes.includes(definition.effectOpcode)
            || definition.type !== definition.effectOpcode) throw new CatalogError('UNKNOWN_EFFECT_OPCODE');
        if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(definition.assetBase || '')) {
            throw new CatalogError('BAD_ASSET_BASE');
        }
        if (!ID_PATTERN.test(definition.replacementClass || '')
            || !Number.isSafeInteger(definition.powerBudget)) throw new CatalogError('BAD_REPLACEMENT_CONTRACT');
        if (typeof definition.availableByDefault !== 'boolean'
            || !Number.isSafeInteger(definition.tamashiPrice) || definition.tamashiPrice < 0) {
            throw new CatalogError('BAD_UNLOCK_CONTRACT');
        }
        validateExpansionDefinition(definition);
        definitions.set(definition.definitionId, definition);
    }
    for (const definition of definitions.values()) {
        if (definition.availableByDefault === true) continue;
        const anchor = definitions.get(definition.design.replacementAnchorDefinitionId);
        if (!anchor || anchor.availableByDefault !== true
            || anchor.replacementClass !== definition.replacementClass
            || anchor.powerBudget !== definition.powerBudget) {
            throw new CatalogError('INVALID_REPLACEMENT_ANCHOR');
        }
    }
    const recipes = new Set();
    for (const recipe of catalog.recipes) {
        if (!recipe || !ID_PATTERN.test(recipe.recipeId || '') || recipes.has(recipe.recipeId)) {
            throw new CatalogError('DUPLICATE_OR_BAD_RECIPE_ID');
        }
        if (recipe.rulesVersion !== core.rulesVersion) throw new CatalogError('RECIPE_RULES_MISMATCH');
        const colored = recipe.coloredDefinitionIds;
        const black = recipe.blackDefinitionIds;
        if (!Array.isArray(colored) || !Array.isArray(black)
            || colored.length * core.standardColors.length + black.length !== core.deckSize) {
            throw new CatalogError('BAD_RECIPE_SIZE');
        }
        const all = [...colored, ...black];
        if (new Set(all).size !== all.length || all.some(id => !definitions.has(id))) {
            throw new CatalogError('BAD_RECIPE_DEFINITIONS');
        }
        if (colored.some(id => definitions.get(id).replacementClass === 'black-wild')
            || black.some(id => definitions.get(id).replacementClass !== 'black-wild')) {
            throw new CatalogError('BAD_RECIPE_COLOR_CLASS');
        }
        if (!all.some(id => definitions.get(id).effectOpcode === core.openingCardType)) {
            throw new CatalogError('BAD_RECIPE_OPENING_CARD');
        }
        recipes.add(recipe.recipeId);
    }
    if (!recipes.has(catalog.activeRecipeId)) throw new CatalogError('UNKNOWN_ACTIVE_RECIPE');
    const economy = catalog.economy || {};
    if (economy.currencyId !== 'tamashi' || economy.cardUnlock !== 'direct-fixed-price'
        || economy.randomizedPacks !== false || economy.duplicateUnlocks !== false
        || economy.gameplayAcquisitionRequired !== true || economy.paidExclusiveGameplayCards !== false
        || economy.rankedRecipeStandardized !== true
        || economy.friendlyOwnershipModel !== 'shared-deck-contribution') {
        throw new CatalogError('UNSAFE_ECONOMY_CONTRACT');
    }
    return true;
}

function verifySignedEnvelope(envelope, publicKey) {
    if (!envelope || envelope.algorithm !== 'Ed25519'
        || typeof envelope.signature !== 'string'
        || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature) || !envelope.manifest) {
        throw new CatalogError('BAD_CATALOG_ENVELOPE');
    }
    validateCatalogManifest(MEH_CORE_MANIFEST, envelope.manifest);
    let valid = false;
    try {
        valid = crypto.verify(
            null,
            Buffer.from(canonicalJson(envelope.manifest)),
            publicKey,
            Buffer.from(envelope.signature, 'base64url'),
        );
    } catch (error) {
        throw new CatalogError('CATALOG_SIGNATURE_INVALID');
    }
    if (!valid) throw new CatalogError('CATALOG_SIGNATURE_INVALID');
    return freezeClone(envelope.manifest);
}

function recipeDefinitionIds(recipe) {
    return [...recipe.coloredDefinitionIds, ...recipe.blackDefinitionIds];
}

function compareVersions(left, right) {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    for (let index = 0; index < 3; index++) {
        if (a[index] !== b[index]) return a[index] - b[index];
    }
    return 0;
}

function assertForwardCompatibleCatalog(previousManifest, candidateManifest) {
    if (compareVersions(candidateManifest.catalogVersion, previousManifest.catalogVersion) <= 0) {
        throw new CatalogError('CATALOG_VERSION_NOT_FORWARD');
    }
    const candidateDefinitions = new Map(
        candidateManifest.definitions.map(item => [item.definitionId, item]),
    );
    const embeddedDefinitionIds = new Set(
        MEH_CATALOG_MANIFEST.definitions.map(item => item.definitionId),
    );
    for (const definition of previousManifest.definitions) {
        const candidate = candidateDefinitions.get(definition.definitionId);
        if (!candidate) throw new CatalogError('CATALOG_DEFINITION_REMOVED');
        if (embeddedDefinitionIds.has(definition.definitionId)) {
            if (canonicalJson(candidate) !== canonicalJson(definition)) {
                throw new CatalogError('EMBEDDED_DEFINITION_IMMUTABLE');
            }
            continue;
        }
        const previousWithoutStatus = { ...definition };
        const candidateWithoutStatus = { ...candidate };
        delete previousWithoutStatus.releaseStatus;
        delete candidateWithoutStatus.releaseStatus;
        if (canonicalJson(previousWithoutStatus) !== canonicalJson(candidateWithoutStatus)
            || !RELEASE_TRANSITIONS[definition.releaseStatus].includes(candidate.releaseStatus)) {
            throw new CatalogError('REGISTERED_DEFINITION_IMMUTABLE');
        }
    }
    for (const definition of candidateManifest.definitions) {
        if (!previousManifest.definitions.some(item => item.definitionId === definition.definitionId)
            && definition.availableByDefault === true) {
            throw new CatalogError('NEW_DEFAULT_DEFINITION_FORBIDDEN');
        }
        if (!embeddedDefinitionIds.has(definition.design && definition.design.replacementAnchorDefinitionId)
            && definition.availableByDefault !== true) {
            throw new CatalogError('REPLACEMENT_ANCHOR_MUST_BE_EMBEDDED');
        }
    }
    if (canonicalJson(candidateManifest.economy) !== canonicalJson(previousManifest.economy)) {
        throw new CatalogError('ECONOMY_CONTRACT_IMMUTABLE');
    }
    const candidateRecipes = new Map(candidateManifest.recipes.map(item => [item.recipeId, item]));
    for (const recipe of previousManifest.recipes) {
        const candidate = candidateRecipes.get(recipe.recipeId);
        if (!candidate || canonicalJson(candidate) !== canonicalJson(recipe)) {
            throw new CatalogError('EMBEDDED_RECIPE_IMMUTABLE');
        }
    }
    if (candidateManifest.activeRecipeId !== previousManifest.activeRecipeId) {
        const active = candidateRecipes.get(candidateManifest.activeRecipeId);
        if (!active || recipeDefinitionIds(active).some(definitionId => {
            const definition = candidateDefinitions.get(definitionId);
            return definition.availableByDefault !== true && definition.releaseStatus !== 'live';
        })) throw new CatalogError('PUBLIC_RECIPE_REQUIRES_LIVE_DEFINITIONS');
    }
    return true;
}

function compileFriendlyRecipe(catalogManifest, baseRecipeId, contributions) {
    validateCatalogManifest(MEH_CORE_MANIFEST, catalogManifest);
    const catalog = catalogManifest;
    const base = catalog.recipes.find(item => item.recipeId === baseRecipeId);
    if (!base) throw new CatalogError('UNKNOWN_BASE_RECIPE');
    if (!Array.isArray(contributions) || contributions.length > MAX_FRIENDLY_CONTRIBUTIONS) {
        throw new CatalogError('TOO_MANY_CONTRIBUTIONS');
    }
    const definitions = new Map(catalog.definitions.map(item => [item.definitionId, item]));
    const seats = new Set();
    const additions = new Set();
    const replacements = new Set();
    const normalized = Array.from(contributions, item => {
        if (!item || !SEAT_ID_PATTERN.test(item.seatId || '') || seats.has(item.seatId)) {
            throw new CatalogError('ONE_CONTRIBUTION_PER_SEAT');
        }
        const added = definitions.get(item.definitionId);
        const removed = definitions.get(item.replacesDefinitionId);
        if (!added || !removed || added.availableByDefault === true
            || !['friendly-5', 'live'].includes(added.releaseStatus)) {
            throw new CatalogError('CARD_NOT_FRIENDLY_ELIGIBLE');
        }
        if (added.replacementClass !== removed.replacementClass
            || added.powerBudget !== removed.powerBudget) throw new CatalogError('REPLACEMENT_BUDGET_MISMATCH');
        const baseIds = recipeDefinitionIds(base);
        if (!baseIds.includes(removed.definitionId) || baseIds.includes(added.definitionId)
            || additions.has(added.definitionId) || replacements.has(removed.definitionId)) {
            throw new CatalogError('INVALID_ONE_FOR_ONE_REPLACEMENT');
        }
        seats.add(item.seatId);
        additions.add(added.definitionId);
        replacements.add(removed.definitionId);
        return {
            seatId: item.seatId,
            definitionId: added.definitionId,
            replacesDefinitionId: removed.definitionId,
        };
    }).sort((left, right) => left.seatId.localeCompare(right.seatId));
    const replace = ids => ids.map(id => {
        const contribution = normalized.find(item => item.replacesDefinitionId === id);
        return contribution ? contribution.definitionId : id;
    });
    const coloredDefinitionIds = replace(base.coloredDefinitionIds);
    const blackDefinitionIds = replace(base.blackDefinitionIds);
    const digest = crypto.createHash('sha256').update(canonicalJson({ baseRecipeId, normalized }))
        .digest('hex').slice(0, 16);
    const recipe = {
        recipeId: normalized.length ? `friendly-${digest}` : base.recipeId,
        rulesVersion: base.rulesVersion,
        coloredDefinitionIds,
        blackDefinitionIds,
        baseRecipeId: base.recipeId,
        replacements: normalized,
    };
    const manifest = {
        ...clone(catalog),
        activeRecipeId: recipe.recipeId,
        recipes: recipe.recipeId === base.recipeId
            ? clone(catalog.recipes)
            : [...clone(catalog.recipes), recipe],
    };
    validateCatalogManifest(MEH_CORE_MANIFEST, manifest);
    return freezeClone(recipe);
}

class CatalogRegistry {
    constructor(options = {}) {
        this.coreManifest = options.coreManifest || MEH_CORE_MANIFEST;
        this.embeddedManifest = freezeClone(options.catalogManifest || MEH_CATALOG_MANIFEST);
        validateCatalogManifest(this.coreManifest, this.embeddedManifest);
        this.publicKey = options.publicKey || null;
        this.expansionEnabled = options.expansionEnabled === true;
        this.manifests = new Map([[this.embeddedManifest.catalogVersion, this.embeddedManifest]]);
        this.activeCatalogVersion = this.embeddedManifest.catalogVersion;
        this.freeRotationDefinitionIds = new Set();
        this.enabledContentFlags = new Set();
        this.setEnabledContentFlags(options.enabledContentFlags || []);
        this.setFreeRotationDefinitionIds(options.freeRotationDefinitionIds || []);
    }

    setFreeRotationDefinitionIds(definitionIds) {
        const next = new Set(definitionIds || []);
        for (const definitionId of next) {
            const definition = this.current().definitions.find(item => item.definitionId === definitionId);
            if (!definition || definition.availableByDefault === true || definition.trialEligible !== true
                || !['friendly-5', 'live'].includes(definition.releaseStatus)) {
                throw new CatalogError('INVALID_FREE_ROTATION_CARD');
            }
        }
        this.freeRotationDefinitionIds = next;
    }

    setEnabledContentFlags(contentFlags) {
        const next = new Set(contentFlags || []);
        for (const contentFlag of next) {
            if (!CONTENT_FLAG_PATTERN.test(contentFlag)
                || !this.current().definitions.some(definition => definition.availableByDefault !== true
                    && definition.contentFlag === contentFlag)) {
                throw new CatalogError('UNKNOWN_CARD_CONTENT_FLAG');
            }
        }
        this.enabledContentFlags = next;
    }

    registerSigned(envelope) {
        if (!this.publicKey) throw new CatalogError('CATALOG_PUBLIC_KEY_REQUIRED');
        const manifest = verifySignedEnvelope(envelope, this.publicKey);
        const latestManifest = [...this.manifests.values()].sort(
            (left, right) => compareVersions(left.catalogVersion, right.catalogVersion),
        ).at(-1);
        assertForwardCompatibleCatalog(latestManifest, manifest);
        if (this.manifests.has(manifest.catalogVersion)) {
            throw new CatalogError('CATALOG_VERSION_ALREADY_REGISTERED');
        }
        this.manifests.set(manifest.catalogVersion, manifest);
        return manifest.catalogVersion;
    }

    activate(catalogVersion) {
        if (!this.expansionEnabled) throw new CatalogError('CATALOG_EXPANSION_DISABLED');
        if (!this.manifests.has(catalogVersion)) throw new CatalogError('UNKNOWN_CATALOG_VERSION');
        const previousVersion = this.activeCatalogVersion;
        this.activeCatalogVersion = catalogVersion;
        try {
            this.setEnabledContentFlags(this.enabledContentFlags);
            this.setFreeRotationDefinitionIds(this.freeRotationDefinitionIds);
        } catch (error) {
            this.activeCatalogVersion = previousVersion;
            throw error;
        }
        return this.current();
    }

    rollback() {
        this.activeCatalogVersion = this.embeddedManifest.catalogVersion;
        return this.current();
    }

    current() {
        return this.manifests.get(this.activeCatalogVersion);
    }

    isInFreeRotation(definitionId) {
        return this.freeRotationDefinitionIds.has(definitionId)
            && this.isDefinitionEnabled(definitionId);
    }

    isDefinitionEnabled(definitionId) {
        const definition = this.current().definitions.find(item => item.definitionId === definitionId);
        if (!definition) return false;
        return definition.availableByDefault === true
            || (this.expansionEnabled && this.enabledContentFlags.has(definition.contentFlag));
    }

    enableContentFlag(contentFlag) {
        if (!this.expansionEnabled || !CONTENT_FLAG_PATTERN.test(contentFlag || '')
            || !this.current().definitions.some(definition => definition.availableByDefault !== true
                && definition.contentFlag === contentFlag)) {
            throw new CatalogError(this.expansionEnabled
                ? 'UNKNOWN_CARD_CONTENT_FLAG' : 'CATALOG_EXPANSION_DISABLED');
        }
        this.enabledContentFlags.add(contentFlag);
    }

    disableContentFlag(contentFlag) {
        this.enabledContentFlags.delete(contentFlag);
    }

    manifestForRoom(room) {
        const manifest = this.manifests.get(room.catalogVersion) || this.embeddedManifest;
        if (!room.recipeSnapshot || manifest.recipes.some(item => item.recipeId === room.deckRecipeId)) {
            return manifest;
        }
        const result = {
            ...clone(manifest),
            recipes: [...clone(manifest.recipes), clone(room.recipeSnapshot)],
        };
        validateCatalogManifest(this.coreManifest, result);
        return freezeClone(result);
    }

    assertClientCapability(room, capability) {
        if (!capability) {
            const manifest = this.manifestForRoom(room);
            const recipe = manifest.recipes.find(item => item.recipeId === room.deckRecipeId);
            const definitions = new Map(manifest.definitions.map(item => [item.definitionId, item]));
            if (recipe && recipeDefinitionIds(recipe).every(
                definitionId => definitions.get(definitionId).availableByDefault === true,
            )) return true;
            throw new CatalogError('CATALOG_UPDATE_REQUIRED');
        }
        if (capability.rulesVersion !== room.rulesVersion
            || capability.catalogVersion !== room.catalogVersion
            || !Array.isArray(capability.definitionIds) || capability.definitionIds.length > 256
            || capability.definitionIds.some(id => typeof id !== 'string' || !ID_PATTERN.test(id))) {
            throw new CatalogError('CATALOG_UPDATE_REQUIRED');
        }
        const manifest = this.manifestForRoom(room);
        const recipe = manifest.recipes.find(item => item.recipeId === room.deckRecipeId);
        const supported = new Set(capability.definitionIds);
        if (!recipe || recipeDefinitionIds(recipe).some(id => !supported.has(id))) {
            throw new CatalogError('CATALOG_UPDATE_REQUIRED');
        }
        return true;
    }
}

module.exports = {
    CatalogError,
    CatalogRegistry,
    MAX_CATALOG_BYTES,
    MAX_FRIENDLY_CONTRIBUTIONS,
    assertForwardCompatibleCatalog,
    canonicalJson,
    compileFriendlyRecipe,
    recipeDefinitionIds,
    validateCatalogManifest,
    verifySignedEnvelope,
};
