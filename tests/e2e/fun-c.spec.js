'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { createServer } = require('../../tools/serve');
const peerScript = fs.readFileSync(path.join(path.dirname(require.resolve('peerjs')), 'peerjs.min.js'), 'utf8');
let server;
test.beforeAll(async () => {
    server = createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(process.env.MEH_E2E_PORT || 4174), '127.0.0.1', resolve); });
});
test.afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

async function boot(page, lang = 'ar') {
    await page.route('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', route => route.fulfill({ body: peerScript, contentType: 'text/javascript' }));
    await page.addInitScript(locale => {
        if (!localStorage.getItem('meh_settings')) localStorage.setItem('meh_settings', JSON.stringify({
            lang: locale, batterySaver: true, wakeLock: false, confirmPlay: true, sound: false, haptics: false,
        }));
        let seed = 0x10274633;
        Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
    }, lang);
    await page.goto('/');
    await page.locator('#splash').waitFor({ state: 'detached' });
    await page.locator('#show-create-profile').click();
    await page.locator('#profile-name-input').fill(lang === 'ar' ? 'مختبر التجربة' : 'Experience tester');
    await page.locator('#avatar-picker .avatar-option').first().click();
    await page.locator('#save-profile-btn').click();
}

async function chooseCard(page, type) {
    const id = await page.evaluate(kind => window.game.players[0].hand.find(card => card.type === kind).id, type);
    await page.locator(`#human-hand [data-card-id="${id}"]`).click();
    await page.locator('#confirm-play-btn').click();
}

async function coreState(page) {
    return page.evaluate(() => {
        const g = window.game;
        return { deck: g.deck.cards.map(c => c.id), hands: g.players.map(p => p.hand.map(c => c.id)),
            discard: g.discardPile.map(c => c.id), current: g.currentPlayerIndex, direction: g.direction,
            pending: g.pendingDraws, color: g.activeColor, shields: g.drawImmune, skipped: g.skipNextMap };
    });
}

// Only reload-case fixtures arrange a position. The full-match test below does
// not use this helper, mutate hands, skip turns or force a result.
async function arrange(page, type) {
    await page.evaluate(kind => {
        const g = window.game;
        g.startGame(); g._cancelTurnWork();
        g.deck = new Deck();
        const take = predicate => g.deck.cards.splice(g.deck.cards.findIndex(predicate), 1)[0];
        g.players.forEach(p => { p.hand = []; });
        g.players[0].hand = [take(c => c.type === kind && (c.color === 'orange' || c.color === 'black')),
            take(c => c.type === 'sorry' && c.color === 'gray'), take(c => c.type === 'normal' && c.color === 'purple')];
        g.discardPile = [take(c => c.type === 'normal' && c.color === 'orange')];
        for (const p of g.players.slice(1)) p.hand = g.deck.cards.splice(0, 7);
        g.currentPlayerIndex = 0; g.activeColor = 'orange'; g.pendingDraws = 0;
        g._beginLocalSession(); g.updateUI(); g.playTurn();
    }, type);
}

test('three optional training positions use real effects, retain 60 cards and never award results or overwrite a saved round', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await page.locator('#play-btn').click();
    const saved = await page.evaluate(() => localStorage.getItem(window.game._localSaveKey()));
    await page.locator('#solo-menu-btn').click();
    await page.locator('#solo-save-exit-btn').click();
    await page.locator('#solo-exit-confirm-btn').click();
    const record = await page.evaluate(() => JSON.stringify(Storage.getCurrentProfile()));
    await page.locator('#practice-home-btn').click();
    await chooseCard(page, 'normal');
    await expect(page.locator('#practice-next-btn')).toBeVisible();
    await page.locator('#practice-next-btn').click();
    await chooseCard(page, 'counterAttack');
    await expect(page.locator('#practice-next-btn')).toBeVisible();
    expect(await page.evaluate(() => window.game.players[3].hand.length)).toBe(11);
    await page.screenshot({ path: 'artifacts/fun-c-practice-counter.png' });
    await page.locator('#practice-next-btn').click();
    await chooseCard(page, 'boShlakh');
    await expect(page.locator('#decision-context')).toBeVisible();
    await chooseCard(page, 'sorry');
    await expect(page.locator('#practice-retry-btn')).toBeVisible();
    expect(await page.evaluate(() => window.game.players[0].hand.length)).toBe(1);
    const state = await coreState(page);
    expect(new Set([...state.deck, ...state.discard, ...state.hands.flat()]).size).toBe(60);
    expect(await page.evaluate(() => JSON.stringify(Storage.getCurrentProfile()))).toBe(record);
    expect(await page.evaluate(() => localStorage.getItem(window.game._localSaveKey()))).toBe(saved);
    await page.locator('#practice-play-btn').click();
    await expect(page.locator('#solo-resume-btn')).toBeVisible();
    await page.locator('#solo-new-btn').click();
    await expect(page.locator('#human-hand .card')).toHaveCount(7);
    expect(await page.evaluate(() => window.game._practice)).toBeNull();
});

