'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./helpers/load-script');

function memoryLocalStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
        clear() { values.clear(); },
    };
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
    assert.equal(defaults.sound, true);

    Storage.setSetting('sound', false);
    const saved = Storage.getSettings();
    assert.equal(saved.sound, false);
    assert.equal(saved.lang, 'ar');
    assert.equal(saved.confirmPlay, true);
});

test('malformed JSON falls back without crashing', () => {
    const localStorage = memoryLocalStorage();
    localStorage.setItem('meh_profiles', '{broken');
    const { Storage } = loadScript('storage.js', ['Storage'], { localStorage });
    assert.deepEqual(Array.from(Storage.getProfiles()), []);
});
