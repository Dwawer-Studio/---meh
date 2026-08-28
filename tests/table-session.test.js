'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadScript } = require('./helpers/load-script');

const { TableSession, TABLE_PHASES } = loadScript(
    'game/table-session.js',
    ['TableSession', 'TABLE_PHASES'],
);

function addHumans(table, count) {
    for (let index = 0; index < count; index++) {
        assert.equal(table.addHuman({
            ownerId: index === 0 ? 'host' : `peer-${index}`,
            displayName: `Player ${index}`,
            avatar: '😎',
        }).ok, true);
    }
}

test('P1 TableSession follows FORMING → IN_MATCH → RESULTS → next match without a new table', () => {
    const table = new TableSession({ tableId: 'ABCDE' });
    addHumans(table, 2);
    table.fillBots();
    assert.equal(table.phase, TABLE_PHASES.FORMING);
    assert.equal(table.seats.length, 4);
    assert.equal(table.startMatch().ok, true);
    assert.equal(table.phase, TABLE_PHASES.IN_MATCH);
    assert.equal(table.endMatch('seat-1').ok, true);
    assert.equal(table.phase, TABLE_PHASES.RESULTS);
    assert.equal(table.seats[1].score, 1);
    assert.equal(table.setReady('host'), true);
    assert.equal(table.setReady('peer-1'), true);
    assert.equal(table.allHumansReady(), true);
    assert.equal(table.startMatch().ok, true);
    assert.equal(table.matchNumber, 2);
    assert.equal(table.tableId, 'ABCDE');
});

test('P1 TableSession accepts new humans only while forming or showing results', () => {
    const table = new TableSession();
    addHumans(table, 1);
    table.startMatch();
    assert.equal(table.addHuman({ ownerId: 'late', displayName: 'Late', avatar: '😎' }).reason, 'match-in-progress');
    table.endMatch('seat-0');
    assert.equal(table.addHuman({ ownerId: 'late', displayName: 'Late', avatar: '😎' }).ok, true);
});

test('P1 disconnected seat is reserved, reclaimed in-window, and bot-controlled after expiry', () => {
    let now = 1000;
    const table = new TableSession({ now: () => now, reconnectWindowMs: 5000 });
    addHumans(table, 2);
    table.startMatch();
    assert.equal(table.disconnect('peer-1'), true);
    now = 5000;
    assert.equal(table.reconnect('peer-1').mode, 'current-match');
    table.disconnect('peer-1');
    now = 11_000;
    assert.deepEqual(Array.from(table.expireLeases()), ['seat-1']);
    assert.equal(table.seats[1].controller, 'bot');
    assert.equal(table.reconnect('peer-1').mode, 'next-match');
});

test('P1 TableSession requires every connected human to be ready for the next match', () => {
    const table = new TableSession();
    addHumans(table, 3);
    table.startMatch();
    table.endMatch('seat-0');
    table.setReady('host');
    table.setReady('peer-1');
    assert.equal(table.startMatch().reason, 'not-ready');
    table.setReady('peer-2');
    assert.equal(table.startMatch().ok, true);
});

test('P1 closing a table is final', () => {
    const table = new TableSession();
    addHumans(table, 1);
    assert.equal(table.close(), true);
    assert.equal(table.phase, TABLE_PHASES.CLOSED);
    assert.throws(() => table.addHuman({ ownerId: 'x' }), /closed/);
});

test('P1 explicit leave releases the seat to a bot immediately', () => {
    const table = new TableSession();
    addHumans(table, 2);
    table.startMatch();
    assert.equal(table.abandon('peer-1'), true);
    assert.equal(table.seats[1].kind, 'bot');
    assert.equal(table.seats[1].ownerId, null);
});

test('P1 three humans are completed by exactly one bot', () => {
    const table = new TableSession();
    addHumans(table, 3);
    table.startMatch();
    assert.equal(table.seats.filter(seat => seat.kind === 'human').length, 3);
    assert.equal(table.seats.filter(seat => seat.kind === 'bot').length, 1);
});
