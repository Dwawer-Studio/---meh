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
        window.MEH_FEATURE_FLAGS = {
            persistent_table: true,
            session_score: true,
            safe_quick_chat: true,
            recent_majalis: true,
            one_tap_reinvite: true,
        };
        localStorage.setItem('meh_settings', JSON.stringify({
            lang: selectedLang, colorblind: false, batterySaver: true,
            wakeLock: false, confirmPlay: true, sound: false, haptics: false,
        }));
    }, lang);
    await page.goto('/');
    await page.locator('#splash').waitFor({ state: 'detached' });
    await page.locator('#show-create-profile').click();
    await page.locator('#profile-name-input').fill(lang === 'ar' ? 'مختبر المجلس' : 'Majlis tester');
    await page.locator('#avatar-picker .avatar-option').first().click();
    await page.locator('#save-profile-btn').click();
}

async function showLobby(page) {
    await page.evaluate(() => {
        game.lobbyPlayers = [
            { id: 'host', name: I18n.lang === 'ar' ? 'نورة' : 'Noura', avatar: 'ن', host: true },
            { id: 'guest-1', name: I18n.lang === 'ar' ? 'سلمان' : 'Salman', avatar: 'س', host: false },
        ];
        document.getElementById('lobby-room-code').textContent = 'MEH42';
        document.getElementById('lobby-start-btn').classList.remove('hidden');
        document.getElementById('invite-actions').classList.remove('hidden');
        game.renderLobby();
        game.showScreen('lobby-screen');
    });
}

async function showTableResults(page) {
    await page.evaluate(() => {
        game.tableSession = null;
        game.tableSnapshot = {
            schemaVersion: 1,
            tableId: 'MEH42',
            phase: 'RESULTS',
            matchNumber: 2,
            maxSeats: 4,
            seats: [
                { seatId: 'seat-0', displayName: 'Noura', avatar: 'ن', host: true, kind: 'human', controller: 'human', connected: true, ready: true, score: 1, wins: 1 },
                { seatId: 'seat-1', displayName: 'Salman', avatar: 'س', host: false, kind: 'human', controller: 'human', connected: true, ready: false, score: 3, wins: 1 },
                { seatId: 'seat-2', displayName: 'Dana', avatar: 'د', host: false, kind: 'human', controller: 'human', connected: true, ready: true, score: 2, wins: 0 },
                { seatId: 'seat-3', displayName: 'Bot', avatar: 'ب', host: false, kind: 'bot', controller: 'bot', connected: true, ready: true, score: 0, wins: 0 },
            ],
        };
        game._localReady = false;
        UI.winnerText.textContent = I18n.t('you_win');
        game._updateResultPresentation(true, 'Noura');
        game._renderPersonalRecord();
        game._renderTableResults();
        game.showScreen('end-screen');
    });
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

async function auditActiveScreen(page, selector) {
    return page.evaluate(activeSelector => {
        const screen = document.querySelector(activeSelector);
        const visible = element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden'
                && rect.width > 0 && rect.height > 0;
        };
        const rects = [...screen.querySelectorAll('button, input, select, .lobby-player, .lobby-seat-empty')]
            .filter(visible)
            .map(element => {
                const rect = element.getBoundingClientRect();
                return { label: element.id || element.className, left: rect.left, right: rect.right };
            });
        return {
            viewportWidth: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            screenWidth: screen.scrollWidth,
            rects,
        };
    }, selector);
}

test('UIX-4 lobby exposes the invitation and exactly four explicit seats in Arabic and English', async ({ page }) => {
    const diagnostics = trackDiagnostics(page);
    await page.setViewportSize({ width: 393, height: 852 });
    await openApp(page, 'ar');
    await showLobby(page);

    await expect(page.locator('#lobby-screen')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#lobby-room-code')).toHaveText('MEH42');
    await expect(page.locator('#lobby-players > li')).toHaveCount(4);
    await expect(page.locator('#lobby-players .lobby-player')).toHaveCount(2);
    await expect(page.locator('#lobby-players .lobby-seat-empty')).toHaveCount(2);
    await expect(page.locator('#lobby-seat-status')).toHaveText('2 من 4');
    await expect(page.locator('#share-invite-btn')).toBeVisible();
    await expect(page.locator('#qr-invite-btn')).toBeVisible();
    await expect(page.locator('#turn-time-select')).toHaveAccessibleName(/وقت الدور/);
    await expect(page.locator('#lobby-title')).toBeFocused();

    const arAudit = await auditActiveScreen(page, '#lobby-screen');
    expect(arAudit.documentWidth).toBeLessThanOrEqual(arAudit.viewportWidth + 1);
    expect(arAudit.screenWidth).toBeLessThanOrEqual(arAudit.viewportWidth + 1);
    for (const rect of arAudit.rects) {
        expect(rect.left, `${rect.label} left`).toBeGreaterThanOrEqual(-1);
        expect(rect.right, `${rect.label} right`).toBeLessThanOrEqual(arAudit.viewportWidth + 1);
    }
    expect(diagnostics).toEqual([]);
});

test('UIX-4 mirrors the lobby hierarchy and labels in English/LTR', async ({ page }) => {
    await page.setViewportSize({ width: 932, height: 430 });
    await openApp(page, 'en');
    await showLobby(page);

    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('#lobby-title')).toHaveText('Lobby');
    await expect(page.locator('#lobby-seat-status')).toHaveText('2 of 4');
    await expect(page.locator('#lobby-players > li')).toHaveCount(4);
    await expect(page.locator('#turn-time-select')).toHaveAccessibleName('Turn time for this table');
    await expect(page.locator('#share-invite-btn')).toContainText('Share invite');
});

