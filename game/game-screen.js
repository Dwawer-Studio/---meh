'use strict';

class MehGameScreenModule {
    // ============ التعليمات (متعددة اللغات) ============
    renderInstructions() {
        const nameFor = (ar) => (I18n.lang === 'ar') ? ar : ((I18n.cards[ar] && I18n.cards[ar].en) || ar);
        const make = (item) =>
            `<div class="rule-card"><img src="assets/cards/${item.img}.webp" alt="">
             <div><strong>${nameFor(item.ar)}</strong><br>${I18n.cardDesc(item.ar)}</div></div>`;
        const sp = document.getElementById('special-cards-list');
        const pw = document.getElementById('power-cards-list');
        if (sp) sp.innerHTML = INSTR_SPECIAL.map(make).join('');
        if (pw) pw.innerHTML = INSTR_POWER.map(make).join('');
    }

    bindDevEvents() {
        const toggleBtn = document.getElementById('dev-toggle-btn');
        const closeBtn = document.getElementById('dev-close-btn');
        const panel = document.getElementById('dev-panel');
        if (toggleBtn) toggleBtn.onclick = () => {
            if (!this._authoritativeClient) panel.classList.toggle('hidden');
        };
        if (closeBtn) closeBtn.onclick = () => panel.classList.add('hidden');
        // اختصار سرّي للمطوّر فقط (الزر مخفي عن اللاعبين)
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
                e.preventDefault();
                if (!this._authoritativeClient) panel.classList.toggle('hidden');
            }
        });

        document.getElementById('dev-reveal-btn').onclick = () => {
            if (this._authoritativeClient) return;
            this.devShowBotHands = !this.devShowBotHands;
            this.updateUI();
            this.showToast(this.devShowBotHands ? 'تم كشف أوراق البوتات 👁️' : 'تم إخفاء الأوراق 🔒');
        };
        document.getElementById('dev-skip-btn').onclick = () => {
            if (this._authoritativeClient) return;
            this.showToast('تم تخطي الدور ⏩');
            this.advanceTurn();
        };
        document.getElementById('dev-color-btn').onclick = () => {
            if (this._authoritativeClient) return;
            if (!this.topCard) return;
            this.isAwaitingColor = true;
            this.setDialogOpen(UI.colorPicker, true);
            this.showToast('اختر لوناً جديداً 🎨');
        };
        document.getElementById('dev-draw-btn').onclick = () => {
            if (this._authoritativeClient) return;
            this.showToast('سحب 4 بطاقات للاعب الحالي 🃏');
            this.pendingDraws += 4;
            this.playTurn();
        };
        document.getElementById('dev-win-btn').onclick = () => {
            if (this._authoritativeClient) return;
            this.endGame(this.players[0]);
        };
    }

    bindMenuEvents() {
        this._initializeScreenHistory();
        document.getElementById('play-btn').addEventListener('click', () => this.startGame());
        document.getElementById('local-play-btn').addEventListener('click', () => this.startGame());
        const openPlayCenter = () => this.showScreen('play-center-screen');
        document.getElementById('play-options-btn').addEventListener('click', openPlayCenter);
        document.getElementById('home-social-btn').addEventListener('click', openPlayCenter);
        document.getElementById('play-center-back-btn').addEventListener('click', () => this.navigateBack('main-menu'));
        document.getElementById('instructions-btn').addEventListener('click', () => this.showScreen('instructions-screen'));
        document.getElementById('back-btn').addEventListener('click', () => this.navigateBack('play-center-screen'));
        document.getElementById('home-nav-btn').addEventListener('click', () => this.showScreen('main-menu', { replaceHistory: true }));
        document.getElementById('majalis-nav-btn').addEventListener('click', () => document.getElementById('online-btn').click());
        document.getElementById('share-result-btn').addEventListener('click', () => this._shareResult());
        document.getElementById('restart-btn').addEventListener('click', () => {
            const tablePhase = this.tableSession ? this.tableSession.phase : this.tableSnapshot && this.tableSnapshot.phase;
            if (tablePhase === TABLE_PHASES.RESULTS) {
                this._markLocalReady();
                return;
            }
            this._trackProductEvent('rematch.ready', { mode: this._productMode() });
            this.startGame();
        });
        document.getElementById('end-menu-btn').addEventListener('click', () => {
            if (this.tableSession || this.tableSnapshot) {
                this._leaveOnlineSession('main-menu');
                return;
            }
            this._productCompleteTable('results-exit');
            this.showScreen('main-menu');
        });
    }

    _initializeScreenHistory() {
        this._screenDepth = 0;
        this._screenFocus = new Map();
        if (!window.history || typeof window.history.replaceState !== 'function') return;
        const initial = document.querySelector('.screen.active');
        window.history.replaceState({ mehScreen: initial ? initial.id : 'main-menu', mehDepth: 0 }, '', window.location.href);
        window.addEventListener('popstate', event => {
            const state = event.state && event.state.mehScreen ? event.state : { mehScreen: 'main-menu', mehDepth: 0 };
            this._screenDepth = Number.isSafeInteger(state.mehDepth) ? Math.max(0, state.mehDepth) : 0;
            this.showScreen(state.mehScreen, { fromHistory: true, restoreFocus: true });
        });
    }

    _captureScreenFocus(screen) {
        if (!screen || !this._screenFocus) return;
        const active = document.activeElement;
        if (active && active !== document.body && screen.contains(active)) this._screenFocus.set(screen.id, active);
    }

    navigateBack(fallbackId = 'main-menu') {
        if (window.history && typeof window.history.back === 'function' && this._screenDepth > 0) {
            window.history.back();
            return;
        }
        this.showScreen(fallbackId, { replaceHistory: true });
    }

    showScreen(id, navigation = {}) {
        const target = document.getElementById(id);
        if (!target) return;
        const screens = [...document.querySelectorAll('.screen')];
        const current = screens.find(screen => screen.classList.contains('active')) || null;
        if (current && current !== target) this._captureScreenFocus(current);
        screens.forEach(screen => {
            const isActive = screen === target;
            screen.classList.toggle('active', isActive);
            screen.inert = !isActive;
            screen.toggleAttribute('inert', !isActive);
            screen.setAttribute('aria-hidden', String(!isActive));
        });
        if (typeof FeedbackDirector !== 'undefined') FeedbackDirector.transition(current, target);
        else if (typeof Sound.setScene === 'function') {
            Sound.setScene(id === 'game-screen' ? 'table' : (id === 'end-screen' ? 'result' : 'home'));
        }
        if (!navigation.fromHistory && current !== target && window.history) {
            if (navigation.replaceHistory && typeof window.history.replaceState === 'function') {
                window.history.replaceState({ mehScreen: id, mehDepth: this._screenDepth || 0 }, '', window.location.href);
            } else if (typeof window.history.pushState === 'function') {
                this._screenDepth = (this._screenDepth || 0) + 1;
                window.history.pushState({ mehScreen: id, mehDepth: this._screenDepth }, '', window.location.href);
            }
        }
        const restored = navigation.restoreFocus && this._screenFocus && this._screenFocus.get(id);
        if (restored && restored.isConnected && !restored.disabled && target.contains(restored)) restored.focus();
        else this.focusScreen(target);
        this._trackProductEvent('entry.viewed', { screenId: id });
    }

    syncScreenAccessibility() {
        document.querySelectorAll('.screen').forEach(screen => {
            const isActive = screen.classList.contains('active');
            screen.inert = !isActive;
            screen.toggleAttribute('inert', !isActive);
            screen.setAttribute('aria-hidden', String(!isActive));
        });
    }

    setDialogOpen(dialog, isOpen) {
        if (!dialog) return;
        dialog.classList.toggle('hidden', !isOpen);
        dialog.inert = !isOpen;
        dialog.toggleAttribute('inert', !isOpen);
        dialog.setAttribute('aria-hidden', String(!isOpen));
        if (!isOpen) return;
        const firstControl = dialog.querySelector('button:not([disabled])');
        if (firstControl) firstControl.focus();
    }

    focusScreen(screen) {
        const heading = screen.querySelector('h1, h2');
        const target = heading || screen.querySelector('button:not([disabled]), input:not([disabled])');
        if (!target) return;
        if (heading) heading.setAttribute('tabindex', '-1');
        target.focus();
    }

    focusTurnAction() {
        const playableCard = document.querySelector('#human-hand .card.playable:not([disabled])');
        const target = playableCard || UI.drawPile;
        if (target && !target.disabled) target.focus();
    }
}

const MehGameScreenMethods = MehGameScreenModule.prototype;
delete MehGameScreenMethods.constructor;
Object.freeze(MehGameScreenMethods);
