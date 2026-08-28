'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const GAME_RUNTIME_SCRIPTS = Object.freeze([
    'product/feature-flags.js',
    'product/telemetry-schema.js',
    'product/telemetry.js',
    'game/game-product.js',
    'game/game-config.js',
    'game/game-profile.js',
    'game/game-online.js',
    'game/game-screen.js',
    'game/game-rules.js',
    'game/game-renderer.js',
    'game.js',
]);

const SCRIPT_PREREQUISITES = Object.freeze({
    'deck.js': ['game/game-manifests.js', 'game/core-evidence.js'],
});

function expandRuntimePaths(relativePaths) {
    const paths = Array.isArray(relativePaths) ? relativePaths : [relativePaths];
    const expanded = paths.flatMap(relativePath => {
        const selected = relativePath === 'game.js' ? GAME_RUNTIME_SCRIPTS : [relativePath];
        return selected.flatMap(scriptPath => [
            ...(SCRIPT_PREREQUISITES[scriptPath] || []),
            scriptPath,
        ]);
    });
    return [...new Set(expanded)];
}

function defaultDocument() {
    const classList = { add() {}, remove() {}, toggle() {} };
    return {
        addEventListener() {},
        removeEventListener() {},
        getElementById() { return null; },
        querySelectorAll() { return []; },
        documentElement: {},
        body: { classList },
    };
}

function loadScripts(relativePaths, exposedNames, overrides = {}) {
    const paths = expandRuntimePaths(relativePaths);
    const filename = paths.map((relativePath) => path.join(ROOT, relativePath)).join(', ');
    const context = {
        console,
        Math,
        Date,
        JSON,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        requestAnimationFrame(callback) { return setTimeout(callback, 0); },
        window: {},
        document: defaultDocument(),
        navigator: {},
        ...overrides,
    };
    vm.createContext(context);

    const expose = exposedNames
        .map((name) => `globalThis[${JSON.stringify(name)}] = ${name};`)
        .join('\n');
    const source = `${paths.map((relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')).join('\n')}\n${expose}`;
    vm.runInContext(source, context, { filename });

    const loaded = { context };
    for (const name of exposedNames) loaded[name] = context[name];
    return loaded;
}

function loadScript(relativePath, exposedNames, overrides = {}) {
    return loadScripts([relativePath], exposedNames, overrides);
}

module.exports = { GAME_RUNTIME_SCRIPTS, ROOT, loadScript, loadScripts };
