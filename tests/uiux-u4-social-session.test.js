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
const socialCss = read('ui/screens/social.css');
const online = read('game/game-online.js');
const renderer = read('game/game-renderer.js');
const table = read('game/game-table.js');
const majlis = read('game/game-majlis.js');

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

test('UIX-4 loads one dedicated social-session layer after the game table', () => {
    assert.match(html, /href="ui\/screens\/social\.css"/);
    assert.ok(
        html.indexOf('ui/screens/social.css') > html.indexOf('ui/screens/table.css'),
        'social CSS must load after table CSS',
    );
    assert.match(html, /id="lobby-screen" class="screen app-screen social-screen lobby-screen"/);
    assert.match(html, /id="end-screen" class="screen app-screen social-screen results-screen"/);
});

test('UIX-4 lobby presents invite, QR actions, four seats, timing and readiness', () => {
    for (const id of [
        'lobby-room-code', 'copy-code-btn', 'share-invite-btn', 'whatsapp-invite-btn',
        'copy-invite-btn', 'qr-invite-btn', 'invite-qr-wrap', 'invite-qr-image',
        'lobby-seat-status', 'turn-time-select', 'lobby-players', 'lobby-start-btn',
    ]) assert.match(html, new RegExp(`id="${id}"`), id);
    assert.match(html, /<ul id="lobby-players" class="lobby-players"><\/ul>/);
    assert.match(online, /for \(let index = occupied; index < 4; index\+\+\)/);
    assert.match(online, /className = 'lobby-player'/);
    assert.match(online, /_createTextElement\('li', 'lobby-seat-empty'/);
    assert.match(online, /I18n\.t\('lobby_seat_summary'/);
    assert.doesNotMatch(online, /renderLobby\(\)[\s\S]*?\.innerHTML\s*=/);
});

test('UIX-4 results expose outcome, standings, readiness, rematch and sharing', () => {
    for (const id of [
        'share-result-btn', 'end-menu-btn', 'result-mark', 'winner-text',
        'result-subtitle', 'end-stats', 'result-board', 'session-score',
        'result-rematch', 'table-ready-list', 'rematch-status', 'restart-btn',
    ]) assert.match(html, new RegExp(`id="${id}"`), id);
    assert.match(renderer, /_updateResultPresentation\(humanWon, winnerName\)/);
    assert.match(renderer, /screen\.dataset\.outcome = humanWon \? 'win' : 'loss'/);
    assert.match(renderer, /_renderPersonalRecord\(\)/);
    assert.match(table, /rankedSeats = snapshot\.seats\.slice\(\)\.sort/);
    assert.match(table, /session-score-rank/);
    assert.match(table, /I18n\.t\('players_ready'/);
    assert.match(table, /async _shareResult\(\)/);
    assert.match(table, /navigator\.share/);
    assert.match(table, /this\._copyText\(text\)/);
});

test('UIX-4 uses the icon vocabulary and avoids new system-emoji chrome', () => {
    const icons = read('assets/ui/icons.svg');
    for (const id of ['icon-copy', 'icon-qr', 'icon-share', 'icon-exit']) {
        assert.match(icons, new RegExp(`id="${id}"`), id);
        assert.match(html, new RegExp(`icons\\.svg#${id}`), id);
    }
    const dictionary = loadDictionary();
    const keys = [
        'lobby_eyebrow', 'lobby_invite_eyebrow', 'lobby_invite_title',
        'lobby_seats_eyebrow', 'lobby_seats_title', 'lobby_seats_status',
        'host_label', 'open_seat', 'lobby_seat_summary', 'round_complete',
        'result_subtitle', 'result_win_subtitle', 'result_loss_subtitle',
        'session_standings', 'session_score_hint', 'session_score_after',
        'rematch_title', 'players_ready', 'share_result', 'result_share_title',
        'result_share_copied', 'result_share_failed', 'personal_record_summary',
    ];
    for (const locale of ['ar', 'en']) {
        for (const key of keys) {
            assert.equal(typeof dictionary[locale][key], 'string', `${locale}.${key}`);
            assert.doesNotMatch(dictionary[locale][key], /\p{Extended_Pictographic}/u, `${locale}.${key}`);
        }
    }
});

test('UIX-4 composes portrait and short-landscape lobby/results independently', () => {
    assert.match(socialCss, /\.ui-v2 #end-screen\.results-screen[\s\S]*var\(--ui-surface-paper\)/);
    assert.match(socialCss, /@media \(max-width: 720px\)/);
    assert.match(socialCss, /@media \(max-width: 390px\)/);
    assert.match(socialCss, /@media \(max-height: 520px\) and \(orientation: landscape\)/);
    assert.match(socialCss, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(socialCss, /\.lobby-layout[\s\S]*grid-template-columns/);
    assert.match(socialCss, /\.results-screen \.end-content[\s\S]*grid-template-areas/);
    assert.match(socialCss, /\.result-seal/);
});

test('UIX-4 social communication is phrase-only and has visible safety controls', () => {
    const quickChatStart = html.indexOf('id="quick-chat-control"');
    const quickChatEnd = html.indexOf('</div>', html.indexOf('id="table-safety-list"'));
    const quickChatMarkup = html.slice(quickChatStart, quickChatEnd);
    assert.ok(quickChatStart > 0 && quickChatEnd > quickChatStart);
    assert.doesNotMatch(quickChatMarkup, /<(input|textarea)\b/);
    assert.match(majlis, /MAJLIS_QUICK_PHRASES\.forEach/);
    assert.match(majlis, /MAJLIS_QUICK_PHRASES\.includes\(chat\.phraseId\)/);
    assert.match(majlis, /_mutedSeatIds/);
    assert.match(majlis, /reportSeat\(seatId, reasonCode\)/);
    assert.match(majlis, /event\.key !== 'Escape'/);
    assert.match(majlis, /_quickChatLastFocus/);
    assert.match(html, /data-i18n="majlis_consent_note"/);
});

test('UIX-4 preserves every locked card image and protected core source byte-for-byte', () => {
    for (const manifest of ['docs/uiux-u0/card-assets.sha256', 'docs/uiux-u0/protected-files.sha256']) {
        for (const entry of parseHashManifest(manifest)) {
            assert.equal(hash(entry.file), entry.sha256, entry.file);
        }
    }
});
