'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadScripts } = require('./helpers/load-script');

function loadRelease(overrides) {
    const window = overrides ? { MEH_FEATURE_FLAGS: overrides } : {};
    return loadScripts(
        ['product/release-config.js', 'product/feature-flags.js'],
        ['P1_RELEASE_DEFAULTS', 'ProductFeatureFlags'],
        { window },
    );
}

test('P1 release bundle enables only its five reversible slices', () => {
    const loaded = loadRelease();
    assert.deepEqual(
        Object.keys(loaded.P1_RELEASE_DEFAULTS).sort(),
        ['action_journal', 'contextual_ftue', 'deep_link_join', 'persistent_table', 'session_score'],
    );
    for (const name of Object.keys(loaded.P1_RELEASE_DEFAULTS)) {
        assert.equal(loaded.ProductFeatureFlags.isEnabled(name), true, name);
    }
    assert.equal(loaded.ProductFeatureFlags.isEnabled('catalog_expansion'), false);
});

test('P1 host configuration can roll back an individual slice before startup', () => {
    const loaded = loadRelease({ deep_link_join: false, persistent_table: false });
    assert.equal(loaded.ProductFeatureFlags.isEnabled('deep_link_join'), false);
    assert.equal(loaded.ProductFeatureFlags.isEnabled('persistent_table'), false);
    assert.equal(loaded.ProductFeatureFlags.isEnabled('action_journal'), true);
});

test('P2 authority is enabled only when a service endpoint exists', () => {
    const withoutService = loadScripts(
        ['product/release-config.js', 'product/feature-flags.js'],
        ['P2_RELEASE_DEFAULTS', 'ProductFeatureFlags'],
        { window: {} },
    );
    assert.equal(withoutService.P2_RELEASE_DEFAULTS.authoritative_service, false);
    assert.equal(withoutService.ProductFeatureFlags.isEnabled('authoritative_service'), false);

    const withService = loadScripts(
        ['product/release-config.js', 'product/feature-flags.js'],
        ['P2_RELEASE_DEFAULTS', 'ProductFeatureFlags'],
        { window: { MEH_SERVICE_URL: 'wss://game.example/realtime' } },
    );
    assert.equal(withService.ProductFeatureFlags.isEnabled('authoritative_service'), true);
});
