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
let browserDiagnostics;
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

async function openApp(page) {
    await page.route('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', route => route.fulfill({
        body: peerScript,
        contentType: 'text/javascript',
        status: 200,
    }));
    await page.addInitScript(randomSeed => {
        Math.random = () => {
            randomSeed |= 0;
            randomSeed = randomSeed + 0x6D2B79F5 | 0;
            let value = Math.imul(randomSeed ^ randomSeed >>> 15, 1 | randomSeed);
            value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
            return ((value ^ value >>> 14) >>> 0) / 4294967296;
        };
        localStorage.clear();
        localStorage.setItem('meh_settings', JSON.stringify({
            lang: 'ar',
            colorblind: false,
            batterySaver: true,
            wakeLock: false,
            confirmPlay: true,
            sound: false,
        }));
    }, 0x4D4548);

    await page.goto('/');
    await page.locator('#splash').waitFor({ state: 'detached' });
    await expect(page.locator('#profile-screen')).toHaveClass(/\bactive\b/);
    await page.locator('#show-create-profile').click();
    await page.locator('#profile-name-input').fill('مختبر');
    await page.locator('#avatar-picker .avatar-option').first().click();
    await page.locator('#save-profile-btn').click();
    await expect(page.locator('#main-menu')).toHaveClass(/\bactive\b/);
}

async function expectGameReady(page) {
    await expect(page.locator('#game-screen')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#human-hand .card')).toHaveCount(7);
    await expect(page.locator('#bot-1-count')).toHaveText('7');
    await expect(page.locator('#bot-2-count')).toHaveText('7');
    await expect(page.locator('#bot-3-count')).toHaveText('7');
    await expect(page.locator('#draw-pile')).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
    browserDiagnostics = [];
    page.on('pageerror', error => browserDiagnostics.push(`pageerror: ${error.message}`));
    page.on('console', message => {
        if (message.type() === 'error') browserDiagnostics.push(`console: ${message.text()}`);
    });
    page.on('response', response => {
        if (response.url().startsWith('http://127.0.0.1:') && response.status() >= 400) {
            browserDiagnostics.push(`response: ${response.status()} ${response.url()}`);
        }
    });
});

test.afterEach(() => {
    expect(browserDiagnostics, 'the browser completed the scenario without runtime or resource errors').toEqual([]);
});

test('a malformed invite opens a recoverable contextual error instead of the main menu', async ({ page }) => {
    await page.route('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', route => route.fulfill({
        body: peerScript,
        contentType: 'text/javascript',
        status: 200,
    }));
    await page.goto('/?join=ABCDE&v=2');
    await page.locator('#splash').waitFor({ state: 'detached' });
    await expect(page.locator('#invite-screen')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#invite-status')).toContainText('تالف');
    await expect(page.locator('#invite-join-btn')).toBeDisabled();
    await page.locator('#invite-back-btn').click();
    await expect(page.locator('#main-menu')).toHaveClass(/\bactive\b/);
});

test('a desktop player can start, inspect a playable card, draw, and return after winning', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openApp(page);

    await page.getByRole('button', { name: /العب الآن/ }).click();
    await expectGameReady(page);

    const playableCard = page.locator('#human-hand .card.playable').first();
    await expect(playableCard).toBeEnabled();
    await playableCard.press('Enter');
    await expect(page.locator('#confirm-bar')).not.toHaveClass(/\bhidden\b/);
    await expect(page.locator('#confirm-play-btn')).toBeFocused();
    await page.locator('#cancel-play-btn').press('Enter');
    await expect(page.locator('#confirm-bar')).toHaveClass(/\bhidden\b/);

    await page.locator('#draw-pile').press('Enter');
    await expect(page.locator('#human-count')).toHaveText('8');
    await expect(page.locator('#draw-pile')).toBeDisabled();

    await page.keyboard.press('Control+Shift+D');
    await expect(page.locator('#dev-panel')).not.toHaveClass(/\bhidden\b/);
    await page.locator('#dev-win-btn').click();
    await expect(page.locator('#end-screen')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#winner-text')).toContainText('فزت');

    await page.locator('#end-menu-btn').click();
    await expect(page.locator('#main-menu')).toHaveClass(/\bactive\b/);
    await expect(page.getByRole('button', { name: /العب الآن/ })).toBeVisible();
});

test('the core turn can be completed with the keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openApp(page);

    await page.getByRole('button', { name: /العب الآن/ }).press('Enter');
    await expectGameReady(page);
    const actionHasFocus = await page.evaluate(() => document.activeElement.matches(
        '#draw-pile, #human-hand .card.playable',
    ));
    expect(actionHasFocus).toBe(true);

    await page.locator('#draw-pile').press('Enter');
    await expect(page.locator('#human-count')).toHaveText('8');
    await expect(page.locator('#draw-pile')).toBeDisabled();
});

for (const viewport of [
    { name: 'portrait phone', width: 390, height: 844 },
    { name: 'landscape phone', width: 844, height: 390 },
]) {
    test(`${viewport.name} keeps every critical game control inside the viewport`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await openApp(page);
        await page.getByRole('button', { name: /العب الآن/ }).click();
        await expectGameReady(page);

        const layout = await page.evaluate(selectors => {
            const boxes = selectors.map(selector => {
                const rect = document.querySelector(selector).getBoundingClientRect();
                return {
                    selector,
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height,
                };
            });
            return {
                boxes,
                viewport: { width: window.innerWidth, height: window.innerHeight },
                scroll: {
                    width: document.documentElement.scrollWidth,
                    height: document.documentElement.scrollHeight,
                },
            };
        }, [
            '#game-screen',
            '#player-bot-1',
            '#player-bot-2',
            '#player-bot-3',
            '#center-table',
            '#player-human',
            '#draw-pile',
            '#emoji-toggle-btn',
        ]);

        expect(layout.scroll.width).toBeLessThanOrEqual(layout.viewport.width);
        expect(layout.scroll.height).toBeLessThanOrEqual(layout.viewport.height);
        for (const box of layout.boxes) {
            expect(box.width, `${box.selector} has a rendered width`).toBeGreaterThan(0);
            expect(box.height, `${box.selector} has a rendered height`).toBeGreaterThan(0);
            expect(box.left, `${box.selector} is not clipped on the left`).toBeGreaterThanOrEqual(-1);
            expect(box.top, `${box.selector} is not clipped at the top`).toBeGreaterThanOrEqual(-1);
            expect(box.right, `${box.selector} is not clipped on the right`).toBeLessThanOrEqual(layout.viewport.width + 1);
            expect(box.bottom, `${box.selector} is not clipped at the bottom`).toBeLessThanOrEqual(layout.viewport.height + 1);
        }

        await page.keyboard.press('Control+Shift+D');
        await expect(page.locator('#dev-panel')).not.toHaveClass(/\bhidden\b/);
        await expect(page.locator('#dev-close-btn')).toBeVisible();
        await page.locator('#dev-close-btn').click();
        await expect(page.locator('#dev-panel')).toHaveClass(/\bhidden\b/);
    });
}
