'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { createServer } = require('../../tools/serve');
const matrix = require('../fixtures/uiux-u7-matrix.json');

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

async function prime(page, lang, { reducedMotion = 'no-preference', batterySaver = false } = {}) {
    await page.emulateMedia({ reducedMotion });
    await page.route('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', route => route.fulfill({
        body: peerScript,
        contentType: 'text/javascript',
        status: 200,
    }));
    await page.addInitScript(({ selectedLang, battery }) => {
        localStorage.clear();
        sessionStorage.clear();
        let seed = 0x75697837;
        Math.random = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 0x100000000;
        };
        window.__u7LongTasks = [];
        if (typeof PerformanceObserver !== 'undefined') {
            try {
                const observer = new PerformanceObserver(list => {
                    window.__u7LongTasks.push(...list.getEntries().map(entry => entry.duration));
                });
                observer.observe({ type: 'longtask', buffered: true });
            } catch (_) {
                // Long-task entries are optional in browsers that do not expose the API.
            }
        }
        localStorage.setItem('meh_settings', JSON.stringify({
            lang: selectedLang,
            colorblind: false,
            batterySaver: battery,
            wakeLock: false,
            confirmPlay: true,
            sound: false,
            soundMaster: false,
            music: false,
            sfx: true,
            haptics: false,
        }));
    }, { selectedLang: lang, battery: batterySaver });
    await page.goto('/');
    await page.locator('#splash').waitFor({ state: 'detached' });
}

async function createProfile(page, lang) {
    await page.locator('#show-create-profile').click();
    await page.locator('#profile-name-input').fill(lang === 'ar' ? 'مختبر الصلابة' : 'Hardening tester');
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

async function applyPseudoLocale(page) {
    await page.locator('.screen.active').evaluate(screen => {
        const protectedToken = /(\{\{?[^{}]+\}?\}|%\d*\$?[a-z]|https?:\/\/\S+)/gi;
        const expand = source => {
            let letters = 0;
            let output = '';
            for (const character of source) {
                if (/\p{L}/u.test(character)) letters++;
                output += character;
                if (letters > 0 && letters % 3 === 0 && /\p{L}/u.test(character)) output += 'ـ';
            }
            return output;
        };
        const pseudo = value => `⟦${String(value).split(protectedToken)
            .map((part, index) => index % 2 === 1 ? part : expand(part)).join('')}⟧`;
        const walker = document.createTreeWalker(screen, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
            if (node.parentElement && !['SCRIPT', 'STYLE'].includes(node.parentElement.tagName)
                && node.nodeValue.trim()) node.nodeValue = pseudo(node.nodeValue);
        }
        for (const element of screen.querySelectorAll('[aria-label]')) {
            const label = element.getAttribute('aria-label');
            if (label) element.setAttribute('aria-label', pseudo(label));
        }
    });
}

async function auditActiveSurface(page, expectedId) {
    const audit = await page.evaluate(() => {
        const active = document.querySelector('.screen.active');
        const isVisible = element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
                && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
                && rect.top < innerHeight && rect.left < innerWidth;
        };
        // عند فتح قرار نمطي تصبح عناصره وحدها طبقة التفاعل الفعلية؛
        // قياس عناصر الشاشة المحجوبة خلفه يعطي تداخلات هندسية وهمية.
        const openModal = [...active.querySelectorAll('[role="dialog"][aria-modal="true"]')]
            .find(isVisible);
        const controlRoot = openModal || active;
        const controls = [...controlRoot.querySelectorAll('button, a, input, select, textarea, [role="switch"]')]
            .filter(isVisible)
            .map(element => {
                const rect = element.getBoundingClientRect();
                // The hand now scrolls instead of hiding cards behind overlapping
                // hit areas. Audit the clipped rail bounds, not offscreen content.
                const rail = element.closest('.human-hand-scroll.is-dense-hand');
                const bounds = rail && rail.getBoundingClientRect();
                return {
                    id: element.id || element.getAttribute('aria-label') || element.textContent.trim().slice(0, 30),
                    card: element.classList.contains('card'),
                    left: bounds ? Math.max(bounds.left, Math.min(bounds.right, rect.left)) : rect.left,
                    right: bounds ? Math.min(bounds.right, Math.max(bounds.left, rect.right)) : rect.right,
                    top: rect.top, bottom: rect.bottom,
                    width: rect.width, height: rect.height,
                };
            });
        const overlaps = [];
        for (let first = 0; first < controls.length; first++) {
            if (controls[first].card) continue;
            for (let second = first + 1; second < controls.length; second++) {
                if (controls[second].card) continue;
                const a = controls[first];
                const b = controls[second];
                const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
                const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
                const ratio = (width * height) / Math.min(a.width * a.height, b.width * b.height);
                if (ratio > 0.2) overlaps.push(`${a.id} <> ${b.id}`);
            }
        }
        const text = active.innerText;
        return {
            id: active.id,
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: innerWidth,
            controls,
            overlaps,
            brokenImages: [...active.querySelectorAll('img')]
                .filter(image => image.complete && image.naturalWidth === 0)
                .map(image => image.getAttribute('src')),
            missingAlt: [...active.querySelectorAll('img:not([alt])')].map(image => image.getAttribute('src')),
            rawKeys: text.match(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/gi) || [],
        };
    });
    expect(audit.id).toBe(expectedId);
    expect(audit.documentWidth).toBeLessThanOrEqual(audit.viewportWidth + 1);
    expect(audit.brokenImages).toEqual([]);
    expect(audit.missingAlt).toEqual([]);
    expect(audit.rawKeys).toEqual([]);
    expect(audit.overlaps).toEqual([]);
    for (const control of audit.controls) {
        expect(control.width, `${expectedId}:${control.id} width`).toBeGreaterThanOrEqual(43.5);
        expect(control.height, `${expectedId}:${control.id} height`).toBeGreaterThanOrEqual(43.5);
        expect(control.left, `${expectedId}:${control.id} left`).toBeGreaterThanOrEqual(-1);
        expect(control.right, `${expectedId}:${control.id} right`).toBeLessThanOrEqual(audit.viewportWidth + 1);
    }
}

