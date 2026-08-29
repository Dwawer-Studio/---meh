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

async function prime(page, settings, reducedMotion = 'no-preference') {
    await page.emulateMedia({ reducedMotion });
    await page.route('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', route => route.fulfill({
        body: peerScript,
        contentType: 'text/javascript',
        status: 200,
    }));
    await page.addInitScript(initialSettings => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('meh_settings', JSON.stringify(initialSettings));
    }, settings);
    await page.goto('/');
    await page.locator('#splash').waitFor({ state: 'detached' });
}

async function openTable(page, { batterySaver = false, reducedMotion = 'no-preference' } = {}) {
    await prime(page, {
        lang: 'ar', colorblind: false, batterySaver, wakeLock: false, confirmPlay: true,
        sound: false, soundMaster: false, music: false, sfx: true, haptics: false,
    }, reducedMotion);
    await page.locator('#show-create-profile').click();
    await page.locator('#profile-name-input').fill('مختبر الاستجابة');
    await page.locator('#avatar-picker .avatar-option').first().click();
    await page.locator('#save-profile-btn').click();
    await page.locator('#play-btn').click();
    await expect(page.locator('#game-screen')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#human-hand .card')).toHaveCount(7);
}

test('UIX-6 remains silent until explicit Master opt-in and exposes three audio buses', async ({ page }) => {
    await prime(page, {
        lang: 'ar', colorblind: false, batterySaver: false, wakeLock: false,
        confirmPlay: true, sound: true, haptics: false,
    });
    await page.evaluate(() => {
        game.showScreen('settings-screen');
        game.refreshSettingsUI();
    });

    await expect(page.locator('[data-setting="soundMaster"]')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('[data-setting="music"]')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('[data-setting="sfx"]')).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => Sound.ctx)).toBeNull();

    await page.locator('[data-setting="music"]').click();
    expect(await page.evaluate(() => Sound.ctx)).toBeNull();
    await page.locator('[data-setting="soundMaster"]').click();
    await expect(page.locator('[data-setting="soundMaster"]')).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => ({
        hasContext: Sound.ctx !== null,
        master: Sound.settings.master,
        music: Sound.settings.music,
        sfx: Sound.settings.sfx,
    }))).toEqual({ hasContext: true, master: true, music: true, sfx: true });

    await page.locator('[data-setting="soundMaster"]').click();
    expect(await page.evaluate(() => ({
        master: Sound.isEnabled('sfx'),
        music: Sound.isEnabled('music'),
    }))).toEqual({ master: false, music: false });
});

test('UIX-6 reduced-motion uses a 120ms non-spatial card handoff', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await openTable(page, { reducedMotion: 'reduce' });
    await expect(page.locator('body')).toHaveAttribute('data-feedback-profile', 'reduced');
    await page.evaluate(() => {
        window.__u6CardHandoff = null;
        const original = FeedbackDirector.animateCardPlay.bind(FeedbackDirector);
        FeedbackDirector.animateCardPlay = (...args) => {
            const duration = original(...args);
            window.__u6CardHandoff = { duration, profile: FeedbackDirector.profile };
            return duration;
        };
    });
    await page.locator('#human-hand .card.playable').last().click();
    await page.locator('#confirm-play-btn').click();
    await expect.poll(() => page.evaluate(() => window.__u6CardHandoff)).not.toBeNull();
    expect(await page.evaluate(() => window.__u6CardHandoff)).toEqual({ duration: 120, profile: 'reduced' });
    await expect(page.locator('.screen-flash, .confetti')).toHaveCount(0);
});

test('UIX-6 bounds impact and result choreography without DOM particle storms', async ({ page }) => {
    await page.setViewportSize({ width: 932, height: 430 });
    await openTable(page);
    const impact = await page.evaluate(() => {
        game.screenFx('draw4');
        const screen = document.getElementById('game-screen');
        const pseudo = getComputedStyle(screen, '::after');
        return {
            active: screen.classList.contains('feedback-impact'),
            name: pseudo.animationName,
            duration: pseudo.animationDuration,
            iterations: pseudo.animationIterationCount,
        };
    });
    expect(impact).toEqual({
        active: true,
        name: 'feedback-impact-border',
        duration: '0.36s',
        iterations: '1',
    });

    const result = await page.evaluate(() => {
        game.endGame(game.players[0]);
        const screen = document.getElementById('end-screen');
        const copy = getComputedStyle(screen.querySelector('.result-copy'));
        return {
            active: screen.classList.contains('active'),
            outcome: screen.dataset.resultOutcome,
            moment: screen.classList.contains('result-moment-active'),
            name: copy.animationName,
            duration: copy.animationDuration,
            particles: document.querySelectorAll('.confetti, [data-feedback-flight]').length,
            tamashi: document.getElementById('result-tamashi-status').dataset.settlement,
        };
    });
    expect(result).toEqual({
        active: true,
        outcome: 'win',
        moment: true,
        name: 'result-paper-open',
        duration: '0.42s',
        particles: 0,
        tamashi: 'local',
    });
    await expect(page.locator('#restart-btn')).toBeEnabled();
});

test('UIX-6 battery profile removes nonessential motion while keeping state visible', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await openTable(page, { batterySaver: true });
    await expect(page.locator('body')).toHaveAttribute('data-feedback-profile', 'battery');
    const state = await page.evaluate(() => {
        game.screenFx('counter');
        game.endGame(game.players[0]);
        return {
            impact: document.getElementById('game-screen').classList.contains('feedback-impact'),
            resultMoment: document.getElementById('end-screen').classList.contains('result-moment-active'),
            resultVisible: document.getElementById('end-screen').classList.contains('active'),
            outcome: document.getElementById('end-screen').dataset.resultOutcome,
        };
    });
    expect(state).toEqual({
        impact: false,
        resultMoment: false,
        resultVisible: true,
        outcome: 'win',
    });
});
