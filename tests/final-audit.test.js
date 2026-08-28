'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ROOT } = require('./helpers/load-script');

const PHASE_DOCUMENTS = Object.freeze([
    'docs/BASELINE.md',
    'docs/PHASE-1-SECURITY.md',
    'docs/PHASE-2-RELIABILITY.md',
    'docs/PHASE-3-GAME-RULES.md',
    'docs/PHASE-4-ACCESSIBILITY.md',
    'docs/PHASE-5-QUALITY.md',
    'docs/PHASE-6-RESPONSIVE.md',
    'docs/PHASE-7-ARCHITECTURE.md',
    'docs/PHASE-8-LOCAL-CI.md',
    'docs/PHASE-9-BROWSER-E2E.md',
    'docs/PHASE-10-ONLINE-E2E.md',
    'docs/PHASE-11-FINAL-AUDIT.md',
    'docs/RULES-DECISIONS.md',
]);

function testFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return testFiles(target);
        return /\.(?:test|spec)\.js$/.test(entry.name) ? [target] : [];
    });
}

test('FINAL-01: every hardening phase is documented and linked from README', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    for (const relativePath of PHASE_DOCUMENTS) {
        assert.equal(fs.existsSync(path.join(ROOT, relativePath)), true, `${relativePath} exists`);
        assert.match(readme, new RegExp(relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});

test('FINAL-01: no test is hidden behind skip or todo markers', () => {
    const forbidden = [
        /\b(?:test|it|describe)\.(?:skip|todo)\s*\(/,
        /\b(?:skip|todo)\s*:\s*(?:true|['"])/,
    ];
    for (const filename of testFiles(path.join(ROOT, 'tests'))) {
        const source = fs.readFileSync(filename, 'utf8');
        for (const pattern of forbidden) {
            assert.doesNotMatch(source, pattern, path.relative(ROOT, filename));
        }
    }
});

test('FINAL-02: README describes the current online runtime and draw decision', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    assert.match(readme, /لعب جماعي أونلاين/);
    assert.match(readme, /PeerJS/);
    assert.match(readme, /يمكنك السحب من الكومة بدل الرمي حتى لو كانت لديك بطاقة مناسبة/);
    assert.doesNotMatch(readme, /بلا أطر أو مكتبات خارجية/);
});
