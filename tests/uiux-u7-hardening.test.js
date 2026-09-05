'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ROOT, loadScript } = require('./helpers/load-script');
const { PRODUCTION_STYLESHEETS, readUiCss } = require('./helpers/ui-css');
const { pseudoLocalize } = require('./helpers/pseudo-locale');

const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const hash = relativePath => crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, relativePath))).digest('hex');
const html = read('index.html');
const css = readUiCss();
const matrix = JSON.parse(read('tests/fixtures/uiux-u7-matrix.json'));
const { I18n } = loadScript('i18n.js', ['I18n']);

function parseHashManifest(relativePath) {
    return read(relativePath).trim().split('\n').map(line => {
        const match = line.match(/^([0-9a-f]{64})  (.+)$/);
        assert.ok(match, `Invalid hash line: ${line}`);
        return { sha256: match[1], file: match[2] };
    });
}

test('UIX-7 removes the legacy stylesheet and temporary UI flag completely', () => {
    assert.equal(fs.existsSync(path.join(ROOT, 'style.css')), false);
    assert.doesNotMatch(html, /style\.css|ui-v2|data-ui-system/);
    assert.doesNotMatch(css, /ui-v2|--gold|--glass|casino|طاولة كازينو/i);
    assert.deepEqual(PRODUCTION_STYLESHEETS, [
        'ui/tokens.css',
        'ui/foundations.css',
        'ui/components.css',
        'ui/shell.css',
        'ui/screens/home.css',
        'ui/screens/entry.css',
        'ui/screens/table.css',
        'ui/screens/social.css',
        'ui/screens/catalog.css',
        'ui/motion.css',
        'ui/experience.css',
        'ui/accessibility.css',
    ]);
});

test('UIX-7 locks the complete ten-frame device and state matrix', () => {
    assert.deepEqual(matrix.frames.map(frame => [frame.lang, frame.width, frame.height]), [
        ['ar', 360, 800], ['ar', 393, 852], ['en', 360, 800], ['en', 430, 932],
        ['ar', 844, 390], ['en', 932, 430], ['ar', 768, 1024], ['en', 1024, 768],
        ['ar', 1366, 768], ['en', 1440, 900],
    ]);
    assert.deepEqual(matrix.profiles, ['normal', 'reduced-motion', 'colorblind', 'text-200']);
    assert.deepEqual(matrix.catalogStates, ['loading', 'error', 'empty']);
    assert.deepEqual(matrix.tableStages, ['ready', 'selected', 'decision', 'penalty', 'result']);
});

test('UIX-7 pseudo-localization expands both dictionaries without corrupting placeholders', () => {
    const arKeys = Object.keys(I18n.dict.ar).sort();
    const enKeys = Object.keys(I18n.dict.en).sort();
    assert.deepEqual(enKeys, arKeys);
    for (const lang of ['ar', 'en']) {
        for (const [key, value] of Object.entries(I18n.dict[lang])) {
            const pseudo = pseudoLocalize(value);
            assert.match(pseudo, /^⟦[\s\S]*⟧$/, `${lang}.${key}`);
            const originalTokens = value.match(/\{\{?[^{}]+\}?\}|%\d*\$?[a-z]/gi) || [];
            const pseudoTokens = pseudo.match(/\{\{?[^{}]+\}?\}|%\d*\$?[a-z]/gi) || [];
            assert.deepEqual(pseudoTokens, originalTokens, `${lang}.${key} placeholders`);
            if (value.length >= 12) {
                assert.ok(pseudo.length >= value.length * 1.2, `${lang}.${key} expands`);
            }
        }
    }
});

test('UIX-7 locks performance, motion and critical-resource budgets', () => {
    const tokens = read('ui/tokens.css');
    const director = read('ui/feedback-director.js');
    assert.match(tokens, /--ui-duration-blocking-max:\s*450ms/);
    assert.match(director, /MAX_BLOCKING_MS:\s*420/);
    assert.match(director, /MAX_FLASHES_PER_SECOND:\s*0/);
    assert.equal((html.match(/rel="preload"/g) || []).length, 1);
    assert.match(html, /IBMPlexSansArabic-Regular\.woff2[^>]*as="font"/);
    assert.doesNotMatch(css, /https?:\/\/|data:font/i);
    for (const id of ['catalog-detail-image']) {
        assert.match(html, new RegExp(`id="${id}"[^>]*loading="lazy"[^>]*decoding="async"`));
    }
    assert.match(html, /dwawer-mark-ink\.png"[^>]*loading="lazy"[^>]*decoding="async"/);
});

test('UIX-7 makes axe and pixel baselines mandatory repository gates', () => {
    const packageJson = JSON.parse(read('package.json'));
    assert.equal(packageJson.devDependencies['@axe-core/playwright'], '4.13.0');
    assert.equal(packageJson.scripts['test:uiux-u7'],
        'node --test tests/uiux-u7-hardening.test.js && playwright test tests/e2e/uiux-u7.spec.js tests/e2e/uiux-u7-visual.spec.js');
    assert.match(read('tests/e2e/uiux-u7.spec.js'), /AxeBuilder/);
    assert.equal(fs.existsSync(path.join(ROOT, 'tests/e2e/uiux-u7-visual.spec.js-snapshots')), true);
});

test('UIX-7 preserves every protected gameplay and card-art byte', () => {
    for (const manifest of ['docs/uiux-u0/card-assets.sha256', 'docs/uiux-u0/protected-files.sha256']) {
        for (const entry of parseHashManifest(manifest)) {
            assert.equal(hash(entry.file), entry.sha256, entry.file);
        }
    }
});
