'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { RealtimeRuntime } = require('../../server/runtime');
const { MemoryStore } = require('../../server/stores/memory-store');
const { MatchReducer } = require('../../shared/match-reducer');
const { MEH_CORE_MANIFEST, MEH_CATALOG_MANIFEST } = require('../../game/game-manifests');
const { createServer } = require('../../tools/serve');

const peerScript = fs.readFileSync(
    path.join(path.dirname(require.resolve('peerjs')), 'peerjs.min.js'),
    'utf8',
);
const appPort = Number.parseInt(process.env.MEH_E2E_PORT || '4174', 10);
const servicePort = Number.parseInt(process.env.MEH_E2E_SERVICE_PORT || '8788', 10);
const origin = `http://127.0.0.1:${appPort}`;
let appServer;
let runtime;

function listen(server, port) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
}

test.beforeAll(async () => {
    appServer = createServer();
    await listen(appServer, appPort);
    runtime = new RealtimeRuntime({
        store: new MemoryStore(),
        pepper: 'browser-e2e-pepper-at-least-32-characters',
        allowedOrigins: [origin],
        p4Features: {
            cardCatalog: true, tamashiWallet: true, friendlyRecipes: true, verifiedIap: false,
        },
    });
    await runtime.listen(servicePort, '127.0.0.1');
});

test.afterAll(async () => {
    if (runtime) await runtime.close();
    if (appServer) await new Promise(resolve => appServer.close(resolve));
});

test('browser quick play is rendered from the authoritative service and blocks local dev mutation',
    { timeout: 30_000 }, async ({ page }) => {
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
        await page.route('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', route => route.fulfill({
            body: peerScript,
            contentType: 'text/javascript',
            status: 200,
        }));
        await page.addInitScript(({ realtimeUrl, httpUrl }) => {
            window.MEH_SERVICE_URL = realtimeUrl;
            window.MEH_SERVICE_HTTP_URL = httpUrl;
            localStorage.clear();
            localStorage.setItem('meh_settings', JSON.stringify({
                lang: 'ar', colorblind: false, batterySaver: true,
                wakeLock: false, confirmPlay: true, sound: false, haptics: false,
            }));
        }, {
            realtimeUrl: `ws://127.0.0.1:${servicePort}/v1/realtime`,
            httpUrl: `http://127.0.0.1:${servicePort}`,
        });

        await page.goto('/');
        await page.locator('#splash').waitFor({ state: 'detached' });
        await page.locator('#show-create-profile').click();
        await page.locator('#profile-name-input').fill('مختبر الخدمة');
        await page.locator('#avatar-picker .avatar-option').first().click();
        await page.locator('#save-profile-btn').click();
        await page.locator('#online-btn').click();
        await expect(page.locator('#quick-play-btn')).toBeVisible();
        await page.locator('#quick-play-btn').click();

        await expect(page.locator('#game-screen')).toHaveClass(/\bactive\b/);
        await expect(page.locator('#human-hand .card')).toHaveCount(7);
        await expect(page.locator('#draw-pile')).toBeEnabled();
        const authority = await page.evaluate(() => ({
            connected: !!(game._authoritativeClient && game._authoritativeClient.socket),
            clientIsHost: game.isHost,
            phase: game._authoritativeSnapshot.payload.room.phase,
            opponentHandsLeaked: game._authoritativeSnapshot.payload.match.others.some(player => 'hand' in player),
            deckLeaked: 'deck' in game._authoritativeSnapshot.payload.match,
        }));
        expect(authority).toEqual({
            connected: true,
            clientIsHost: false,
            phase: 'IN_MATCH',
            opponentHandsLeaked: false,
            deckLeaked: false,
        });

        const oldRecoveryToken = await page.evaluate(() => {
            const client = game._authoritativeClient;
            const token = client.recoveryToken;
            client.socket.close(4000, 'test disconnect');
            return token;
        });
        await expect.poll(() => page.evaluate(() => !!(game._authoritativeClient
            && game._authoritativeClient.socket
            && game._authoritativeClient.socket.readyState === WebSocket.OPEN)),
        { timeout: 10_000 }).toBe(true);
        await expect.poll(() => page.evaluate(() => game._authoritativeClient.recoveryToken),
        { timeout: 10_000 }).not.toBe(oldRecoveryToken);

        await page.locator('#draw-pile').click();
        await expect.poll(() => page.locator('#human-count').textContent()).not.toBe('7');
        await page.keyboard.press('Control+Shift+D');
        await expect(page.locator('#dev-panel')).toHaveClass(/\bhidden\b/);
        expect(diagnostics).toEqual([]);
    });

