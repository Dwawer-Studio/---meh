'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { PeerServer } = require('peer');
const { createServer } = require('../../tools/serve');

const peerScript = fs.readFileSync(
    path.join(path.dirname(require.resolve('peerjs')), 'peerjs.min.js'),
    'utf8',
);
const appPort = Number.parseInt(process.env.MEH_E2E_PORT || '4174', 10);
const peerPort = Number.parseInt(process.env.MEH_E2E_PEER_PORT || '9001', 10);
let appServer;
let signalServer;
let signalApp;

function listen(server, port) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
}

function close(server) {
    if (!server) return Promise.resolve();
    return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}

test.beforeAll(async () => {
    appServer = createServer();
    await listen(appServer, appPort);

    signalServer = await new Promise((resolve, reject) => {
        signalApp = PeerServer({
            host: '127.0.0.1',
            port: peerPort,
            path: '/meh',
        }, resolve);
        signalApp.once('error', reject);
    });
});

test.afterAll(async () => {
    await Promise.all([close(appServer), close(signalServer)]);
});

function collectDiagnostics(page, label, diagnostics) {
    page.on('pageerror', error => diagnostics.push(`${label} pageerror: ${error.message}`));
    page.on('console', message => {
        if (message.type() === 'error') diagnostics.push(`${label} console: ${message.text()}`);
    });
    page.on('response', response => {
        if (response.url().startsWith('http://127.0.0.1:') && response.status() >= 400) {
            diagnostics.push(`${label} response: ${response.status()} ${response.url()}`);
        }
    });
}

async function openPlayer(page, name, seed) {
    await page.route('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', route => route.fulfill({
        body: peerScript,
        contentType: 'text/javascript',
        status: 200,
    }));
    await page.addInitScript(({ playerSeed, localPeerPort }) => {
        Math.random = () => {
            playerSeed |= 0;
            playerSeed = playerSeed + 0x6D2B79F5 | 0;
            let value = Math.imul(playerSeed ^ playerSeed >>> 15, 1 | playerSeed);
            value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
            return ((value ^ value >>> 14) >>> 0) / 4294967296;
        };
        window.MEH_PEER_OPTIONS = Object.freeze({
            host: '127.0.0.1',
            port: localPeerPort,
            path: '/meh',
            secure: false,
            config: Object.freeze({ iceServers: Object.freeze([]) }),
        });
        localStorage.clear();
        localStorage.setItem('meh_settings', JSON.stringify({
            lang: 'ar',
            colorblind: false,
            batterySaver: true,
            wakeLock: false,
            confirmPlay: true,
            sound: false,
        }));
    }, { playerSeed: seed, localPeerPort: peerPort });

    await page.goto('/');
    await page.locator('#splash').waitFor({ state: 'detached' });
    await expect(page.locator('#profile-screen')).toHaveClass(/\bactive\b/);
    await page.locator('#show-create-profile').click();
    await page.locator('#profile-name-input').fill(name);
    await page.locator('#avatar-picker .avatar-option').first().click();
    await page.locator('#save-profile-btn').click();
    await expect(page.locator('#main-menu')).toHaveClass(/\bactive\b/);
}

async function expectLobby(page, names) {
    await expect(page.locator('#lobby-screen')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#lobby-players .lobby-player')).toHaveCount(names.length);
    for (const name of names) await expect(page.locator('#lobby-players')).toContainText(name);
}

test('two real browsers create, recover, start, and exchange online state', async ({ browser }) => {
    test.setTimeout(45_000);
    const diagnostics = [];
    const hostContext = await browser.newContext();
    const clientContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const clientPage = await clientContext.newPage();
    collectDiagnostics(hostPage, 'host', diagnostics);
    collectDiagnostics(clientPage, 'client', diagnostics);

    try {
        await openPlayer(hostPage, 'المضيف', 0x484F5354);
        await openPlayer(clientPage, 'الضيف', 0x434C4945);

        await hostPage.locator('#online-btn').click();
        await hostPage.locator('#create-room-btn').click();
        await expectLobby(hostPage, ['المضيف']);
        const roomCode = await hostPage.locator('#lobby-room-code').textContent();
        expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);

        await clientPage.locator('#online-btn').click();
        await clientPage.locator('#room-code-input').fill(roomCode);
        await clientPage.locator('#join-room-btn').click();
        await expectLobby(hostPage, ['المضيف', 'الضيف']);
        await expectLobby(clientPage, ['المضيف', 'الضيف']);

        const firstConnectionId = await clientPage.evaluate(() => Net.hostConn.connectionId);
        await clientPage.evaluate(() => Net.hostConn.close());
        await expect(clientPage.locator('#online-status')).toContainText('جاري الاستعادة');
        await expectLobby(hostPage, ['المضيف', 'الضيف']);
        await expectLobby(clientPage, ['المضيف', 'الضيف']);
        await expect.poll(() => clientPage.evaluate(previousId => (
            Net.hostConn && Net.hostConn.open && Net.hostConn.connectionId !== previousId
        ), firstConnectionId)).toBe(true);

        await hostPage.locator('#lobby-start-btn').click();
        await expect(hostPage.locator('#game-screen')).toHaveClass(/\bactive\b/);
        await expect(clientPage.locator('#game-screen')).toHaveClass(/\bactive\b/);
        await expect(hostPage.locator('#human-hand .card')).toHaveCount(7);
        await expect(clientPage.locator('#human-hand .card')).toHaveCount(7);

        await expect(hostPage.locator('#draw-pile')).toBeEnabled();
        await hostPage.locator('#draw-pile').click();
        await expect(hostPage.locator('#human-count')).toHaveText('8');
        await expect(clientPage.locator('#draw-pile')).toBeEnabled();

        await clientPage.locator('#draw-pile').click();
        await expect(clientPage.locator('#human-count')).toHaveText('8');
        await expect(hostPage.locator('#bot-1-count')).toHaveText('8');
        expect(diagnostics, 'both browsers completed without runtime or resource errors').toEqual([]);
    } finally {
        await Promise.all([hostContext.close(), clientContext.close()]);
    }
});
