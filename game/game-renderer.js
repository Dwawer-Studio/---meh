'use strict';

class MehGameRendererModule {
    launchConfetti(won = true) {
        const resultScreen = document.getElementById('end-screen');
        if (typeof FeedbackDirector !== 'undefined') FeedbackDirector.result(resultScreen, won);
    }

    // ========== RENDERING ==========
    createCardElement(card, isHidden = false, playable = false, index = -1) {
        const isHumanCard = !isHidden && !!card && index !== -1;
        const div = document.createElement(isHumanCard ? 'button' : 'div');
        if (isHumanCard) div.type = 'button';
        let cls = 'card';
        if (isHidden) { cls += ' back'; }
        else if (card) { cls += ` ${card.color}`; }
        if (playable && !isHidden) cls += ' playable';
        if (!playable && !isHidden && !this.currentPlayer.isBot) cls += ' disabled';
        div.className = cls;

        if (!isHidden && card) {
            if (isHumanCard) {
                div.disabled = !playable;
                div.setAttribute('aria-label', I18n.cardName(card));
                div.setAttribute('aria-pressed', String(index === this.selectedCardIndex));
            }
            const img = document.createElement('img');
            img.alt = '';
            img.src = card.svgFile;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'contain';
            img.style.borderRadius = 'inherit';
            img.style.pointerEvents = 'none';
            img.style.transform = 'none';

            img.onerror = () => {
                img.onerror = null;
                img.style.display = 'none';
                const wheel = document.createElement('div');
                wheel.className = 'card-wheel';
                wheel.appendChild(this._createTextElement('span', 'card-emoji', card.emoji));
                const label = this._createTextElement('div', 'card-label', I18n.cardName(card));
                div.replaceChildren(wheel, label);
                this._addColorSymbol(div, card);
            };

            div.appendChild(img);
            this._addColorSymbol(div, card);

            if (playable && index !== -1) {
                div.onclick = () => {
                    if (!this.humanCanPlay || this.isAwaitingColor || this.actionInProgress) return;
                    if (this.online && !this.isHost) {
                        // العميل: أرسل للمضيف بدل اللعب محلياً
                        if (this.settings.confirmPlay && this.selectedCardIndex !== index) { this.selectCard(index); return; }
                        this.humanCanPlay = false; this.selectedCardIndex = -1; this.hideConfirmBar();
                        Net.send({ t: 'play', cardId: card.id });
                        return;
                    }
                    if (this.settings.confirmPlay) {
                        // الضغطة الأولى تعاين، والثانية على نفس البطاقة ترميها
                        if (this.selectedCardIndex === index) this.confirmSelectedCard();
                        else this.selectCard(index);
                    } else {
                        this.humanCanPlay = false;
                        this.actionInProgress = true;
                        this.playCard(this.currentPlayer, index);
                    }
                };
            }
        }
        return div;
    }

    // شارة رمز اللون (تظهر في وضع عمى الألوان)
    _addColorSymbol(div, card) {
        if (!card || !card.color) return;
        const sym = document.createElement('span');
        sym.className = 'cb-symbol';
        sym.textContent = COLOR_SYMBOLS[card.color] || '';
        div.appendChild(sym);
    }

    _updateTablePresentation() {
        const screen = document.getElementById('game-screen');
        if (!screen || !this.currentPlayer) return;

        const isLocalTurn = this.currentPlayerIndex === 0 && this.humanCanPlay
            && !this.isAwaitingColor && !this.actionInProgress;
        screen.dataset.turnIndex = String(this.currentPlayerIndex);
        screen.classList.toggle('local-turn', isLocalTurn);
        screen.classList.toggle('awaiting-decision', !!this.isAwaitingColor);
        screen.classList.toggle('pending-penalty', Number(this.pendingDraws) > 0);
        if (typeof FeedbackDirector !== 'undefined') {
            FeedbackDirector.turn(screen, this.currentPlayerIndex, this.direction, this.currentPlayer.id);
        }

        const context = document.getElementById('table-context-name');
        if (context) {
            const majlisName = this._activeMajlis && this._activeMajlis.displayName;
            context.textContent = majlisName || I18n.t(this.online ? 'online_table' : 'local_table');
        }

        const roundLabel = document.getElementById('table-round-label');
        if (roundLabel) {
            const matchNumber = Number(
                (this.tableSession && this.tableSession.matchNumber)
                || (this.tableSnapshot && this.tableSnapshot.matchNumber)
                || 1,
            );
            roundLabel.textContent = I18n.t('round_number', { n: Math.max(1, matchNumber) });
        }

        const actionLabel = document.getElementById('turn-action-label');
        if (actionLabel) {
            let actionKey = isLocalTurn ? 'table_action_choose' : 'table_action_wait';
            const params = {};
            if (isLocalTurn && Number(this.pendingDraws) > 0) {
                actionKey = 'table_action_penalty';
                params.n = this.pendingDraws;
            }
            actionLabel.textContent = I18n.t(actionKey, params);
        }
    }