for (const frame of matrix.frames) {
    test(`UIX-7 state matrix: ${frame.name}`, async ({ page }) => {
        await page.setViewportSize({ width: frame.width, height: frame.height });
        await prime(page, frame.lang);
        await createProfile(page, frame.lang);

        await auditActiveSurface(page, 'main-menu');

        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.evaluate(() => FeedbackDirector.configure(game.settings));
        await expect(page.locator('body')).toHaveAttribute('data-feedback-profile', 'reduced');
        await auditActiveSurface(page, 'main-menu');

        await page.evaluate(() => document.body.dataset.uiTextScale = '200');
        await auditActiveSurface(page, 'main-menu');
        await page.evaluate(() => delete document.body.dataset.uiTextScale);

        await applyPseudoLocale(page);
        await auditActiveSurface(page, 'main-menu');

        await page.evaluate(() => {
            game.showScreen('catalog-screen');
            game._renderCatalogLoadState('loading');
        });
        await auditActiveSurface(page, 'catalog-screen');
        await page.evaluate(() => game._renderCatalogLoadState('error', 'catalog_load_failed'));
        await auditActiveSurface(page, 'catalog-screen');
        await showEmptyCatalog(page);
        await auditActiveSurface(page, 'catalog-screen');

        await page.evaluate(() => game.showScreen('main-menu'));
        await page.locator('#play-btn').click();
        await expect(page.locator('#human-hand .card')).toHaveCount(7);
        await auditActiveSurface(page, 'game-screen');
        // Every card must also be reachable as an actual target, including the
        // edge cards outside the initial scroll position. Never force the click.
        const cardIds = await page.locator('#human-hand .card').evaluateAll(cards => cards.map(card => card.dataset.cardId));
        for (const id of cardIds) {
            await page.locator(`#human-hand [data-card-id="${id}"]`).click();
            await expect(page.locator('#confirm-bar')).toBeVisible();
            await page.locator('#cancel-play-btn').click();
        }

        await page.evaluate(() => {
            game.settings.colorblind = true;
            game.applySettings();
            game.updateUI();
        });
        await expect(page.locator('#human-hand .cb-symbol').first()).toBeVisible();
        await auditActiveSurface(page, 'game-screen');

        const playable = page.locator('#human-hand .card.playable').last();
        await playable.click();
        await expect(page.locator('#confirm-play-btn')).toBeVisible();
        await auditActiveSurface(page, 'game-screen');

        await page.evaluate(() => game.setDialogOpen(document.getElementById('color-picker'), true));
        await expect(page.locator('#color-picker .color-btn').first()).toBeFocused();
        await auditActiveSurface(page, 'game-screen');
        await page.evaluate(() => game.setDialogOpen(document.getElementById('color-picker'), false));

        await page.evaluate(() => game.showDrawPenalty(game.players[1], 2));
        await expect(page.locator('.draw-badge')).toContainText('+2');
        await expect(page.locator('.penalty-reason-banner')).toBeVisible();
        await auditActiveSurface(page, 'game-screen');

        await page.evaluate(() => game.endGame(game.players[0]));
        await expect(page.locator('#restart-btn')).toBeEnabled();
        await auditActiveSurface(page, 'end-screen');
        expect((await page.locator('#end-menu-btn').boundingBox()).y).toBeGreaterThanOrEqual(0);
    });
}

