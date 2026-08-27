'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./helpers/load-script');

const { Card, Deck } = loadScript('deck.js', ['Card', 'Deck']);

test('deck contains the current 60-card baseline with unique ids', () => {
    const deck = new Deck();
    assert.equal(deck.cards.length, 60);
    assert.equal(new Set(deck.cards.map((card) => card.id)).size, 60);

    const byColor = {};
    for (const card of deck.cards) byColor[card.color] = (byColor[card.color] || 0) + 1;
    assert.deepEqual(byColor, { orange: 19, gray: 19, purple: 19, black: 3 });
});

test('draw removes one card and returns null when the deck is empty', () => {
    const deck = new Deck();
    const drawn = deck.draw();
    assert.ok(drawn instanceof Card);
    assert.equal(deck.cards.length, 59);

    deck.cards = [];
    assert.equal(deck.draw(), null);
});

test('a card is playable by black color, active color, or matching name', () => {
    const top = new Card('orange', 'الدافور', 'normal', '🔥', 'unused.webp');
    assert.equal(new Card('black', 'مه', 'meh', '🃏', 'unused.webp').isPlayable(top, 'orange'), true);
    assert.equal(new Card('orange', 'ام كشة', 'normal', '👩', 'unused.webp').isPlayable(top, 'orange'), true);
    assert.equal(new Card('gray', 'الدافور', 'normal', '🔥', 'unused.webp').isPlayable(top, 'orange'), true);
    assert.equal(new Card('purple', 'ام كشة', 'normal', '👩', 'unused.webp').isPlayable(top, 'orange'), false);
});