    _updateSeatAccessibility(area, player) {
        if (!area || !player) return;
        area.setAttribute('aria-label', I18n.t('seat_summary', {
            name: player.name,
            n: Array.isArray(player.hand) ? player.hand.length : 0,
        }));
    }

    _updateResultPresentation(humanWon, winnerName) {
        const screen = document.getElementById('end-screen');
        if (!screen) return;
        screen.dataset.outcome = humanWon ? 'win' : 'loss';

        const resolvedName = String(winnerName || (humanWon && this.humanProfile && this.humanProfile.name) || '').trim();
        const mark = document.getElementById('result-mark');
        if (mark) mark.textContent = Array.from(resolvedName)[0] || 'م';

        const subtitle = document.getElementById('result-subtitle');
        if (subtitle) subtitle.textContent = I18n.t(humanWon ? 'result_win_subtitle' : 'result_loss_subtitle');

        const tamashiStatus = document.getElementById('result-tamashi-status');
        if (tamashiStatus) {
            const verified = !!this._authoritativeClient
                && this._productFeatureEnabled('tamashi_wallet');
            tamashiStatus.dataset.settlement = verified ? 'pending' : 'local';
            const message = tamashiStatus.querySelector('span');
            if (message) message.textContent = I18n.t(verified
                ? 'result_tamashi_pending' : 'result_tamashi_local');
        }

        const hasTable = !!(this.tableSession || this.tableSnapshot);
        const board = document.getElementById('result-board');
        if (board) board.classList.toggle('hidden', !hasTable);
        const rematchTitle = document.getElementById('rematch-title');
        if (rematchTitle && !hasTable) rematchTitle.textContent = I18n.t('rematch_title');
    }

    _renderPersonalRecord() {
        const stats = document.getElementById('end-stats');
        if (!stats) return;
        if (!this.humanProfile || this.humanProfile.guest) {
            stats.textContent = '';
            return;
        }
        const record = this.humanProfile.stats || { wins: 0, losses: 0, games: 0 };
        stats.textContent = I18n.t('personal_record_summary', record);
    }

