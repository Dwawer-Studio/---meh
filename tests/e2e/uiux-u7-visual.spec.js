'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { createServer } = require('../../tools/serve');

const peerScript = fs.readFileSync(
    path.join(path.dirname(require.resolve('peerjs')), 'peerjs.min.js'),
    'utf8',
);
const testPort = Number.parseInt(process.env.MEH_E2E_PORT || '4174', 10);
let server;

const FRAMES = [
    { name: 'ar-phone-360-home', lang: 'ar', width: 360, height: 800, state: 'home' },
    { name: 'ar-phone-393-table', lang: 'ar', width: 393, height: 852, state: 'table' },
    { name: 'en-phone-360-play-center', lang: 'en', width: 360, height: 800, state: 'play-center' },
    { name: 'en-phone-430-settings', lang: 'en', width: 430, height: 932, state: 'settings' },
    { name: 'ar-landscape-844-decision', lang: 'ar', width: 844, height: 390, state: 'decision' },
    { name: 'en-landscape-932-result', lang: 'en', width: 932, height: 430, state: 'result' },
    { name: 'ar-tablet-768-empty-store', lang: 'ar', width: 768, height: 1024, state: 'empty-store' },
    { name: 'en-tablet-1024-loading', lang: 'en', width: 1024, height: 768, state: 'loading' },
    { name: 'ar-desktop-1366-instructions', lang: 'ar', width: 1366, height: 768, state: 'instructions' },
    { name: 'en-desktop-1440-result', lang: 'en', width: 1440, height: 900, state: 'result' },
];

test.beforeAll(async () => {
    server = createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(testPort, '127.0.0.1', resolve);
    });
});

test.afterAll(async () => {
    if (!server) return;
    await new Promise(resolve => server.close(resolve));
});

async function prime(page, lang) {
    await page.route('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', route => route.fulfill({
        body: peerScript,
        contentType: 'text/javascript',
        status: 200,
    }));
    await page.addInitScript(selectedLang => {
        localStorage.clear();
        sessionStorage.clear();
        let seed = 0x6d6568;
        Math.random = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 0x100000000;
        };
        localStorage.setItem('meh_settings', JSON.stringify({
            lang: selectedLang,
            colorblind: false,
            batterySaver: true,
            wakeLock: false,
            confirmPlay: true,
            sound: false,
            soundMaster: false,
            music: false,
            sfx: true,
            haptics: false,
        }));
    }, lang);
    await page.goto('/');
    await page.locator('#splash').waitFor({ state: 'detached' });
}

async function createProfile(page, lang) {
    await page.locator('#show-create-profile').click();
    await page.locator('#profile-name-input').fill(lang === 'ar' ? 'لاعب مِهْ' : 'Meh player');
    await page.locator('#avatar-picker .avatar-option').first().click();
    await page.locator('#save-profile-btn').click();
    await expect(page.locator('#main-menu')).toHaveClass(/\bactive\b/);
}

async function showEmptyCatalog(page) {
    await page.evaluate(() => {
        game._catalogState = {
            catalogVersion: MEH_CATALOG_MANIFEST.catalogVersion,
            rulesVersion: MEH_CORE_MANIFEST.rulesVersion,
            currency: { currencyId: 'tamashi', balance: 0, revision: 1, frozen: false },
            policy: { earning: { completionReward: 100, healthyParticipationReward: 20, winBonus: 20 } },
            cards: MEH_CATALOG_MANIFEST.definitions.map(definition => ({
                ...definition,
                includedByDefault: true,
                unlocked: true,
                inFreeRotation: false,
                contentEnabled: true,
                purchasable: false,
                trialEligible: false,
                releaseStatus: 'live',
            })),
        };
        game._catalogView = 'store';
        game._catalogFilter = 'all';
        game._renderCardCatalog();
        game.showScreen('catalog-screen');
    });
}

async function moveToState(page, frame) {
    await prime(page, frame.lang);
    if (frame.state === 'profile') return '#profile-screen';
    await createProfile(page, frame.lang);

    if (frame.state === 'home') return '#main-menu';
    if (frame.state === 'play-center') {
        await page.locator('#play-options-btn').click();
        return '#play-center-screen';
    }
    if (frame.state === 'settings') {
        await page.locator('#menu-settings-btn').click();
        return '#settings-screen';
    }
    if (frame.state === 'instructions') {
        await page.locator('#play-options-btn').click();
        await page.locator('#instructions-btn').click();
        return '#instructions-screen';
    }
    if (frame.state === 'empty-store') {
        await showEmptyCatalog(page);
        return '#catalog-screen';
    }
    if (frame.state === 'loading') {
        await page.evaluate(() => {
            game.showScreen('catalog-screen');
            game._renderCatalogLoadState('loading');
        });
        return '#catalog-screen';
    }

    await page.locator('#play-btn').click();
    await expect(page.locator('#game-screen')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#human-hand .card')).toHaveCount(7);
    if (frame.state === 'decision') {
        await page.evaluate(() => game.setDialogOpen(document.getElementById('color-picker'), true));
        return '#game-screen';
    }
    if (frame.state === 'result') {
        await page.evaluate(() => game.endGame(game.players[0]));
        return '#end-screen';
    }
    return '#game-screen';
}

for (const frame of FRAMES) {
    test(`UIX-7 visual baseline: ${frame.name}`, async ({ page }) => {
        await page.setViewportSize({ width: frame.width, height: frame.height });
        const screenSelector = await moveToState(page, frame);
        const screen = page.locator(screenSelector);
        await expect(screen).toHaveClass(/\bactive\b/);
        // ثبّت الشاشة الدائمة فقط؛ تغطية الترحيب المؤقتة لها اختبارات UIX-6 مستقلة.
        await page.evaluate(() => document.getElementById('toast-container')?.replaceChildren());
        await page.mouse.move(0, 0);
        await expect(screen).toHaveScreenshot(`${frame.name}.png`, {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.002,
        });
    });
}
