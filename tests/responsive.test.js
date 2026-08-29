'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { ROOT } = require('./helpers/load-script');

const css = fs.readFileSync(path.join(ROOT, 'ui/screens/table.css'), 'utf8');
const harness = fs.readFileSync(path.join(ROOT, 'tests/fixtures/responsive-harness.html'), 'utf8');

test('RESP-01: portrait phones use a dedicated table layout', () => {
    assert.match(css, /@media\s*\(max-width:\s*620px\)/);
    assert.match(css, /#game-screen \.left-player,[\s\S]*#game-screen \.right-player/);
    assert.match(css, /height:\s*100dvh/);
});

test('RESP-02: short landscape phones use a dedicated table layout', () => {
    assert.match(css, /@media\s*\(max-height:\s*520px\)\s*and\s*\(orientation:\s*landscape\)/);
    assert.match(css, /#game-screen #player-human[\s\S]*height:\s*142px/);
});

test('RESP-01/02: the browser harness preserves the target viewport sizes', () => {
    assert.match(harness, /\.portrait\s*\{\s*width:\s*390px;\s*height:\s*844px;/);
    assert.match(harness, /\.landscape\s*\{\s*width:\s*844px;\s*height:\s*390px;/);
    assert.doesNotMatch(harness, /\sstyle\s*=/i);
});
