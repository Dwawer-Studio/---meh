'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const hash = relativePath => crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, relativePath))).digest('hex');

const html = read('index.html');
const catalogCss = read('ui/screens/catalog.css');
const catalogSource = read('game/game-catalog.js');

function loadDictionary() {
    const context = { window: {} };
    vm.runInNewContext(`${read('i18n.js')}\nthis.dictionary = I18n.dict;`, context);
    return context.dictionary;
}

function parseHashManifest(relativePath) {
    return read(relativePath).trim().split('\n').map(line => {
        const match = line.match(/^([0-9a-f]{64})  (.+)$/);
        assert.ok(match, `Invalid hash line: ${line}`);
        return { sha256: match[1], file: match[2] };
    });
}

test('UIX-5 loads one collection/store layer after social and before motion', () => {
    assert.match(html, /href="ui\/screens\/catalog\.css"/);
    assert.ok(html.indexOf('ui/screens/catalog.css') > html.indexOf('ui/screens/social.css'));
    assert.ok(html.indexOf('ui/screens/catalog.css') < html.indexOf('ui/motion.css'));
    assert.match(html, /id="catalog-screen" class="screen"/);
    assert.match(catalogCss, /\.ui-v2 #catalog-screen/);
});

test('UIX-5 exposes wallet, collection progress, filters, gallery and detail dialog', () => {
    for (const id of [
        'tamashi-balance', 'tamashi-completion-reward', 'tamashi-healthy-reward',
        'tamashi-win-reward', 'catalog-store-tab', 'catalog-collection-tab',
        'catalog-collection-summary', 'catalog-completion-value', 'catalog-completion-progress',
        'catalog-filters', 'catalog-list', 'catalog-detail-backdrop', 'catalog-detail-dialog',
        'catalog-detail-effect', 'catalog-detail-decision', 'catalog-detail-counterplay',
        'catalog-detail-price', 'catalog-detail-buy',
    ]) assert.match(html, new RegExp(`id="${id}"`), id);
    for (const filter of ['all', 'colored-normal', 'colored-action', 'colored-power', 'black-wild']) {
        assert.match(html, new RegExp(`data-catalog-filter="${filter}"`), filter);
    }
    assert.match(html, /<progress id="catalog-completion-progress"/);
});

test('UIX-5 keeps purchase out of the gallery and reveals it only after decision context', () => {
    const cardStart = catalogSource.indexOf('    _catalogCard(card) {');
    const cardEnd = catalogSource.indexOf('    _catalogImageUrl(card)', cardStart);
    const cardMethod = catalogSource.slice(cardStart, cardEnd);
    assert.match(cardMethod, /_openCatalogDetail\(card, preview\)/);
    assert.doesNotMatch(cardMethod, /_unlockCatalogCard|catalog-buy/);
    const effect = html.indexOf('id="catalog-detail-effect"');
    const decision = html.indexOf('id="catalog-detail-decision"');
    const counterplay = html.indexOf('id="catalog-detail-counterplay"');
    const price = html.indexOf('id="catalog-detail-price"');
    const purchase = html.indexOf('id="catalog-detail-buy"');
    assert.ok(effect > 0 && effect < decision && decision < counterplay);
    assert.ok(counterplay < price && price < purchase, 'all decision and price context must precede purchase');
    assert.match(catalogSource, /card\.purchasable && !card\.unlocked/);
    assert.match(catalogSource, /this\._catalogState\.currency\.balance < card\.tamashiPrice/);
});

test('UIX-5 presents original card art without crop or transform', () => {
    assert.match(catalogSource, /assets\/cards\/\$\{color\}-\$\{card\.assetBase\}\.webp/);
    assert.match(catalogCss, /\.catalog-card-art img[\s\S]*object-fit:\s*contain/);
    assert.match(catalogCss, /\.catalog-card-art img[\s\S]*filter:\s*none/);
    assert.match(catalogCss, /\.catalog-card-art img[\s\S]*transform:\s*none/);
    assert.doesNotMatch(catalogSource, /canvas|clipPath|maskImage/);
});

test('UIX-5 implements completion, owned-only collection and category filters', () => {
    assert.match(catalogSource, /card\.includedByDefault \|\| card\.unlocked/);
    assert.match(catalogSource, /!card\.includedByDefault/);
    assert.match(catalogSource, /Math\.round\(\(safeOwned \/ safeTotal\) \* 100\)/);
    assert.match(catalogSource, /card\.replacementClass === this\._catalogFilter/);
    assert.match(catalogSource, /progress\.value = percentage/);
});

test('UIX-5 has localized loading, error, empty, free-rotation and access states', () => {
    const dictionary = loadDictionary();
    const keys = [
        'catalog_eyebrow', 'catalog_shared_deck', 'tamashi_eyebrow',
        'collection_progress_title', 'collection_completion_value', 'catalog_filters',
        'filter_all', 'filter_characters', 'filter_actions', 'filter_powers', 'filter_wild',
        'store_empty_title', 'catalog_filter_empty_title', 'catalog_error_title', 'catalog_retry',
        'view_card_detail', 'open_card_detail', 'card_detail_eyebrow', 'card_effect',
        'card_decision', 'card_counterplay', 'classic_access_note', 'unlocked_access_note',
        'locked_access_note', 'free_rotation_note', 'card_price',
    ];
    for (const locale of ['ar', 'en']) {
        for (const key of keys) {
            assert.equal(typeof dictionary[locale][key], 'string', `${locale}.${key}`);
            assert.ok(dictionary[locale][key].trim(), `${locale}.${key}`);
            assert.doesNotMatch(dictionary[locale][key], /\p{Extended_Pictographic}/u, `${locale}.${key}`);
        }
    }
    assert.match(catalogSource, /_renderCatalogLoadState\('loading'\)/);
    assert.match(catalogSource, /_renderCatalogLoadState\('error', messageKey\)/);
    assert.match(catalogSource, /_catalogEmptyState\(\)/);
    assert.match(catalogSource, /card\.inFreeRotation/);
});

test('UIX-5 keeps commerce local-safe and preserves every protected byte', () => {
    assert.match(html, /data-i18n="local_iap_disabled"/);
    assert.match(read('product/service-config.js'), /verified_iap:\s*false/);
    assert.doesNotMatch(html.slice(html.indexOf('id="catalog-screen"'), html.indexOf('<!-- ===== شاشة الأونلاين')), /\$\d|USD|BHD|بطاقة ائتمان|credit card/i);
    for (const manifest of ['docs/uiux-u0/card-assets.sha256', 'docs/uiux-u0/protected-files.sha256']) {
        for (const entry of parseHashManifest(manifest)) {
            assert.equal(hash(entry.file), entry.sha256, entry.file);
        }
    }
});