for (const type of ['boShlakh', 'chameleon', 'wild']) {
    test(`reload resumes a mandatory ${type} decision from the same 60-card position`, async ({ page }) => {
        await boot(page, 'en'); await arrange(page, type);
        await page.evaluate(() => ProductTelemetry.setConsent('granted'));
        await chooseCard(page, type);
        if (type === 'chameleon') await page.locator('#player-picker-list button').first().click();
        await expect(page.locator(type === 'wild' ? '#color-picker' : '#decision-context')).toBeVisible();
        const before = await coreState(page);
        const committed = await page.evaluate(() => ProductTelemetry.queue.filter(event => ['action.committed', 'decision.completed'].includes(event.name)).length);
        if (type === 'wild') {
            await page.locator('#color-picker .solo-decision-pause').click();
            await page.locator('#solo-continue-btn').click();
            expect(await coreState(page)).toEqual(before);
        }
        await page.reload();
        await page.locator('#splash').waitFor({ state: 'detached' });
        await page.locator('#solo-resume-home-btn').click();
        await expect(page.locator(type === 'wild' ? '#color-picker' : '#decision-context')).toBeVisible();
        expect(await coreState(page)).toEqual(before);
        expect(await page.evaluate(() => ProductTelemetry.queue.filter(event => ['action.committed', 'decision.completed'].includes(event.name)).length)).toBe(committed);
        if (type === 'wild') await page.locator('.color-btn[data-color="gray"]').click();
        else await chooseCard(page, 'sorry');
        await expect.poll(() => page.evaluate(() => window.game.currentPlayerIndex)).not.toBe(0);
        const after = await coreState(page);
        expect(new Set([...after.deck, ...after.discard, ...after.hands.flat()]).size).toBe(60);
        expect(after.hands[0]).toHaveLength(type === 'wild' ? 2 : 1);
    });
}

test('pause freezes actual bots, settings return paused, exit confirms and resume retains the state', async ({ page }) => {
    await boot(page); await page.locator('#play-btn').click();
    await page.locator('#draw-pile').click();
    await page.locator('#solo-menu-btn').click();
    const before = await coreState(page);
    await page.waitForTimeout(1500);
    expect(await coreState(page)).toEqual(before);
    await page.locator('#solo-settings-btn').click();
    await page.locator('#settings-back-btn').click();
    await expect(page.locator('#solo-continue-btn')).toBeVisible();
    expect(await coreState(page)).toEqual(before);
    await page.locator('#solo-save-exit-btn').click();
    await page.locator('#solo-exit-cancel-btn').click();
    await expect(page.locator('#solo-continue-btn')).toBeVisible();
    await page.locator('#solo-save-exit-btn').click();
    await page.locator('#solo-exit-confirm-btn').click();
    await expect(page.locator('#solo-resume-home-btn')).toBeVisible();
});

test('saving failures are visible and optional telemetry records nothing before consent or after withdrawal', async ({ page }) => {
    await boot(page, 'en'); await page.locator('#play-btn').click();
    expect(await page.evaluate(() => ProductTelemetry.export().events)).toEqual([]);
    await page.locator('#solo-menu-btn').click(); await page.locator('#solo-settings-btn').click();
    await page.locator('#experience-consent').check();
    await page.locator('#settings-back-btn').click(); await page.locator('#solo-continue-btn').click();
    await page.locator('#human-hand .card').first().click();
    await page.locator('#cancel-play-btn').click();
    await page.evaluate(() => { Storage._write = () => false; window.game._checkpointLocal('turn'); });
    await expect(page.locator('#solo-save-warning')).toBeVisible();
    await page.locator('#solo-menu-btn').click(); await page.locator('#solo-settings-btn').click();
    const download = page.waitForEvent('download');
    await page.locator('#experience-export-btn').click();
    expect((await download).suggestedFilename()).toBe('meh-experience.json');
    const events = await page.evaluate(() => ProductTelemetry.export().events);
    expect(events.some(event => event.name === 'card.inspected')).toBe(true);
    expect(events.some(event => event.name === 'solo.paused')).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/Experience tester|cardId|svgFile|handIds/);
    await page.locator('#experience-consent').uncheck();
    expect(await page.evaluate(() => ProductTelemetry.export().events)).toEqual([]);
    await page.locator('#settings-back-btn').click(); await page.locator('#solo-continue-btn').click();
    await page.locator('#human-hand .card').first().click();
    expect(await page.evaluate(() => ProductTelemetry.export().events)).toEqual([]);
});

