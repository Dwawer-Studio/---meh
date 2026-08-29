'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { GAME_RUNTIME_SCRIPTS, ROOT } = require('./helpers/load-script');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const gameSource = GAME_RUNTIME_SCRIPTS
    .map(relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8'))
    .join('\n');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');

test('HTML has a doctype, unique ids, and expected script order', () => {
    assert.match(html, /^<!DOCTYPE html>/i);
    assert.match(html, /<\/html>\s*$/i);

    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    assert.deepEqual([...new Set(duplicates)], []);

    const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((source) => !/^https?:\/\//i.test(source));
    assert.deepEqual(scripts, [
        'storage.js',
        'i18n.js',
        'features.js',
        'sound.js',
        'ui/feedback-director.js',
        'net.js',
        'game/game-manifests.js',
        'game/core-evidence.js',
        'shared/match-reducer.js',
        'game/authoritative-client.js',
        'game/table-session.js',
        'deck.js',
        'vendor/qrcode-generator-1.4.4.js',
        'product/service-config.js',
        ...GAME_RUNTIME_SCRIPTS,
    ]);
});

test('external PeerJS is pinned with SRI and no external stylesheet remains', () => {
    const peerScript = html.match(/<script\b[^>]*src="https:\/\/unpkg\.com\/peerjs@1\.5\.4\/dist\/peerjs\.min\.js"[^>]*><\/script>/);
    assert.ok(peerScript, 'PeerJS script tag is missing');
    assert.match(peerScript[0], /integrity="sha384-nlUQ8ZqCbvStErob\+biJNzSgltf6urV3VGqhfIfzhmg9RXmpeRm76ELw0pYnKlTR"/);
    assert.match(peerScript[0], /crossorigin="anonymous"/);

    const externalStyles = [...html.matchAll(/<link\b[^>]*href="https?:\/\/[^\"]+"[^>]*>/g)];
    assert.deepEqual(externalStyles, []);
});

test('non-void HTML tags are properly nested and closed', () => {
    const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
    const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
    const stack = [];

    for (const match of withoutComments.matchAll(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
        const token = match[0];
        const tag = match[1].toLowerCase();
        if (voidTags.has(tag) || token.endsWith('/>')) continue;
        if (!token.startsWith('</')) stack.push(tag);
        else assert.equal(stack.pop(), tag, `unexpected closing tag </${tag}>`);
    }
    assert.deepEqual(stack, []);
});

test('all local static references exist', () => {
    const references = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((reference) => !/^(?:https?:|data:|#|\/\/)/i.test(reference));

    const missing = references.filter((reference) => {
        const cleanPath = reference.split(/[?#]/, 1)[0];
        return !fs.existsSync(path.join(ROOT, cleanPath));
    });
    assert.deepEqual(missing, []);
});

test('literal DOM ids used by the game runtime exist in index.html', () => {
    const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    const referenced = [...gameSource.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)]
        .map((match) => match[1])
        .filter((id) => id !== 'player-');
    const missing = [...new Set(referenced)].filter((id) => !htmlIds.has(id));
    assert.deepEqual(missing, []);
});

test('CSS braces are balanced after comments are removed', () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    for (const character of withoutComments) {
        if (character === '{') depth++;
        if (character === '}') depth--;
        assert.ok(depth >= 0, 'CSS contains an unexpected closing brace');
    }
    assert.equal(depth, 0);
});
