'use strict';

class MehGameGuidanceModule {
    _initializeGuidance() {
        this._guidanceSeen = new Set();
        this._actionJournal = [];
        this._journalSequence = 0;
        this._lastSkipReason = {};
        this._latestActionReason = '';
        const journalButton = document.getElementById('journal-toggle-btn');
        if (journalButton) journalButton.classList.toggle('hidden', !this._productFeatureEnabled('action_journal'));
    }

    bindGuidanceEvents() {
        document.getElementById('context-tip-why').onclick = () => this._openActionJournal();
        document.getElementById('journal-toggle-btn').onclick = () => this._openActionJournal();
        document.getElementById('journal-close-btn').onclick = () => this._closeActionJournal();
        const latest = document.getElementById('last-table-action');
        if (latest) latest.onclick = () => this._openActionJournal();
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

    _showTransientReason(message, reason, duration = 3000) {
        const tip = document.getElementById('context-tip');
        const text = document.getElementById('context-tip-text');
        if (!tip || !text) return false;
        text.textContent = message;
        this._latestActionReason = reason || message;
        tip.classList.remove('hidden');
        clearTimeout(this._guidanceTimer);
        clearTimeout(this._penaltyReasonTimer);
        this._penaltyReasonTimer = setTimeout(() => tip.classList.add('hidden'), Math.max(1000, duration));
        return true;
    }

    _recordActionJournal(text, reason, kind = 'system', broadcast = true) {
        if (!this._productFeatureEnabled('action_journal')) return false;
        if (typeof text !== 'string' || !text.trim()) return false;
        if (!Array.isArray(this._actionJournal)) this._actionJournal = [];
        const entry = { sequence: this._journalSequence = (this._journalSequence || 0) + 1,
            text: text.trim(), reason: reason || text, kind };
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
            list.replaceChildren(...this._actionJournal.slice().reverse().map(entry => {
                const item = this._createTextElement('li', `journal-entry journal-${entry.kind}`, '');
                const detail = document.createElement('details');
                detail.appendChild(this._createTextElement('summary', '', entry.text));
                detail.appendChild(this._createTextElement('p', '', entry.reason));
                item.appendChild(detail);
                return item;
            }));
        }
        if (reason) reason.textContent = this._latestActionReason || I18n.t('journal_no_reason');
        const latest = document.getElementById('last-table-action');
        if (latest) {
            const entry = this._actionJournal[this._actionJournal.length - 1];
            latest.textContent = entry ? entry.text : '';
            latest.classList.toggle('hidden', !entry);
        }
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

    _consumeServiceJournal(match, seats) {
        const marker = this._serviceJournalCursor;
        const after = marker && marker.matchId === match.matchId ? marker.version : -1;
        const players = seats.map(seat => ({ id: seat.seatId, name: seat.displayName }));
        const named = id => (players.find(player => player.id === id) || {}).name || I18n.t('guest');
        for (const group of match.journal || []) {
            if (group.version <= after) continue;
            const definition = group.card && MEH_CATALOG_MANIFEST.definitions.find(item => item.definitionId === group.card.definitionId);
            const card = definition && { name: definition.nameAr, type: definition.type, color: group.card.color };
            const cause = card ? I18n.t('journal_played', { name: named(group.actorId), card: I18n.cardName(card) }) : '';
            const effect = card ? CardInsight.describe(card, { ...group.before, players,
                actorIndex: players.findIndex(player => player.id === group.actorId), discardComplete: false },
            (key, params) => I18n.t(key, params)).description : '';
            for (const event of group.events) {
                const name = named(event.seatId);
                if (event.type === 'card.committed') this._recordActionJournal(cause, effect || cause, 'play', false);
                else if (event.type === 'effect.applied' || event.type === 'effect.suppressed') {
                    this._recordActionJournal(I18n.t('journal_effect', { card: card ? I18n.cardName(card) : '', effect }), cause, 'effect', false);
                } else if (event.type === 'cards.drawn') {
                    this._recordActionJournal(I18n.t('journal_draw_count', { name, n: event.count }), cause || I18n.t('draw_card'), 'draw', false);
                } else if (event.type === 'draw.blocked') {
                    this._recordActionJournal(I18n.t('phantom_shield', { name }), cause || I18n.t('insight_phantom'), 'effect', false);
                } else if (event.type === 'turn.skipped') {
                    this._recordActionJournal(I18n.t('journal_skipped', { name }), cause || I18n.t('skips_turn', { name }), 'skip', false);
                } else if (event.type === 'powers.restored') {
                    this._recordActionJournal(I18n.t('journal_powers_restored', { name }), I18n.t('insight_sugar'), 'effect', false);
                } else if (event.type === 'cards.discarded') {
                    this._recordActionJournal(I18n.t('discarded_n', { name, n: event.count }), cause, 'decision', false);
                } else if (event.type === 'card.given') {
                    this._recordActionJournal(I18n.t('gave_card', { name: named(group.actorId), target: name }), cause, 'decision', false);
                } else if (event.type === 'color.chosen') {
                    this._recordActionJournal(I18n.t('chose_color', { name, color: I18n.colorName(event.color) }), cause, 'decision', false);
                }
            }
            this._serviceJournalCursor = { matchId: match.matchId, version: group.version };
        }
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
