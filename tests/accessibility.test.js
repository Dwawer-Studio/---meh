'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { GAME_RUNTIME_SCRIPTS, ROOT, loadScripts } = require('./helpers/load-script');
const { readUiCss } = require('./helpers/ui-css');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const gameSource = GAME_RUNTIME_SCRIPTS
    .map(relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8'))
    .join('\n');
const css = readUiCss();

function makeClassList() {
    const values = new Set();
    return {
        add(...names) { names.forEach(name => values.add(name)); },
        remove(...names) { names.forEach(name => values.delete(name)); },
        toggle(name, force) {
            if (force === true) values.add(name);
            else if (force === false) values.delete(name);
            else if (values.has(name)) values.delete(name);
            else values.add(name);
            return values.has(name);
        },
        contains(name) { return values.has(name); },
    };
}

function createDocument() {
    const byId = new Map();
    const document = {
        activeElement: null,
        addEventListener() {},
        removeEventListener() {},
        querySelectorAll() { return []; },
        getElementById(id) { return byId.get(id) || null; },
        createElement(tagName) {
            const attributes = new Map();
            const element = {
                tagName: tagName.toUpperCase(),
                children: [],
                className: '',
                classList: makeClassList(),
                dataset: {},
                style: { setProperty() {} },
                appendChild(child) { this.children.push(child); return child; },
                replaceChildren(...children) { this.children = children; },
                setAttribute(name, value) { attributes.set(name, String(value)); },
                toggleAttribute(name, force) {
                    if (force) attributes.set(name, '');
                    else attributes.delete(name);
                },
                getAttribute(name) { return attributes.get(name) ?? null; },
                focus() { document.activeElement = this; },
            };
            return element;
        },
        body: { classList: makeClassList() },
        register(id, element) { byId.set(id, element); return element; },
    };
    return document;
}

function loadAccessibleGame(document) {
    return loadScripts(['deck.js', 'game.js'], ['MehGame'], {
        document,
        window: { innerWidth: 1280 },
        I18n: {
            t(key) { return key; },
            cardName(card) { return card.name; },
            colorName(color) { return color; },
        },
        Net: {},
        Sound: { play() {} },
        WakeLock: {},
        Storage: {},
        COLOR_SYMBOLS: {},
    }).MehGame;
}

test('A11Y-01: static game controls use native keyboard semantics', () => {
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
    assert.ok(buttons.length > 0);
    for (const button of buttons) assert.match(button, /\btype="button"/, button);

    assert.match(html, /<button\b[^>]*id="draw-pile"[^>]*type="button"/);
    assert.equal((html.match(/<button\b[^>]*class="color-btn/g) || []).length, 3);
    assert.equal((html.match(/class="modal-overlay hidden"[^>]*role="dialog"[^>]*aria-modal="true"/g) || []).length, 3);
});

test('A11Y-01: settings toggles expose keyboard switch semantics', () => {
    const switches = [...html.matchAll(/<div\b[^>]*class="[^"]*\bsetting-row\b[^"]*\btoggle-row\b[^"]*"[^>]*>/g)]
        .map(match => match[0]);
    assert.equal(switches.length, 8);
    for (const toggle of switches) {
        assert.match(toggle, /\brole="switch"/);
        assert.match(toggle, /\btabindex="0"/);
        assert.match(toggle, /\baria-checked="false"/);
    }
    assert.match(gameSource, /event\.key !== 'Enter' && event\.key !== ' '/);
});

test('A11Y-01: turn changes, game messages, and toasts are announced', () => {
    assert.match(html, /id="turn-indicator"[^>]*aria-live="polite"/);
    assert.match(html, /id="game-message"[^>]*role="alert"/);
    assert.match(html, /id="toast-container"[^>]*aria-live="polite"/);
});

test('A11Y-01: inactive screens are removed from keyboard navigation', () => {
    assert.match(gameSource, /screen\.inert\s*=\s*!isActive/);
    assert.match(gameSource, /setAttribute\('aria-hidden',\s*String\(!isActive\)\)/);
});

test('A11Y-01: a playable card is a named native button', () => {
    const document = createDocument();
    const MehGame = loadAccessibleGame(document);
    const game = Object.create(MehGame.prototype);
    game.players = [{ id: 'human', isBot: false }];
    game.currentPlayerIndex = 0;
    game.settings = { confirmPlay: true };
    game.humanCanPlay = true;
    game.isAwaitingColor = false;
    game.actionInProgress = false;
    let selected = null;
    game.inspectCard = id => { selected = id; };

    const element = game.createCardElement({
        id: 'card1', color: 'orange', name: 'بطاقة', emoji: '🃏', svgFile: 'card.webp',
    }, false, true, 2);

    assert.equal(element.tagName, 'BUTTON');
    assert.equal(element.type, 'button');
    assert.match(element.getAttribute('aria-label'), /بطاقة/);
    element.onclick();
    assert.equal(selected, 'card1');
});

test('A11Y-01: an unavailable card remains keyboard-inspectable without committing a play', () => {
    const document = createDocument();
    const MehGame = loadAccessibleGame(document);
    const game = Object.create(MehGame.prototype);
    game.players = [{ id: 'human', isBot: false }];
    game.currentPlayerIndex = 0;
    game.selectedCardIndex = -1;
    let inspected = null;
    game.inspectCard = id => { inspected = id; };

    const element = game.createCardElement({
        id: 'card2', color: 'gray', name: 'غير متاحة', emoji: '🃏', svgFile: 'card.webp',
    }, false, false, 1);

    assert.equal(element.tagName, 'BUTTON');
    assert.equal(element.disabled, false);
    element.onclick();
    assert.equal(inspected, 'card2');
});

test('A11Y-01: selecting a card moves focus to confirmation', () => {
    const document = createDocument();
    const confirmBar = document.createElement('div');
    const confirmButton = document.createElement('button');
    document.register('confirm-bar', confirmBar);
    document.register('confirm-play-btn', confirmButton);
    const MehGame = loadAccessibleGame(document);
    const game = Object.create(MehGame.prototype);
    game.updateUI = () => {};
    game.selectedCardIndex = -1;
    game.players = [{ hand: [0, 1, 2, 3].map(index => ({ id: `card-${index}` })) }];

    game.selectCard(3);

    assert.equal(game.selectedCardIndex, 3);
    assert.equal(document.activeElement, confirmButton);
});

test('A11Y-01: opening a decision dialog exposes it and focuses its first control', () => {
    const document = createDocument();
    const control = document.createElement('button');
    const dialog = document.createElement('div');
    dialog.classList.add('hidden');
    dialog.querySelector = () => control;
    const MehGame = loadAccessibleGame(document);
    const game = Object.create(MehGame.prototype);

    game.setDialogOpen(dialog, true);
    assert.equal(dialog.classList.contains('hidden'), false);
    assert.equal(dialog.inert, false);
    assert.equal(dialog.getAttribute('aria-hidden'), 'false');
    assert.equal(document.activeElement, control);

    game.setDialogOpen(dialog, false);
    assert.equal(dialog.classList.contains('hidden'), true);
    assert.equal(dialog.inert, true);
    assert.equal(dialog.getAttribute('aria-hidden'), 'true');
});

test('A11Y-01: keyboard focus has a visible style across primary controls', () => {
    assert.match(css, /\.human-hand \.card\.playable:focus-visible/);
    assert.match(css, /:where\(button, input, select, textarea, \[tabindex\]\):focus-visible/);
    assert.match(css, /outline:\s*var\(--ui-stroke-focus\) solid var\(--ui-brand-signal\)/);
});

test('P1 guidance, journal, and timer expose non-motion accessible alternatives', () => {
    assert.match(html, /id="context-tip"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(html, /id="action-journal"[^>]*role="dialog"[^>]*aria-hidden="true"[^>]*inert/);
    assert.match(html, /id="turn-timer"[^>]*role="timer"[^>]*aria-live="polite"/);
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    assert.match(css, /animation-duration:\s*1ms\s*!important/);
});
