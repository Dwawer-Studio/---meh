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
const renderer = read('game/game-renderer.js');
const tableCss = read('ui/screens/table.css');

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

test('UIX-3 production loads a dedicated game-table screen after the entry surfaces', () => {
    assert.match(html, /href="ui\/screens\/table\.css"/);
    assert.ok(
        html.indexOf('ui/screens/table.css') > html.indexOf('ui/screens/entry.css'),
        'table CSS must load after entry CSS',
    );
    assert.match(html, /id="game-screen" class="screen game-table-screen"/);
});

test('UIX-3 table exposes seats, piles, direction, turn state, hand and contextual actions', () => {
    for (const id of [
        'table-context-name', 'table-round-label', 'player-bot-1', 'player-bot-2',
        'player-bot-3', 'player-human', 'dir-ring', 'draw-pile', 'discard-pile',
        'turn-indicator', 'turn-action-label', 'human-hand', 'confirm-bar',
        'action-journal', 'journal-toggle-btn',
    ]) assert.match(html, new RegExp(`id="${id}"`), id);

    assert.match(html, /id="human-hand"[^>]*role="group"/);
    assert.match(html, /id="dir-ring"[^>]*role="img"/);
    assert.match(html, /id="discard-pile"[^>]*role="img"/);
});

test('UIX-3 renders original card art in full instead of cropping or scaling it', () => {
    assert.match(renderer, /img\.style\.objectFit = 'contain'/);
    assert.match(renderer, /img\.style\.transform = 'none'/);
    assert.doesNotMatch(renderer, /img\.style\.objectFit = 'cover'/);
    assert.doesNotMatch(renderer, /scale\(1\.045\)/);
    assert.match(tableCss, /\.card > img[\s\S]*object-fit:\s*contain !important/);
});

test('UIX-3 presents live match state without changing the rule engine', () => {
    assert.match(renderer, /_updateTablePresentation\(\)/);
    assert.match(renderer, /classList\.toggle\('local-turn', isLocalTurn\)/);
    assert.match(renderer, /classList\.toggle\('awaiting-decision'/);
    assert.match(renderer, /classList\.toggle\('pending-penalty'/);
    assert.match(renderer, /I18n\.t\('seat_summary'/);
    assert.match(renderer, /I18n\.t\('round_number'/);
    for (const selector of [
        '.active-player .player-info', '.human-hand .card.playable',
        '.human-hand .card.selected', '.human-hand .card.disabled',
        '.player-area.skipped .player-info', '.confirm-bar', '.action-journal',
    ]) assert.ok(tableCss.includes(selector), selector);
});

test('UIX-3 has independently composed portrait and short-landscape tables', () => {
    assert.match(tableCss, /@media \(max-width: 620px\)/);
    assert.match(tableCss, /@media \(max-height: 520px\) and \(orientation: landscape\)/);
    assert.match(tableCss, /#player-human[\s\S]*height:\s*224px/);
    assert.match(
        tableCss,
        /@media \(max-height: 520px\)[\s\S]*#player-human[\s\S]*height:\s*142px/,
    );
    assert.match(tableCss, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(tableCss, /\.dir-arrow[\s\S]*animation:\s*none/);
});

test('UIX-3 Arabic and English table copy is complete and avoids system emoji', () => {
    const dictionary = loadDictionary();
    const keys = [
        'local_table', 'online_table', 'round_number', 'cards_count', 'turn_direction',
        'draw_pile_label', 'discard_pile_label', 'your_hand', 'table_action_choose',
        'table_action_wait', 'table_action_penalty', 'seat_summary', 'confirm_play',
        'cancel', 'action_journal', 'journal_close',
    ];
    const systemMessages = [
        'm_freeze', 'm_uturn', 'm_sorry', 'm_counter', 'm_drama', 'm_captain',
        'm_plato', 'm_chameleon', 'm_boshlakh', 'm_hamour', 'm_sugar', 'm_um',
        'm_phantom', 'm_meh', 'm_draw4', 'm_wild', 'm_bestone', 'm_meh_win',
    ];
    for (const locale of ['ar', 'en']) {
        for (const key of keys) assert.equal(typeof dictionary[locale][key], 'string', `${locale}.${key}`);
        for (const key of [...keys, ...systemMessages]) {
            assert.doesNotMatch(dictionary[locale][key], /\p{Extended_Pictographic}/u, `${locale}.${key}`);
        }
    }
});

test('UIX-3 preserves every locked card image and protected core source byte-for-byte', () => {
    for (const manifest of ['docs/uiux-u0/card-assets.sha256', 'docs/uiux-u0/protected-files.sha256']) {
        for (const entry of parseHashManifest(manifest)) {
            assert.equal(hash(entry.file), entry.sha256, entry.file);
        }
    }
});
