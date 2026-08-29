'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function hash(relativePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relativePath))).digest('hex');
}

function parseHashManifest(relativePath) {
    return read(relativePath).trim().split('\n').map(line => {
        const match = line.match(/^([0-9a-f]{64})  (.+)$/);
        assert.ok(match, `Invalid hash line in ${relativePath}: ${line}`);
        return { sha256: match[1], file: match[2] };
    });
}

function luminance(hex) {
    const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255);
    const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(left, right) {
    const a = luminance(left);
    const b = luminance(right);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('UIX-0 generated manifests are current', () => {
    const result = spawnSync(process.execPath, ['tools/uiux-u0-manifests.js'], {
        cwd: root,
        encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Verified 4 UIX-0 manifests/);
});

test('all current card assets are locked by SHA-256', () => {
    const entries = parseHashManifest('docs/uiux-u0/card-assets.sha256');
    assert.equal(entries.length, 61, 'Expected 60 card faces plus one card back');
    for (const entry of entries) {
        assert.ok(entry.file.startsWith('assets/cards/'));
        assert.equal(hash(entry.file), entry.sha256, entry.file);
    }
});

test('core rules and catalog sources are locked for the visual slice', () => {
    const entries = parseHashManifest('docs/uiux-u0/protected-files.sha256');
    assert.deepEqual(entries.map(entry => entry.file), [
        'deck.js',
        'catalog/catalog-registry.js',
        'shared/match-reducer.js'
    ]);
    for (const entry of entries) assert.equal(hash(entry.file), entry.sha256, entry.file);
});

test('brand exports are byte-identical and fonts carry an OFL license', () => {
    const manifest = JSON.parse(read('docs/uiux-u0/brand-assets.json'));
    for (const asset of manifest.exports) assert.equal(hash(asset.file), asset.sourceSha256, asset.file);
    assert.equal(manifest.font.license, 'SIL Open Font License 1.1');
    assert.match(read(manifest.font.licenseFile), /SIL OPEN FONT LICENSE Version 1\.1/);
});

test('every committed text contrast pair meets its declared gate', () => {
    const tokens = JSON.parse(read('docs/uiux-u0/tokens.json'));
    for (const pair of tokens.contrast) {
        const actual = contrast(pair.foreground, pair.background);
        assert.ok(actual >= pair.minimum, `${pair.foreground} on ${pair.background} = ${actual.toFixed(2)}`);
        assert.ok(Math.abs(actual - pair.ratio) < 0.02, `Stale recorded ratio for ${pair.foreground}`);
    }
    assert.equal(tokens.color['brand.signal'].restriction.includes('fifth gameplay color'), true);
});

test('reference matrix contains all screens, locales and orientations', () => {
    const manifest = JSON.parse(read('artifacts/uiux-u0/screenshot-manifest.json'));
    const browserAudit = JSON.parse(read('artifacts/uiux-u0/browser-audit.json'));
    assert.equal(manifest.baseline.length, 10);
    assert.equal(manifest.reference.length, 12);
    assert.equal(browserAudit.cases.length, 12);
    assert.ok(browserAudit.cases.every(item => item.visibleOverflowCount === 0));
    const expected = [];
    for (const frame of [
        { name: 'portrait', width: 393, height: 852 },
        { name: 'landscape', width: 932, height: 430 }
    ]) {
        for (const locale of ['ar', 'en']) {
            for (const screen of ['home', 'table', 'results']) {
                expected.push(`artifacts/uiux-u0/reference/reference-${screen}-${locale}-${frame.name}-${frame.width}x${frame.height}.jpg`);
            }
        }
    }
    assert.deepEqual(manifest.reference.map(item => item.file).sort(), expected.sort());
    for (const item of manifest.reference) {
        const portrait = item.file.includes('-portrait-');
        assert.equal(item.width, portrait ? 393 : 932, item.file);
        assert.equal(item.height, portrait ? 852 : 430, item.file);
    }
});

test('prototype remains isolated from production and contains the three reference screens', () => {
    const html = read('prototypes/uiux-u0/index.html');
    const javascript = read('prototypes/uiux-u0/prototype.js');
    for (const screen of ['home', 'table', 'results']) {
        assert.match(html, new RegExp(`id="${screen}-screen"`));
        assert.match(javascript, new RegExp(`'${screen}'`));
    }
    assert.match(html, /assets\/cards\/black-meh\.webp/);
    assert.doesNotMatch(javascript, /match-reducer|deck\.js|catalog-registry/);
});
