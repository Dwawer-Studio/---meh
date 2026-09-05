'use strict';

// Explicit, optional middle-game positions. Cards and effects use the ordinary
// engine. This module never awards results, currency, or catalog ownership.
class MehGamePracticeModule {
    startPractice(step = 0) {
        if (this.online) return;
        this.startGame(Math.max(0, Math.min(2, step)));
        this._trackProductEvent('practice.step_started', { step: this._practice.step + 1 });
    }

    _dealPractice() {
        const take = predicate => {
            const index = this.deck.cards.findIndex(predicate);
            if (index < 0) throw new Error('Practice position cannot be built from the classic deck');
            return this.deck.cards.splice(index, 1)[0];
        };
        const selected = (type, color = 'orange') => take(card => card.type === type && card.color === color);
        const step = this._practice.step;
        this.players[0].hand = step === 0
            ? [selected('normal'), selected('normal', 'gray'), selected('normal', 'purple')]
            : step === 1
                ? [selected('counterAttack'), selected('normal', 'gray'), selected('normal', 'purple')]
                : [selected('boShlakh'), selected('sorry', 'gray'), selected('normal', 'purple')];
        const top = selected(step === 1 ? 'draw2' : 'normal');
        this.discardPile = [top]; this.activeColor = top.color;
        for (const player of this.players.slice(1)) {
            // The attacker in position 2 has no response: the actual engine will
            // draw the returned penalty, without inspecting/altering a live game.
            for (let i = 0; i < 7; i++) player.hand.push(take(card => step !== 1 || !this.canRespondToPendingDraw(card)));
        }
        this.pendingDraws = step === 1 ? 2 : 0;
        this._pendingDrawReason = step === 1 ? I18n.t('practice_counter_cause') : '';
        this._practice.initialIds = this.players[0].hand.map(card => card.id);
        this._practice.burdenId = this.players[0].hand.find(card => card.type === 'sorry')?.id;
        this.updateUI(); this.playTurn();
    }

    _practiceAfterPlay(card, player) {
        if (!this._practice || player !== this.players[0]) return false;
        if (this._practice.step === 1 && card.type === 'counterAttack') return false;
        const success = this._practice.step === 0 || (this._practice.step === 2
            && card.type === 'boShlakh' && !player.hand.some(held => held.id === this._practice.burdenId));
        this._finishPractice(success ? 'success' : 'alternative');
        return true;
    }

    _practiceBeforeTurn() {
        if (!this._practice) return false;
        if (this._practice.done) return true;
        // Position 2 ends only after the actual four-card penalty was received.
        if (this._practice.step === 1 && this.direction === -1 && this.players[3].hand.length === 11 && this.pendingDraws === 0) {
            this._finishPractice('success'); return true;
        }
        if (this.currentPlayerIndex !== 0 && this.direction === 1) {
            this._finishPractice('alternative'); return true;
        }
        return false;
    }

    _finishPractice(outcome) {
        if (!this._practice || this._practice.done) return;
        this._practice.done = true; this._practice.outcome = outcome;
        this._cancelTurnWork(); this._pauseLocalClock();
        this.humanCanPlay = false; this.actionInProgress = true;
        UI.gameMessage.classList.add('hidden');
        UI.toastContainer.replaceChildren();
        document.querySelectorAll('.draw-badge, .penalty-reason-banner').forEach(element => element.remove());
        const tip = document.getElementById('context-tip');
        if (tip) tip.classList.add('hidden');
        this.hideConfirmBar(); this.updateUI();
        this._trackProductEvent('practice.step_completed', { step: this._practice.step + 1, outcome });
        const next = document.getElementById('practice-next-btn');
        if (next) next.focus();
    }

    _leavePracticeForMatch() {
        if (!this._practice) return;
        if (!this._practice.done) this._trackProductEvent('practice.skipped', { step: this._practice.step + 1 });
        this._clearOnlineRuntime(); this._practice = null;
        this._renderPractice();
        this.showScreen('main-menu', { replaceHistory: true, allowSoloExit: true });
        this._requestLocalStart();
    }

    _renderPractice() {
        const panel = document.getElementById('practice-panel');
        if (!panel) return;
        const active = document.getElementById('game-screen').classList.contains('active');
        document.getElementById('game-screen').classList.toggle('is-practice', !!this._practice && !this.online);
        panel.classList.toggle('hidden', !this._practice || !!this.online || !active);
        panel.inert = !active;
        if (!this._practice || this.online) return;
        const { step, done, outcome } = this._practice;
        document.getElementById('practice-title').textContent = I18n.t('practice_position', { n: step + 1 });
        document.getElementById('practice-instruction').textContent = I18n.t(done
            ? outcome === 'success' ? `practice_success_${step + 1}` : 'practice_alternative'
            : `practice_goal_${step + 1}`);
        document.getElementById('practice-next-btn').classList.toggle('hidden', !done || step === 2);
        document.getElementById('practice-play-btn').textContent = I18n.t(done && step === 2 ? 'practice_full_game' : 'practice_skip');
        document.getElementById('practice-retry-btn').classList.toggle('hidden', !done);
        const round = document.getElementById('table-round-label');
        if (round) round.textContent = I18n.t('practice_position', { n: step + 1 });
    }
}

const MehGamePracticeMethods = MehGamePracticeModule.prototype;
delete MehGamePracticeMethods.constructor;
Object.freeze(MehGamePracticeMethods);
