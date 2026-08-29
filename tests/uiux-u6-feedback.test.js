'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadScript } = require('./helpers/load-script');
const { readUiCss } = require('./helpers/ui-css');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const hash = relativePath => crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(ROOT, relativePath))).digest('hex');

const html = read('index.html');
const storageSource = read('storage.js');
const soundSource = read('sound.js');
const directorSource = read('ui/feedback-director.js');
const motionSource = read('ui/motion.css');
const rulesSource = read('game/game-rules.js');
const rendererSource = read('game/game-renderer.js');

function parseHashManifest(relativePath) {
    return read(relativePath).trim().split('\n').map(line => {
        const match = line.match(/^([0-9a-f]{64})  (.+)$/);
        assert.ok(match, `Invalid hash line: ${line}`);
        return { sha256: match[1], file: match[2] };
    });
}

function audioContextHarness() {
    let creations = 0;
    const parameter = {
        value: 0,
        setValueAtTime() {},
        exponentialRampToValueAtTime() {},
    };
    const node = () => ({
        connect() { return this; },
        start() {},
        stop() {},
        gain: { ...parameter },
        frequency: { ...parameter },
    });
    class FakeAudioContext {
        constructor() {
            creations += 1;
            this.currentTime = 0;
            this.sampleRate = 8_000;
            this.state = 'running';
            this.destination = {};
        }
        createGain() { return node(); }
        createOscillator() { return node(); }
        createBufferSource() { return node(); }
        createBiquadFilter() { return node(); }
        createBuffer(_channels, size) {
            return { getChannelData() { return new Float32Array(size); } };
        }
        resume() { return Promise.resolve(); }
    }
    return { FakeAudioContext, creations: () => creations };
}

test('UIX-6 loads the feedback director after the mixer and before game modules', () => {
    const soundIndex = html.indexOf('src="sound.js"');
    const directorIndex = html.indexOf('src="ui/feedback-director.js"');
    const gameIndex = html.indexOf('src="game/game-product.js"');
    assert.ok(soundIndex > 0 && soundIndex < directorIndex && directorIndex < gameIndex);
    assert.match(html, /id="result-tamashi-status"[^>]+role="status"[^>]+aria-live="polite"/);
});

test('UIX-6 is mute-first and does not treat legacy sound=true as consent', () => {
    assert.match(storageSource, /soundMaster:\s*false/);
    assert.match(storageSource, /music:\s*false/);
    assert.match(storageSource, /sfx:\s*true/);
    assert.match(storageSource, /hasOwnProperty\.call\(overrides, 'soundMaster'\)/);

    const { FakeAudioContext, creations } = audioContextHarness();
    const { Sound } = loadScript('sound.js', ['Sound'], {
        window: { AudioContext: FakeAudioContext },
        document: { addEventListener() {}, hidden: false },
    });
    assert.equal(creations(), 0);
    assert.equal(Sound.play('card-settle'), false);
    assert.equal(creations(), 0);
    Sound.configure({ soundMaster: true, music: false, sfx: false });
    assert.equal(Sound.play('tap-soft'), false);
    assert.equal(creations(), 0);
    Sound.configure({ soundMaster: true, music: false, sfx: true });
    assert.equal(Sound.play('tap-soft'), true);
    assert.equal(creations(), 1);
});

test('UIX-6 exposes independent Master, Music, SFX and haptic controls in both locales', () => {
    for (const setting of ['soundMaster', 'music', 'sfx', 'haptics']) {
        assert.match(html, new RegExp(`data-setting="${setting}"`));
    }
    for (const key of [
        'sound_master_label', 'sound_master_desc', 'music_label', 'music_desc',
        'sfx_label', 'sfx_desc', 'haptics_label', 'haptics_desc',
    ]) {
        assert.match(read('i18n.js'), new RegExp(`${key}:\\s*'[^']+'`));
    }
    assert.match(read('server/account-service.js'), /'soundMaster', 'music', 'sfx'/);
});

