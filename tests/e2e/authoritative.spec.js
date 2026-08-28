'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { RealtimeRuntime } = require('../../server/runtime');
const { MemoryStore } = require('../../server/stores/memory-store');
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
