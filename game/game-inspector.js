'use strict';

class MehGameInspectorModule {
    bindInspectorEvents() {
        const retry = document.getElementById('inspect-art-retry');
        if (retry) retry.onclick = () => {
            const image = document.getElementById('inspect-art');
            const card = this._inspectedCard();
            if (image && card) {
                image.src = `${card.svgFile}?retry=${Date.now()}`;
                retry.disabled = true;
            }
        };
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && this._inspectedCardId && !this._localPaused) {
                event.preventDefault();
                this.cancelSelectedCard();
            }
        });
    }

    _inspectedCard() {
        return (this.players[0] && this.players[0].hand || [])
            .find(card => card && card.id === this._inspectedCardId);
    }

    _cardInsight(card, actorIndex = 0) {
        return CardInsight.describe(card, {
            players: this.players, actorIndex, direction: this.direction,
            pendingDraws: this.pendingDraws, superpowersDisabled: this.superpowersDisabled,
            selfShield: !!(this.drawImmune && this.drawImmune[(this.players[actorIndex] || {}).id]),
            discardPile: this.discardPile,
            discardComplete: !this._authoritativeClient && (!this.online || this.isHost),
        }, (key, params) => I18n.t(key, params));
    }

    inspectCard(cardId) {
        const index = (this.players[0] && this.players[0].hand || []).findIndex(card => card && card.id === cardId);
        if (index < 0) return;
        this._inspectedCardId = cardId;
        this._trackProductEvent('card.inspected', { playable: this.isCardPlayableNow(this.players[0].hand[index]),
            phase: this._decisionContext ? 'decision' : this.humanCanPlay ? 'turn' : 'waiting' });
        this.selectedCardIndex = index;
        Sound.play('card-lift');
        this.updateUI();
        const confirm = document.getElementById('confirm-play-btn');
        const close = document.getElementById('cancel-play-btn');
        if (confirm && !confirm.disabled) confirm.focus();
        else if (close) close.focus();
    }

    _renderCardInspector() {
        const panel = UI.confirmBar;
        if (!panel) return;
        const card = this._inspectedCard();
        if (!card) {
            panel.classList.add('hidden');
            panel.setAttribute('aria-hidden', 'true');
            this._inspectedCardId = null;
            return;
        }
        panel.classList.remove('hidden');
        panel.setAttribute('aria-hidden', 'false');
        const write = (id, text) => {
            const element = document.getElementById(id);
            if (element) element.textContent = text;
        };
        const insight = this._cardInsight(card);
        const decision = this._cardDecision;
        const isChoice = !!decision && decision.ids.includes(card.id);
        write('inspect-name', I18n.cardName(card));
        write('inspect-color', I18n.colorName(card.color));
        write('inspect-effect', isChoice ? I18n.t(decision.targetName ? 'insight_give_choice' : 'insight_discard_choice',
            { name: decision.targetName || '' }) : insight.description);
        write('inspect-cost', isChoice ? '' : insight.detail);
        const image = document.getElementById('inspect-art');
        const retry = document.getElementById('inspect-art-retry');
        if (image && image.dataset.cardId !== card.id) {
            image.dataset.cardId = card.id;
            image.alt = I18n.cardName(card);
            image.classList.remove('art-unavailable');
            if (retry) retry.classList.add('hidden');
            image.onload = () => {
                image.classList.remove('art-unavailable');
                if (retry) { retry.classList.add('hidden'); retry.disabled = false; }
            };
            image.onerror = () => {
                image.classList.add('art-unavailable');
                if (retry) { retry.classList.remove('hidden'); retry.disabled = false; }
            };
            image.src = card.svgFile;
        }
        const turnReady = this.currentPlayerIndex === 0 && this.humanCanPlay
            && !this.isAwaitingColor && !this.actionInProgress && !this._localPaused;
        const playable = isChoice || (!decision && turnReady && this.isCardPlayableNow(card));
        let reason = I18n.t('inspect_legal');
        if (isChoice) reason = this._decisionContext && this._decisionContext.title || I18n.t('choose_card');
        else if (decision || this.isAwaitingColor) reason = I18n.t('inspect_resolving');
        else if (!turnReady) reason = I18n.t('inspect_wait');
        else if (!playable) reason = this.pendingDraws > 0
            ? I18n.t('inspect_penalty', { n: this.pendingDraws })
            : I18n.t('inspect_mismatch', { color: I18n.colorName(this.activeColor) });
        write('inspect-legality', reason);
        write('inspect-confirm-label', isChoice ? I18n.t('choose_card') : I18n.t('confirm_play'));
        const confirm = document.getElementById('confirm-play-btn');
        if (confirm) confirm.disabled = !playable;
        panel.dataset.playable = String(playable);
    }

    _confirmCardDecision() {
        if (this._localPaused && !this.online) return false;
        const decision = this._cardDecision;
        const card = this._inspectedCard();
        if (!decision || !card || !decision.ids.includes(card.id)) return false;
        this.hideConfirmBar();
        decision.resolve(card.id);
        return true;
    }

    _beginDecisionContext(player, kind, data) {
        const card = this._resolvingCard;
        const cardName = card ? I18n.cardName(card) : I18n.t('choose');
        const key = kind === 'card' ? (card && card.type === 'chameleon' ? 'decision_card_give' : 'decision_card_discard')
            : kind === 'target' ? 'decision_target' : kind === 'color' ? 'decision_color' : null;
        this._decisionContext = {
            kind, actorId: player.id,
            title: key ? I18n.t(key, { card: cardName }) : data.title || I18n.t('choose'),
        };
        this._renderDecisionContext();
    }

    _renderDecisionContext() {
        this._measureSoloWait();
        const banner = document.getElementById('decision-context');
        if (!banner) return;
        const decision = this._decisionContext;
        banner.classList.toggle('hidden', !decision);
        if (decision) banner.textContent = decision.title;
        const label = document.getElementById('turn-action-label');
        if (label && decision) label.textContent = decision.actorId === (this.players[0] || {}).id
            ? decision.title : I18n.t('decision_wait', { name: (this.currentPlayer || {}).name || '' });
    }

    _renderTacticalStatus() {
        const status = document.getElementById('table-state-summary');
        if (status) {
            const owner = (this.players || []).find(player => player.id === this._sugarOwnerId);
            status.textContent = this.superpowersDisabled
                ? I18n.t('state_sugar', { name: owner ? owner.name : I18n.t('you') }) : '';
            status.classList.toggle('hidden', !this.superpowersDisabled);
        }
        (this.players || []).forEach(player => {
            const area = this._areaEl(player);
            if (!area) return;
            let badges = area.querySelector('.seat-tactical-state');
            if (!badges) {
                badges = this._createTextElement('small', 'seat-tactical-state', '');
                const info = area.querySelector('.player-copy') || area;
                info.appendChild(badges);
            }
            const labels = [];
            if (player.isBot && !this.online) labels.push(I18n.t(`bot_style_${player.botStyle || BotStrategy.styleForSeat(this.players.indexOf(player))}`));
            if (player.hand.length === 1) labels.push(I18n.t('state_last'));
            if (this.drawImmune && this.drawImmune[player.id]) labels.push(I18n.t('state_shield'));
            badges.textContent = labels.join(' · ');
            area.classList.toggle('one-card-threat', player.hand.length === 1);
        });
    }
}

const MehGameInspectorMethods = MehGameInspectorModule.prototype;
delete MehGameInspectorMethods.constructor;
Object.freeze(MehGameInspectorMethods);
