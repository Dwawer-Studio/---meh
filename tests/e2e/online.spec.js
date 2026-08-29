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

async function configurePlayerPage(page, seed) {
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
        window.MEH_TELEMETRY_CONSENT = 'granted';
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

}

async function openPlayer(page, name, seed) {
    await configurePlayerPage(page, seed);
    await page.goto('/');
    await page.locator('#splash').waitFor({ state: 'detached' });
    await expect(page.locator('#profile-screen')).toHaveClass(/\bactive\b/);
    await page.locator('#show-create-profile').click();
    await page.locator('#profile-name-input').fill(name);
    await page.locator('#avatar-picker .avatar-option').first().click();
    await page.locator('#save-profile-btn').click();
    await expect(page.locator('#main-menu')).toHaveClass(/\bactive\b/);
}

async function openInvitedGuest(page, name, seed, inviteUrl) {
    await configurePlayerPage(page, seed);
    const invite = new URL(inviteUrl);
    await page.goto(`${invite.pathname}${invite.search}`);
    await page.locator('#splash').waitFor({ state: 'detached' });
    await expect(page.locator('#invite-screen')).toHaveClass(/\bactive\b/);
    await page.locator('#invite-guest-name').fill(name);
    await page.locator('#invite-join-btn').click();
    await expect(page.locator('#lobby-screen')).toHaveClass(/\bactive\b/);
}

async function expectLobby(page, names) {
    await expect(page.locator('#lobby-screen')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#lobby-players .lobby-player')).toHaveCount(names.length);
    for (const name of names) await expect(page.locator('#lobby-players')).toContainText(name);
}

async function cycleHostSignal(page) {
    const before = await page.evaluate(() => ProductTelemetry.export().events
        .filter(event => event.name === 'reconnect.completed').length);
    await page.evaluate(() => Net.peer.disconnect());
    await expect.poll(() => page.evaluate(() => Net.peer && Net.peer.disconnected)).toBe(true);
    await expect.poll(() => page.evaluate(() => Net.peer && !Net.peer.disconnected), { timeout: 5000 }).toBe(true);
    await expect.poll(() => page.evaluate(previous => ProductTelemetry.export().events
        .filter(event => event.name === 'reconnect.completed').length > previous, before)).toBe(true);
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

        await hostPage.locator('#majalis-nav-btn').click();
        await hostPage.locator('#create-room-btn').click();
        await expectLobby(hostPage, ['المضيف']);
        const roomCode = await hostPage.locator('#lobby-room-code').textContent();
        expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
        await hostPage.locator('#qr-invite-btn').click();
        await expect(hostPage.locator('#invite-qr-wrap')).not.toHaveClass(/\bhidden\b/);
        await expect(hostPage.locator('#invite-qr-image')).toHaveAttribute('src', /^data:image\/gif;base64,/);
        await cycleHostSignal(hostPage);
        await expectLobby(hostPage, ['المضيف']);

        await clientPage.locator('#majalis-nav-btn').click();
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
        expect(await hostPage.evaluate(() => game.players.filter(player => player.isBot).length)).toBe(2);
        await cycleHostSignal(hostPage);
        await expect(hostPage.locator('#game-screen')).toHaveClass(/\bactive\b/);

        await expect(hostPage.locator('#draw-pile')).toBeEnabled();
        await hostPage.locator('#draw-pile').click();
        await expect(hostPage.locator('#human-count')).toHaveText('8');
        await expect(clientPage.locator('#draw-pile')).toBeEnabled();

        await clientPage.locator('#draw-pile').click();
        await expect(clientPage.locator('#human-count')).toHaveText('8');
        await expect(hostPage.locator('#bot-1-count')).toHaveText('8');

        const tableConnectionId = await clientPage.evaluate(() => Net.hostConn.connectionId);
        await hostPage.evaluate(() => game.endGame(game.players[0]));
        await expect(hostPage.locator('#end-screen')).toHaveClass(/\bactive\b/);
        await expect(clientPage.locator('#end-screen')).toHaveClass(/\bactive\b/);
        await expect(hostPage.locator('#session-score')).toContainText('المضيف · 1');
        await expect(hostPage.locator('#restart-btn')).toContainText('جاهز');
        await cycleHostSignal(hostPage);
        await expect(hostPage.locator('#end-screen')).toHaveClass(/\bactive\b/);

        await hostPage.locator('#restart-btn').click();
        await clientPage.locator('#restart-btn').click();
        await expect(hostPage.locator('#game-screen')).toHaveClass(/\bactive\b/, { timeout: 5000 });
        await expect(clientPage.locator('#game-screen')).toHaveClass(/\bactive\b/);
        await expect(hostPage.locator('#human-hand .card')).toHaveCount(7);
        await expect(clientPage.locator('#human-hand .card')).toHaveCount(7);
        expect(await clientPage.evaluate(() => Net.hostConn.connectionId)).toBe(tableConnectionId);

        await hostPage.evaluate(() => game.endGame(game.players[0]));
        await expect(hostPage.locator('#end-screen')).toHaveClass(/\bactive\b/);
        await expect(clientPage.locator('#end-screen')).toHaveClass(/\bactive\b/);
        await expect(hostPage.locator('#session-score')).toContainText('المضيف · 2');
        const hostEventCounts = await hostPage.evaluate(() => ProductTelemetry.export().events
            .reduce((counts, event) => ({ ...counts, [event.name]: (counts[event.name] || 0) + 1 }), {}));
        expect(hostEventCounts['match.started']).toBe(2);
        expect(hostEventCounts['match.completed']).toBe(2);
        expect(hostEventCounts['rematch.ready']).toBe(1);
        expect(diagnostics, 'both browsers completed without runtime or resource errors').toEqual([]);
    } finally {
        await Promise.all([hostContext.close(), clientContext.close()]);
    }
});