test('English landscape practice is skippable and replayable with keyboard controls and original art', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page, 'en');
    await page.locator('#practice-home-btn').focus(); await page.keyboard.press('Enter');
    await chooseCard(page, 'normal');
    await page.locator('#practice-retry-btn').focus(); await page.keyboard.press('Enter');
    await expect(page.locator('#human-hand .card')).toHaveCount(3);
    await expect(page.locator('#practice-panel')).toContainText('Practice 1/3');
    const images = await page.locator('#human-hand img').evaluateAll(nodes => nodes.map(img => ({ loaded: img.complete && img.naturalWidth > 0, src: img.getAttribute('src') })));
    expect(images.every(img => img.loaded && img.src.startsWith('assets/cards/'))).toBe(true);
    await page.screenshot({ path: 'artifacts/fun-c-practice-landscape.png' });
    await page.locator('#practice-play-btn').click();
    await expect(page.locator('#human-hand .card')).toHaveCount(7);
    await expect(page.locator('#practice-panel')).toBeHidden();
});

test('agent plays an ordinary complete 4-seat 7-card round through the real UI, then rematches', async ({ page }) => {
    test.setTimeout(240000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page); await page.locator('#play-btn').click();
    expect((await coreState(page)).hands.map(hand => hand.length)).toEqual([7, 7, 7, 7]);
    const started = Date.now(); let inputs = 0;
    for (let iteration = 0; iteration < 1800; iteration++) {
        // Decision policy reads only our hand and public/visible legal controls.
        const choice = await page.evaluate(() => {
            const g = window.game;
            if (document.getElementById('end-screen').classList.contains('active')) return { kind: 'end' };
            if (!document.getElementById('color-picker').classList.contains('hidden')) return { kind: 'color' };
            if (!document.getElementById('player-picker').classList.contains('hidden')) return { kind: 'target' };
            if (!document.getElementById('choice-modal').classList.contains('hidden')) return { kind: 'choice' };
            const candidates = g.players[0].hand.filter(card => g._cardDecision
                ? g._cardDecision.ids.includes(card.id) : g.humanCanPlay && !g.actionInProgress && g.isCardPlayableNow(card));
            const burden = card => ['sorry', 'hamour', 'plato'].includes(card.type);
            candidates.sort((a, b) => g._cardDecision ? Number(burden(b)) - Number(burden(a))
                : Number(burden(a)) - Number(burden(b)) || Number(a.color === 'black') - Number(b.color === 'black'));
            if (candidates.length) return { kind: 'card', id: candidates[0].id };
            if (g.humanCanPlay && !g.actionInProgress && !g._cardDecision) return { kind: 'draw' };
            return { kind: 'wait' };
        });
        if (choice.kind === 'end') break;
        if (choice.kind === 'card') {
            await page.locator(`#human-hand [data-card-id="${choice.id}"]`).click();
            await page.locator('#confirm-play-btn').click(); inputs++;
        } else if (choice.kind === 'color') { await page.locator('.color-btn[data-color="orange"]').click(); inputs++; }
        else if (choice.kind === 'target') { await page.locator('#player-picker-list button').first().click(); inputs++; }
        else if (choice.kind === 'choice') { await page.locator('#choice-modal .choice-btn').nth(1).click(); inputs++; }
        else if (choice.kind === 'draw') { await page.locator('#draw-pile').click(); inputs++; }
        else await page.waitForTimeout(100);
    }
    await expect(page.locator('#end-screen')).toHaveClass(/\bactive\b/);
    const finished = await coreState(page);
    expect(finished.hands.some(hand => hand.length === 0)).toBe(true);
    expect(new Set([...finished.deck, ...finished.discard, ...finished.hands.flat()]).size).toBe(60);
    expect(errors).toEqual([]);
    await expect(page.locator('.solo-score-row')).toHaveCount(4);
    expect(await page.evaluate(() => window.game._localSeries.rounds)).toBe(1);
    expect(await page.evaluate(() => window.game._readLocalCheckpoint())).toBeNull();
    await page.screenshot({ path: 'artifacts/fun-c-real-round-result.png' });
    console.log(JSON.stringify({ evidence: 'ordinary-ui-round', durationMs: Date.now() - started, inputs,
        remaining: finished.hands.map(hand => hand.length), errors }));
    await page.locator('#restart-btn').click();
    await expect(page.locator('#human-hand .card')).toHaveCount(7);
    await expect(page.locator('#table-round-label')).toContainText('2');
    await page.locator('#solo-menu-btn').click();
});
