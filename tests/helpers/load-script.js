'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

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
    const paths = Array.isArray(relativePaths) ? relativePaths : [relativePaths];
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

module.exports = { ROOT, loadScript, loadScripts };
