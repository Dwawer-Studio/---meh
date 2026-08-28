'use strict';

const { MEH_CATALOG_MANIFEST } = require('../../game/game-manifests');

function expansionCatalog(overrides = {}) {
    const catalog = JSON.parse(JSON.stringify(MEH_CATALOG_MANIFEST));
    catalog.catalogVersion = '1.1.0';
    catalog.definitions.push({
        definitionId: 'test-strategist',
        nameAr: 'بطاقة اختبار استراتيجية',
        type: 'normal',
        effectOpcode: 'normal',
        emoji: '🧪',
        assetBase: 'dafour',
        replacementClass: 'colored-normal',
        powerBudget: 0,
        availableByDefault: false,
        tamashiPrice: 1_200,
        gameplayTargetMatches: 10,
        gameplayEarnable: true,
        paidExclusive: false,
        trialEligible: true,
        contentFlag: 'card_test_strategist',
        releaseStatus: 'friendly-5',
        design: {
            replacementAnchorDefinitionId: 'dafour',
            decision: { ar: 'اختبر قراراً تكتيكياً', en: 'Test a tactical decision' },
            effect: { ar: 'تعريف اختباري بلا تغيير للقواعد', en: 'A test definition with no rules change' },
            counterplay: { ar: 'طابق اللون أو الشخصية', en: 'Match the color or character' },
            accessibilityLabel: { ar: 'بطاقة اختبار', en: 'Test card' },
            edgeCases: ['لا تغيّر حجم الرزمة', 'لا تضيف opcode جديداً'],
            matchLengthRisk: 'low',
        },
        ...overrides,
    });
    return catalog;
}

module.exports = { expansionCatalog };
