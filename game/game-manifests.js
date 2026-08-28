'use strict';

function deepFreezeManifest(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreezeManifest);
    return value;
}

const MEH_CORE_MANIFEST = deepFreezeManifest({
    schemaVersion: 1,
    rulesVersion: '1.0.0',
    seats: 4,
    initialHandSize: 7,
    deckSize: 60,
    standardColors: ['orange', 'gray', 'purple'],
    wildColor: 'black',
    legalPlay: ['wild-color', 'active-color', 'matching-name'],
    drawWithPlayableCard: true,
    openingCardType: 'normal',
    pendingDrawResponses: ['draw2', 'draw4Wild', 'meh', 'counterAttack', 'phantom'],
    winCondition: 'first-empty-hand',
    effectOpcodes: [
        'normal', 'draw2', 'plato', 'chameleon', 'nokhtha', 'hamour', 'bestOne',
        'skip', 'sorry', 'umWajhain', 'boShlakh', 'dramaQueen', 'sugar',
        'phantom', 'reverse', 'counterAttack', 'meh', 'draw4Wild', 'wild',
    ],
});

const MEH_CATALOG_MANIFEST = deepFreezeManifest({
    schemaVersion: 1,
    catalogVersion: '1.0.0',
    activeRecipeId: 'classic-60-v1',
    definitionFields: [
        'definitionId', 'nameAr', 'type', 'effectOpcode', 'emoji', 'assetBase',
        'replacementClass', 'powerBudget', 'availableByDefault', 'tamashiPrice',
    ],
    definitions: [
        { definitionId: 'draw2', nameAr: 'اسكت اسكت', type: 'draw2', effectOpcode: 'draw2', emoji: '🤫', assetBase: 'draw2', replacementClass: 'colored-action', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'plato', nameAr: 'افلاطون', type: 'plato', effectOpcode: 'plato', emoji: '🏛️', assetBase: 'plato', replacementClass: 'colored-power', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'chameleon', nameAr: 'الحرباية', type: 'chameleon', effectOpcode: 'chameleon', emoji: '🦎', assetBase: 'chameleon', replacementClass: 'colored-power', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'dafour', nameAr: 'الدافور', type: 'normal', effectOpcode: 'normal', emoji: '🔥', assetBase: 'dafour', replacementClass: 'colored-normal', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'box-man', nameAr: 'الرجل الصندوق', type: 'normal', effectOpcode: 'normal', emoji: '📦', assetBase: 'boxMan', replacementClass: 'colored-normal', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'nokhtha', nameAr: 'النوخذه', type: 'nokhtha', effectOpcode: 'nokhtha', emoji: '⚓', assetBase: 'nokhtha', replacementClass: 'colored-power', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'hamour', nameAr: 'الهامور', type: 'hamour', effectOpcode: 'hamour', emoji: '🦈', assetBase: 'hamour', replacementClass: 'colored-power', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'best-one', nameAr: 'انت احسن واحد', type: 'bestOne', effectOpcode: 'bestOne', emoji: '🌳', assetBase: 'bestOne', replacementClass: 'colored-power', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'skip', nameAr: 'انثبر مكانك', type: 'skip', effectOpcode: 'skip', emoji: '🛑', assetBase: 'skip', replacementClass: 'colored-action', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'sorry', nameAr: 'أنا آسف', type: 'sorry', effectOpcode: 'sorry', emoji: '🤜', assetBase: 'sorry', replacementClass: 'colored-action', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'um-humar', nameAr: 'ام حمار', type: 'normal', effectOpcode: 'normal', emoji: '🐴', assetBase: 'umHumar', replacementClass: 'colored-normal', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'um-kasha', nameAr: 'ام كشة', type: 'normal', effectOpcode: 'normal', emoji: '👩', assetBase: 'umKasha', replacementClass: 'colored-normal', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'um-wajhain', nameAr: 'ام وجهين', type: 'umWajhain', effectOpcode: 'umWajhain', emoji: '🎭', assetBase: 'umWajhain', replacementClass: 'colored-power', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'bo-shlakh', nameAr: 'بوشلاخ', type: 'boShlakh', effectOpcode: 'boShlakh', emoji: '🗣️', assetBase: 'boShlakh', replacementClass: 'colored-power', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'drama-queen', nameAr: 'دراما كوين', type: 'dramaQueen', effectOpcode: 'dramaQueen', emoji: '👸', assetBase: 'dramaQueen', replacementClass: 'colored-power', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'sugar', nameAr: 'شوقر', type: 'sugar', effectOpcode: 'sugar', emoji: '🍬', assetBase: 'sugar', replacementClass: 'colored-power', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'phantom', nameAr: 'فانتوم', type: 'phantom', effectOpcode: 'phantom', emoji: '🦇', assetBase: 'phantom', replacementClass: 'colored-action', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'reverse', nameAr: 'يوتيرن', type: 'reverse', effectOpcode: 'reverse', emoji: '🔄', assetBase: 'reverse', replacementClass: 'colored-action', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'counter-attack', nameAr: 'هجمة مرتدة', type: 'counterAttack', effectOpcode: 'counterAttack', emoji: '⚡', assetBase: 'counterAttack', replacementClass: 'colored-action', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'meh', nameAr: 'مه', type: 'meh', effectOpcode: 'meh', emoji: '🃏', assetBase: 'meh', replacementClass: 'black-wild', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'draw4-wild', nameAr: 'شنو كنت تقول', type: 'draw4Wild', effectOpcode: 'draw4Wild', emoji: '📜', assetBase: 'draw4Wild', replacementClass: 'black-wild', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
        { definitionId: 'wild', nameAr: 'طلعت يا محلى نورها', type: 'wild', effectOpcode: 'wild', emoji: '📺', assetBase: 'wild', replacementClass: 'black-wild', powerBudget: 0, availableByDefault: true, tamashiPrice: 0 },
    ],
    recipes: [{
        recipeId: 'classic-60-v1',
        rulesVersion: '1.0.0',
        coloredDefinitionIds: [
            'draw2', 'plato', 'chameleon', 'dafour', 'box-man', 'nokhtha',
            'hamour', 'best-one', 'skip', 'sorry', 'um-humar', 'um-kasha',
            'um-wajhain', 'bo-shlakh', 'drama-queen', 'sugar', 'phantom',
            'reverse', 'counter-attack',
        ],
        blackDefinitionIds: ['meh', 'draw4-wild', 'wild'],
    }],
    economy: {
        currencyId: 'tamashi',
        displayNameAr: 'تاماشي',
        sources: ['verified-gameplay', 'verified-in-app-purchase'],
        cardUnlock: 'direct-fixed-price',
        randomizedPacks: false,
        duplicateUnlocks: false,
        gameplayAcquisitionRequired: true,
        paidExclusiveGameplayCards: false,
        rankedRecipeStandardized: true,
        friendlyOwnershipModel: 'shared-deck-contribution',
    },
});

if (typeof window !== 'undefined') {
    window.MEH_CORE_MANIFEST = MEH_CORE_MANIFEST;
    window.MEH_CATALOG_MANIFEST = MEH_CATALOG_MANIFEST;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MEH_CORE_MANIFEST, MEH_CATALOG_MANIFEST };
}
