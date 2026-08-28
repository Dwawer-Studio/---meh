'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadScripts, ROOT } = require('./helpers/load-script');

const P3_FLAGS = [
    'recent_majalis', 'one_tap_reinvite', 'majlis_session_score', 'majlis_schedule', 'safe_quick_chat',
];

test('P3 social slices are independent, reversible, and service-dependent', () => {
    const without = loadScripts(
        ['product/release-config.js', 'product/feature-flags.js'],
        ['P3_RELEASE_DEFAULTS', 'ProductFeatureFlags'], { window: {} },
    );
    assert.deepEqual(Object.keys(without.P3_RELEASE_DEFAULTS).sort(), [...P3_FLAGS].sort());
    P3_FLAGS.forEach(flag => assert.equal(without.ProductFeatureFlags.isEnabled(flag), false));
    const withService = loadScripts(
        ['product/release-config.js', 'product/feature-flags.js'],
        ['ProductFeatureFlags'], {
            window: {
                MEH_SERVICE_URL: 'wss://game.example/v1/realtime',
                MEH_FEATURE_FLAGS: {
                    recent_majalis: true, one_tap_reinvite: true,
                    majlis_schedule: false, safe_quick_chat: false,
                },
            },
        },
    );
    assert.equal(withService.ProductFeatureFlags.isEnabled('recent_majalis'), true);
    assert.equal(withService.ProductFeatureFlags.isEnabled('one_tap_reinvite'), true);
    assert.equal(withService.ProductFeatureFlags.isEnabled('majlis_schedule'), false);
    assert.equal(withService.ProductFeatureFlags.isEnabled('safe_quick_chat'), false);
});

test('P3 experiment assignment is stable, 50/50-only, and fails closed for overlap', () => {
    const values = new Map();
    const storage = {
        getItem: key => values.get(key) || null,
        setItem: (key, value) => values.set(key, String(value)),
    };
    const window = {
        localStorage: storage,
        crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' },
        MEH_EXPERIMENT_CONFIG: {
            p3_recent_majalis: {
                active: true, treatmentPercent: 50, salt: 'p3-e01-v1',
            },
        },
    };
    const first = loadScripts(
        ['product/release-config.js', 'product/experiment-assignment.js', 'product/feature-flags.js'],
        ['ProductFeatureFlags'], { window },
    );
    const variant = window.MEH_EXPERIMENT_ASSIGNMENTS.p3_recent_majalis;
    assert.ok(['control', 'treatment'].includes(variant));
    assert.equal(first.ProductFeatureFlags.isEnabled('recent_majalis'), variant === 'treatment');
    const secondWindow = {
        localStorage: storage,
        crypto: { randomUUID: () => { throw new Error('must reuse assignment'); } },
        MEH_EXPERIMENT_CONFIG: window.MEH_EXPERIMENT_CONFIG,
    };
    loadScripts(
        ['product/release-config.js', 'product/experiment-assignment.js', 'product/feature-flags.js'],
        ['ProductFeatureFlags'], { window: secondWindow },
    );
    assert.equal(secondWindow.MEH_EXPERIMENT_ASSIGNMENTS.p3_recent_majalis, variant);

    const overlapWindow = {
        localStorage: storage,
        MEH_FEATURE_FLAGS: { recent_majalis: true, one_tap_reinvite: true },
        MEH_EXPERIMENT_CONFIG: {
            p3_recent_majalis: { active: true, treatmentPercent: 50, salt: 'p3-e01-v1' },
            p3_one_tap_reinvite: { active: true, treatmentPercent: 50, salt: 'p3-e02-v1' },
        },
    };
    const overlap = loadScripts(
        ['product/release-config.js', 'product/experiment-assignment.js', 'product/feature-flags.js'],
        ['ProductFeatureFlags'], { window: overlapWindow },
    );
    assert.equal(overlapWindow.MEH_EXPERIMENT_CONFIG_ERROR, 'MULTIPLE_P3_EXPERIMENTS_ACTIVE');
    assert.equal(overlap.ProductFeatureFlags.isEnabled('recent_majalis'), false);
    assert.equal(overlap.ProductFeatureFlags.isEnabled('one_tap_reinvite'), false);
});

test('P3 quick chat exposes only fixed phrases and no free-text composer', () => {
    const source = fs.readFileSync(path.join(ROOT, 'game', 'game-majlis.js'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    for (const phrase of ['salam', 'yalla', 'kafo', 'meh', 'good_game', 'one_more']) {
        assert.match(source, new RegExp(`'${phrase}'`));
    }
    assert.doesNotMatch(html, /id="quick-chat[^\"]*"[^>]*<(?:input|textarea)/i);
    assert.match(html, /id="table-safety-list"/);
});
