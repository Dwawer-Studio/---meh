'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const exists = relativePath => fs.existsSync(path.join(ROOT, relativePath));

const html = read('index.html');
const screenSource = read('game/game-screen.js');
const profileSource = read('game/game-profile.js');
const inviteSource = read('game/game-invite.js');
const catalogSource = read('game/game-catalog.js');
const shellCss = read('ui/shell.css');
const homeCss = read('ui/screens/home.css');
const entryCss = read('ui/screens/entry.css');

function loadDictionary() {
    const context = { window: {} };
    vm.runInNewContext(`${read('i18n.js')}\nthis.dictionary = I18n.dict;`, context);
    return context.dictionary;
}

test('UIX-2 production loads the app shell and screen styles after the shared system', () => {
    const expected = [
        'ui/components.css',
        'ui/shell.css',
        'ui/screens/home.css',
        'ui/screens/entry.css',
        'ui/motion.css',
        'ui/accessibility.css',
    ];
    let previous = -1;
    for (const stylesheet of expected) {
        assert.ok(exists(stylesheet), stylesheet);
        const position = html.indexOf(`href="${stylesheet}"`);
        assert.ok(position > previous, `${stylesheet} must load after its dependency`);
        previous = position;
    }
});

test('UIX-2 exposes the complete first-session shell without placing the store on the hero', () => {
    for (const id of [
        'splash', 'profile-screen', 'main-menu', 'play-center-screen',
        'instructions-screen', 'settings-screen', 'invite-screen', 'online-screen',
        'play-btn', 'play-options-btn', 'local-play-btn', 'online-btn',
        'home-nav-btn', 'majalis-nav-btn', 'catalog-btn',
    ]) assert.match(html, new RegExp(`id="${id}"`), id);

    assert.match(html, /id="catalog-btn" class="app-nav-item hidden"/);
    const homeStart = html.indexOf('id="main-menu"');
    const homeEnd = html.indexOf('id="play-center-screen"');
    assert.ok(homeStart >= 0 && homeEnd > homeStart, 'home screen boundaries');
    assert.doesNotMatch(html.slice(homeStart, homeEnd), /id="catalog-screen"/);
    assert.match(html, /assets\/brand\/dwawer-circle-four\.png/);
    assert.match(html, /assets\/cards\/card-back\.webp/);
    assert.match(html, /assets\/cards\/black-meh\.webp/);
});

test('UIX-2 keeps the primary home action one click from a playable local round', () => {
    assert.match(screenSource, /getElementById\('play-btn'\)\.addEventListener\('click', \(\) => this\._requestLocalStart\(\)\)/);
    assert.match(screenSource, /getElementById\('local-play-btn'\)\.addEventListener\('click', \(\) => this\._requestLocalStart\(\)\)/);
    const localControls = fs.readFileSync(path.join(ROOT, 'game/game-local-controls.js'), 'utf8');
    assert.match(localControls, /if \(this\._readLocalCheckpoint\(\)\) this\._showSoloMenu\('offer'\);\s*else this\.startGame\(\);/);
    assert.match(screenSource, /const openPlayCenter = \(\) => this\.showScreen\('play-center-screen'\)/);
    assert.match(screenSource, /getElementById\('play-options-btn'\)\.addEventListener\('click', openPlayCenter\)/);
    assert.match(html, /id="practice-entry-btn"[\s\S]*?class="play-mode-card__icon"[\s\S]*?data-i18n="practice_entry"/);
});

test('UIX-2 owns browser history, back navigation and focus restoration', () => {
    assert.match(screenSource, /_initializeScreenHistory\(\)/);
    assert.match(screenSource, /addEventListener\('popstate'/);
    assert.match(screenSource, /history\.pushState\(\{ mehScreen: id, mehDepth: this\._screenDepth \}/);
    assert.match(screenSource, /history\.replaceState\(\{ mehScreen: id, mehDepth:/);
    assert.match(screenSource, /_captureScreenFocus\(current\)/);
    assert.match(screenSource, /navigation\.restoreFocus[\s\S]*restored\.focus\(\)/);
    assert.match(profileSource, /navigateBack\('main-menu'\)/);
});

test('UIX-2 deep links replace the entry state and keep the saved-profile label coherent', () => {
    assert.match(inviteSource, /showScreen\('invite-screen', \{ replaceHistory: true \}\)/);
    assert.match(inviteSource, /invite-guest-name-label/);
    assert.match(inviteSource, /inputLabel\.classList\.toggle\('hidden', !!name\)/);
    assert.match(inviteSource, /document\.getElementById\('invite-join-btn'\)\.disabled = !valid/);
});

test('UIX-2 hides commerce until a completed game and an authoritative catalog are available', () => {
    assert.match(catalogSource, /Number\.isSafeInteger\(profile\.stats\.games\)/);
    assert.match(catalogSource, /const visible = games > 0/);
    assert.match(catalogSource, /_productFeatureEnabled\('card_catalog'\)/);
    assert.match(catalogSource, /_productFeatureEnabled\('tamashi_wallet'\)/);
    assert.match(catalogSource, /_authoritativeServiceAvailable\(\)/);
    assert.match(profileSource, /_syncCatalogEntryVisibility/);
});

test('UIX-2 defines dedicated portrait and landscape compositions with minimum touch targets', () => {
    assert.match(homeCss, /\.home-composition/);
    assert.match(homeCss, /@media \(max-height: 520px\) and \(orientation: landscape\)/);
    assert.match(homeCss, /\.app-bottom-nav/);
    assert.match(shellCss, /min-height:\s*100dvh/);
    assert.match(entryCss, /@media \(max-height: 520px\) and \(orientation: landscape\)/);
    assert.match([shellCss, homeCss, entryCss].join('\n'), /min-(?:width|height|block-size):\s*(?:44px|var\(--ui-target-min\))/);
});

test('UIX-2 Arabic and English system copy use the icon vocabulary instead of emoji', () => {
    const dictionary = loadDictionary();
    const keys = [
        'play_now', 'play_options', 'home_eyebrow', 'home_headline', 'home_subtitle',
        'home_social_title', 'home_social_text', 'main_navigation', 'home', 'majalis', 'cards',
        'play_center_eyebrow', 'play_center_title', 'local_game', 'online_play', 'instructions',
        'profiles', 'instructions_title', 'settings_title', 'profile_title', 'online_title',
        'create_room', 'quick_play', 'join_room', 'back', 'main_menu', 'invite_title',
    ];
    for (const locale of ['ar', 'en']) {
        for (const key of keys) {
            assert.equal(typeof dictionary[locale][key], 'string', `${locale}.${key}`);
            assert.doesNotMatch(dictionary[locale][key], /\p{Extended_Pictographic}/u, `${locale}.${key}`);
        }
    }
});
