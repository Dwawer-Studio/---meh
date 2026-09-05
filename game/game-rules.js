'use strict';

class MehGameRuleModule {
    startGame() {
        this._decisionContext = null;
        this._cardDecision = null;
        this._resolvingCard = null;
        this._clearOnlineRuntime();
        this.online = false; this.isHost = false; this.awaitingRemote = false;
        Net.close();
        this.showScreen('game-screen');
        if (this.settings.wakeLock) WakeLock.enable();

        this.deck = new Deck();
        this.discardPile = [];
        this.pendingDraws = 0;
        this._pendingDrawReason = '';
        this.direction = 1;
        this.currentPlayerIndex = 0;
        this.isAwaitingColor = false;
        this.actionInProgress = true;     // قفل التفاعل أثناء التوزيع
        this.skipNextMap = {};
        this.superpowersDisabled = false;
        this._sugarOwnerId = null;
        this.selectedCardIndex = -1;
        this.drawImmune = {};
        this.humanCanPlay = false;
        this.activeColor = '';
        this.hideConfirmBar();

        this.players = playersConfig.map(c => ({ ...c, hand: [] }));
        // اسم وصورة العضو الحالي
        this.players[0].name = this.humanProfile.name;
        this.players[0].avatar = this.humanProfile.avatar;
        this._productBeginMatch();

        this.bindGameEvents();
        this.updateUI();                  // أيدٍ فارغة + عدّادات صفر

        // توزيع حقيقي: ورقة ورقة، يزيد العدّاد مع كل واحدة
        this.dealCards(() => {
            const initial = this.drawInitialCard();
            this.discardPile.push(initial);
            this.activeColor = initial.color;
            this.updateUI();
            this.playTurn();
        });
    }

    // توزيع الأوراق ورقة ورقة على اللاعبين بالتناوب
    dealCards(done) {
        const perPlayer = 7;
        if (this.settings.batterySaver) {
            for (let i = 0; i < perPlayer; i++)
                for (const p of this.players) p.hand.push(this.deck.draw());
            this.updateUI();
            done();
            return;
        }
        Sound.play('shuffle');
        const totalSteps = perPlayer * this.players.length;
        let step = 0;
        const dealOne = () => {
            if (step >= totalSteps) { setTimeout(done, 280); return; }
            const p = this.players[step % this.players.length];
            const c = this.deck.draw();
            if (c) p.hand.push(c);
            this.animateCardFly(p);
            Sound.play('draw');
            this.updateUI();              // العدّاد يزيد والورقة تظهر
            step++;
            setTimeout(dealOne, 85);
        };
        dealOne();
    }

