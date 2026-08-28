'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { GAME_RUNTIME_SCRIPTS, ROOT, loadScripts } = require('./helpers/load-script');

const METHOD_MODULES = [
    'MehGameProductMethods',
    'MehGameInviteMethods',
    'MehGameTableMethods',
    'MehGameGuidanceMethods',
    'MehGameProfileMethods',
    'MehGameOnlineMethods',
    'MehGameScreenMethods',
    'MehGameRuleMethods',
    'MehGameRendererMethods',
];

test('game runtime is split into explicit modules loaded before the composition root', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const gameSource = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');

    for (const relativePath of GAME_RUNTIME_SCRIPTS) {
        assert.ok(fs.existsSync(path.join(ROOT, relativePath)), `${relativePath} must exist`);
    }

    let previousIndex = -1;
    for (const relativePath of GAME_RUNTIME_SCRIPTS) {
        const scriptIndex = html.indexOf(`src="${relativePath}"`);
        assert.ok(scriptIndex > previousIndex, `${relativePath} must follow the previous runtime script`);
        previousIndex = scriptIndex;
    }

    assert.ok(gameSource.split(/\r?\n/).length <= 150, 'game.js must remain a small composition root');
});

test('method modules are immutable, disjoint, and preserve prototype accessors', () => {
    const loaded = loadScripts(GAME_RUNTIME_SCRIPTS, ['MehGame', ...METHOD_MODULES], {
        Storage: { getSettings: () => ({}), getCurrentProfile: () => null },
        I18n: { t: key => key },
        Sound: { play() {} },
    });

    const owners = new Map();
    for (const moduleName of METHOD_MODULES) {
        const methods = loaded[moduleName];
        assert.ok(Object.isFrozen(methods), `${moduleName} must be frozen`);
        for (const methodName of Reflect.ownKeys(methods)) {
            assert.equal(owners.has(methodName), false, `${String(methodName)} must have one owner`);
            owners.set(methodName, moduleName);
        }
    }

    const expectedOwners = {
        _trackProductEvent: 'MehGameProductMethods',
        _buildInviteUrl: 'MehGameInviteMethods',
        _beginTableMatch: 'MehGameTableMethods',
        _recordActionJournal: 'MehGameGuidanceMethods',
        applySettings: 'MehGameProfileMethods',
        bindOnlineEvents: 'MehGameOnlineMethods',
        handleHostMessage: 'MehGameOnlineMethods',
        showScreen: 'MehGameScreenMethods',
        startGame: 'MehGameRuleMethods',
        processEffect: 'MehGameRuleMethods',
        launchConfetti: 'MehGameRendererMethods',
        updateUI: 'MehGameRendererMethods',
    };
    for (const [methodName, moduleName] of Object.entries(expectedOwners)) {
        assert.equal(owners.get(methodName), moduleName, `${methodName} has the wrong owner`);
        assert.equal(typeof loaded.MehGame.prototype[methodName], 'function');
    }

    const topCard = Object.getOwnPropertyDescriptor(loaded.MehGame.prototype, 'topCard');
    const currentPlayer = Object.getOwnPropertyDescriptor(loaded.MehGame.prototype, 'currentPlayer');
    assert.equal(typeof topCard.get, 'function');
    assert.equal(typeof currentPlayer.get, 'function');
});
