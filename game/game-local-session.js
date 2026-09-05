'use strict';

class MehGameLocalSessionModule {
    _localSaveKey() { return `meh_solo_v1_${this.humanProfile && this.humanProfile.id || 'guest'}`; }

    _readLocalCheckpoint() {
        if (typeof Storage === 'undefined' || typeof Storage._getItem !== 'function') return null;
        try {
            const raw = Storage._getItem(this._localSaveKey());
            if (!raw || raw.length > 80000) return null;
            return LocalCheckpoint.validate(JSON.parse(raw), this.humanProfile.id || 'guest', MEH_CORE_MANIFEST, MEH_CATALOG_MANIFEST);
        } catch (error) { return null; }
    }

    _beginLocalSession() {
        if (this._practice || typeof Storage === 'undefined' || typeof Storage._write !== 'function') return;
        const profileId = this.humanProfile.id || 'guest';
        if (this._localSeriesProfile !== profileId || !this._localSeries) {
            this._localSeries = { rounds: 0, wins: [0, 0, 0, 0] };
        }
        this._localSeriesProfile = profileId;
        this._localRunId = `solo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        this._localSaveEstablished = false;
        this._localLastSaved = JSON.stringify(this._readLocalCheckpoint());
        this._localSaveFailed = false;
        this._localHighlights = [];
        this._localActionBase = null;
        this._localReplayDecisions = [];
        this._lastResultWasLocal = false;
        this._actionJournal = []; this._journalSequence = 0; this._latestActionReason = '';
    }

    _writeLocalCheckpoint(checkpoint) {
        if (this.online || this._practice || !checkpoint || typeof Storage === 'undefined' || typeof Storage._write !== 'function') return false;
        const existing = this._readLocalCheckpoint();
        if (JSON.stringify(existing) !== this._localLastSaved) {
            this._localSaveFailed = true;
            this._renderLocalSaveStatus();
            return false; // A second tab advanced/replaced/finished this save.
        }
        const saved = Storage._write(this._localSaveKey(), checkpoint);
        this._localSaveEstablished = saved || this._localSaveEstablished;
        if (saved) this._localLastSaved = JSON.stringify(checkpoint);
        this._localSaveFailed = !saved;
        this._renderLocalSaveStatus();
        return saved;
    }

    _checkpointLocal(kind, details = {}) {
        if (this.online || this._practice || !this._localRunId || !this.topCard) return false;
        const checkpoint = LocalCheckpoint.capture(this, { kind, ...details }, MEH_CORE_MANIFEST, MEH_CATALOG_MANIFEST);
        this._localActionBase = kind === 'play' ? checkpoint : null;
        return this._writeLocalCheckpoint(checkpoint);
    }

    _rememberLocalDecision(kind, value) {
        if (this.online || this._practice || !this._localActionBase) return;
        this._localActionBase.resume.decisions.push({ kind, value });
        this._writeLocalCheckpoint(this._localActionBase);
    }

    _replayedLocalDecision(kind, data) {
        if (!this._localReplayDecisions || !this._localReplayDecisions.length) return null;
        const decision = this._localReplayDecisions.shift();
        const valid = decision.kind === kind && (kind === 'color' ? ONLINE_COLORS.includes(decision.value)
            : kind === 'choice' ? [0, 1].includes(decision.value)
                : (data.options || []).some(option => (kind === 'target' ? option.idx : option.id) === decision.value));
        if (!valid) { this._localReplayDecisions = []; return null; }
        return decision;
    }

    _resumeLocalMatch() {
        const saved = this._readLocalCheckpoint();
        if (!saved) { this.showToast(I18n.t('solo_save_invalid')); this._syncLocalEntry(); return false; }
        this._clearOnlineRuntime();
        Net.close();
        this.online = false; this.isHost = false; this._practice = null;
        const definitions = new Map(MEH_CATALOG_MANIFEST.definitions.map(definition => [definition.definitionId, definition]));
        const hydrate = raw => {
            const definition = definitions.get(raw.definitionId);
            return new Card(raw.color, definition.nameAr, definition.type, definition.emoji,
                `assets/cards/${raw.color}-${definition.assetBase}.webp`,
                { definitionId: raw.definitionId, idFactory: () => raw.id });
        };
        this.deck = new Deck(); this.deck.cards = saved.deck.map(hydrate);
        this.discardPile = saved.discard.map(hydrate);
        this.players = playersConfig.map((player, index) => ({ ...player, hand: saved.hands[index].map(hydrate) }));
        this.players[0].name = this.humanProfile.name; this.players[0].avatar = this.humanProfile.avatar;
        this.currentPlayerIndex = saved.current; this.direction = saved.direction; this.activeColor = saved.activeColor;
        this.pendingDraws = saved.pending; this.skipNextMap = {}; this.drawImmune = {};
        saved.skipped.forEach(index => { this.skipNextMap[this.players[index].id] = true; });
        saved.shields.forEach(index => { this.drawImmune[this.players[index].id] = true; });
        this.superpowersDisabled = saved.powersDisabled;
        this._sugarOwnerId = saved.sugarOwner >= 0 ? this.players[saved.sugarOwner].id : null;
        this._localRunId = saved.runId; this._localSaveEstablished = true; this._localSaveFailed = false;
        this._localLastSaved = JSON.stringify(saved);
        this._localSeries = saved.series; this._localSeriesProfile = this.humanProfile.id || 'guest';
        this._localHighlights = saved.highlights; this._actionJournal = saved.journal;
        this._journalSequence = saved.journal.length;
        this._latestActionReason = saved.journal.at(-1)?.reason || '';
        this._pendingDrawReason = saved.pendingReason;
        this._lastSkipReason = {};
        saved.skipReasons.forEach((reason, index) => { this._lastSkipReason[this.players[index].id] = reason; });
        this._decisionContext = null; this._cardDecision = null; this._resolvingCard = null;
        this.selectedCardIndex = -1; this.humanCanPlay = false; this.actionInProgress = false; this.isAwaitingColor = false;
        this._localReplayDecisions = saved.resume.decisions ? saved.resume.decisions.slice() : [];
        this.hideConfirmBar(); this.bindGameEvents(); this.showScreen('game-screen'); this.updateUI();
        if (this.settings.wakeLock) WakeLock.enable();
        this._productMatchActive = true;
        this._productCompletedMatches = saved.series.rounds;
        this._trackProductEvent('solo.resumed', { phase: saved.resume.kind });
        if (saved.resume.kind === 'advance') this.advanceTurn();
        else if (saved.resume.kind === 'draw') { this.actionInProgress = true; this.doDrawForCurrent(); }
        else if (saved.resume.kind === 'play') {
            const index = this.currentPlayer.hand.findIndex(card => card.id === saved.resume.cardId);
            if (index < 0 || !this.isCardPlayableNow(this.currentPlayer.hand[index])) {
                this._localReplayDecisions = []; this.playTurn();
            } else {
                this.actionInProgress = true; this._restoringLocalPlay = true;
                try { this.playCard(this.currentPlayer, index); } finally { this._restoringLocalPlay = false; }
            }
        } else this.playTurn();
        return true;
    }

    _removeLocalCheckpoint() {
        if (typeof Storage !== 'undefined' && typeof Storage._removeItem === 'function') Storage._removeItem(this._localSaveKey());
    }

    _completeLocalMatch(winner) {
        if (this.online || this._practice || !this._localRunId || this._localCompletedRun === this._localRunId) return;
        this._localCompletedRun = this._localRunId;
        this._lastResultWasLocal = true;
        const index = this.players.indexOf(winner);
        if (this._localSeries && index >= 0) {
            this._localSeries.rounds++;
            this._localSeries.wins[index]++;
        }
        const saved = this._readLocalCheckpoint();
        if (!saved || saved.runId === this._localRunId) this._removeLocalCheckpoint();
        this._localRunId = null;
        this._lastLocalMoment = [...this._localHighlights].sort((a, b) => b.weight - a.weight)[0]?.text
            || I18n.t('solo_finish_fact', { name: winner.name });
    }

    _rememberLocalMoment(text, weight) {
        if (this.online || this._practice || !this._localRunId) return;
        if (!this._localHighlights) this._localHighlights = [];
        this._localHighlights.push({ text, weight });
        this._localHighlights = this._localHighlights.sort((a, b) => b.weight - a.weight).slice(0, 6);
    }

    _renderLocalResult() {
        if (!this._lastResultWasLocal || !this._localSeries) return;
        const board = document.getElementById('result-board');
        const score = document.getElementById('session-score');
        if (!board || !score) return;
        board.classList.remove('hidden');
        score.replaceChildren(...this.players.map((player, index) => {
            const row = this._createTextElement('div', 'solo-score-row', '');
            row.appendChild(this._createTextElement('span', '', player.name));
            row.appendChild(this._createTextElement('strong', '', I18n.t('solo_wins', { n: this._localSeries.wins[index] })));
            return row;
        }));
        document.getElementById('session-score-hint').textContent = I18n.t('solo_rounds', { n: this._localSeries.rounds });
        document.getElementById('result-subtitle').textContent = this._lastLocalMoment;
    }
}

const MehGameLocalSessionMethods = MehGameLocalSessionModule.prototype;
delete MehGameLocalSessionMethods.constructor;
Object.freeze(MehGameLocalSessionMethods);
