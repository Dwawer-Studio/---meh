'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadScripts, ROOT } = require('./helpers/load-script');

const P4_FLAGS = [
    'card_catalog', 'tamashi_wallet', 'card_lab', 'friendly_recipes',
    'verified_iap', 'catalog_expansion',
];

test('P4 product slices default closed and remain independently reversible', () => {
    const loaded = loadScripts(
        ['product/release-config.js', 'product/feature-flags.js'],
        ['P4_RELEASE_DEFAULTS', 'ProductFeatureFlags'], { window: {} },
    );
    assert.deepEqual(Object.keys(loaded.P4_RELEASE_DEFAULTS).sort(), [...P4_FLAGS].sort());
    P4_FLAGS.forEach(flag => assert.equal(loaded.ProductFeatureFlags.isEnabled(flag), false));
    loaded.ProductFeatureFlags.configure({
        card_catalog: true, tamashi_wallet: true, friendly_recipes: true,
        verified_iap: false, catalog_expansion: false,
    });
    assert.equal(loaded.ProductFeatureFlags.isEnabled('card_catalog'), true);
    assert.equal(loaded.ProductFeatureFlags.isEnabled('friendly_recipes'), true);
    assert.equal(loaded.ProductFeatureFlags.isEnabled('verified_iap'), false);
    assert.equal(loaded.ProductFeatureFlags.isEnabled('catalog_expansion'), false);
});

test('P4 local service enables the lab but keeps real-money verification and expansion off', () => {
    const window = {
        location: { search: '?service=local', hostname: '127.0.0.1' },
    };
    const loaded = loadScripts(
        ['product/service-config.js', 'product/release-config.js', 'product/feature-flags.js'],
        ['ProductFeatureFlags'], { window, URLSearchParams },
    );
    assert.equal(loaded.ProductFeatureFlags.isEnabled('card_catalog'), true);
    assert.equal(loaded.ProductFeatureFlags.isEnabled('tamashi_wallet'), true);
    assert.equal(loaded.ProductFeatureFlags.isEnabled('card_lab'), true);
    assert.equal(loaded.ProductFeatureFlags.isEnabled('friendly_recipes'), true);
    assert.equal(loaded.ProductFeatureFlags.isEnabled('verified_iap'), false);
    assert.equal(loaded.ProductFeatureFlags.isEnabled('catalog_expansion'), false);
});

test('P4 catalog UI is optional, accessible, text-safe, and does not interrupt first play', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const source = fs.readFileSync(path.join(ROOT, 'game', 'game-catalog.js'), 'utf8');
    assert.match(html, /id="catalog-btn"[^>]*class="[^"]*hidden/);
    assert.match(html, /id="catalog-screen"[^>]*class="screen"/);
    assert.match(html, /id="tamashi-balance"[^>]*aria-live="polite"/);
    assert.match(html, /id="catalog-store-tab"[^>]*role="tab"/);
    assert.match(html, /id="catalog-collection-tab"[^>]*role="tab"/);
    assert.match(html, /id="catalog-list"[^>]*role="tabpanel"/);
    assert.match(html, /id="friendly-recipe-summary"[^>]*aria-live="polite"/);
    assert.doesNotMatch(source, /\.innerHTML\s*=/);
    assert.match(source, /textContent/);
    assert.match(source, /_catalogEmptyState\(\)/);
    assert.match(source, /card => !card\.includedByDefault/);
    assert.doesNotMatch(source, /randomized|loot|pack/i);
});

test('P4 dynamic catalog and friendly recipe rerender when language changes', () => {
    const loaded = loadScripts(
        ['game/game-catalog.js'], ['MehGameCatalogMethods'],
    );
    const calls = [];
    const subject = {
        _catalogState: { cards: [] },
        _catalogRoom: { roomId: 'room_language_test' },
        _catalogSeats: [],
        _renderCardCatalog() { calls.push('catalog'); },
        _renderFriendlyRecipe() { calls.push('recipe'); },
    };
    loaded.MehGameCatalogMethods._refreshCatalogLocalization.call(subject);
    assert.deepEqual(calls, ['catalog', 'recipe']);
    const profileSource = fs.readFileSync(path.join(ROOT, 'game', 'game-profile.js'), 'utf8');
    assert.ok(profileSource.match(/_refreshCatalogLocalization\(\)/g).length >= 2);
});