test('UIX-6 motion profiles are bounded, interruptible and battery-safe', () => {
    const body = { dataset: {} };
    const document = {
        body,
        hidden: false,
        querySelectorAll() { return []; },
        getElementById() { return null; },
    };
    const motionQuery = { matches: true, addEventListener() {} };
    const { FeedbackDirector } = loadScript('ui/feedback-director.js', ['FeedbackDirector'], {
        document,
        window: { matchMedia() { return motionQuery; } },
        Sound: { setScene() {} },
    });
    assert.equal(FeedbackDirector.MAX_BLOCKING_MS, 420);
    assert.equal(FeedbackDirector.MAX_FLASHES_PER_SECOND, 0);
    assert.equal(FeedbackDirector.configure({ batterySaver: false }), 'reduced');
    assert.equal(FeedbackDirector.duration(900), 120);
    assert.equal(body.dataset.uiMotion, 'reduced');
    assert.equal(FeedbackDirector.configure({ batterySaver: true }), 'battery');
    assert.equal(FeedbackDirector.duration(900), 0);
    assert.equal(body.dataset.feedbackProfile, 'battery');
    assert.match(read('game/game-profile.js'), /reduced \? 220 : 420/);
    assert.doesNotMatch(read('game/game-profile.js'), /1300|1900/);
});

test('UIX-6 implements the approved card, draw, turn, penalty and result vocabulary', () => {
    for (const token of [
        'tap-soft', 'card-lift', 'card-settle', 'turn-ready',
        'penalty-double', 'round-resolve',
    ]) assert.match(soundSource, new RegExp(`['"]${token}['"]`), token);
    assert.match(rulesSource, /FeedbackDirector\.animateCardPlay/);
    assert.match(rulesSource, /FeedbackDirector\.animateDraw/);
    assert.match(rendererSource, /FeedbackDirector\.turn/);
    assert.match(rendererSource, /FeedbackDirector\.impact/);
    assert.match(rendererSource, /FeedbackDirector\.result/);
    assert.match(rendererSource, /result-tamashi-status/);
    assert.match(rendererSource, /result_tamashi_pending/);
    assert.match(motionSource, /feedback-card-arc[\s\S]*260ms/);
    assert.match(motionSource, /feedback-turn-arrival 180ms/);
    assert.match(motionSource, /result-paper-open 420ms/);
});

test('UIX-6 keeps every sound meaning visible or textual and removes heavy/flashing FX', () => {
    assert.match(html, /id="turn-indicator" aria-live="polite"/);
    assert.match(html, /id="game-message" class="hidden" role="alert"/);
    assert.match(html, /id="context-tip"[^>]+aria-live="polite"/);
    assert.match(rulesSource, /penalty-reason-banner/);
    assert.match(rulesSource, /_showTransientReason\([^,]+, reason, 3000\)/);
    assert.doesNotMatch(`${rendererSource}\n${readUiCss()}`, /screen-flash|confettiFall|className = 'confetti'/);
    assert.doesNotMatch(rendererSource, /for\s*\(let i = 0; i < 90/);
    assert.match(motionSource, /feedback-impact-border 360ms linear 1/);
});

test('UIX-6 keeps haptics opt-in and every pattern below 250ms', () => {
    assert.match(read('game/game-guidance.js'), /settings\.haptics !== true/);
    const patterns = [...rulesSource.matchAll(/_haptic\([^\n]*?\[([^\]]+)\]/g)].map(match =>
        match[1].split(',').reduce((total, value) => total + Number(value.trim()), 0));
    assert.ok(patterns.length >= 2);
    assert.ok(patterns.every(duration => duration <= 250), patterns.join(','));
});

test('UIX-6 preserves every protected gameplay and card-art byte', () => {
    for (const manifest of ['docs/uiux-u0/card-assets.sha256', 'docs/uiux-u0/protected-files.sha256']) {
        for (const entry of parseHashManifest(manifest)) {
            assert.equal(hash(entry.file), entry.sha256, entry.file);
        }
    }
});
