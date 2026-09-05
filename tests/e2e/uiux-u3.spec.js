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
            const scroller = element.closest('.human-hand-scroll.is-dense-hand');
            const bounds = scroller && scroller.getBoundingClientRect();
            return {
                id: element.id || element.className,
                // A scroll rail intentionally contains offscreen cards. Audit its
                // visible bounds here; the interaction tests scroll to real cards.
                left: bounds ? Math.max(bounds.left, Math.min(bounds.right, rect.left)) : rect.left,
                right: bounds ? Math.min(bounds.right, Math.max(bounds.left, rect.right)) : rect.right,
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
    const unplayable = page.locator('#human-hand .card.disabled').first();
    await expect(unplayable).toBeEnabled(); // Inspecting is not committing a play.
    await unplayable.click();
    await expect(page.locator('#inspect-effect')).not.toBeEmpty();
    await expect(page.locator('#confirm-play-btn')).toBeDisabled();
    await page.screenshot({ path: 'artifacts/fun-a-portrait-inspection.png' });
    await page.locator('#cancel-play-btn').click();

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
    await page.screenshot({ path: 'artifacts/fun-a-portrait-journal.png' });
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

// Controlled positions exercise production rules, dictionary and DOM together.
// Every fixture retains the full, unique 60-card pool; no alternate rules engine.
async function positionForInsight(page, types, pending = 0) {
    return page.evaluate(({ types, pending }) => {
        const game = window.game;
        const pool = [...game.deck.cards, ...game.discardPile, ...game.players.flatMap(player => player.hand)];
        const take = (type, color = 'gray') => {
            const index = pool.findIndex(card => card.type === type && card.color === color);
            if (index < 0) throw new Error(`Missing fixture card ${type}/${color}`);
            return pool.splice(index, 1)[0];
        };
        const hand = types.map(type => take(type, ['wild', 'meh', 'draw4Wild'].includes(type) ? 'black' : 'gray'));
        const top = take('normal');
        game.players[0].hand = hand;
        for (const player of game.players.slice(1)) player.hand = pool.splice(0, 3);
        game.deck.cards = pool;
        game.discardPile = [top];
        game.activeColor = 'gray'; game.direction = 1; game.pendingDraws = pending;
        game.currentPlayerIndex = 0; game.humanCanPlay = true; game.actionInProgress = false;
        game.isAwaitingColor = false; game.skipNextMap = {}; game.drawImmune = {};
        game.superpowersDisabled = false; game._cardDecision = null; game._decisionContext = null;
        game._actionJournal = []; game.hideConfirmBar(); game.updateUI();
        return hand.map(card => ({ id: card.id, type: card.type }));
    }, { types, pending });
}

test('FUN-A actual extra-card decision stays explicit and does not activate the discarded power', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await openTable(page, 'ar');
    const hand = await positionForInsight(page, ['boShlakh', 'plato', 'normal']);
    const before = await page.evaluate(() => window.game.players[0].hand.map(card => card.id));
    await page.locator(`[data-card-id="${hand[0].id}"]`).click();
    await expect(page.locator('#inspect-effect')).toContainText('لا تنفذ قوتها');
    await page.locator('#confirm-play-btn').click();
    await expect(page.locator('#decision-context')).toContainText('اختر بطاقة تتخلّص منها');
    await page.locator(`[data-card-id="${hand[1].id}"]`).click();
    await expect(page.locator('#inspect-effect')).toContainText('دون تشغيل قوتها');
    await page.locator('#confirm-play-btn').click();
    await expect(page.locator('#decision-context')).toBeHidden();
    const after = await page.evaluate(() => ({
        hand: window.game.players[0].hand.map(card => card.id), skipped: window.game.skipNextMap,
        pool: [...window.game.deck.cards, ...window.game.discardPile, ...window.game.players.flatMap(player => player.hand)].map(card => card.id),
    }));
    expect(before).toEqual(hand.map(card => card.id)); // Rendering did not reorder the model.
    expect(after.hand).toEqual([hand[2].id]);
    expect(after.skipped).toEqual({});
    expect(new Set(after.pool).size).toBe(60);
    await page.locator('#journal-toggle-btn').click();
    await expect(page.locator('#action-journal')).toContainText('بوشلاخ');
    await expect(page.locator('#action-journal')).not.toContainText('undefined');
});

