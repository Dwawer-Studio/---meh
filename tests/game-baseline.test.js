'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./helpers/load-script');

const { MehGame } = loadScript('game.js', ['MehGame']);

function bareGame(direction, currentPlayerIndex = 0) {
    const game = Object.create(MehGame.prototype);
    game.players = [{ id: 'p0' }, { id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
    game.direction = direction;
    game.currentPlayerIndex = currentPlayerIndex;
    return game;
}

test('clockwise turn navigation wraps around the table', () => {
    const game = bareGame(1, 3);
    assert.equal(game.nextPlayerIndex(), 0);
    assert.equal(game.nextPlayerIndex(1, 2), 3);
    assert.equal(game.prevPlayerIndex(), 2);
});

test('counter-clockwise turn navigation wraps around the table', () => {
    const game = bareGame(-1, 0);
    assert.equal(game.nextPlayerIndex(), 3);
    assert.equal(game.nextPlayerIndex(1, 2), 3);
    assert.equal(game.prevPlayerIndex(), 1);
});

test('a marked player consumes the skip flag and schedules the next turn', () => {
    const scheduled = [];
    const turnName = { innerText: '' };
    const classList = { add() {}, remove() {}, toggle() {} };
    const document = {
        addEventListener() {},
        getElementById(id) { return id === 'current-player-name' ? turnName : null; },
        querySelectorAll() { return []; },
        body: { classList },
    };
    const sounds = [];
    const { MehGame: SkipGame } = loadScript('game.js', ['MehGame'], {
        document,
        Sound: { play(name) { sounds.push(name); } },
        I18n: { t(key) { return key; } },
        setTimeout(callback, delay) { scheduled.push({ callback, delay }); return scheduled.length; },
    });
    const game = Object.create(SkipGame.prototype);
    game.players = [
        { id: 'p0', name: 'الأول', hand: [{}], isBot: false },
        { id: 'p1', name: 'الثاني', hand: [{}], isBot: false },
    ];
    game.currentPlayerIndex = 0;
    game.skipNextMap = { p0: true };
    game.turnTimer = null;
    game.humanCanPlay = false;
    game.awaitingRemote = false;
    game.showToast = () => {};
    game.updateUI = () => {};
    let advanced = 0;
    game.advanceTurn = () => { advanced++; };

    game.playTurn();
    assert.equal(game.skipNextMap.p0, undefined);
    assert.deepEqual(sounds, ['skip']);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 460);
    scheduled[0].callback();
    assert.equal(advanced, 1);
    game.online = true;
    game.skipNextMap.p0 = true;
    game.playTurn();
    assert.equal(scheduled[1].delay, 1000, 'online timing remains unchanged');
});
