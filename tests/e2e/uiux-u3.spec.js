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

async function primeApp(page, lang = 'ar') {
    await page.route('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', route => route.fulfill({
        body: peerScript,
        contentType: 'text/javascript',
        status: 200,
    }));
    await page.addInitScript(selectedLang => {
        localStorage.clear();
        sessionStorage.clear();
        let seed = 0x75697837;
        Math.random = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 0x100000000;
        };
        localStorage.setItem('meh_settings', JSON.stringify({
            lang: selectedLang, colorblind: false, batterySaver: true,
            wakeLock: false, confirmPlay: true, sound: false, haptics: false,
        }));
    }, lang);
}

async function openTable(page, lang = 'ar') {
    await primeApp(page, lang);
    await page.goto('/');
    await page.locator('#splash').waitFor({ state: 'detached' });
    await page.locator('#show-create-profile').click();
    await page.locator('#profile-name-input').fill(lang === 'ar' ? 'مختبر الطاولة' : 'Table tester');
    await page.locator('#avatar-picker .avatar-option').first().click();
    await page.locator('#save-profile-btn').click();
    await page.locator('#play-btn').click();
    await expect(page.locator('#game-screen')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#human-hand .card')).toHaveCount(7);
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

async function auditTable(page) {
    return page.evaluate(() => {
        const screen = document.getElementById('game-screen');
        const visible = element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden'
                && rect.width > 0 && rect.height > 0;
        };
        const rects = [...screen.querySelectorAll(
            '.table-bar, .player-area, .pile-slot, #turn-indicator, #player-human, '
            + '#human-hand .card, button:not(.hidden)',
        )].filter(visible).map(element => {
            const rect = element.getBoundingClientRect();
            return {
                id: element.id || element.className,
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
            };
        });
        return {
            width: innerWidth,
            height: innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
            rects,
            brokenImages: [...screen.querySelectorAll('img')]
                .filter(image => image.complete && image.naturalWidth === 0)
                .map(image => image.getAttribute('src')),
            cardObjectFits: [...screen.querySelectorAll('.card > img')]
                .map(image => getComputedStyle(image).objectFit),
        };
    });
}

test('UIX-3 makes play, selection, confirmation and the action journal explicit', async ({ page }) => {
    const diagnostics = trackDiagnostics(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await openTable(page, 'ar');

    await expect(page.locator('#game-screen')).toHaveClass(/\blocal-turn\b/);
    await expect(page.locator('#table-context-name')).toHaveText('طاولة محلية');
    await expect(page.locator('#table-round-label')).toHaveText('الجولة 1');
    await expect(page.locator('#draw-pile')).toBeEnabled();
    await expect(page.locator('#human-hand .card.playable').first()).toBeEnabled();
    await expect(page.locator('#human-hand .card.disabled').first()).toBeDisabled();

    const playable = page.locator('#human-hand .card.playable').last();
    await playable.click();
    await expect(page.locator('#human-hand .card.selected')).toHaveCount(1);
    await expect(page.locator('#human-hand .card.selected')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#confirm-bar')).toBeVisible();
    await expect(page.locator('#confirm-play-btn')).toBeFocused();
    await page.locator('#cancel-play-btn').click();
    await expect(page.locator('#confirm-bar')).toBeHidden();
    await expect(page.locator('#human-hand .card.selected')).toHaveCount(0);

    await page.locator('#journal-toggle-btn').click();
    await expect(page.locator('#action-journal')).toBeVisible();
    await expect(page.locator('#journal-close-btn')).toBeFocused();
    await page.locator('#journal-close-btn').click();
    await expect(page.locator('#journal-toggle-btn')).toBeFocused();

    const audit = await auditTable(page);
    expect(audit.cardObjectFits.length).toBeGreaterThanOrEqual(8);
    expect(audit.cardObjectFits.every(value => value === 'contain')).toBe(true);
    expect(audit.brokenImages).toEqual([]);
    expect(diagnostics).toEqual([]);
});

test('UIX-3 renders every card definition through the production hand renderer', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await openTable(page, 'en');

    const rendered = await page.evaluate(() => {
        const pool = [
            ...window.game.deck.cards,
            ...window.game.discardPile,
            ...window.game.players.flatMap(player => player.hand),
        ];
        const definitions = new Map();
        for (const card of pool) {
            if (!definitions.has(card.definitionId)) definitions.set(card.definitionId, card);
        }
        window.game.players[0].hand = [...definitions.values()];
        window.game.currentPlayerIndex = 0;
        window.game.humanCanPlay = true;
        window.game.actionInProgress = false;
        window.game.isAwaitingColor = false;
        window.game.updateUI();
        return { definitions: definitions.size, ids: [...definitions.keys()] };
    });

    expect(rendered.definitions).toBeGreaterThanOrEqual(15);
    await expect(page.locator('#human-hand .card')).toHaveCount(rendered.definitions);
    await expect(page.locator('#human-hand .card > img')).toHaveCount(rendered.definitions);
    const labels = await page.locator('#human-hand .card')
        .evaluateAll(cards => cards.map(card => card.getAttribute('aria-label')));
    expect(labels.every(Boolean)).toBe(true);
    const denseState = await page.locator('.human-hand-scroll').evaluate(scroller => ({
        dense: scroller.classList.contains('is-dense-hand'),
        overflowX: getComputedStyle(scroller).overflowX,
        clientWidth: scroller.clientWidth,
        scrollWidth: scroller.scrollWidth,
    }));
    expect(denseState.dense).toBe(true);
    expect(denseState.overflowX).toBe('auto');
    expect(denseState.scrollWidth).toBeGreaterThan(denseState.clientWidth);
    await page.locator('#human-hand .card').last().scrollIntoViewIfNeeded();
    await expect(page.locator('#human-hand .card').last()).toBeInViewport();
});

test('UIX-3 keeps English/LTR table state equivalent to Arabic/RTL', async ({ page }) => {
    await page.setViewportSize({ width: 932, height: 430 });
    await openTable(page, 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('#table-context-name')).toHaveText('Local table');
    await expect(page.locator('#table-round-label')).toHaveText('Round 1');
    await expect(page.locator('#turn-action-label')).toHaveText('Choose a card or draw');
    await expect(page.locator('#human-hand')).toHaveAttribute('aria-label', 'Your hand');
    await expect(page.locator('#dir-ring')).toHaveAttribute('aria-label', 'Turn direction');
});

for (const viewport of [
    { name: 'compact portrait', width: 360, height: 800 },
    { name: 'reference portrait', width: 393, height: 852 },
    { name: 'large portrait', width: 430, height: 932 },
    { name: 'tablet portrait', width: 768, height: 1024 },
    { name: 'compact landscape', width: 844, height: 390 },
    { name: 'reference landscape', width: 932, height: 430 },
    { name: 'tablet landscape', width: 1024, height: 768 },
    { name: 'desktop landscape', width: 1366, height: 768 },
]) {
    test(`UIX-3 table fits ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await openTable(page, 'ar');
        const audit = await auditTable(page);
        expect(audit.scrollWidth).toBeLessThanOrEqual(audit.width + 1);
        expect(audit.scrollHeight).toBeLessThanOrEqual(audit.height + 1);
        expect(audit.brokenImages).toEqual([]);
        for (const rect of audit.rects) {
            expect(rect.left, `${rect.id} left edge`).toBeGreaterThanOrEqual(-1);
            expect(rect.right, `${rect.id} right edge`).toBeLessThanOrEqual(audit.width + 1);
            expect(rect.top, `${rect.id} top edge`).toBeGreaterThanOrEqual(-1);
            expect(rect.bottom, `${rect.id} bottom edge`).toBeLessThanOrEqual(audit.height + 1);
        }
    });
}
