'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { GAME_RUNTIME_SCRIPTS, ROOT, loadScript, loadScripts } = require('./helpers/load-script');

const { I18n } = loadScripts(['i18n.js', 'ui/experience-copy.js'], ['I18n']);
const { Deck } = loadScript('deck.js', ['Deck']);

test('Arabic and English dictionaries contain the same keys', () => {
    const arabic = Object.keys(I18n.dict.ar).sort();
    const english = Object.keys(I18n.dict.en).sort();
    assert.deepEqual(english, arabic);
});

test('all statically referenced translation keys exist', () => {
    const sourceFiles = [...GAME_RUNTIME_SCRIPTS, 'index.html', 'features.js', 'sound.js', 'storage.js', 'net.js'];
    const sources = sourceFiles
        .map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8'))
        .join('\n');

    const used = new Set();
    for (const match of sources.matchAll(/I18n\.t\(\s*['"]([^'"]+)['"]/g)) used.add(match[1]);
    for (const match of sources.matchAll(/\bdata-i18n="([^"]+)"/g)) used.add(match[1]);
    for (const match of sources.matchAll(/\bdata-i18n-attr="[^:"]+:([^"]+)"/g)) used.add(match[1]);

    const missing = [...used].filter((key) => !(key in I18n.dict.ar)).sort();
    assert.deepEqual(missing, []);
});

test('every deck card name has a translation entry', () => {
    const names = [...new Set(new Deck().cards.map((card) => card.name))];
    const missing = names.filter((name) => !(name in I18n.cards));
    assert.deepEqual(missing, []);
});
