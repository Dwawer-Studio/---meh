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

async function openApp(page, lang = 'ar') {
    await page.route('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', route => route.fulfill({
        body: peerScript,
        contentType: 'text/javascript',
        status: 200,
    }));
    await page.addInitScript(selectedLang => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('meh_settings', JSON.stringify({
            lang: selectedLang, colorblind: false, batterySaver: true,
            wakeLock: false, confirmPlay: true, sound: false, haptics: false,
        }));
    }, lang);
    await page.goto('/');
    await page.locator('#splash').waitFor({ state: 'detached' });
}

async function showCatalog(page, { expansion = false, balance = 0 } = {}) {
    await page.evaluate(({ withExpansion, tamashiBalance }) => {
        const classicCards = MEH_CATALOG_MANIFEST.definitions.map(definition => ({
            ...definition,
            includedByDefault: true,
            unlocked: true,
            inFreeRotation: false,
            contentEnabled: true,
            purchasable: false,
            trialEligible: false,
            releaseStatus: 'live',
        }));
        const cards = [...classicCards];
        if (withExpansion) cards.push({
            definitionId: 'test-strategist',
            nameAr: 'بطاقة اختبار استراتيجية',
            type: 'normal',
            effectOpcode: 'normal',
            assetBase: 'dafour',
            replacementClass: 'colored-normal',
            powerBudget: 0,
            tamashiPrice: 1200,
            includedByDefault: false,
            unlocked: false,
            inFreeRotation: true,
            contentEnabled: true,
            purchasable: true,
            trialEligible: true,
            releaseStatus: 'friendly-5',
            design: {
                decision: { ar: 'اختبر قراراً تكتيكياً', en: 'Test a tactical decision' },
                effect: { ar: 'تعريف اختباري بلا تغيير للقواعد', en: 'A test definition with no rules change' },
                counterplay: { ar: 'طابق اللون أو الشخصية', en: 'Match the color or character' },
                accessibilityLabel: { ar: 'بطاقة اختبار', en: 'Test card' },
            },
        });
        game._catalogState = {
            catalogVersion: MEH_CATALOG_MANIFEST.catalogVersion,
            rulesVersion: MEH_CORE_MANIFEST.rulesVersion,
            currency: { currencyId: 'tamashi', balance: tamashiBalance, revision: 1, frozen: false },
            policy: {
                earning: {
                    completionReward: 100,
                    healthyParticipationReward: 20,
                    winBonus: 20,
                    minimumHumanSeats: 2,
                },
            },
            cards,
        };
        game._catalogView = 'store';
        game._catalogFilter = 'all';
        game._renderCardCatalog();
        game.showScreen('catalog-screen');
    }, { withExpansion: expansion, tamashiBalance: balance });
}

async function horizontalAudit(page) {
    return page.evaluate(() => {
        const screen = document.getElementById('catalog-screen');
        const visibleControls = [...screen.querySelectorAll('button')].filter(button => {
            const rect = button.getBoundingClientRect();
            const style = getComputedStyle(button);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        });
        return {
            viewportWidth: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            screenWidth: screen.scrollWidth,
            controls: visibleControls.map(button => ({
                id: button.id || button.textContent.trim(),
                left: button.getBoundingClientRect().left,
                right: button.getBoundingClientRect().right,
                height: button.getBoundingClientRect().height,
            })),
        };
    });
}

test('UIX-5 puts all 22 classic cards only in the collection with complete uncropped art', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await openApp(page, 'ar');
    await showCatalog(page);

    await expect(page.locator('#catalog-store-tab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#catalog-store-count')).toHaveText('0');
    await expect(page.locator('#catalog-list .catalog-card')).toHaveCount(0);
    await expect(page.locator('.store-empty-state')).toContainText('لا توجد بطاقات جديدة معروضة الآن');
    await expect(page.locator('#catalog-list .catalog-buy')).toHaveCount(0);

    await page.locator('#catalog-collection-tab').click();
    await expect(page.locator('#catalog-list .catalog-card')).toHaveCount(22);
    await expect(page.locator('#catalog-completion-progress')).toHaveAttribute('value', '100');
    await expect(page.locator('#catalog-completion-value')).toContainText('22');
    expect(await page.locator('#catalog-list img').evaluateAll(images => images.every(image =>
        image.complete && image.naturalWidth > 0 && getComputedStyle(image).objectFit === 'contain'
            && getComputedStyle(image).transform === 'none'))).toBe(true);
    await expect(page.locator('#catalog-list .catalog-buy')).toHaveCount(0);

    const allCount = await page.locator('#catalog-list .catalog-card').count();
    await page.locator('[data-catalog-filter="colored-power"]').click();
    const powerCount = await page.locator('#catalog-list .catalog-card').count();
    expect(powerCount).toBeGreaterThan(0);
    expect(powerCount).toBeLessThan(allCount);
    await page.locator('[data-catalog-filter="all"]').click();
    await expect(page.locator('#catalog-list .catalog-card')).toHaveCount(22);

    const audit = await horizontalAudit(page);
    expect(audit.documentWidth).toBeLessThanOrEqual(audit.viewportWidth + 1);
    expect(audit.screenWidth).toBeLessThanOrEqual(audit.viewportWidth + 1);
    for (const control of audit.controls) {
        expect(control.left, `${control.id} left`).toBeGreaterThanOrEqual(-1);
        expect(control.right, `${control.id} right`).toBeLessThanOrEqual(audit.viewportWidth + 1);
        expect(control.height, `${control.id} height`).toBeGreaterThanOrEqual(44);
    }
});

