'use strict';

const { test, expect } = require('@playwright/test');
const { createServer } = require('../../tools/serve');

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

for (const scenario of [
    { name: 'Arabic RTL at 100%', locale: 'ar', scale: '100', direction: 'rtl' },
    { name: 'English LTR at 100%', locale: 'en', scale: '100', direction: 'ltr' },
    { name: 'Arabic RTL at 200%', locale: 'ar', scale: '200', direction: 'rtl' },
    { name: 'English LTR at 200%', locale: 'en', scale: '200', direction: 'ltr' },
]) {
    test(`UIX-1 fixture: ${scenario.name}`, async ({ page }) => {
        await page.setViewportSize({ width: 393, height: 852 });
        await page.goto(`/ui/fixture/index.html?locale=${scenario.locale}&scale=${scenario.scale}&motion=reduced`);
        await expect(page.locator('html')).toHaveAttribute('dir', scenario.direction);
        await expect(page.locator('html')).toHaveAttribute('lang', scenario.locale);
        await expect(page.locator('body')).toHaveAttribute('data-ui-text-scale', scenario.scale);
        await expect(page.locator('body')).toHaveAttribute('data-ui-motion', 'reduced');
        await expect(page.locator('#fixture-title')).toBeVisible();

        const audit = await page.evaluate(async () => {
            await document.fonts.ready;
            const controls = [...document.querySelectorAll('button:not([hidden]), input:not([hidden])')]
                .filter(element => element.getClientRects().length > 0)
                .map(element => {
                    const rect = element.getBoundingClientRect();
                    return { id: element.id, width: rect.width, height: rect.height };
                });
            return {
                fontLoaded: document.fonts.check('16px "Meh UI"'),
                fontFamily: getComputedStyle(document.body).fontFamily,
                scrollWidth: document.documentElement.scrollWidth,
                viewportWidth: window.innerWidth,
                controls,
            };
        });

        expect(audit.fontLoaded).toBe(true);
        expect(audit.fontFamily).toContain('Meh UI');
        expect(audit.scrollWidth).toBeLessThanOrEqual(audit.viewportWidth + 1);
        for (const control of audit.controls) {
            expect(control.width, `${control.id || 'control'} width`).toBeGreaterThanOrEqual(44);
            expect(control.height, `${control.id || 'control'} height`).toBeGreaterThanOrEqual(44);
        }
    });
}

test('UIX-1 tabs and dialog are keyboard-operable and restore focus', async ({ page }) => {
    await page.goto('/ui/fixture/index.html?locale=en&scale=100&motion=full');
    await page.locator('#tab-store').click();
    await expect(page.locator('#tab-store')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#panel-store')).toBeVisible();

    await page.locator('#dialog-open').focus();
    await page.locator('#dialog-open').press('Enter');
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.locator('#dialog-close')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).toBeHidden();
    await expect(page.locator('#dialog-open')).toBeFocused();
});

test('UIX-1 production entry loads the executable identity foundation', async ({ page }) => {
    await page.goto('/');
    const identity = await page.evaluate(async () => {
        await document.fonts.ready;
        const body = getComputedStyle(document.body);
        return {
            system: document.body.dataset.uiSystem,
            fontLoaded: document.fonts.check('16px "Meh UI"'),
            fontFamily: body.fontFamily,
            signal: body.getPropertyValue('--ui-brand-signal').trim(),
            ink: body.getPropertyValue('--ui-brand-ink').trim(),
        };
    });
    expect(identity).toEqual({
        system: 'living-circle',
        fontLoaded: true,
        fontFamily: expect.stringContaining('Meh UI'),
        signal: '#ee3633',
        ink: '#040707',
    });
});
