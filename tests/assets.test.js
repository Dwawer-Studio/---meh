'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ROOT, loadScript } = require('./helpers/load-script');

const { Deck } = loadScript('deck.js', ['Deck']);

test('every card image exists and every tracked WebP asset is referenced', () => {
    const expected = new Set(new Deck().cards.map((card) => card.svgFile.replaceAll('/', path.sep)));
    expected.add(path.join('assets', 'cards', 'card-back.webp'));

    const assetDirectory = path.join(ROOT, 'assets', 'cards');
    const actual = fs.readdirSync(assetDirectory)
        .filter((name) => name.endsWith('.webp'))
        .map((name) => path.join('assets', 'cards', name));

    assert.equal(expected.size, 61);
    assert.equal(actual.length, 61);
    assert.deepEqual([...actual].sort(), [...expected].sort());

    for (const relativePath of actual) {
        const data = fs.readFileSync(path.join(ROOT, relativePath));
        assert.ok(data.length > 1_000, `${relativePath} is unexpectedly small`);
        assert.equal(data.toString('ascii', 0, 4), 'RIFF', `${relativePath} is not a RIFF file`);
        assert.equal(data.toString('ascii', 8, 12), 'WEBP', `${relativePath} is not a WebP file`);
    }
});