test('FUN-A a real counter explains the accumulated penalty and target in Arabic and English', async ({ page }) => {
    for (const locale of ['ar', 'en']) {
        await openTable(page, locale);
        const hand = await positionForInsight(page, ['counterAttack', 'normal'], 4);
        await page.locator(`[data-card-id="${hand[0].id}"]`).click();
        await expect(page.locator('#inspect-effect')).toContainText('6');
        await page.locator('#confirm-play-btn').click();
        await expect.poll(() => page.evaluate(() => window.game.pendingDraws)).toBe(6);
        expect(await page.evaluate(() => window.game.direction)).toBe(-1);
        await page.locator('#journal-toggle-btn').click();
        await expect(page.locator('#action-journal')).not.toContainText('undefined');
        await expect(page.locator('#action-journal')).toContainText('6');
    }
});

test('FUN-A the original artwork recovers after a failed image load without an emoji replacement', async ({ page }) => {
    const pattern = '**/assets/cards/gray-plato.webp*';
    await page.route(pattern, route => route.abort());
    await openTable(page, 'en');
    const hand = await positionForInsight(page, ['plato', 'normal']);
    await page.locator(`[data-card-id="${hand[0].id}"]`).click();
    await expect(page.locator('#inspect-art-retry')).toBeVisible();
    await page.unroute(pattern);
    await page.locator('#inspect-art-retry').click();
    await expect.poll(() => page.locator('#inspect-art').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('#inspect-art')).toHaveAttribute('src', /gray-plato\.webp/);
    await expect(page.locator('#human-hand .card-emoji')).toHaveCount(0);
});

test('FUN-A Chameleon selects a named target then inspects the donated card without revealing it in the journal', async ({ page }) => {
    await openTable(page, 'en');
    const cards = await positionForInsight(page, ['chameleon', 'plato', 'normal']);
    await page.locator(`[data-card-id="${cards[0].id}"]`).click();
    await page.locator('#confirm-play-btn').click();
    await expect(page.locator('#decision-context')).toContainText('target');
    const target = page.locator('#player-picker-list button').first();
    await expect(target).toContainText('3 cards');
    await target.click();
    await expect(page.locator('#decision-context')).toContainText('give');
    await page.locator(`[data-card-id="${cards[1].id}"]`).click();
    await expect(page.locator('#inspect-effect')).toContainText('without activating');
    await page.locator('#confirm-play-btn').click();
    const state = await page.evaluate(id => ({
        mine: window.game.players[0].hand.length,
        targetHasCard: window.game.players[1].hand.some(card => card.id === id),
        skipped: window.game.skipNextMap,
        journal: window.game._actionJournal.map(entry => entry.text).join(' '),
    }), cards[1].id);
    expect(state.mine).toBe(1);
    expect(state.targetHasCard).toBe(true);
    expect(state.skipped).toEqual({});
    expect(state.journal).not.toContain('Plato');
});

test('FUN-A the Best One choice warns when discarding would give the opponent a win', async ({ page }) => {
    await openTable(page, 'en');
    const cards = await positionForInsight(page, ['bestOne', 'normal']);
    await page.evaluate(() => {
        const game = window.game;
        game.deck.cards.push(...game.players[1].hand.splice(1));
        game.updateUI();
    });
    await page.locator(`[data-card-id="${cards[0].id}"]`).click();
    await page.locator('#confirm-play-btn').click();
    await expect(page.locator('#choice-modal')).toContainText('let them win');
    await page.locator('#choice-modal .choice-btn').last().click();
    await expect.poll(() => page.evaluate(() => window.game.players[1].hand.length)).toBe(3);
});