test('browser creates a consent-bound Majlis from results and regroups it from the recent list',
    { timeout: 30_000 }, async ({ page }) => {
        const diagnostics = [];
        page.on('pageerror', error => diagnostics.push(`pageerror: ${error.message}`));
        page.on('console', message => {
            if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`);
        });
        await page.route('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', route => route.fulfill({
            body: peerScript, contentType: 'text/javascript', status: 200,
        }));
        await page.addInitScript(({ realtimeUrl, httpUrl }) => {
            window.MEH_SERVICE_URL = realtimeUrl;
            window.MEH_SERVICE_HTTP_URL = httpUrl;
            window.MEH_FEATURE_FLAGS = {
                recent_majalis: true,
                one_tap_reinvite: true,
                majlis_session_score: true,
                majlis_schedule: true,
                safe_quick_chat: true,
            };
            localStorage.clear();
            sessionStorage.clear();
            localStorage.setItem('meh_settings', JSON.stringify({
                lang: 'ar', colorblind: false, batterySaver: true,
                wakeLock: false, confirmPlay: true, sound: false, haptics: false,
            }));
        }, {
            realtimeUrl: `ws://127.0.0.1:${servicePort}/v1/realtime`,
            httpUrl: `http://127.0.0.1:${servicePort}`,
        });

        await page.goto('/');
        await page.locator('#splash').waitFor({ state: 'detached' });
        await page.locator('#show-create-profile').click();
        await page.locator('#profile-name-input').fill('صاحب المجلس');
        await page.locator('#avatar-picker .avatar-option').first().click();
        await page.locator('#save-profile-btn').click();
        await page.locator('#online-btn').click();
        await expect(page.locator('#recent-majalis')).toBeVisible();
        await page.locator('#create-room-btn').click();
        await expect(page.locator('#lobby-screen')).toHaveClass(/\bactive\b/);

        const roomId = await page.evaluate(() => game._authoritativeSnapshot.payload.room.roomId);
        const current = await runtime.store.getRoom(roomId);
        const second = await runtime.accounts.createGuest('عضو موافق لاحقًا');
        current.seats[1] = {
            ...current.seats[1], accountId: second.account.accountId,
            displayName: second.account.displayName, isBot: false, status: 'CONNECTED', ready: false,
            connectionSessionId: 'conn_browser_second_0001',
        };
        const matchId = 'match_browser_majlis_0001';
        const matchState = MatchReducer.createMatch({
            seed: 81, matchId, coreManifest: MEH_CORE_MANIFEST,
            catalogManifest: MEH_CATALOG_MANIFEST,
            deckRecipeId: current.room.deckRecipeId,
            players: current.seats.map(seat => ({ id: seat.seatId, isBot: seat.isBot })),
        });
        matchState.phase = 'COMPLETE';
        matchState.winnerId = current.seats[0].seatId;
        current.room.phase = 'RESULTS';
        current.room.matchId = matchId;
        current.room.matchState = matchState;
        current.room.stateVersion = matchState.stateVersion;
        current.room.serverSeq++;
        await runtime.store.updateRoomAndSeats(current.room, current.seats);
        await page.evaluate(() => game._authoritativeClient.requestSnapshot());

        await expect(page.locator('#end-screen')).toHaveClass(/\bactive\b/);
        await expect(page.locator('#majlis-result-panel')).toBeVisible();
        await expect(page.locator('#majlis-create-controls')).toBeVisible();
        await page.locator('#majlis-name-input').fill('مجلس المختبر');
        await page.locator('#majlis-banner-select').selectOption('dhow');
        await page.locator('#majlis-theme-select').selectOption('sea');
        await page.locator('#majlis-create-btn').click();
        await expect(page.locator('#majlis-detail')).toBeVisible();
        await expect(page.locator('#majlis-result-status')).toContainText('مجلس المختبر');
        await expect(page.locator('.majlis-score-list')).toHaveCount(1);

        await page.locator('#end-menu-btn').click();
        await expect(page.locator('#main-menu')).toHaveClass(/\bactive\b/);
        await page.locator('#online-btn').click();
        await expect(page.locator('.majlis-card')).toHaveCount(1);
        await expect(page.locator('.majlis-card')).toContainText('مجلس المختبر');
        await page.locator('.majlis-regroup-btn').click();
        await expect(page.locator('#lobby-screen')).toHaveClass(/\bactive\b/);
        const regroupedMajlisId = await page.evaluate(() =>
            game._authoritativeSnapshot.payload.room.majlisId);
        expect(regroupedMajlisId).toMatch(/^majlis_/);
        expect(diagnostics).toEqual([]);
    });

