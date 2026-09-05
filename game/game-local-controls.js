'use strict';

class MehGameLocalControlsModule {
    bindLocalControls() {
        const on = (id, callback) => { const button = document.getElementById(id); if (button) button.onclick = callback; };
        on('solo-menu-btn', () => this._showSoloMenu('pause'));
        on('solo-continue-btn', () => this._closeSoloMenu(true));
        on('solo-save-exit-btn', () => this._showSoloMenu('exit'));
        on('solo-exit-confirm-btn', () => this._exitLocalGame());
        on('solo-exit-cancel-btn', () => this._showSoloMenu('pause'));
        on('solo-offer-cancel-btn', () => this._closeSoloMenu(false));
        on('solo-resume-btn', () => { this._closeSoloMenu(false); this._resumeLocalMatch(); });
        on('solo-resume-home-btn', () => this._resumeLocalMatch());
        on('solo-new-btn', () => { this._closeSoloMenu(false); this._removeLocalCheckpoint(); this.startGame(); });
        on('solo-settings-btn', () => {
            this._soloSettingsReturn = true;
            this._closeSoloMenu(false);
            this.showScreen('settings-screen'); this.refreshSettingsUI();
        });
        on('practice-home-btn', () => this.startPractice(0));
        on('practice-entry-btn', () => this.startPractice(0));
        on('practice-next-btn', () => this.startPractice(this._practice.step + 1));
        on('practice-retry-btn', () => this.startPractice(this._practice.step));
        on('practice-play-btn', () => this._leavePracticeForMatch());
        document.querySelectorAll('.solo-decision-pause').forEach(button => {
            button.onclick = () => this._showSoloMenu('pause');
        });
        document.addEventListener('keydown', event => {
            if (event.defaultPrevented) return;
            const panel = document.getElementById('solo-menu');
            const open = panel && !panel.classList.contains('hidden');
            if (open && event.key === 'Tab') {
                const controls = [...panel.querySelectorAll('button:not([disabled])')].filter(button => button.getClientRects().length);
                const first = controls[0], last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
            if (event.key !== 'Escape') return;
            if (open) { event.preventDefault(); this._closeSoloMenu(this._soloMenuMode !== 'offer'); }
            else if (!this.online && document.getElementById('game-screen').classList.contains('active')) {
                event.preventDefault(); this._showSoloMenu('pause');
            }
        });
    }

    _requestLocalStart() {
        if (this._readLocalCheckpoint()) this._showSoloMenu('offer');
        else this.startGame();
    }

    _showSoloMenu(mode) {
        if (this.online) return;
        if (mode !== 'offer' && this._pauseLocalClock()) {
            this._measureSoloWait(true);
            this._trackProductEvent('solo.paused', {});
        }
        const panel = document.getElementById('solo-menu');
        if (!panel) return;
        if (panel.classList.contains('hidden')) {
            this._soloPreviousFocus = document.activeElement;
            this._soloBackground = document.querySelector('.screen.active');
            if (this._soloBackground) this._soloBackground.inert = true;
        }
        this._soloMenuMode = mode;
        const trainingPanel = document.getElementById('practice-panel');
        if (trainingPanel) trainingPanel.inert = true;
        ['pause', 'exit', 'offer'].forEach(kind => document.getElementById(`solo-${kind}-actions`).classList.toggle('hidden', kind !== mode));
        document.getElementById('solo-menu-title').textContent = I18n.t(mode === 'offer' ? 'solo_resume_title' : mode === 'exit' ? 'solo_exit_title' : 'solo_paused');
        document.getElementById('solo-menu-description').textContent = I18n.t(this._practice ? 'practice_no_rewards'
            : mode === 'offer' ? 'solo_resume_description' : this._localSaveFailed || !this._localSaveEstablished ? 'solo_save_failed' : 'solo_saved_description');
        this.setDialogOpen(panel, true);
        document.getElementById(mode === 'offer' ? 'solo-resume-btn' : mode === 'exit' ? 'solo-exit-cancel-btn' : 'solo-continue-btn').focus();
    }

    _closeSoloMenu(resume) {
        this.setDialogOpen(document.getElementById('solo-menu'), false);
        if (this._soloBackground && this._soloBackground.classList.contains('active')) this._soloBackground.inert = false;
        this._soloBackground = null;
        if (resume && !(this._practice && this._practice.done)) this._resumeLocalClock();
        this._renderPractice(); this._measureSoloWait();
        if (this._soloPreviousFocus && this._soloPreviousFocus.isConnected) this._soloPreviousFocus.focus();
        this._soloPreviousFocus = null;
    }

    _exitLocalGame() {
        this._measureSoloWait(true);
        if (this._practice) this._trackProductEvent('practice.skipped', { step: this._practice.step + 1 });
        this._closeSoloMenu(false);
        this._clearOnlineRuntime();
        WakeLock.disable();
        this._localRunId = null; this._localActionBase = null; this._localReplayDecisions = [];
        this._practice = null;
        this._renderPractice();
        this._productCompleteTable('solo-exit');
        this.showScreen('main-menu', { replaceHistory: true, allowSoloExit: true });
    }

    _returnFromSoloSettings() {
        if (!this._soloSettingsReturn) return false;
        this._soloSettingsReturn = false;
        this.showScreen('game-screen'); this.updateUI(); this._showSoloMenu('pause');
        return true;
    }

    _syncLocalEntry() {
        const resume = document.getElementById('solo-resume-home-btn');
        if (resume) resume.classList.toggle('hidden', !this._readLocalCheckpoint());
    }

    _renderLocalSaveStatus() {
        const banner = document.getElementById('solo-save-warning');
        if (!banner) return;
        banner.textContent = this._localSaveFailed ? I18n.t('solo_save_failed') : '';
        banner.classList.toggle('hidden', !this._localSaveFailed || this.online || !!this._practice);
    }

    _renderLocalSessionChrome() {
        const menu = document.getElementById('solo-menu-btn');
        if (menu) menu.classList.toggle('hidden', !!this.online);
        document.querySelectorAll('.solo-decision-pause').forEach(button => button.classList.toggle('hidden', !!this.online));
        this._renderPractice();
        this._renderLocalSaveStatus();
        if (!this.online && this._localSeries && !this._practice) {
            const round = document.getElementById('table-round-label');
            if (round) round.textContent = I18n.t('round_number', { n: this._localSeries.rounds + 1 });
        }
    }
}

const MehGameLocalControlsMethods = MehGameLocalControlsModule.prototype;
delete MehGameLocalControlsMethods.constructor;
Object.freeze(MehGameLocalControlsMethods);
