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
        if (toggleBtn) toggleBtn.onclick = () => panel.classList.toggle('hidden');
        if (closeBtn) closeBtn.onclick = () => panel.classList.add('hidden');
        // اختصار سرّي للمطوّر فقط (الزر مخفي عن اللاعبين)
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
                e.preventDefault();
                panel.classList.toggle('hidden');
            }
        });

        document.getElementById('dev-reveal-btn').onclick = () => {
            this.devShowBotHands = !this.devShowBotHands;
            this.updateUI();
            this.showToast(this.devShowBotHands ? 'تم كشف أوراق البوتات 👁️' : 'تم إخفاء الأوراق 🔒');
        };
        document.getElementById('dev-skip-btn').onclick = () => {
            this.showToast('تم تخطي الدور ⏩');
            this.advanceTurn();
        };
        document.getElementById('dev-color-btn').onclick = () => {
            if (!this.topCard) return;
            this.isAwaitingColor = true;
            this.setDialogOpen(UI.colorPicker, true);
            this.showToast('اختر لوناً جديداً 🎨');
        };
        document.getElementById('dev-draw-btn').onclick = () => {
            this.showToast('سحب 4 بطاقات للاعب الحالي 🃏');
            this.pendingDraws += 4;
            this.playTurn();
        };
        document.getElementById('dev-win-btn').onclick = () => {
            this.endGame(this.players[0]);
        };
    }

    bindMenuEvents() {
        document.getElementById('play-btn').addEventListener('click', () => this.startGame());
        document.getElementById('instructions-btn').addEventListener('click', () => this.showScreen('instructions-screen'));
        document.getElementById('back-btn').addEventListener('click', () => this.showScreen('main-menu'));
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

    showScreen(id) {
        const target = document.getElementById(id);
        if (!target) return;
        document.querySelectorAll('.screen').forEach(screen => {
            const isActive = screen === target;
            screen.classList.toggle('active', isActive);
            screen.inert = !isActive;
            screen.toggleAttribute('inert', !isActive);
            screen.setAttribute('aria-hidden', String(!isActive));
        });
        this.focusScreen(target);
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