test('card store separates sale inventory from the classic collection and fits a phone',
    { timeout: 30_000 }, async ({ page }) => {
        const diagnostics = [];
        page.on('pageerror', error => diagnostics.push(`pageerror: ${error.message}`));
        page.on('console', message => {
            if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`);
        });
        await page.route('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', route => route.fulfill({
            body: peerScript, contentType: 'text/javascript', status: 200,
        }));
        await page.addInitScript(({ realtimeUrl, httpUrl }) => {
            window.MEH_SERVICE_URL = realtimeUrl;
            window.MEH_SERVICE_HTTP_URL = httpUrl;
            window.MEH_FEATURE_FLAGS = {
                card_catalog: true,
                tamashi_wallet: true,
                card_lab: true,
                friendly_recipes: true,
            };
            localStorage.clear();
            sessionStorage.clear();
            localStorage.setItem('meh_settings', JSON.stringify({
                lang: 'ar', colorblind: false, batterySaver: true,
                wakeLock: false, confirmPlay: true, sound: false, haptics: false,
            }));
        }, {
            realtimeUrl: `ws://127.0.0.1:${servicePort}/v1/realtime`,
            httpUrl: `http://127.0.0.1:${servicePort}`,
        });

        await page.goto('/');
        await page.locator('#splash').waitFor({ state: 'detached' });
        await page.locator('#show-create-profile').click();
        await page.locator('#profile-name-input').fill('مختبر الكتالوج');
        await page.locator('#avatar-picker .avatar-option').first().click();
        await page.locator('#save-profile-btn').click();
        await expect(page.locator('#catalog-btn')).toBeVisible();
        await page.locator('#catalog-btn').click();
        await expect(page.locator('#catalog-screen')).toHaveClass(/\bactive\b/);
        await expect(page.locator('#catalog-store-tab')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('#catalog-store-count')).toHaveText('0');
        await expect(page.locator('#catalog-collection-count')).toHaveText('22');
        await expect(page.locator('#catalog-list .catalog-card')).toHaveCount(0);
        await expect(page.locator('.store-empty-state')).toContainText('لا توجد بطاقات جديدة معروضة الآن');
        await expect(page.locator('#tamashi-balance strong')).toHaveText(/^[0٠]$/);
        await expect(page.locator('#tamashi-completion-reward')).toHaveText(/^\+(?:100|١٠٠)$/);
        await expect(page.locator('#tamashi-healthy-reward')).toHaveText(/^\+(?:20|٢٠)$/);
        await expect(page.locator('#tamashi-win-reward')).toHaveText(/^\+(?:20|٢٠)$/);
        await expect(page.locator('#catalog-list .catalog-buy')).toHaveCount(0);
        await page.locator('#catalog-collection-tab').click();
        await expect(page.locator('#catalog-collection-tab')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('#catalog-list .catalog-card')).toHaveCount(22);
        expect(await page.locator('#catalog-list img').evaluateAll(images =>
            images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
        await expect(page.locator('#catalog-list .catalog-card').first()).toContainText('متاحة');

        await page.locator('#catalog-back-btn').click();
        await page.locator('#menu-settings-btn').click();
        await page.locator('.lang-btn[data-lang="en"]').click();
        await page.locator('#settings-back-btn').click();
        await page.locator('#catalog-btn').click();
        await expect(page.locator('#catalog-store-tab')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('.store-empty-state')).toContainText('No new cards are on sale right now');
        await page.locator('#catalog-collection-tab').click();
        await expect(page.locator('#catalog-list .catalog-card').first()).toContainText('Hush Hush');
        await expect(page.locator('#catalog-list .catalog-card').first()).toContainText('Available');
        expect(await page.locator('html').getAttribute('dir')).toBe('ltr');

        await page.setViewportSize({ width: 360, height: 800 });
        const mobile = await page.evaluate(() => ({
            viewport: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            refreshHeight: document.getElementById('catalog-refresh-btn').getBoundingClientRect().height,
            backHeight: document.getElementById('catalog-back-btn').getBoundingClientRect().height,
            storeTabHeight: document.getElementById('catalog-store-tab').getBoundingClientRect().height,
            collectionTabHeight: document.getElementById('catalog-collection-tab').getBoundingClientRect().height,
        }));
        expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.viewport);
        expect(mobile.refreshHeight).toBeGreaterThanOrEqual(44);
        expect(mobile.backHeight).toBeGreaterThanOrEqual(44);
        expect(mobile.storeTabHeight).toBeGreaterThanOrEqual(44);
        expect(mobile.collectionTabHeight).toBeGreaterThanOrEqual(44);
        expect(diagnostics).toEqual([]);
    });