test('an expired or unavailable invite stays contextual and can be retried', async ({ browser }) => {
    test.setTimeout(20_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    const diagnostics = [];
    collectDiagnostics(page, 'expired-invite', diagnostics);
    try {
        await configurePlayerPage(page, 0x1006);
        await page.goto('/?join=ABCDE&v=1');
        await page.locator('#splash').waitFor({ state: 'detached' });
        await expect(page.locator('#invite-screen')).toHaveClass(/\bactive\b/);
        await page.locator('#invite-guest-name').fill('ضيف منتهي');
        await page.evaluate(() => { Net._maxReconnectAttempts = 0; });
        await page.locator('#invite-join-btn').click();
        await expect(page.locator('#invite-screen')).toHaveClass(/\bactive\b/);
        await expect(page.locator('#invite-status')).toContainText('انتهت', { timeout: 12_000 });
        await expect(page.locator('#invite-join-btn')).toBeEnabled();
        expect(diagnostics).toEqual([]);
    } finally {
        await context.close();
    }
});

test('four browsers join by invite link and play two matches on one connection', async ({ browser }) => {
    test.setTimeout(60_000);
    const diagnostics = [];
    const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()));
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    pages.forEach((page, index) => collectDiagnostics(page, `player-${index}`, diagnostics));

    try {
        await openPlayer(pages[0], 'المضيف', 0x1001);
        await pages[0].locator('#majalis-nav-btn').click();
        await pages[0].locator('#create-room-btn').click();
        await expectLobby(pages[0], ['المضيف']);
        const inviteUrl = await pages[0].evaluate(() => game._activeInviteUrl);
        expect(inviteUrl).toMatch(/\?join=[A-HJ-NP-Z2-9]{5}&v=1$/);

        await Promise.all([
            openInvitedGuest(pages[1], 'ضيف ١', 0x1002, inviteUrl),
            openInvitedGuest(pages[2], 'ضيف ٢', 0x1003, inviteUrl),
            openInvitedGuest(pages[3], 'ضيف ٣', 0x1004, inviteUrl),
        ]);
        await expectLobby(pages[0], ['المضيف', 'ضيف ١', 'ضيف ٢', 'ضيف ٣']);

        const extraContext = await browser.newContext();
        const extraPage = await extraContext.newPage();
        collectDiagnostics(extraPage, 'extra-player', diagnostics);
        await configurePlayerPage(extraPage, 0x1005);
        const invite = new URL(inviteUrl);
        await extraPage.goto(`${invite.pathname}${invite.search}`);
        await extraPage.locator('#splash').waitFor({ state: 'detached' });
        await extraPage.locator('#invite-guest-name').fill('الخامس');
        await extraPage.locator('#invite-join-btn').click();
        await expect(extraPage.locator('#invite-screen')).toHaveClass(/\bactive\b/);
        await expect(extraPage.locator('#invite-status')).toContainText('ممتلئة');
        await extraContext.close();

        await pages[1].reload();
        await pages[1].locator('#splash').waitFor({ state: 'detached' });
        await expect(pages[1].locator('#invite-screen')).toHaveClass(/\bactive\b/);
        await pages[1].locator('#invite-guest-name').fill('ضيف ١');
        await pages[1].locator('#invite-join-btn').click();
        await expectLobby(pages[1], ['المضيف', 'ضيف ١', 'ضيف ٢', 'ضيف ٣']);

        await pages[0].locator('#lobby-start-btn').click();
        await Promise.all(pages.map(async page => {
            await expect(page.locator('#game-screen')).toHaveClass(/\bactive\b/);
            await expect(page.locator('#human-hand .card')).toHaveCount(7);
        }));
        expect(await pages[0].evaluate(() => game.players.filter(player => player.isBot).length)).toBe(0);

        await pages[2].reload();
        await pages[2].locator('#splash').waitFor({ state: 'detached' });
        await pages[2].locator('#invite-guest-name').fill('ضيف ٢');
        await pages[2].locator('#invite-join-btn').click();
        await expect(pages[2].locator('#game-screen')).toHaveClass(/\bactive\b/, { timeout: 5000 });

        await pages[0].evaluate(() => game.endGame(game.players[0]));
        await Promise.all(pages.map(page => expect(page.locator('#end-screen')).toHaveClass(/\bactive\b/)));

        await pages[3].reload();
        await pages[3].locator('#splash').waitFor({ state: 'detached' });
        await pages[3].locator('#invite-guest-name').fill('ضيف ٣');
        await pages[3].locator('#invite-join-btn').click();
        await expect(pages[3].locator('#end-screen')).toHaveClass(/\bactive\b/, { timeout: 5000 });

        const connectionIds = await Promise.all(pages.slice(1).map(page =>
            page.evaluate(() => Net.hostConn.connectionId)));
        await Promise.all(pages.map(page => page.locator('#restart-btn').click()));
        await Promise.all(pages.map(page => expect(page.locator('#game-screen')).toHaveClass(/\bactive\b/, { timeout: 5000 })));

        const afterRematchIds = await Promise.all(pages.slice(1).map(page =>
            page.evaluate(() => Net.hostConn.connectionId)));
        expect(afterRematchIds).toEqual(connectionIds);
        await pages[0].evaluate(() => game.endGame(game.players[0]));
        await Promise.all(pages.map(page => expect(page.locator('#end-screen')).toHaveClass(/\bactive\b/)));
        await expect(pages[0].locator('#session-score')).toContainText('المضيف · 2');
        expect(diagnostics, 'all four browsers completed without runtime or resource errors').toEqual([]);
    } finally {
        await Promise.all(contexts.map(context => context.close()));
    }
});
