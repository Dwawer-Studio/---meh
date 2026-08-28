'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { ROOT } = require('./helpers/load-script');

test('QUALITY-01: strict HTML quality rules cannot be silently disabled', () => {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, '.htmlvalidate.json'), 'utf8'));
    assert.equal(config.rules['no-inline-style'], 'error');
    assert.equal(config.rules['prefer-native-element'], 'error');
    assert.equal(config.rules['no-implicit-button-type'], 'error');
});

test('QUALITY-01: the HTML template contains no inline style attributes', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /\sstyle\s*=/i);
});

test('QUALITY-02: CSS ordering and duplicate-selector checks stay enabled', () => {
    const config = require(path.join(ROOT, 'stylelint.config.cjs'));
    assert.equal(config.rules['no-descending-specificity'], true);
    assert.equal(config.rules['no-duplicate-selectors'], true);
});
