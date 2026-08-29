'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript, loadScripts } = require('./helpers/load-script');

function memoryLocalStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
        clear() { values.clear(); },
    };
}

function appDocument() {
    const elements = new Map();
    const makeElement = () => {
        const classes = new Set();
        const attributes = new Map();
        const element = {
            children: [],
            className: '',
            dataset: {},
            style: {},
            value: '',
            textContent: '',
            innerText: '',
            innerHTML: '',
            classList: {
                add(...names) { names.forEach(name => classes.add(name)); },
                remove(...names) { names.forEach(name => classes.delete(name)); },
                toggle(name, force) {
                    if (force === true) classes.add(name);
                    else if (force === false) classes.delete(name);
                    else if (classes.has(name)) classes.delete(name);
                    else classes.add(name);
                },
                contains(name) { return classes.has(name); },
            },
            addEventListener() {},
            setAttribute(name, value) { attributes.set(name, String(value)); },
            getAttribute(name) { return attributes.get(name) ?? null; },
            appendChild(child) { this.children.push(child); return child; },
            replaceChildren(...children) { this.children = children; },
            querySelector() { return makeElement(); },
            querySelectorAll() { return []; },
            closest() { return null; },
            focus() {},
            remove() {},
        };
        return element;
    };
    const document = {
        visibilityState: 'visible',
        documentElement: makeElement(),
        body: makeElement(),
        addEventListener() {},
        removeEventListener() {},
        createElement: makeElement,
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, makeElement());
            return elements.get(id);
        },
        querySelectorAll() { return []; },
    };
    return document;
}

test('profile lifecycle covers create, select, record result, and delete', () => {
    const localStorage = memoryLocalStorage();
    const { Storage } = loadScript('storage.js', ['Storage'], { localStorage });

    const profile = Storage.createProfile('عبدالرحمن', '😎');
    assert.equal(profile.name, 'عبدالرحمن');
    assert.equal(profile.avatar, '😎');
    assert.equal(Storage.getProfiles().length, 1);
    assert.equal(Storage.getCurrentProfile().id, profile.id);

    Storage.recordResult(true);
    const afterWin = Storage.getCurrentProfile();
    assert.deepEqual(
        { wins: afterWin.stats.wins, losses: afterWin.stats.losses, games: afterWin.stats.games },
        { wins: 1, losses: 0, games: 1 },
    );

    Storage.recordResult(false);
    const afterLoss = Storage.getCurrentProfile();
    assert.deepEqual(
        { wins: afterLoss.stats.wins, losses: afterLoss.stats.losses, games: afterLoss.stats.games },
        { wins: 1, losses: 1, games: 2 },
    );

    Storage.deleteProfile(profile.id);
    assert.equal(Storage.getProfiles().length, 0);
    assert.equal(Storage.getCurrentProfile(), null);
});

test('settings retain defaults while persisting an override', () => {
    const localStorage = memoryLocalStorage();
    const { Storage } = loadScript('storage.js', ['Storage'], { localStorage });

    const defaults = Storage.getSettings();
    assert.equal(defaults.lang, 'ar');
    assert.equal(defaults.sound, false);
    assert.equal(defaults.soundMaster, false);
    assert.equal(defaults.music, false);
    assert.equal(defaults.sfx, true);

    Storage.setSetting('soundMaster', true);
    const saved = Storage.getSettings();
    assert.equal(saved.sound, true);
    assert.equal(saved.soundMaster, true);
    assert.equal(saved.lang, 'ar');
    assert.equal(saved.confirmPlay, true);
});

test('legacy sound=true never bypasses the new explicit master opt-in', () => {
    const localStorage = memoryLocalStorage();
    localStorage.setItem('meh_settings', JSON.stringify({ sound: true }));
    const { Storage } = loadScript('storage.js', ['Storage'], { localStorage });

    const migrated = Storage.getSettings();
    assert.equal(migrated.sound, false);
    assert.equal(migrated.soundMaster, false);
});

test('malformed JSON falls back without crashing', () => {
    const localStorage = memoryLocalStorage();
    localStorage.setItem('meh_profiles', '{broken');
    const { Storage } = loadScript('storage.js', ['Storage'], { localStorage });
    assert.deepEqual(Array.from(Storage.getProfiles()), []);
});

test('PLATFORM-01: blocked localStorage never prevents storage operations or startup reads', () => {
    const blocked = {
        getItem() { throw new DOMException('blocked', 'SecurityError'); },
        setItem() { throw new DOMException('blocked', 'SecurityError'); },
        removeItem() { throw new DOMException('blocked', 'SecurityError'); },
    };
    const { Storage } = loadScript('storage.js', ['Storage'], { localStorage: blocked });

    assert.doesNotThrow(() => Storage.getSettings());
    assert.deepEqual(Array.from(Storage.getProfiles()), []);
    assert.equal(Storage.getCurrentProfile(), null);
    assert.doesNotThrow(() => Storage.setCurrentProfile('missing'));
    assert.doesNotThrow(() => Storage.createProfile('ضيف', '😎'));
    assert.doesNotThrow(() => Storage.deleteProfile('missing'));
    assert.doesNotThrow(() => Storage.recordResult(true));
});

test('PLATFORM-01: the complete app constructor survives a blocked localStorage', () => {
    const blocked = {
        getItem() { throw new DOMException('blocked', 'SecurityError'); },
        setItem() { throw new DOMException('blocked', 'SecurityError'); },
        removeItem() { throw new DOMException('blocked', 'SecurityError'); },
    };
    const document = appDocument();
    const loaded = loadScripts(
        ['storage.js', 'i18n.js', 'features.js', 'sound.js', 'net.js', 'deck.js', 'game.js'],
        ['MehGame'],
        {
            document,
            navigator: {},
            localStorage: blocked,
            setTimeout(callback) { callback(); return 1; },
            clearTimeout() {},
        },
    );

    assert.doesNotThrow(() => new loaded.MehGame());
});

test('corrupt storage shapes are normalized before callers iterate over them', () => {
    const localStorage = memoryLocalStorage();
    localStorage.setItem('meh_profiles', JSON.stringify({ not: 'an array' }));
    localStorage.setItem('meh_settings', JSON.stringify('invalid'));
    localStorage.setItem('meh_current_profile', 'missing');
    const { Storage } = loadScript('storage.js', ['Storage'], { localStorage });

    assert.deepEqual(Array.from(Storage.getProfiles()), []);
    assert.equal(Storage.getCurrentProfile(), null);
    assert.deepEqual(
        Object.fromEntries(Object.entries(Storage.getSettings())),
        Object.fromEntries(Object.entries(Storage.defaultSettings())),
    );
});
