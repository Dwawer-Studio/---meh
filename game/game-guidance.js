'use strict';

class MehGameGuidanceModule {
    _initializeGuidance() {
        this._guidanceSeen = new Set();
        this._actionJournal = [];
        this._latestActionReason = '';
        const journalButton = document.getElementById('journal-toggle-btn');
        if (journalButton) journalButton.classList.toggle('hidden', !this._productFeatureEnabled('action_journal'));
    }

    bindGuidanceEvents() {
        document.getElementById('context-tip-why').onclick = () => this._openActionJournal();
        document.getElementById('journal-toggle-btn').onclick = () => this._openActionJournal();
        document.getElementById('journal-close-btn').onclick = () => this._closeActionJournal();
    }

    _showGuidance(key, message, reason) {
        if (!this._productFeatureEnabled('contextual_ftue')) return false;
        if (!this._guidanceSeen) this._guidanceSeen = new Set();
        if (this._guidanceSeen.has(key)) return false;
        this._guidanceSeen.add(key);
        const tip = document.getElementById('context-tip');
        const text = document.getElementById('context-tip-text');
        if (!tip || !text) return false;
        text.textContent = message;
        this._latestActionReason = reason || message;
        tip.classList.remove('hidden');
        clearTimeout(this._guidanceTimer);
        this._guidanceTimer = setTimeout(() => tip.classList.add('hidden'), 7000);
        return true;
    }

    _recordActionJournal(text, reason, kind = 'system', broadcast = true) {
        if (!this._productFeatureEnabled('action_journal')) return false;
        if (typeof text !== 'string' || !text.trim()) return false;
        if (!Array.isArray(this._actionJournal)) this._actionJournal = [];
        const entry = { sequence: this._actionJournal.length + 1, text: text.trim(), reason: reason || text, kind };
        this._actionJournal.push(entry);
        if (this._actionJournal.length > 20) this._actionJournal.shift();
        this._latestActionReason = entry.reason;
        this._renderActionJournal();
        if (broadcast && this.online && this.isHost && typeof Net.broadcast === 'function') {
            Net.broadcast({ t: 'journal', text: entry.text, reason: entry.reason, kind: entry.kind });
        }
        return true;
    }

    _renderActionJournal() {
        const list = document.getElementById('action-journal-list');
        const reason = document.getElementById('action-reason');
        if (list) {
            list.replaceChildren(...this._actionJournal.slice().reverse().map(entry =>
                this._createTextElement('li', `journal-entry journal-${entry.kind}`, entry.text)));
        }
        if (reason) reason.textContent = this._latestActionReason || I18n.t('journal_no_reason');
    }

    _openActionJournal() {
        const journal = document.getElementById('action-journal');
        if (!journal) return;
        this._renderActionJournal();
        journal.classList.remove('hidden');
        journal.inert = false;
        journal.setAttribute('aria-hidden', 'false');
        document.getElementById('journal-close-btn').focus();
    }

    _closeActionJournal() {
        const journal = document.getElementById('action-journal');
        if (!journal) return;
        journal.classList.add('hidden');
        journal.inert = true;
        journal.setAttribute('aria-hidden', 'true');
        document.getElementById('journal-toggle-btn').focus();
    }

    _cardPlayReason(card, previousTop, previousActiveColor) {
        if (card.color === 'black') return I18n.t('reason_wild');
        if (card.color === previousActiveColor) return I18n.t('reason_color');
        if (previousTop && card.name === previousTop.name) return I18n.t('reason_character');
        if (this.pendingDraws > 0 && this.canRespondToPendingDraw(card)) return I18n.t('reason_counter');
        return I18n.t('reason_legal_action');
    }

    _haptic(pattern) {
        if (!this.settings || this.settings.haptics !== true) return false;
        try {
            if (!navigator.vibrate) return false;
            return navigator.vibrate(pattern) === true;
        } catch (error) { return false; }
    }

    _startTurnCountdownVisual(seconds = 10) {
        this._stopTurnCountdownVisual();
        const duration = [10, 15, 20].includes(seconds) ? seconds : 10;
        const timer = document.getElementById('turn-timer');
        const label = document.getElementById('turn-timer-label');
        if (timer) timer.style.setProperty('--turn-duration', `${duration}s`);
        if (label) label.textContent = String(duration);
        const deadline = Date.now() + duration * 1000;
        this._turnCountdownInterval = setInterval(() => {
            const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            if (label) label.textContent = String(remaining);
            if (remaining === 0) this._stopTurnCountdownVisual(false);
        }, 250);
    }

    _stopTurnCountdownVisual(clearLabel = true) {
        if (this._turnCountdownInterval) clearInterval(this._turnCountdownInterval);
        this._turnCountdownInterval = null;
        if (clearLabel) {
            const label = document.getElementById('turn-timer-label');
            if (label) label.textContent = '';
        }
    }
}

const MehGameGuidanceMethods = MehGameGuidanceModule.prototype;
delete MehGameGuidanceMethods.constructor;
Object.freeze(MehGameGuidanceMethods);