    bindGameEvents() {
        UI.drawPile.onclick = () => this.handleDrawClick();
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.onclick = () => this.handleColorPicked(btn.dataset.color);
        });
        document.getElementById('confirm-play-btn').onclick = () => this.confirmSelectedCard();
        document.getElementById('cancel-play-btn').onclick = () => this.cancelSelectedCard();
    }

    get topCard() { return this.discardPile[this.discardPile.length - 1]; }
    get currentPlayer() { return this.players[this.currentPlayerIndex]; }

    drawInitialCard() {
        let initial = null;
        const attempts = this.deck.cards.length;
        for (let attempt = 0; attempt < attempts; attempt++) {
            const candidate = this.deck.draw();
            if (candidate.type === 'normal') {
                initial = candidate;
                break;
            }
            this.deck.cards.unshift(candidate);
        }
        if (!initial) {
            const owner = (this.players || []).find(player => player.hand.some(
                card => card.type === 'normal',
            ));
            const index = owner && owner.hand.findIndex(card => card.type === 'normal');
            if (owner && index >= 0) {
                initial = owner.hand.splice(index, 1)[0];
                const replacement = this.deck.draw();
                if (replacement) owner.hand.push(replacement);
            }
        }
        return initial;
    }

    canRespondToPendingDraw(card) {
        return !!card && ['draw2', 'draw4Wild', 'meh', 'counterAttack', 'phantom'].includes(card.type);
    }

    isCardPlayableNow(card) {
        if (!card) return false;
        return this.pendingDraws > 0
            ? this.canRespondToPendingDraw(card)
            : (typeof card.isPlayable === 'function' ? card.isPlayable(this.topCard, this.activeColor)
                : card.color === 'black' || card.color === this.activeColor || (this.topCard && card.name === this.topCard.name));
    }

    updateSugarLockForTurn(player) {
        if (this.superpowersDisabled && this._sugarOwnerId === player.id) {
            this.superpowersDisabled = false;
            this._sugarOwnerId = null;
        }
    }

    nextPlayerIndex(from = this.currentPlayerIndex, steps = 1) {
        let idx = from;
        for (let i = 0; i < steps; i++) {
            idx += this.direction;
            if (idx >= this.players.length) idx = 0;
            if (idx < 0) idx = this.players.length - 1;
        }
        return idx;
    }

    prevPlayerIndex() {
        let idx = this.currentPlayerIndex - this.direction;
        if (idx >= this.players.length) idx = 0;
        if (idx < 0) idx = this.players.length - 1;
        return idx;
    }

    advanceTurn() {
        this.clearTurnTimer();
        this.selectedCardIndex = -1;
        this.humanCanPlay = false;
        this._decisionContext = null;
        this._resolvingCard = null;
        this.currentPlayerIndex = this.nextPlayerIndex();
        this.updateUI();
        this.playTurn();
    }

    playTurn() {
        const winner = this.players.find(p => p.hand.length === 0);
        if (winner) { this.endGame(winner); return; }

        this.actionInProgress = false;
        this.humanCanPlay = false;       // يُمنح فقط عند وصول دور اللاعب الفعلي
        this.awaitingRemote = false;
        const player = this.currentPlayer;
        this._trackProductEvent('turn.started', {
            actor: this._productActor(player),
            pendingDraws: Math.max(0, Math.min(999, this.pendingDraws || 0)),
        });
        this.updateSugarLockForTurn(player);
        UI.turnIndicator.innerText = player.name;

        if (this.skipNextMap[player.id]) {
            delete this.skipNextMap[player.id];
            Sound.play('skip');
            this.showToast(I18n.t('skips_turn', { name: player.name }));
            this._recordActionJournal(I18n.t('journal_skipped', { name: player.name }),
                this._lastSkipReason && this._lastSkipReason[player.id] || I18n.t('skips_turn', { name: player.name }), 'skip');
            setTimeout(() => this.advanceTurn(), 1000);
            return;
        }

        if (this.pendingDraws > 0) {
            this._showGuidance('first-penalty', I18n.t('first_penalty_tip'), I18n.t('reason_counter'));
            this._haptic([45, 60, 45]);
            const hasResponse = player.hand.some(card => this.canRespondToPendingDraw(card));
            if (!hasResponse) {
                this.actionInProgress = true;
                this.showGameMessage(I18n.t('m_plus', { n: this.pendingDraws }));
                this.drawMultiple(player, this.pendingDraws, () => {
                    this.pendingDraws = 0;
                    this._pendingDrawReason = '';
                    this.advanceTurn();
                });
                return;
            }
        }

        if (player.isBot) {
            setTimeout(() => this.playBotTurn(), 1200);
        } else if (this.online && player.isRemote) {
            // المضيف ينتظر حركة اللاعب البعيد (لا يلعب نيابةً عنه)
            this.awaitingRemote = true;
            this.updateUI();   // يبثّ canPlay=true لذلك العميل
            this.startTurnTimer();
        } else {
            Sound.play('turn-ready');
            this.humanCanPlay = true;    // ✅ الآن فقط يُسمح للاعب بالفعل
            this._showGuidance('first-turn', I18n.t('first_turn_tip'), I18n.t('reason_legal_action'));
            this._haptic(45);
            this.updateUI();
            const hasPlayable = player.hand.some(c => c.isPlayable(this.topCard, this.activeColor));
            if (!hasPlayable && this.pendingDraws === 0) {
                this.humanCanPlay = false;
                this.actionInProgress = true;
                this.showToast(I18n.t('no_card_draw'));
                setTimeout(() => {
                    this._trackProductEvent('action.committed', { actor: 'self', action: 'draw' });
                    this.handleDrawCard(player);
                    setTimeout(() => this.advanceTurn(), 600);
                }, 1200);
            } else {
                this.startTurnTimer();
                this.focusTurnAction();
            }
        }
    }

    playBotTurn() {
        const bot = this.currentPlayer;
        this.botMaybeEmoji(bot);
        let cardIndex = -1;

        if (this.pendingDraws > 0) {
            cardIndex = bot.hand.findIndex(card => this.canRespondToPendingDraw(card));
        } else {
            cardIndex = bot.hand.findIndex(c => c.isPlayable(this.topCard, this.activeColor) && c.type !== 'sorry' && c.type !== 'plato' && c.type !== 'hamour');
            if (cardIndex === -1) {
                cardIndex = bot.hand.findIndex(c => c.isPlayable(this.topCard, this.activeColor));
            }
        }

        if (cardIndex !== -1) {
            this.playCard(bot, cardIndex);
        } else {
            this._trackProductEvent('action.committed', { actor: this._productActor(bot), action: 'draw' });
            this.handleDrawCard(bot);
            setTimeout(() => this.advanceTurn(), 800);
        }
    }

    handleDrawClick() {
        if (!this.humanCanPlay || this.isAwaitingColor || this.actionInProgress) return;
        if (this._authoritativeClient) {
            this.selectedCardIndex = -1;
            this.hideConfirmBar();
            this._submitAuthoritativeDraw();
            return;
        }
        if (this.online && !this.isHost) {
            this._trackProductEvent('action.committed', { actor: 'self', action: 'draw' });
            this.humanCanPlay = false; this.selectedCardIndex = -1; this.hideConfirmBar();
            Net.send({ t: 'draw' });
            return;
        }
        this.humanCanPlay = false;
        this.actionInProgress = true;
        this.selectedCardIndex = -1;
        this.hideConfirmBar();
        this._trackProductEvent('action.committed', { actor: 'self', action: 'draw' });
        this.doDrawForCurrent();
    }

    handleDrawCard(player) {
        if (this.deck.cards.length === 0) this.reshuffleDeck();
        const card = this.deck.draw();
        if (card) {
            player.hand.push(card);
            this._recordActionJournal(
                I18n.t('journal_drew', { name: player.name }),
                this.pendingDraws > 0 ? I18n.t('first_penalty_tip') : I18n.t('reason_legal_action'),
                'draw',
            );
            Sound.play('draw');
            this.animateCardFly(player);
            this.updateUI();
        }
    }

    // ===== تأكيد رمي البطاقة =====
    selectCard(index) {
        const card = this.players[0] && this.players[0].hand[index];
        if (card) this.inspectCard(card.id);
    }
    confirmSelectedCard() {
        if (this._cardDecision) { this._confirmCardDecision(); return; }
        if ((!this._inspectedCardId && this.selectedCardIndex < 0) || !this.humanCanPlay || this.currentPlayerIndex !== 0) return;
        const idx = this._inspectedCardId
            ? this.players[0].hand.findIndex(card => card.id === this._inspectedCardId) : this.selectedCardIndex;
        const selected = this.players[0] && this.players[0].hand[idx];
        if (!selected || this.actionInProgress || this.isAwaitingColor || this._localPaused || !this.isCardPlayableNow(selected)) return;
        if (this._authoritativeClient) {
            const card = this.players[0] && this.players[0].hand[idx];
            this.selectedCardIndex = -1;
            this.hideConfirmBar();
            this._submitAuthoritativePlay(card);
            return;
        }
        this.selectedCardIndex = -1;
        this.hideConfirmBar();
        this.humanCanPlay = false;
        if (this.online && !this.isHost) {
            const card = this.players[0].hand[idx];
            if (card) Net.send({ t: 'play', cardId: card.id });
            return;
        }
        this.actionInProgress = true;
        this.playCard(this.currentPlayer, idx);
    }
    cancelSelectedCard() {
        this.selectedCardIndex = -1;
        this.hideConfirmBar();
        this.updateUI();
        this.focusTurnAction();
    }
    hideConfirmBar() {
        this._inspectedCardId = null;
        if (UI.confirmBar) {
            UI.confirmBar.classList.add('hidden');
            UI.confirmBar.setAttribute('aria-hidden', 'true');
        }
    }

    // ===== DRAW ANIMATIONS =====
    animateCardFly(player, delayMs = 0) {
        const fromEl = UI.drawPile;
        const toEl = document.getElementById(player.containerId);
        if (!fromEl || !toEl || typeof FeedbackDirector === 'undefined') return;
        setTimeout(() => FeedbackDirector.animateDraw(fromEl, toEl), Math.max(0, delayMs));
    }

    showDrawPenalty(player, count) {
        const area = this._areaEl(player);
        if (!area) return;
        area.classList.add('draw-penalty');
        setTimeout(() => area.classList.remove('draw-penalty'), 900);

        const badge = document.createElement('div');
        badge.className = 'draw-badge';
        badge.textContent = `+${count}`;
        area.appendChild(badge);
        setTimeout(() => badge.remove(), 2200);

        const reason = this._pendingDrawReason || this._latestActionReason || I18n.t('reason_counter');
        const reasonBanner = document.createElement('div');
        reasonBanner.className = 'penalty-reason-banner';
        reasonBanner.setAttribute('role', 'status');
        reasonBanner.textContent = I18n.t('penalty_reason_banner', { name: player.name, n: count });
        area.appendChild(reasonBanner);
        this._showTransientReason(reasonBanner.textContent, reason, 3000);
        setTimeout(() => reasonBanner.remove(), 3000);
    }

    drawMultiple(player, count, callback) {
        // درع الفانتوم: يُلغي السحب القادم على هذا اللاعب ثم يُستهلك
        if (this.drawImmune[player.id]) {
            delete this.drawImmune[player.id];
            this.showGameMessage('🦇');
            this.showToast(I18n.t('phantom_shield', { name: player.name }));
            this._recordActionJournal(I18n.t('phantom_shield', { name: player.name }), I18n.t('insight_phantom'), 'effect');
            Sound.play('skip');
            setTimeout(() => callback && callback(), 400);
            return;
        }
        this.showDrawPenalty(player, count);
        this._recordActionJournal(I18n.t('journal_penalty', { name: player.name, n: count }),
            this._pendingDrawReason || this._latestActionReason || I18n.t('reason_counter'), 'penalty');
        Sound.play('penalty-double');
        UI.drawPile.classList.add('dealing');

        let drawn = 0;
        const interval = setInterval(() => {
            if (this.deck.cards.length === 0) this.reshuffleDeck();
            const card = this.deck.draw();
            if (card) player.hand.push(card);
            this.animateCardFly(player);
            this.updateUI();
            drawn++;
            if (drawn >= count) {
                clearInterval(interval);
                UI.drawPile.classList.remove('dealing');
                setTimeout(callback, 500);
            }
        }, this.settings.batterySaver ? 120 : 320);
    }

    reshuffleDeck() {
        const top = this.discardPile.pop();
        this.deck.cards = this.discardPile;
        this.deck.shuffle();
        this.discardPile = [top];
        Sound.play('shuffle');
        this.showToast(I18n.t('reshuffling'));
    }

    playCard(player, cardIndex) {
        this.clearTurnTimer();
        let startRect = null;
        const container = document.getElementById(player.containerId);
        const playedId = player.hand[cardIndex] && player.hand[cardIndex].id;
        const sourceElement = container && ([...container.children].find(element => element.dataset && element.dataset.cardId === playedId)
            || container.children[cardIndex]);
        if (sourceElement) {
            startRect = sourceElement.getBoundingClientRect();
        }

        const previousTop = this.topCard;
        const previousActiveColor = this.activeColor;
        const card = player.hand.splice(cardIndex, 1)[0];
        if (!card) return;
        this._recordActionJournal(
            I18n.t('journal_played', { name: player.name, card: I18n.cardName(card) }),
            this._cardPlayReason(card, previousTop, previousActiveColor),
            'play',
        );
        this._trackProductEvent('action.committed', {
            actor: this._productActor(player),
            action: this._productAutoAction ? 'auto-play' : 'play',
            definitionId: card.definitionId || card.type,
        });
        this._productAutoAction = false;
        this.discardPile.push(card);
        if (card.color !== 'black') this.activeColor = card.color;
        this.updateUI();

        if (startRect && UI.discardPile.lastChild && typeof FeedbackDirector !== 'undefined') {
            const endEl = UI.discardPile.lastChild;
            const clone = this.createCardElement(card, false);
            const duration = FeedbackDirector.animateCardPlay(startRect, endEl, clone);
            setTimeout(() => {
                Sound.play('card-settle');
                if (!player.isBot && !player.isRemote) this._haptic(35);
                this.processEffect(card, player);
            }, duration);
        } else {
            Sound.play('card-settle');
            if (!player.isBot && !player.isRemote) this._haptic(35);
            this.processEffect(card, player);
        }
    }

    processEffect(card, player) {
        this._resolvingCard = card;
        if (!this._lastSkipReason) this._lastSkipReason = {};
        const skipReason = I18n.t('journal_played', { name: player.name, card: I18n.cardName(card) });
        if (['draw2', 'draw4Wild', 'meh', 'counterAttack'].includes(card.type)) {
            this._pendingDrawReason = [this.pendingDraws > 0 ? this._pendingDrawReason : '', skipReason]
                .filter(Boolean).join(' ← ').slice(-230);
        } else if (card.type === 'phantom') this._pendingDrawReason = '';
        if (card.type !== 'normal') {
            const description = this._cardInsight(card, this.players.indexOf(player)).description;
            this._recordActionJournal(I18n.t('journal_effect', { card: I18n.cardName(card), effect: description }), description, 'effect');
        }
        if (player.hand.length === 1) this.showGameMessage(I18n.t('last_card'));
        if (player.hand.length === 0) { this.showGameMessage(I18n.t('m_meh_win')); }

        const isPowerCard = ['chameleon', 'boShlakh', 'hamour', 'nokhtha', 'dramaQueen', 'sugar', 'umWajhain'].includes(card.type);
        if (isPowerCard && this.superpowersDisabled) {
            this.showToast(I18n.t('powers_disabled'));
            this.finishTurn(card, player);
            return;
        }

        switch (card.type) {
            case 'normal':
                this.finishTurn(card, player);
                break;
            case 'skip':
                this.showGameMessage(I18n.t('m_freeze'));
                this.screenFx('skip');
                this.skipNextMap[this.players[this.nextPlayerIndex()].id] = true;
                this._lastSkipReason[this.players[this.nextPlayerIndex()].id] = skipReason;
                this.updateUI();
                this.finishTurn(card, player);
                break;
            case 'reverse':
                this.showGameMessage(I18n.t('m_uturn'));
                this.direction *= -1;
                if (this.players.length === 2) {
                    this.skipNextMap[this.players[this.nextPlayerIndex()].id] = true;
                }
                this.finishTurn(card, player);
                break;
            case 'draw2':
                this.showGameMessage(I18n.t('m_plus', { n: 2 }) + ' 🤫');
                this.screenFx('draw2');
                this.pendingDraws += 2;
                this.finishTurn(card, player);
                break;
            case 'sorry':
                this.showGameMessage(I18n.t('m_sorry'));
                this.drawMultiple(player, 2, () => this.finishTurn(card, player));
                return;
            case 'counterAttack': {
                this.showGameMessage(I18n.t('m_counter'));
                this.screenFx('counter');
                // ترتدّ الهجمة: تضيف +2 وتنعكس نحو المُهاجِم الذي يأخذ دوراً ليردّ أو يسحب
                this.pendingDraws = (this.pendingDraws > 0 ? this.pendingDraws : 0) + 2;
                this.direction *= -1;
                const victimIdx = this.nextPlayerIndex();
                this.showToast(I18n.t('counter_bounce', { name: this.players[victimIdx].name, n: this.pendingDraws }));
                this.finishTurn(card, player);   // ينتقل الدور للمُهاجَم
                return;
            }
            case 'bestOne':
                this.handleBestOne(card, player);
                return;
            case 'dramaQueen':
                this.showGameMessage(I18n.t('m_drama'));
                const skip1 = this.nextPlayerIndex();
                const skip2 = this.nextPlayerIndex(skip1);
                this.skipNextMap[this.players[skip1].id] = true;
                this.skipNextMap[this.players[skip2].id] = true;
                this._lastSkipReason[this.players[skip1].id] = skipReason;
                this._lastSkipReason[this.players[skip2].id] = skipReason;
                this.updateUI();
                this.finishTurn(card, player);
                break;
            case 'nokhtha':
                this.showGameMessage(I18n.t('m_captain'));
                // الدور يرجع لك مباشرة: تلعب مرة ثانية بلا انتظار تخطّي الجميع
                setTimeout(() => this.playTurn(), 900);
                break;
            case 'plato':
                this.showGameMessage(I18n.t('m_plato'));
                this.skipNextMap[player.id] = true;
                this._lastSkipReason[player.id] = skipReason;
                this.finishTurn(card, player);
                break;
            case 'chameleon':
                this.handleChameleon(card, player);
                return;
            case 'boShlakh':
                this.handleBoShlakh(card, player);
                return;
            case 'hamour':
                this.showGameMessage(I18n.t('m_hamour'));
                const hCount = Math.min(4, this.discardPile.length - 1);
                if (hCount > 0) {
                    const lastCards = this.discardPile.splice(this.discardPile.length - 1 - hCount, hCount);
                    player.hand.push(...lastCards);
                }
                this.updateUI();
                this.finishTurn(card, player);
                break;
            case 'sugar':
                this.showGameMessage(I18n.t('m_sugar'));
                this.superpowersDisabled = true;
                this._sugarOwnerId = player.id;
                this.finishTurn(card, player);
                break;
            case 'umWajhain':
                this.handleUmWajhain(card, player);
                return;
            case 'phantom':
                this.showGameMessage(I18n.t('m_phantom'));
                this.pendingDraws = 0;
                this.drawImmune[player.id] = true;   // درع ضد أي سحب حتى دورك القادم
                this.showToast(I18n.t('cancel_draw'));
                this.finishTurn(card, player);
                break;
            case 'meh':
                this.showGameMessage(I18n.t('m_meh'));
                this.pendingDraws += 1;
                this.handleWild(player, () => this.advanceTurn());
                return;
            case 'draw4Wild':
                this.showGameMessage(I18n.t('m_draw4'));
                this.screenFx('draw4');
                this.pendingDraws += 4;
                this.handleWild(player, () => this.advanceTurn());
                return;
            case 'wild':
                this.showGameMessage(I18n.t('m_wild'));
                this.screenFx('wild');
                this.handleWild(player, () => this.advanceTurn());
                return;
            default:
                this.finishTurn(card, player);
        }
    }

    finishTurn(card, player) {
        setTimeout(() => this.advanceTurn(), 1000);
    }

    requestEffectDecision(player, kind, data, resolve) {
        const applyDecision = resolve;
        resolve = value => {
            // Server decisions are intentions until acknowledged; its real events
            // populate the journal. Local/PeerJS decisions commit here.
            if (!this._authoritativeClient) this._journalEffectDecision(player, kind, data, value);
            applyDecision(value);
        };
        if (this.autoDecide(player)) {
            resolve(this._autoEffectDecision(player, kind, data));
            return;
        }

        this.hideConfirmBar();
        this._beginDecisionContext(player, kind, data);
        const target = this.players.find(candidate => candidate.id === data.targetId);
        const warning = target && target.hand.length <= (data.discardCount || 0)
            ? I18n.t('decision_finish_warning', { name: target.name }) : '';
        const finishDecision = resolve;
        resolve = value => {
            this._decisionContext = null;
            this._cardDecision = null;
            this._renderDecisionContext();
            finishDecision(value);
        };

        if (this.online && this.isHost && player.isRemote) {
            const payload = { title: this._decisionContext.title };
            if (kind === 'choice') {
                payload.title = data.title;
                payload.opt1 = data.opt1;
                payload.opt2 = data.opt2;
                payload.warning = warning;
            } else if (kind === 'target') {
                payload.options = data.options.map(option => ({ idx: option.idx, name: option.name,
                    count: this.players[option.idx].hand.length }));
            } else if (kind === 'card') {
                payload.targetName = data.targetName || '';
                payload.options = data.options.map(option => ({ id: option.id, name: option.name }));
            }
            this.promptRemote(kind, payload, resolve);
            return;
        }

        if (kind === 'color') {
            this.isAwaitingColor = true;
            this.setDialogOpen(UI.colorPicker, true);
            this._colorCallback = resolve;
            return;
        }
        if (kind === 'target') {
            const heading = UI.playerPicker && UI.playerPicker.querySelector('h3');
            if (heading) heading.textContent = this._decisionContext.title;
            UI.playerPickerList.replaceChildren();
            data.options.forEach(option => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'picker-btn';
                const target = this.players[option.idx];
                btn.textContent = I18n.t('decision_count', { name: option.name, n: target ? target.hand.length : 0 });
                btn.onclick = () => {
                    this.setDialogOpen(UI.playerPicker, false);
                    resolve(option.idx);
                };
                UI.playerPickerList.appendChild(btn);
            });
            this.setDialogOpen(UI.playerPicker, true);
            return;
        }
        if (kind === 'choice') {
            const title = [data.title, warning].filter(Boolean).join(' ');
            this.showChoiceModal(title, data.opt1, data.opt2, () => resolve(0), () => resolve(1));
            return;
        }
        if (kind === 'card') {
            this._cardDecision = { ids: data.options.map(option => option.id), targetName: data.targetName, resolve };
            this.updateUI();
            this.focusTurnAction();
        }
    }

    _autoEffectDecision(player, kind, data) {
        if (kind === 'color') {
            const counts = {};
            player.hand.forEach(card => {
                if (card.color !== 'black') counts[card.color] = (counts[card.color] || 0) + 1;
            });
            return ONLINE_COLORS.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0))[0];
        }
        if (kind === 'choice') {
            return typeof data.botChoice === 'function' ? data.botChoice() : (data.botChoice ?? 0);
        }
        if (kind === 'target' || kind === 'card') {
            const options = data.options || [];
            if (!options.length) return null;
            const option = options[Math.floor(Math.random() * options.length)];
            return kind === 'target' ? option.idx : option.id;
        }
        return null;
    }

    _journalEffectDecision(player, kind, data, value) {
        let choice = '';
        if (kind === 'color') choice = I18n.colorName(value);
        if (kind === 'choice') choice = value === 0 ? data.opt1 : data.opt2;
        if (kind === 'target') choice = (this.players[value] || {}).name || '';
        if (kind === 'card') {
            // A donated card remains private. Only a discarded card is public.
            choice = data.targetName ? I18n.t('gave_card', { name: player.name, target: data.targetName })
                : (data.options.find(option => option.id === value) || {}).name || '';
        }
        if (choice) this._recordActionJournal(I18n.t('journal_decision', { name: player.name, choice }),
            this._resolvingCard ? I18n.cardName(this._resolvingCard) : choice, 'decision');
    }

    handleWild(player, callback) {
        this.requestEffectDecision(player, 'color', {}, (color) => {
            this.activeColor = ONLINE_COLORS.includes(color) ? color : ONLINE_COLORS[0];
            this.isAwaitingColor = false;
            this.setDialogOpen(UI.colorPicker, false);
            this.showToast(I18n.t('chose_color', {
                name: player.name,
                color: I18n.colorName(this.activeColor),
            }));
            this.updateUI();
            callback();
        });
    }

    handleColorPicked(color) {
        if (!ONLINE_COLORS.includes(color)) return;
        this.setDialogOpen(UI.colorPicker, false);
        this.isAwaitingColor = false;
        this.updateUI();
        if (this._colorCallback) {
            const callback = this._colorCallback;
            this._colorCallback = null;
            callback(color);
        }
    }

    handleBestOne(card, player) {
        this.showGameMessage(I18n.t('m_bestone'));
        const nextIdx = this.nextPlayerIndex();
        const target = this.players[nextIdx];
        this.requestEffectDecision(player, 'choice', {
            title: I18n.t('best_one_choice', { name: target.name }),
            opt1: I18n.t('throw_two'),
            opt2: I18n.t('draw_two'),
            targetId: target.id, discardCount: 2,
            botChoice: 1,
        }, (choice) => {
            if (choice === 0) {
                const count = Math.min(2, target.hand.length);
                this._storeDiscardedCards(target.hand.splice(0, count));
                this.updateUI();
                this.showToast(I18n.t('discarded_n', { name: target.name, n: count }));
                this.finishTurn(card, player);
                return;
            }
            this.drawMultiple(target, 2, () => {
                this.showToast(I18n.t('drew_two', { name: target.name }));
                this.finishTurn(card, player);
            });
        });
    }

    handleChameleon(card, player) {
        this.showGameMessage(I18n.t('m_chameleon'));
        this.pickTargetPlayer(player, (target) => {
            if (player.hand.length > 0) {
                this.showToast(I18n.t('pick_give'));
                const options = player.hand.map(handCard => ({
                    id: handCard.id,
                    name: I18n.cardName(handCard),
                }));
                this.requestEffectDecision(player, 'card', {
                    owner: player,
                    options,
                    title: I18n.t('pick_give'),
                    targetName: target.name,
                }, (cardId) => {
                    this._transferCard(player, target, cardId);
                    this.showToast(I18n.t('gave_card', { name: player.name, target: target.name }));
                    this.updateUI();
                    this.finishTurn(card, player);
                });
            } else {
                this.finishTurn(card, player);
            }
        });
    }

    handleBoShlakh(card, player) {
        this.showGameMessage(I18n.t('m_boshlakh'));
        if (player.hand.length > 0) {
            this.showToast(I18n.t('pick_discard'));
            const options = player.hand.map(handCard => ({
                id: handCard.id,
                name: I18n.cardName(handCard),
            }));
            this.requestEffectDecision(player, 'card', {
                owner: player,
                options,
                title: I18n.t('pick_discard'),
            }, (cardId) => {
                this._discardCard(player, cardId);
                this.showToast(I18n.t('discarded_done'));
                this.updateUI();
                this.finishTurn(card, player);
            });
        } else {
            this.finishTurn(card, player);
        }
    }

    handleUmWajhain(card, player) {
        this.showGameMessage(I18n.t('m_um'));
        this.pickTargetPlayer(player, (target) => {
            this.requestEffectDecision(player, 'choice', {
                title: I18n.t('um_choice', { name: target.name }),
                opt1: I18n.t('um_discard'),
                opt2: I18n.t('um_draw'),
                targetId: target.id, discardCount: 1,
                botChoice: () => Math.random() > 0.5 ? 0 : 1,
            }, (choice) => {
                if (choice === 0) {
                    if (target.hand.length > 0) this._discardRandomCard(target);
                    this.showToast(I18n.t('discarded_extra', { name: target.name }));
                    this.updateUI();
                    this.finishTurn(card, player);
                    return;
                }
                this.drawMultiple(target, 1, () => {
                    this.showToast(I18n.t('drew_card', { name: target.name }));
                    this.finishTurn(card, player);
                });
            });
        });
    }

    pickTargetPlayer(player, callback) {
        const targets = this.players.filter(candidate => candidate.id !== player.id);
        const options = targets.map(target => ({
            idx: this.players.indexOf(target),
            name: target.name,
        }));
        this.requestEffectDecision(player, 'target', { options }, (index) => {
            const target = this.players[index];
            callback(target && target.id !== player.id ? target : targets[0]);
        });
    }

    _storeDiscardedCards(cards) {
        const validCards = cards.filter(Boolean);
        if (!validCards.length) return;
        const topIndex = Math.max(0, this.discardPile.length - 1);
        this.discardPile.splice(topIndex, 0, ...validCards);
    }

    _discardCard(player, cardId) {
        const index = player.hand.findIndex(handCard => handCard.id === cardId);
        if (index < 0) return false;
        this._storeDiscardedCards(player.hand.splice(index, 1));
        return true;
    }

    _discardRandomCard(player) {
        if (!player.hand.length) return false;
        const index = Math.floor(Math.random() * player.hand.length);
        return this._discardCard(player, player.hand[index].id);
    }

    _transferCard(from, to, cardId) {
        const index = from.hand.findIndex(handCard => handCard.id === cardId);
        if (index < 0) return false;
        to.hand.push(from.hand.splice(index, 1)[0]);
        return true;
    }

    showChoiceModal(title, opt1Text, opt2Text, cb1, cb2) {
        this._showGuidance('first-choice', I18n.t('first_choice_tip'), title);
        const modal = UI.choiceModal;
        modal.querySelector('h3').innerText = title;
        const btns = modal.querySelectorAll('.choice-btn');
        btns[0].innerText = opt1Text;
        btns[1].innerText = opt2Text;
        btns[0].onclick = () => { this.setDialogOpen(modal, false); cb1(); };
        btns[1].onclick = () => { this.setDialogOpen(modal, false); cb2(); };
        this.setDialogOpen(modal, true);
    }

    endGame(winner) {
        const persistentTable = this.online && this.isHost && this.tableSession;
        if (persistentTable) {
            this._completeHostTableMatch(winner);
        } else if (this.online && this.isHost) {
            (Net.conns || []).forEach(conn => {
                Net.sendTo(conn, { t: 'gameover', youWon: winner.connPeer === conn.peer, winnerName: winner.name });
            });
        }
        this._clearOnlineRuntime();
        const humanWon = this.online ? (winner === this.players[0]) : !winner.isBot;
        this._productCompleteMatch(humanWon, winner);
        Storage.recordResult(humanWon);
        this.humanProfile = Storage.getCurrentProfile() || this.humanProfile;
        this.updateMenuChip();

        WakeLock.disable();
        Sound.play(humanWon ? 'round-resolve-win' : 'round-resolve');
        this.launchConfetti(humanWon);
        this._haptic(humanWon ? [60, 50, 90] : 80);

        UI.winnerText.innerText = humanWon
            ? I18n.t('you_win')
            : I18n.t('bot_win', { name: winner.name });
        this._updateResultPresentation(humanWon, winner.name);

        if (this.online) {
            this.online = false;
            if (!persistentTable) Net.close();
        }

        // إحصائيات العضو
        this._renderPersonalRecord();
        if (persistentTable) this._renderTableResults();
        else {
            const restart = document.getElementById('restart-btn');
            if (restart) { restart.textContent = I18n.t('play_again'); restart.disabled = false; }
        }
        this.showScreen('end-screen');
    }
}

const MehGameRuleMethods = MehGameRuleModule.prototype;
delete MehGameRuleMethods.constructor;
Object.freeze(MehGameRuleMethods);