test('UIX-7 axe gate covers entry, home, table, decision and results in both directions', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    const settleScreenTransition = () => page.waitForTimeout(380);
    for (const lang of ['ar', 'en']) {
        await prime(page, lang);
        await settleScreenTransition();
        let results = await new AxeBuilder({ page }).include('#profile-screen')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(results.violations).toEqual([]);
        await createProfile(page, lang);
        await settleScreenTransition();
        results = await new AxeBuilder({ page }).include('#main-menu')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(results.violations).toEqual([]);
        await page.locator('#play-btn').click();
        await settleScreenTransition();
        results = await new AxeBuilder({ page }).include('#game-screen')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(results.violations).toEqual([]);
        await page.evaluate(() => game.setDialogOpen(document.getElementById('color-picker'), true));
        results = await new AxeBuilder({ page }).include('#color-picker')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(results.violations).toEqual([]);
        await page.evaluate(() => {
            game.setDialogOpen(document.getElementById('color-picker'), false);
            game.endGame(game.players[0]);
        });
        await settleScreenTransition();
        results = await new AxeBuilder({ page }).include('#end-screen')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(results.violations).toEqual([]);
    }
});

test('UIX-7 keyboard and accessibility tree expose the complete critical path', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await prime(page, 'en');
    // الموجّه يضع التركيز على عنوان الشاشة؛ الرجوع خطوة يصل إلى رابط تجاوز المحتوى.
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('.ui-skip-link')).toBeFocused();
    await createProfile(page, 'en');
    const homeTree = await page.locator('#main-menu').ariaSnapshot();
    expect(homeTree).toContain('heading "Let your last card say Meh"');
    expect(homeTree).toContain('button "Play now');
    await page.locator('#play-options-btn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#play-center-screen')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#play-center-title')).toBeFocused();
    await page.locator('#local-play-btn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#human-hand .card')).toHaveCount(7);
    await page.locator('#human-hand .card.playable').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#confirm-play-btn')).toBeFocused();
    const tableTree = await page.locator('#game-screen').ariaSnapshot();
    expect(tableTree).toContain('button "Draw a card"');
    expect(tableTree).toContain('status');
    await page.evaluate(() => game.endGame(game.players[0]));
    const resultTree = await page.locator('#end-screen').ariaSnapshot();
    expect(resultTree).toContain('heading "Nicely played. You won."');
    expect(resultTree).toContain('button "Play Again"');
});

test('UIX-7 keeps local feedback responsive under 4x CPU and critical resources local', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.setViewportSize({ width: 393, height: 852 });
    await prime(page, 'ar', { batterySaver: false });
    await createProfile(page, 'ar');
    const responseMs = await page.evaluate(() => new Promise(resolve => {
        const start = performance.now();
        document.getElementById('play-options-btn').click();
        requestAnimationFrame(() => resolve(performance.now() - start));
    }));
    expect(responseMs).toBeLessThan(100);
    await page.locator('#play-center-back-btn').click();
    await page.locator('#play-btn').click();
    // Measure the requested feedback itself, not concurrent initial dealing.
    // Startup interaction remains measured above with its original 100 ms gate.
    await expect.poll(() => page.evaluate(() => game.humanCanPlay && !game.actionInProgress)).toBe(true);
    const captureFeedbackLongTasks = async action => {
        await page.evaluate(() => { window.__u7LongTasks = []; });
        await action();
        await page.evaluate(() => new Promise(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));
        return page.evaluate(() => [...window.__u7LongTasks]);
    };
    const feedbackLongTasks = {
        impact: await captureFeedbackLongTasks(() => page.evaluate(() => game.screenFx('counter'))),
        penalty: await captureFeedbackLongTasks(() => page.evaluate(() => game.showDrawPenalty(game.players[1], 2))),
    };
    await page.evaluate(() => game.showScreen('end-screen'));
    await page.waitForTimeout(380);
    feedbackLongTasks.result = await captureFeedbackLongTasks(() => page.evaluate(() => {
        FeedbackDirector.result(document.getElementById('end-screen'), true);
    }));
    await page.waitForTimeout(500);
    const performanceAudit = await page.evaluate(() => {
        const resources = performance.getEntriesByType('resource');
        const byType = type => resources.filter(entry => entry.initiatorType === type);
        const total = entries => entries.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0);
        return {
            remoteFontOrIcon: resources.filter(entry => /\.(?:woff2?|svg)(?:\?|$)/i.test(entry.name)
                && new URL(entry.name).origin !== location.origin).map(entry => entry.name),
            deferredAssets: resources.filter(entry => /orange-dafour|dwawer-mark-ink/i.test(entry.name))
                .map(entry => entry.name),
            cssBytes: total(byType('link')),
            scriptBytes: total(byType('script')),
            fontBytes: total(resources.filter(entry => /\.woff2(?:\?|$)/i.test(entry.name))),
            heap: performance.memory ? performance.memory.usedJSHeapSize : 0,
        };
    });
    for (const [event, durations] of Object.entries(feedbackLongTasks)) {
        expect(durations.filter(duration => duration > 50), `${event} feedback long tasks`).toEqual([]);
    }
    expect(performanceAudit.remoteFontOrIcon).toEqual([]);
    expect(performanceAudit.cssBytes).toBeLessThan(250_000);
    expect(performanceAudit.scriptBytes).toBeLessThan(1_200_000);
    expect(performanceAudit.fontBytes).toBeLessThan(300_000);
    if (performanceAudit.heap > 0) expect(performanceAudit.heap).toBeLessThan(64 * 1024 * 1024);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});
