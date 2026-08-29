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

async function primeApp(page) {
    await page.route('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', route => route.fulfill({
        body: peerScript,
        contentType: 'text/javascript',
        status: 200,
    }));
    await page.addInitScript(() => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('meh_settings', JSON.stringify({
            lang: 'ar', colorblind: false, batterySaver: true,
            wakeLock: false, confirmPlay: true, sound: false, haptics: false,
        }));
    });
}

async function createFirstProfile(page) {
    await page.goto('/');
    await page.locator('#splash').waitFor({ state: 'detached' });
    await expect(page.locator('#profile-screen')).toHaveClass(/\bactive\b/);
    await page.locator('#show-create-profile').click();
    await page.locator('#profile-name-input').fill('مختبر UIX');
    await page.locator('#avatar-picker .avatar-option').first().click();
    await page.locator('#save-profile-btn').click();
    await expect(page.locator('#main-menu')).toHaveClass(/\bactive\b/);
}

function trackDiagnostics(page) {
    const diagnostics = [];
    page.on('pageerror', error => diagnostics.push(`pageerror: ${error.message}`));
    page.on('console', message => {
        if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`);
    });
    page.on('response', response => {
        if (response.url().startsWith('http://127.0.0.1:') && response.status() >= 400) {
            diagnostics.push(`response: ${response.status()} ${response.url()}`);
        }
    });
    return diagnostics;
}

async function auditActiveScreen(page) {
    return page.evaluate(() => {
        const active = document.querySelector('.screen.active');
        const controls = [...active.querySelectorAll('button, a, input, [role="switch"]')]
            .filter(element => {
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden'
                    && rect.width > 0 && rect.height > 0;
            }).map(element => {
                const rect = element.getBoundingClientRect();
                return {
                    id: element.id,
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height,
                };
            });
        return {
            active: active.id,
            width: innerWidth,
            height: innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            controls,
            brokenImages: [...active.querySelectorAll('img')]
                .filter(image => image.complete && image.naturalWidth === 0)
                .map(image => image.getAttribute('src')),
        };
    });
}

test.beforeEach(async ({ page }) => {
    await primeApp(page);
});

test('UIX-2 first session keeps commerce hidden and reaches play through one primary action', async ({ page }) => {
    const diagnostics = trackDiagnostics(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await createFirstProfile(page);

    await expect(page.locator('#catalog-btn')).toBeHidden();
    await expect(page.locator('#play-btn')).toBeVisible();
    await page.locator('#play-btn').click();
    await expect(page.locator('#game-screen')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#human-hand .card')).toHaveCount(7);
    expect(diagnostics).toEqual([]);
});

test('UIX-2 nested navigation follows browser history and restores focus', async ({ page }) => {
    await createFirstProfile(page);
    await page.locator('#play-options-btn').click();
    await expect(page.locator('#play-center-screen')).toHaveClass(/\bactive\b/);
    await page.locator('#instructions-btn').click();
    await expect(page.locator('#instructions-screen')).toHaveClass(/\bactive\b/);

    await page.goBack();
    await expect(page.locator('#play-center-screen')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#instructions-btn')).toBeFocused();
    await page.locator('#play-center-back-btn').click();
    await expect(page.locator('#main-menu')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#play-options-btn')).toBeFocused();
});

test('UIX-2 settings switch direction without overflow and restore the opener', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await createFirstProfile(page);
    await page.locator('#menu-settings-btn').click();
    await page.locator('.lang-btn[data-lang="en"]').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.locator('#settings-back-btn').click();
    await expect(page.locator('#menu-settings-btn')).toBeFocused();
    await expect(page.locator('#play-btn')).toContainText('Play now');
    const audit = await auditActiveScreen(page);
    expect(audit.scrollWidth).toBeLessThanOrEqual(audit.width + 1);
    expect(audit.brokenImages).toEqual([]);
});

test('UIX-2 valid invite opens the reserved seat directly without exposing the menu', async ({ page }) => {
    await page.goto('/?join=ABCDE&v=1');
    await page.locator('#splash').waitFor({ state: 'detached' });
    await expect(page.locator('#invite-screen')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#main-menu')).not.toHaveClass(/\bactive\b/);
    await expect(page.locator('#invite-join-btn')).toBeEnabled();
    await expect(page.locator('#invite-guest-name')).toBeVisible();
    await expect(page.locator('#invite-guest-name-label')).toBeVisible();
});

for (const viewport of [
    { name: 'compact portrait', width: 360, height: 800 },
    { name: 'reference portrait', width: 393, height: 852 },
    { name: 'large portrait', width: 430, height: 932 },
    { name: 'compact landscape', width: 844, height: 390 },
    { name: 'reference landscape', width: 932, height: 430 },
]) {
    test(`UIX-2 home fits ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await createFirstProfile(page);
        const audit = await auditActiveScreen(page);
        expect(audit.active).toBe('main-menu');
        expect(audit.scrollWidth).toBeLessThanOrEqual(audit.width + 1);
        expect(audit.brokenImages).toEqual([]);
        for (const control of audit.controls) {
            expect(control.width, `${control.id} width`).toBeGreaterThanOrEqual(43.5);
            expect(control.height, `${control.id} height`).toBeGreaterThanOrEqual(43.5);
            expect(control.left, `${control.id} left edge`).toBeGreaterThanOrEqual(-1);
            expect(control.right, `${control.id} right edge`).toBeLessThanOrEqual(audit.width + 1);
            expect(control.top, `${control.id} top edge`).toBeGreaterThanOrEqual(-1);
            expect(control.bottom, `${control.id} bottom edge`).toBeLessThanOrEqual(audit.height + 1);
        }
    });
}
