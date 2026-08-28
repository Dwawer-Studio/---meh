'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadScripts } = require('./helpers/load-script');

test('P1 public table snapshots never disclose seat ownership or reconnect leases', () => {
    const { MehGame } = loadScripts(['game.js'], ['MehGame'], {
        I18n: { lang: 'ar', t: key => key },
        Storage: { getSettings: () => ({}), getCurrentProfile: () => null },
        Sound: { play() {} },
    });
    const game = Object.create(MehGame.prototype);
    game._initializeTableRuntime();
    game.humanProfile = { name: 'Host', avatar: '😎' };
    assert.equal(game._createHostTable('ABCDE'), true);
    game._tableAddLobbyPlayer({
        id: 'peer-1',
        seatToken: 'seat_private_owner_token_1234',
        name: 'Guest',
        avatar: '😎',
    });
    game.tableSession.disconnect('seat_private_owner_token_1234');

    const serialized = JSON.stringify(game._publicTableSnapshot());
    assert.doesNotMatch(serialized, /ownerId|seatToken|reconnectDeadline|leaseExpired|returnAfterMatch/);
    assert.doesNotMatch(serialized, /seat_private_owner_token_1234/);
});
