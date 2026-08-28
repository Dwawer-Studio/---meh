'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadScripts } = require('./helpers/load-script');

const {
    MEH_CORE_MANIFEST,
    MEH_CATALOG_MANIFEST,
    CoreEvidence,
    Deck,
} = loadScripts(
    ['game/game-manifests.js', 'game/core-evidence.js', 'deck.js'],
    ['MEH_CORE_MANIFEST', 'MEH_CATALOG_MANIFEST', 'CoreEvidence', 'Deck'],
);

function everyObjectFrozen(value) {
    if (!value || typeof value !== 'object') return true;
    return Object.isFrozen(value) && Object.values(value).every(everyObjectFrozen);
}

test('P0 core and catalog manifests are deeply immutable and versioned separately', () => {
    assert.equal(everyObjectFrozen(MEH_CORE_MANIFEST), true);
    assert.equal(everyObjectFrozen(MEH_CATALOG_MANIFEST), true);
    assert.match(MEH_CORE_MANIFEST.rulesVersion, /^\d+\.\d+\.\d+$/);
    assert.match(MEH_CATALOG_MANIFEST.catalogVersion, /^\d+\.\d+\.\d+$/);
    assert.equal(MEH_CORE_MANIFEST.deckSize, 60);
    assert.equal(MEH_CORE_MANIFEST.seats, 4);
    assert.equal(MEH_CORE_MANIFEST.initialHandSize, 7);
});

test('P0 every catalog definition satisfies the executable card contract', () => {
    const definitions = MEH_CATALOG_MANIFEST.definitions;
    const ids = definitions.map(definition => definition.definitionId);
    assert.equal(new Set(ids).size, definitions.length);

    for (const definition of definitions) {
        for (const field of MEH_CATALOG_MANIFEST.definitionFields) {
            assert.equal(Object.hasOwn(definition, field), true, `${definition.definitionId}/${field}`);
        }
        assert.equal(MEH_CORE_MANIFEST.effectOpcodes.includes(definition.effectOpcode), true,
            `${definition.definitionId}: unknown effect opcode`);
        assert.equal(definition.effectOpcode, definition.type);
        assert.equal(Number.isFinite(definition.powerBudget), true);
        assert.equal(Number.isSafeInteger(definition.tamashiPrice), true);
        assert.equal(definition.tamashiPrice >= 0, true);
    }
});

test('P0 classic recipe is the exact current 60-card baseline', () => {
    const deck = new Deck({ random: CoreEvidence.createSeededRandom(20260828) });
    assert.equal(deck.recipeId, 'classic-60-v1');
    assert.equal(deck.cards.length, 60);
    assert.equal(new Set(deck.cards.map(card => card.id)).size, 60);
    assert.deepEqual(
        Object.fromEntries(['orange', 'gray', 'purple', 'black'].map(color => [
            color,
            deck.cards.filter(card => card.color === color).length,
        ])),
        { orange: 19, gray: 19, purple: 19, black: 3 },
    );
    assert.equal(new Set(deck.cards.map(card => card.definitionId)).size, 22);
});

test('P0 seeded deck construction is reproducible and injectable', () => {
    const build = seed => new Deck({
        random: CoreEvidence.createSeededRandom(seed),
        idFactory: ({ sequence }) => `seeded-${String(sequence).padStart(2, '0')}`,
    }).cards.map(card => `${card.id}:${card.color}:${card.definitionId}`);

    assert.deepEqual(build(42), build(42));
    assert.notDeepEqual(build(42), build(43));
});

test('P0 Tamashi contract permits verified play and purchase without paid-exclusive cards', () => {
    const economy = MEH_CATALOG_MANIFEST.economy;
    assert.equal(economy.currencyId, 'tamashi');
    assert.deepEqual(Array.from(economy.sources), ['verified-gameplay', 'verified-in-app-purchase']);
    assert.equal(economy.cardUnlock, 'direct-fixed-price');
    assert.equal(economy.randomizedPacks, false);
    assert.equal(economy.duplicateUnlocks, false);
    assert.equal(economy.gameplayAcquisitionRequired, true);
    assert.equal(economy.paidExclusiveGameplayCards, false);
    assert.equal(economy.rankedRecipeStandardized, true);
    assert.equal(economy.friendlyOwnershipModel, 'shared-deck-contribution');
});

test('P0 replay records canonical state and detects tampering', () => {
    const replay = CoreEvidence.createReplay(7);
    CoreEvidence.setInitialState(replay, { z: 1, a: ['x'] });
    CoreEvidence.recordAction(replay, 'action.play', { cardId: 'c1' });
    const complete = CoreEvidence.completeReplay(replay, { winner: 'seat-2' });
    assert.equal(CoreEvidence.validateReplay(complete), true);

    complete.finalState.winner = 'seat-3';
    assert.equal(CoreEvidence.validateReplay(complete), false);
});