    updateUI() {
        const canDraw = this.currentPlayerIndex === 0 && this.humanCanPlay
            && !this.isAwaitingColor && !this.actionInProgress;
        if (UI.drawPile) {
            UI.drawPile.disabled = !canDraw;
            UI.drawPile.setAttribute('aria-label', I18n.t('draw_card'));
        }

        // Discard pile
        UI.discardPile.replaceChildren();
        if (this.discardPile.length > 1) {
            const secondTop = this.discardPile[this.discardPile.length - 2];
            const secondEl = this.createCardElement(secondTop, false, false);
            UI.discardPile.appendChild(secondEl);
        }
        if (this.topCard) {
            const topEl = this.createCardElement(this.topCard, false, false);
            if (this.topCard.color === 'black' && this.activeColor) {
                topEl.style.boxShadow = `0 0 20px var(--${this.activeColor}), 0 0 40px var(--${this.activeColor})`;
            }
            UI.discardPile.appendChild(topEl);
        }

        // Color indicator
        const indicator = document.getElementById('color-indicator');
        if (indicator) {
            indicator.className = `color-indicator ${this.activeColor}`;
            const sym = this.settings.colorblind ? (COLOR_SYMBOLS[this.activeColor] || '') + ' ' : '';
            indicator.innerText = sym + I18n.colorName(this.activeColor);
        }

        // باقي اللاعبين (المقاعد 1..3) — مراوح حول الطاولة (أنا دائماً المقعد 0)
        this.players.slice(1).forEach(bot => {
            const area = this._areaEl(bot);
            if (area) {
                const nm = area.querySelector('.player-name'); if (nm) nm.textContent = bot.name;
                const av = area.querySelector('.player-avatar'); if (av) av.textContent = bot.avatar;
                this._updateSeatAccessibility(area, bot);
            }
            const el = document.getElementById(bot.countId);
            if (el) el.innerText = bot.hand.length;
            const container = document.getElementById(bot.containerId);
            container.replaceChildren();
            const count = Math.min(bot.hand.length, 9);
            if (count === 0) { container.style.transform = 'none'; return; }

            // دوران اليد الجانبية 90° (يمين +90، يسار -90)
            let sideRot = 0;
            if (area && area.classList.contains('left-player')) sideRot = -90;
            else if (area && area.classList.contains('right-player')) sideRot = 90;
            container.style.transform = sideRot ? `rotate(${sideRot}deg)` : 'none';

            const halfCount = (count - 1) / 2;

            for (let i = 0; i < count; i++) {
                const cardObj = this.devShowBotHands ? bot.hand[i] : null;
                const card = this.createCardElement(cardObj, !this.devShowBotHands);
                const t = i - halfCount;
                // مروحة أنيقة (تدور مع اليد للجوانب)
                card.style.transformOrigin = 'bottom center';
                card.style.transform = `translateX(${t * 22}px) translateY(${Math.abs(t) * 3}px) rotate(${t * 6}deg)`;
                card.style.zIndex = i;
                container.appendChild(card);
            }
        });

        // Human hand — fan into an arc when many cards
        const human = this.players[0];
        const hc = document.getElementById(human.containerId);
        hc.replaceChildren();
        // اسم وصورة العضو
        const hArea = document.getElementById('player-human');
        if (hArea) {
            hArea.querySelector('.player-name').textContent = human.name;
            hArea.querySelector('.player-avatar').textContent = human.avatar;
            this._updateSeatAccessibility(hArea, human);
            const hCount = document.getElementById('human-count');
            if (hCount) hCount.textContent = human.hand.length;
        }
        // ليس دور اللاعب إن كان معلَّماً للتخطّي (يمنع اللعب خارج الدور أثناء التخطّي)
        const isHumanTurn = this.currentPlayerIndex === 0 && !this.isAwaitingColor
            && !this.skipNextMap[human.id];

        human.hand.sort((a, b) => {
            const co = { orange: 1, gray: 2, purple: 3, black: 4 };
            if (a.color !== b.color) return (co[a.color] || 9) - (co[b.color] || 9);
            return a.name.localeCompare(b.name, 'ar');
        });

        const n = human.hand.length;
        const mid = (n - 1) / 2;
        const isShortLandscape = window.innerHeight <= 520 && window.innerWidth > window.innerHeight;
        const isDenseHand = n > 10;
        const cardW = isShortLandscape ? 82 : (window.innerWidth <= 620 ? 94 : 116);
        const handScroller = hc.parentElement;
        if (handScroller) handScroller.classList.toggle('is-dense-hand', isDenseHand);
        // تداخل ديناميكي: يوزّع البطاقات على عرض متاح مع ضمان حد أدنى مرئي لكل بطاقة
        const avail = Math.min(window.innerWidth * 0.92, 1150);
        let overlap = -10;
        if (n > 1) {
            const fit = (avail - cardW) / (n - 1) - cardW;   // التباعد المثالي ليملأ العرض
            overlap = Math.max(-70, Math.min(fit, -10));      // بين -70 (لا يختفي) و -10 (تداخل خفيف)
        }
        const step = Math.min(3, 40 / Math.max(n, 1));        // ميل لطيف جداً

        human.hand.forEach((card, i) => {
            let playable = false;
            if (isHumanTurn && !this.actionInProgress) {
                playable = this.isCardPlayableNow(card);
            }
            const el = this.createCardElement(card, false, playable, i);

            // قوس لطيف — الحواف ترتفع قليلاً للأعلى
            const offset = i - mid;
            const rot = isDenseHand ? 0 : offset * step;
            const ty = isDenseHand ? 0 : -Math.min(26, offset * offset * 0.7);
            el.style.setProperty('--rot', rot.toFixed(2) + 'deg');
            el.style.setProperty('--ty', ty.toFixed(1) + 'px');
            el.style.marginInlineEnd = (i < n - 1 ? (isDenseHand ? -32 : overlap) : 0) + 'px';
            el.style.zIndex = i;

            if (i === this.selectedCardIndex) el.classList.add('selected');

            hc.appendChild(el);
        });

        // Active player highlight
        document.querySelectorAll('.player-area').forEach(a => a.classList.remove('active-player'));
        const activeArea = this._areaEl(this.currentPlayer);
        if (activeArea) activeArea.classList.add('active-player');

        // اتجاه المؤشّر الدوّار (RTL يقلب ترتيب الجلوس، فنعكس الشرط ليطابق الدور الفعلي)
        const dirRing = document.getElementById('dir-ring');
        if (dirRing) dirRing.classList.toggle('ccw', this.direction === 1);

        // علامة التوقف 🛑 للاعبين الذين سيُتخطّون (رمادي + إشارة حمراء)
        this.players.forEach(p => {
            const a = this._areaEl(p);
            if (a) a.classList.toggle('skipped', !!this.skipNextMap[p.id]);
        });

        // إخفاء شريط التأكيد إن لم تعد هناك بطاقة مختارة أو ليس دور اللاعب
        if (this.selectedCardIndex < 0 || !isHumanTurn) this.hideConfirmBar();

        // مؤقّت الدور المرئي (أونلاين): يبدأ مرة واحدة عند بدء دوري
        const myTurn = this.online && this.humanCanPlay;
        const tt = document.getElementById('turn-timer');
        if (tt) {
            if (myTurn && !this._timerShown) {
                tt.classList.remove('hidden', 'run'); void tt.offsetWidth; tt.classList.add('run');
                this._startTurnCountdownVisual(this._turnDurationSeconds || 10);
                this._timerShown = true;
            } else if (!myTurn && this._timerShown) {
                tt.classList.add('hidden'); tt.classList.remove('run');
                this._stopTurnCountdownVisual();
                this._timerShown = false;
            }
        }

        // نبضة عند تغيّر ورقة المرمى (تغذية بصرية للعميل)
        if (this.topCard && this._lastTopId !== this.topCard.id) {
            this._lastTopId = this.topCard.id;
            if (this.online && !this.isHost) {
                const dp = UI.discardPile.lastChild;
                if (dp) { dp.classList.remove('card-pop'); void dp.offsetWidth; dp.classList.add('card-pop'); }
            }
        }

        // أونلاين: المضيف يبثّ الحالة لكل العملاء بعد كل تحديث
        if (this.online && this.isHost) this.broadcastGameState();
        this._updateTablePresentation();
    }

    showGameMessage(text) {
        UI.gameMessage.innerText = text;
        UI.gameMessage.classList.remove('hidden');
        UI.gameMessage.classList.remove('pop');
        void UI.gameMessage.offsetHeight;
        UI.gameMessage.classList.add('pop');
        setTimeout(() => UI.gameMessage.classList.add('hidden'), 1500);
    }

    showToast(msg) {
        const t = document.createElement('div');
        t.className = 'toast';
        t.innerText = msg;
        UI.toastContainer.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }

    // نبضة حدّ واحدة بلا وميض؛ المعنى الأساسي يبقى في النص/السجل.
    screenFx(kind) {
        const gs = document.getElementById('game-screen');
        if (typeof FeedbackDirector !== 'undefined') FeedbackDirector.impact(gs, kind);
    }

    colorName(c) {
        return I18n.colorName(c);
    }
}

const MehGameRendererMethods = MehGameRendererModule.prototype;
delete MehGameRendererMethods.constructor;
Object.freeze(MehGameRendererMethods);