test('UIX-5 expansion detail shows strategy, counterplay and Tamashi price before purchase', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await openApp(page, 'ar');
    await showCatalog(page, { expansion: true, balance: 1500 });

    await expect(page.locator('#catalog-store-count')).toHaveText('1');
    await expect(page.locator('#catalog-list .catalog-card')).toHaveCount(1);
    await expect(page.locator('#catalog-list .catalog-buy')).toHaveCount(0);
    const preview = page.locator('#catalog-list .catalog-card-preview');
    await preview.focus();
    await preview.click();

    await expect(page.locator('#catalog-detail-backdrop')).toBeVisible();
    await expect(page.locator('#catalog-detail-close')).toBeFocused();
    await expect(page.locator('#catalog-detail-effect')).toHaveText('تعريف اختباري بلا تغيير للقواعد');
    await expect(page.locator('#catalog-detail-decision')).toHaveText('اختبر قراراً تكتيكياً');
    await expect(page.locator('#catalog-detail-counterplay')).toHaveText('طابق اللون أو الشخصية');
    await expect(page.locator('#catalog-detail-trial')).toContainText('للتجربة المجانية');
    await expect(page.locator('#catalog-detail-price')).toContainText(/(?:1,200|١٬٢٠٠)/);
    await expect(page.locator('#catalog-detail-buy')).toBeEnabled();
    await expect(page.locator('#catalog-detail-access')).toContainText('للرزمة المشتركة');
    const order = await page.locator('#catalog-detail-dialog').evaluate(dialog => ({
        effect: dialog.querySelector('#catalog-detail-effect').compareDocumentPosition(
            dialog.querySelector('#catalog-detail-buy')) & Node.DOCUMENT_POSITION_FOLLOWING,
        decision: dialog.querySelector('#catalog-detail-decision').compareDocumentPosition(
            dialog.querySelector('#catalog-detail-buy')) & Node.DOCUMENT_POSITION_FOLLOWING,
        counterplay: dialog.querySelector('#catalog-detail-counterplay').compareDocumentPosition(
            dialog.querySelector('#catalog-detail-buy')) & Node.DOCUMENT_POSITION_FOLLOWING,
        price: dialog.querySelector('#catalog-detail-price').compareDocumentPosition(
            dialog.querySelector('#catalog-detail-buy')) & Node.DOCUMENT_POSITION_FOLLOWING,
    }));
    expect(Object.values(order).every(Boolean)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#catalog-detail-backdrop')).toBeHidden();
    await expect(preview).toBeFocused();
});

test('UIX-5 local catalog renders explicit loading and recoverable error states', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await openApp(page, 'en');
    await page.evaluate(() => {
        game.showScreen('catalog-screen');
        game._renderCatalogLoadState('loading');
    });
    await expect(page.locator('.catalog-load-state--loading')).toContainText('Loading the trusted catalog');
    await page.evaluate(() => game._renderCatalogLoadState('error', 'catalog_load_failed'));
    await expect(page.locator('.catalog-load-state--error')).toContainText('We could not open the cabinet');
    await expect(page.locator('.catalog-retry')).toHaveText('Try again');
    const audit = await horizontalAudit(page);
    expect(audit.documentWidth).toBeLessThanOrEqual(audit.viewportWidth + 1);
    expect(audit.screenWidth).toBeLessThanOrEqual(audit.viewportWidth + 1);
});