test('UIX-4 result hierarchy ranks the session and makes readiness/rematch explicit', async ({ page }) => {
    const diagnostics = trackDiagnostics(page);
    await page.setViewportSize({ width: 932, height: 430 });
    await openApp(page, 'en');
    await showTableResults(page);

    await expect(page.locator('#end-screen')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#end-screen')).toHaveAttribute('data-outcome', 'win');
    await expect(page.locator('#winner-text')).toHaveText('Nicely played. You won.');
    await expect(page.locator('#result-mark')).toHaveText('N');
    await expect(page.locator('#result-board')).toBeVisible();
    await expect(page.locator('.session-score-seat')).toHaveCount(4);
    const rankedNames = await page.locator('.session-score-player').allTextContents();
    expect(rankedNames).toEqual(['س Salman · ', 'د Dana · ', 'ن Noura · ', 'ب Bot · ']);
    await expect(page.locator('#session-score-hint')).toHaveText('After 2 rounds');
    await expect(page.locator('#table-ready-list .ready-seat')).toHaveCount(3);
    await expect(page.locator('#table-ready-list .ready-seat.is-ready')).toHaveCount(2);
    await expect(page.locator('#rematch-title')).toHaveText('2 of 3 ready');
    await expect(page.locator('#restart-btn')).toHaveText('Ready for the next match');
    await expect(page.locator('#share-result-btn')).toBeVisible();
    await expect(page.locator('#winner-text')).toBeFocused();

    const audit = await auditActiveScreen(page, '#end-screen');
    expect(audit.documentWidth).toBeLessThanOrEqual(audit.viewportWidth + 1);
    expect(audit.screenWidth).toBeLessThanOrEqual(audit.viewportWidth + 1);
    for (const rect of audit.rects) {
        expect(rect.left, `${rect.label} left`).toBeGreaterThanOrEqual(-1);
        expect(rect.right, `${rect.label} right`).toBeLessThanOrEqual(audit.viewportWidth + 1);
    }
    expect(diagnostics).toEqual([]);
});

test('UIX-4 quick chat stays phrase-only and exposes mute/report safety controls', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await openApp(page, 'ar');
    await page.evaluate(() => {
        game._authoritativeClient = { seatId: 'seat-0' };
        game._majlisRoom = { mode: 'quick' };
        game._majlisSeats = [
            { seatId: 'seat-0', displayName: 'أنا', isBot: false },
            { seatId: 'seat-1', displayName: 'لاعب آخر', isBot: false },
        ];
        document.getElementById('quick-chat-control').classList.remove('hidden');
        game._renderQuickChatPhrases();
        game.showScreen('game-screen');
        document.getElementById('quick-chat-toggle').focus();
        game._setQuickChatOpen(true);
    });

    await expect(page.locator('#quick-chat-panel')).toBeVisible();
    await expect(page.locator('#quick-chat-close')).toBeFocused();
    await expect(page.locator('#quick-chat-phrases button')).toHaveCount(6);
    await expect(page.locator('#quick-chat-panel input, #quick-chat-panel textarea')).toHaveCount(0);
    await expect(page.locator('#table-safety-list .table-safety-row')).toHaveCount(1);
    await expect(page.locator('#table-safety-list .compact-action').first()).toHaveText('كتم');
    await expect(page.locator('#table-safety-list select')).toHaveCount(1);
    await expect(page.locator('#table-safety-list .danger-action')).toHaveText('إبلاغ');
    const panelRect = await page.locator('#quick-chat-panel').boundingBox();
    expect(panelRect.x).toBeGreaterThanOrEqual(0);
    expect(panelRect.x + panelRect.width).toBeLessThanOrEqual(394);
    await page.keyboard.press('Escape');
    await expect(page.locator('#quick-chat-panel')).toBeHidden();
    await expect(page.locator('#quick-chat-toggle')).toBeFocused();
});

for (const viewport of [
    { name: 'reference portrait', width: 393, height: 852 },
    { name: 'compact landscape', width: 844, height: 390 },
    { name: 'reference landscape', width: 932, height: 430 },
    { name: 'tablet portrait', width: 768, height: 1024 },
]) {
    test(`UIX-4 lobby and results avoid horizontal clipping at ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await openApp(page, 'ar');
        await showLobby(page);
        for (const selector of ['#lobby-screen']) {
            const audit = await auditActiveScreen(page, selector);
            expect(audit.documentWidth).toBeLessThanOrEqual(audit.viewportWidth + 1);
            expect(audit.screenWidth).toBeLessThanOrEqual(audit.viewportWidth + 1);
        }
        await showTableResults(page);
        const resultsAudit = await auditActiveScreen(page, '#end-screen');
        expect(resultsAudit.documentWidth).toBeLessThanOrEqual(resultsAudit.viewportWidth + 1);
        expect(resultsAudit.screenWidth).toBeLessThanOrEqual(resultsAudit.viewportWidth + 1);
    });
}