test('FUN-A every wild decision keeps its prompt until a real color is selected', async ({ page }) => {
    for (const type of ['wild', 'meh', 'draw4Wild']) {
        await openTable(page, 'en');
        const cards = await positionForInsight(page, [type, 'normal']);
        await page.locator(`[data-card-id="${cards[0].id}"]`).click();
        await page.locator('#confirm-play-btn').click();
        await expect(page.locator('#decision-context')).toContainText('color');
        await expect(page.locator('#color-picker')).toBeVisible();
        await page.locator('.color-btn[data-color="orange"]').click();
        await expect(page.locator('#decision-context')).toBeHidden();
        expect(await page.evaluate(() => window.game.activeColor)).toBe('orange');
    }
});

test('FUN-B three ordinary bot turns return control sooner with an identical legal result', async ({ page }) => {
    const results = [];
    for (const legacy of [true, false]) {
        await openTable(page, 'en');
        await page.evaluate(useLegacy => {
            const game = window.game;
            game._cancelTurnWork();
            const pool = [...game.deck.cards, ...game.discardPile, ...game.players.flatMap(player => player.hand)];
            const name = pool.find(card => card.color === 'orange' && card.type === 'normal').name;
            const take = predicate => {
                const index = pool.findIndex(predicate);
                if (index < 0) throw new Error('Missing pacing fixture card');
                return pool.splice(index, 1)[0];
            };
            const normal = color => take(card => card.name === name && card.color === color);
            const typed = (color, type) => take(card => card.color === color && card.type === type);
            game.players[1].hand = [normal('orange'), typed('gray', 'sorry'), typed('gray', 'plato')];
            game.players[2].hand = [normal('purple'), typed('gray', 'hamour'), typed('gray', 'bestOne')];
            game.players[3].hand = [normal('gray'), typed('orange', 'sorry'), typed('orange', 'plato')];
            game.players[0].hand = [typed('gray', 'normal'), typed('black', 'wild')];
            game.discardPile = [typed('orange', 'normal')]; game.deck.cards = pool;
            game.currentPlayerIndex = 1; game.direction = 1; game.activeColor = 'orange';
            game.pendingDraws = 0; game.drawImmune = {}; game.skipNextMap = {};
            game.superpowersDisabled = false; game.humanCanPlay = false; game.actionInProgress = false;
            game.isAwaitingColor = false; game._decisionContext = null; game._cardDecision = null;
            game._actionJournal = []; game.hideConfirmBar();
            if (useLegacy) game._pace = (_kind, duration) => duration;
            const turn = game.playTurn;
            game._pacingStart = performance.now();
            game.playTurn = function() {
                const result = turn.call(this);
                if (this.currentPlayerIndex === 0 && this.humanCanPlay) this._pacingElapsed = performance.now() - this._pacingStart;
                return result;
            };
            game.updateUI(); game.playTurn();
        }, legacy);
        await expect.poll(() => page.evaluate(() => window.game._pacingElapsed || 0), { timeout: 12000 }).toBeGreaterThan(0);
        results.push(await page.evaluate(() => ({ elapsed: window.game._pacingElapsed,
            fingerprint: CoreEvidence.fingerprint(CoreEvidence.snapshot(window.game)),
            plays: window.game._actionJournal.filter(entry => entry.kind === 'play').map(entry => entry.text),
            count: window.game.players.reduce((sum, player) => sum + player.hand.length, 0) + window.game.deck.cards.length + window.game.discardPile.length,
        })));
    }
    expect(results[1].fingerprint).toBe(results[0].fingerprint);
    expect(results[1].plays).toEqual(results[0].plays);
    expect(results[1].count).toBe(60);
    expect(results[1].elapsed).toBeLessThan(results[0].elapsed * 0.65);
    console.log('FUN-B measured browser waiting (ms):', JSON.stringify(results.map(result => Math.round(result.elapsed))));
    await page.screenshot({ path: 'artifacts/fun-b-local-table.png' });
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
