const UI = {
    get mainMenu() { return document.getElementById('main-menu'); },
    get instructionsScreen() { return document.getElementById('instructions-screen'); },
    get gameScreen() { return document.getElementById('game-screen'); },
    get endScreen() { return document.getElementById('end-screen'); },
    get drawPile() { return document.getElementById('draw-pile'); },
    get discardPile() { return document.getElementById('discard-pile'); },
    get colorPicker() { return document.getElementById('color-picker'); },
    get playerPicker() { return document.getElementById('player-picker'); },
    get playerPickerList() { return document.getElementById('player-picker-list'); },
    get choiceModal() { return document.getElementById('choice-modal'); },
    get turnIndicator() { return document.getElementById('current-player-name'); },
    get gameMessage() { return document.getElementById('game-message'); },
    get toastContainer() { return document.getElementById('toast-container'); },
    get winnerText() { return document.getElementById('winner-text'); },
    get confirmBar() { return document.getElementById('confirm-bar'); },
};

const playersConfig = [
    { id: 'human', name: 'أنت', avatar: '😎', isBot: false, containerId: 'human-hand', countId: null },
    { id: 'bot-1', name: 'أحمد', avatar: '🤖', isBot: true, containerId: 'bot-1-hand', countId: 'bot-1-count' },
    { id: 'bot-2', name: 'نورة', avatar: '🤖', isBot: true, containerId: 'bot-2-hand', countId: 'bot-2-count' },
    { id: 'bot-3', name: 'خالد', avatar: '🤖', isBot: true, containerId: 'bot-3-hand', countId: 'bot-3-count' },
];

// بطاقات شاشة التعليمات (الاسم العربي الثابت + ملف الصورة)
const INSTR_SPECIAL = [
    { ar: 'مه', img: 'black-meh' },
    { ar: 'شنو كنت تقول', img: 'black-draw4Wild' },
    { ar: 'طلعت يا محلى نورها', img: 'black-wild' },
    { ar: 'انثبر مكانك', img: 'orange-skip' },
    { ar: 'يوتيرن', img: 'orange-reverse' },
    { ar: 'اسكت اسكت', img: 'orange-draw2' },
    { ar: 'هجمة مرتدة', img: 'orange-counterAttack' },
    { ar: 'أنا آسف', img: 'orange-sorry' },
    { ar: 'انت احسن واحد', img: 'orange-bestOne' },
];
const INSTR_POWER = [
    { ar: 'بوشلاخ', img: 'orange-boShlakh' },
    { ar: 'الحرباية', img: 'orange-chameleon' },
    { ar: 'ام وجهين', img: 'orange-umWajhain' },
    { ar: 'النوخذه', img: 'orange-nokhtha' },
    { ar: 'دراما كوين', img: 'orange-dramaQueen' },
    { ar: 'افلاطون', img: 'orange-plato' },
    { ar: 'شوقر', img: 'orange-sugar' },
    { ar: 'الهامور', img: 'orange-hamour' },
    { ar: 'فانتوم', img: 'orange-phantom' },
];

const AVATARS = ['😎','😀','😂','🤩','😍','🥳','🤠','👻','🐱','🦁','🐯','🦄','🐲','🤖','👑','🌟'];

class MehGame {
    constructor() {
        this.deck = null;
        this.discardPile = [];
        this.players = [];
        this.currentPlayerIndex = 0;
        this.direction = 1;
        this.activeColor = '';
        this.pendingDraws = 0;
        this.isAwaitingColor = false;
        this.actionInProgress = false;
        this.skipNextMap = {};
        this.superpowersDisabled = false;
        this.selectedCardIndex = -1;      // لتأكيد رمي البطاقة
        this.drawImmune = {};             // درع الفانتوم: حصانة ضد السحب
        this.humanCanPlay = false;        // بوابة صريحة: متى يُسمح للاعب البشري بالفعل
        this._pendingAvatar = '😎';

        // الإعدادات والعضو
        this.settings = Storage.getSettings();
        this.humanProfile = Storage.getCurrentProfile()
            || { name: I18n.t('guest'), avatar: '😎', guest: true };

        // Dev options
        this.devShowBotHands = false;
        window.game = this;

        this.applySettings();
        this.bindMenuEvents();
        this.bindDevEvents();
        this.bindSettingsEvents();
        this.bindProfileEvents();
        this.bindEmojiEvents();
        this.renderInstructions();
        this.initProfile();
        this.runSplash();

        // صوت نقرة عام للأزرار
        document.addEventListener('click', (e) => {
            if (e.target.closest('.btn, .corner-btn, .emoji-toggle-btn, .lang-btn, .picker-btn, .avatar-option, .profile-item')) {
                Sound.play('click');
            }
        });
    }

    runSplash() {
        const s = document.getElementById('splash');
        if (!s) return;
        setTimeout(() => s.classList.add('gone'), 1300);
        setTimeout(() => s.remove(), 1900);
    }

    // ============ الإعدادات ============
    applySettings() {
        I18n.setLang(this.settings.lang);   // يطبّق الترجمة والاتجاه
        document.body.classList.toggle('colorblind', !!this.settings.colorblind);
        document.body.classList.toggle('battery-saver', !!this.settings.batterySaver);
        Sound.setEnabled(this.settings.sound !== false);
        this.renderInstructions();
        this.updateMenuChip();
    }

    bindSettingsEvents() {
        const open = () => { this.showScreen('settings-screen'); this.refreshSettingsUI(); };
        document.getElementById('menu-settings-btn').onclick = open;
        document.getElementById('settings-back-btn').onclick = () => this.showScreen('main-menu');

        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.onclick = () => {
                this.settings.lang = btn.dataset.lang;
                Storage.setSetting('lang', this.settings.lang);
                I18n.setLang(this.settings.lang);
                this.renderInstructions();
                this.updateMenuChip();
                this.refreshSettingsUI();
            };
        });

        document.querySelectorAll('.toggle-row').forEach(row => {
            row.onclick = () => {
                const key = row.dataset.setting;
                this.settings[key] = !this.settings[key];
                Storage.setSetting(key, this.settings[key]);
                if (key === 'colorblind') document.body.classList.toggle('colorblind', this.settings[key]);
                if (key === 'batterySaver') document.body.classList.toggle('battery-saver', this.settings[key]);
                if (key === 'wakeLock') {
                    if (this.settings[key]) WakeLock.enable(); else WakeLock.disable();
                }
                if (key === 'sound') Sound.setEnabled(this.settings[key]);
                Sound.play('click');
                this.refreshSettingsUI();
            };
        });
    }

    refreshSettingsUI() {
        document.querySelectorAll('.lang-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.lang === this.settings.lang));
        document.querySelectorAll('.toggle-row').forEach(row => {
            const key = row.dataset.setting;
            row.querySelector('.switch').classList.toggle('on', !!this.settings[key]);
        });
    }

    // ============ الأعضاء ============
    initProfile() {
        const current = Storage.getCurrentProfile();
        if (current) {
            this.humanProfile = current;
            this.updateMenuChip();
        } else {
            this.showScreen('profile-screen');
            this.renderProfileList();
        }
    }

    bindProfileEvents() {
        document.getElementById('players-btn').onclick = () => {
            this.showScreen('profile-screen');
            this.renderProfileList();
        };
        document.getElementById('show-create-profile').onclick = () => {
            document.getElementById('create-profile-form').classList.remove('hidden');
            this.renderAvatarPicker();
            document.getElementById('profile-name-input').focus();
        };
        document.getElementById('profile-back-btn').onclick = () => {
            document.getElementById('create-profile-form').classList.add('hidden');
            this.showScreen('main-menu');
        };
        document.getElementById('save-profile-btn').onclick = () => {
            const name = document.getElementById('profile-name-input').value.trim();
            if (!name) { document.getElementById('profile-name-input').focus(); return; }
            this.humanProfile = Storage.createProfile(name, this._pendingAvatar);
            document.getElementById('profile-name-input').value = '';
            document.getElementById('create-profile-form').classList.add('hidden');
            this.updateMenuChip();
            this.showScreen('main-menu');
            this.showToast(I18n.t('welcome', { name }));
        };
    }

    renderAvatarPicker() {
        const wrap = document.getElementById('avatar-picker');
        wrap.innerHTML = '';
        this._pendingAvatar = this._pendingAvatar || AVATARS[0];
        AVATARS.forEach(a => {
            const b = document.createElement('button');
            b.className = 'avatar-option' + (a === this._pendingAvatar ? ' selected' : '');
            b.textContent = a;
            b.onclick = () => {
                this._pendingAvatar = a;
                wrap.querySelectorAll('.avatar-option').forEach(x => x.classList.remove('selected'));
                b.classList.add('selected');
            };
            wrap.appendChild(b);
        });
    }

    renderProfileList() {
        const list = document.getElementById('profile-list');
        list.innerHTML = '';
        const profiles = Storage.getProfiles();
        const currentId = (Storage.getCurrentProfile() || {}).id;
        profiles.forEach(p => {
            const item = document.createElement('div');
            item.className = 'profile-item' + (p.id === currentId ? ' current' : '');
            const s = p.stats || { wins: 0, losses: 0, games: 0 };
            item.innerHTML = `
                <span class="profile-avatar">${p.avatar}</span>
                <span class="profile-name">${p.name}</span>
                <span class="profile-stats">🏆 ${s.wins} · 🎮 ${s.games}</span>
                <button class="profile-del" title="delete">🗑️</button>`;
            item.querySelector('.profile-del').onclick = (e) => {
                e.stopPropagation();
                Storage.deleteProfile(p.id);
                if (this.humanProfile && this.humanProfile.id === p.id) {
                    this.humanProfile = { name: I18n.t('guest'), avatar: '😎', guest: true };
                    this.updateMenuChip();
                }
                this.renderProfileList();
            };
            item.onclick = () => {
                Storage.setCurrentProfile(p.id);
                this.humanProfile = p;
                this.updateMenuChip();
                this.showScreen('main-menu');
                this.showToast(I18n.t('welcome', { name: p.name }));
            };
            list.appendChild(item);
        });
    }

    updateMenuChip() {
        const chip = document.getElementById('current-player-chip');
        if (!chip) return;
        if (this.humanProfile && !this.humanProfile.guest) {
            const s = this.humanProfile.stats || { wins: 0, games: 0 };
            chip.innerHTML = `${this.humanProfile.avatar} <strong>${this.humanProfile.name}</strong> &nbsp;🏆 ${s.wins} · 🎮 ${s.games}`;
            chip.classList.remove('hidden');
        } else {
            chip.classList.add('hidden');
        }
    }

    // ============ الإيموجي ============
    bindEmojiEvents() {
        const bar = document.getElementById('emoji-bar');
        const toggle = document.getElementById('emoji-toggle-btn');
        EMOJIS.forEach(e => {
            const b = document.createElement('button');
            b.className = 'emoji-btn';
            b.textContent = e;
            b.onclick = () => {
                spawnEmoji(e, 'human');
                bar.classList.add('hidden');
            };
            bar.appendChild(b);
        });
        toggle.onclick = () => bar.classList.toggle('hidden');
    }

    botMaybeEmoji(bot) {
        // البوتات تتفاعل أحياناً بالإيموجي
        if (Math.random() < 0.22) {
            spawnEmoji(EMOJIS[Math.floor(Math.random() * EMOJIS.length)], bot.id);
        }
    }

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
        const panel = document.getElementById('dev-panel');
        if (toggleBtn) toggleBtn.onclick = () => panel.classList.toggle('hidden');

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
            UI.colorPicker.classList.remove('hidden');
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
        document.getElementById('restart-btn').addEventListener('click', () => this.startGame());
        document.getElementById('end-menu-btn').addEventListener('click', () => this.showScreen('main-menu'));
    }

    showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(id).classList.add('active');
    }

    startGame() {
        this.showScreen('game-screen');
        if (this.settings.wakeLock) WakeLock.enable();

        this.deck = new Deck();
        this.discardPile = [];
        this.pendingDraws = 0;
        this.direction = 1;
        this.currentPlayerIndex = 0;
        this.isAwaitingColor = false;
        this.actionInProgress = true;     // قفل التفاعل أثناء التوزيع
        this.skipNextMap = {};
        this.superpowersDisabled = false;
        this.selectedCardIndex = -1;
        this.drawImmune = {};
        this.humanCanPlay = false;
        this.activeColor = '';
        this.hideConfirmBar();

        this.players = playersConfig.map(c => ({ ...c, hand: [] }));
        // اسم وصورة العضو الحالي
        this.players[0].name = this.humanProfile.name;
        this.players[0].avatar = this.humanProfile.avatar;

        this.bindGameEvents();
        this.updateUI();                  // أيدٍ فارغة + عدّادات صفر

        // توزيع حقيقي: ورقة ورقة، يزيد العدّاد مع كل واحدة
        this.dealCards(() => {
            let initial = this.deck.draw();
            while (initial.color === 'black') {
                this.deck.cards.unshift(initial);
                initial = this.deck.draw();
            }
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
        this.selectedCardIndex = -1;
        this.humanCanPlay = false;
        this.hideConfirmBar();
        this.currentPlayerIndex = this.nextPlayerIndex();
        this.updateUI();
        this.playTurn();
    }

    playTurn() {
        const winner = this.players.find(p => p.hand.length === 0);
        if (winner) { this.endGame(winner); return; }

        this.actionInProgress = false;
        this.humanCanPlay = false;       // يُمنح فقط عند وصول دور اللاعب الفعلي
        const player = this.currentPlayer;
        UI.turnIndicator.innerText = player.name;

        if (this.skipNextMap[player.id]) {
            delete this.skipNextMap[player.id];
            Sound.play('skip');
            this.showToast(I18n.t('skips_turn', { name: player.name }));
            setTimeout(() => this.advanceTurn(), 1000);
            return;
        }

        if (this.pendingDraws > 0) {
            const hasPhantom = player.hand.some(c => c.type === 'phantom' && c.isPlayable(this.topCard, this.activeColor));
            const hasCounter = player.hand.some(c => ['draw2', 'draw4Wild', 'meh', 'counterAttack'].includes(c.type));
            if (!hasPhantom && !hasCounter) {
                this.actionInProgress = true;
                this.showGameMessage(I18n.t('m_plus', { n: this.pendingDraws }));
                this.drawMultiple(player, this.pendingDraws, () => {
                    this.pendingDraws = 0;
                    this.advanceTurn();
                });
                return;
            }
        }

        if (player.isBot) {
            setTimeout(() => this.playBotTurn(), 1200);
        } else {
            Sound.play('turn');
            this.humanCanPlay = true;    // ✅ الآن فقط يُسمح للاعب بالفعل
            this.updateUI();
            const hasPlayable = player.hand.some(c => c.isPlayable(this.topCard, this.activeColor));
            if (!hasPlayable && this.pendingDraws === 0) {
                this.humanCanPlay = false;
                this.actionInProgress = true;
                this.showToast(I18n.t('no_card_draw'));
                setTimeout(() => {
                    this.handleDrawCard(player);
                    setTimeout(() => this.advanceTurn(), 600);
                }, 1200);
            }
        }
    }

    playBotTurn() {
        const bot = this.currentPlayer;
        this.botMaybeEmoji(bot);
        let cardIndex = -1;

        if (this.pendingDraws > 0) {
            cardIndex = bot.hand.findIndex(c =>
                ['draw2', 'draw4Wild', 'meh', 'counterAttack'].includes(c.type) ||
                (c.type === 'phantom' && c.isPlayable(this.topCard, this.activeColor)));
        } else {
            cardIndex = bot.hand.findIndex(c => c.isPlayable(this.topCard, this.activeColor) && c.type !== 'sorry' && c.type !== 'plato' && c.type !== 'hamour');
            if (cardIndex === -1) {
                cardIndex = bot.hand.findIndex(c => c.isPlayable(this.topCard, this.activeColor));
            }
        }

        if (cardIndex !== -1) {
            this.playCard(bot, cardIndex);
        } else {
            this.handleDrawCard(bot);
            setTimeout(() => this.advanceTurn(), 800);
        }
    }

    handleDrawClick() {
        if (!this.humanCanPlay || this.isAwaitingColor || this.actionInProgress) return;
        this.humanCanPlay = false;
        this.actionInProgress = true;
        this.selectedCardIndex = -1;
        this.hideConfirmBar();
        if (this.pendingDraws > 0) {
            // أخذ عقوبة السحب المعلّقة كاملة بدل بطاقة واحدة
            const n = this.pendingDraws;
            this.pendingDraws = 0;
            this.drawMultiple(this.currentPlayer, n, () => this.advanceTurn());
        } else {
            this.handleDrawCard(this.currentPlayer);
            setTimeout(() => this.advanceTurn(), 500);
        }
    }

    handleDrawCard(player) {
        if (this.deck.cards.length === 0) this.reshuffleDeck();
        const card = this.deck.draw();
        if (card) {
            player.hand.push(card);
            Sound.play('draw');
            this.animateCardFly(player);
            this.updateUI();
        }
    }

    // ===== تأكيد رمي البطاقة =====
    selectCard(index) {
        this.selectedCardIndex = index;
        this.updateUI();
        UI.confirmBar.classList.remove('hidden');
    }
    confirmSelectedCard() {
        if (this.selectedCardIndex < 0 || !this.humanCanPlay) return;
        const idx = this.selectedCardIndex;
        this.selectedCardIndex = -1;
        this.hideConfirmBar();
        this.humanCanPlay = false;
        this.actionInProgress = true;
        this.playCard(this.currentPlayer, idx);
    }
    cancelSelectedCard() {
        this.selectedCardIndex = -1;
        this.hideConfirmBar();
        this.updateUI();
    }
    hideConfirmBar() {
        if (UI.confirmBar) UI.confirmBar.classList.add('hidden');
    }

    // ===== DRAW ANIMATIONS =====
    animateCardFly(player, delayMs = 0) {
        if (this.settings.batterySaver) return;  // توفير البطارية: لا حركات
        const fromEl = UI.drawPile;
        const toEl = document.getElementById(player.containerId);
        if (!fromEl || !toEl) return;

        const fromRect = fromEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();

        const fly = document.createElement('div');
        fly.className = 'card back draw-fly-card';
        fly.style.cssText = `
            position: fixed;
            width: 72px; height: 104px;
            top:  ${fromRect.top + fromRect.height / 2 - 52}px;
            left: ${fromRect.left + fromRect.width / 2 - 36}px;
            z-index: 9998;
            pointer-events: none;
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0,0,0,.6);
            transition: none;
        `;
        document.body.appendChild(fly);

        const destTop = toRect.top + toRect.height / 2 - 52;
        const destLeft = toRect.left + toRect.width / 2 - 36;

        setTimeout(() => {
            fly.style.transition = 'top .45s cubic-bezier(.4,0,.2,1), left .45s cubic-bezier(.4,0,.2,1), transform .45s, opacity .2s .3s';
            fly.style.top = destTop + 'px';
            fly.style.left = destLeft + 'px';
            fly.style.transform = 'scale(0.55) rotate(12deg)';
            fly.style.opacity = '0';
            setTimeout(() => fly.remove(), 500);
        }, delayMs + 30);
    }

    showDrawPenalty(player, count) {
        const area = document.getElementById(`player-${player.id}`);
        if (!area) return;
        area.classList.add('draw-penalty');
        setTimeout(() => area.classList.remove('draw-penalty'), 900);

        const badge = document.createElement('div');
        badge.className = 'draw-badge';
        badge.textContent = `+${count}`;
        area.appendChild(badge);
        setTimeout(() => badge.remove(), 2200);
    }

    drawMultiple(player, count, callback) {
        // درع الفانتوم: يُلغي السحب القادم على هذا اللاعب ثم يُستهلك
        if (this.drawImmune[player.id]) {
            delete this.drawImmune[player.id];
            this.showGameMessage('🦇');
            this.showToast(I18n.t('phantom_shield', { name: player.name }));
            Sound.play('skip');
            setTimeout(() => callback && callback(), 400);
            return;
        }
        this.showDrawPenalty(player, count);
        Sound.play('penalty');
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
        let startRect = null;
        const container = document.getElementById(player.containerId);
        if (container && container.children[cardIndex]) {
            startRect = container.children[cardIndex].getBoundingClientRect();
        }

        const card = player.hand.splice(cardIndex, 1)[0];
        this.discardPile.push(card);
        if (card.color !== 'black') this.activeColor = card.color;
        Sound.play('cardPlay');

        this.updateUI();

        if (!this.settings.batterySaver && startRect && UI.discardPile.lastChild) {
            const endEl = UI.discardPile.lastChild;
            const endRect = endEl.getBoundingClientRect();

            const clone = this.createCardElement(card, false);
            clone.style.position = 'fixed';
            clone.style.top = startRect.top + 'px';
            clone.style.left = startRect.left + 'px';
            clone.style.margin = '0';
            clone.style.zIndex = '9999';
            clone.style.transition = 'all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)';
            clone.style.boxShadow = '0 10px 20px rgba(0,0,0,0.3)';
            document.body.appendChild(clone);

            endEl.style.opacity = '0';

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    clone.style.top = endRect.top + 'px';
                    clone.style.left = endRect.left + 'px';
                    clone.style.transform = `rotate(${Math.random() * 20 - 10}deg) scale(1)`;
                });
            });

            setTimeout(() => {
                endEl.style.opacity = '1';
                clone.remove();
                this.processEffect(card, player);
            }, 400);
        } else {
            this.processEffect(card, player);
        }
    }

    processEffect(card, player) {
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
                setTimeout(() => { this.superpowersDisabled = false; }, 15000);
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

    handleWild(player, callback) {
        if (player.isBot) {
            const colors = ['orange', 'gray', 'purple'];
            const colorCounts = {};
            for (const c of player.hand) {
                if (c.color !== 'black') colorCounts[c.color] = (colorCounts[c.color] || 0) + 1;
            }
            let best = colors[0];
            let max = 0;
            for (const c of colors) {
                if ((colorCounts[c] || 0) > max) { max = colorCounts[c] || 0; best = c; }
            }
            this.activeColor = best;
            this.showToast(I18n.t('chose_color', { name: player.name, color: I18n.colorName(best) }));
            this.updateUI();
            callback();
        } else {
            this.isAwaitingColor = true;
            UI.colorPicker.classList.remove('hidden');
            this._colorCallback = callback;
        }
    }

    handleColorPicked(color) {
        this.activeColor = color;
        UI.colorPicker.classList.add('hidden');
        this.isAwaitingColor = false;
        this.updateUI();
        if (this._colorCallback) { this._colorCallback(); this._colorCallback = null; }
    }

    handleBestOne(card, player) {
        this.showGameMessage(I18n.t('m_bestone'));
        const nextIdx = this.nextPlayerIndex();
        const target = this.players[nextIdx];
        if (player.isBot) {
            this.drawMultiple(target, 2, () => {
                this.showToast(I18n.t('drew_two', { name: target.name }));
                this.finishTurn(card, player);
            });
        } else {
            this.showChoiceModal(
                I18n.t('best_one_choice', { name: target.name }),
                I18n.t('throw_two'), I18n.t('draw_two'),
                () => {
                    const count = Math.min(2, target.hand.length);
                    target.hand.splice(0, count);
                    this.updateUI();
                    this.showToast(I18n.t('discarded_n', { name: target.name, n: count }));
                    this.finishTurn(card, player);
                },
                () => {
                    this.drawMultiple(target, 2, () => {
                        this.showToast(I18n.t('drew_two', { name: target.name }));
                        this.finishTurn(card, player);
                    });
                }
            );
        }
    }

    handleChameleon(card, player) {
        this.showGameMessage(I18n.t('m_chameleon'));
        if (player.isBot) {
            if (player.hand.length > 0) {
                const targets = this.players.filter(p => p.id !== player.id);
                const target = targets[Math.floor(Math.random() * targets.length)];
                const gi = Math.floor(Math.random() * player.hand.length);
                const given = player.hand.splice(gi, 1)[0];
                target.hand.push(given);
                this.showToast(I18n.t('gave_card', { name: player.name, target: target.name }));
                this.updateUI();
            }
            this.finishTurn(card, player);
        } else {
            this.pickTargetPlayer(player, (target) => {
                if (player.hand.length > 0) {
                    this.showToast(I18n.t('pick_give'));
                    this.enableCardGiving(player, target, () => this.finishTurn(card, player));
                } else {
                    this.finishTurn(card, player);
                }
            });
        }
    }

    enableCardGiving(player, target, callback) {
        const container = document.getElementById(player.containerId);
        const cards = container.querySelectorAll('.card');
        cards.forEach((el, i) => {
            el.classList.add('playable');
            el.classList.remove('disabled');
            el.onclick = () => {
                const given = player.hand.splice(i, 1)[0];
                target.hand.push(given);
                this.showToast(I18n.t('gave_card_you', { target: target.name }));
                this.updateUI();
                callback();
            };
        });
    }

    handleBoShlakh(card, player) {
        this.showGameMessage(I18n.t('m_boshlakh'));
        if (player.isBot) {
            if (player.hand.length > 0) {
                player.hand.splice(0, 1);
                this.showToast(I18n.t('discarded_extra', { name: player.name }));
                this.updateUI();
            }
            this.finishTurn(card, player);
        } else {
            if (player.hand.length > 0) {
                this.showToast(I18n.t('pick_discard'));
                this.enableCardDiscard(player, () => this.finishTurn(card, player));
            } else {
                this.finishTurn(card, player);
            }
        }
    }

    enableCardDiscard(player, callback) {
        const container = document.getElementById(player.containerId);
        const cards = container.querySelectorAll('.card');
        cards.forEach((el, i) => {
            el.classList.add('playable');
            el.classList.remove('disabled');
            el.onclick = () => {
                const discarded = player.hand.splice(i, 1)[0];
                this.discardPile.push(discarded);
                this.showToast(I18n.t('discarded_done'));
                this.updateUI();
                callback();
            };
        });
    }

    handleUmWajhain(card, player) {
        this.showGameMessage(I18n.t('m_um'));
        if (player.isBot) {
            const targets = this.players.filter(p => p.id !== player.id);
            const target = targets[Math.floor(Math.random() * targets.length)];
            if (Math.random() > 0.5 && target.hand.length > 0) {
                target.hand.splice(0, 1);
                this.showToast(I18n.t('discarded_extra', { name: target.name }));
                this.updateUI();
                this.finishTurn(card, player);
            } else {
                this.drawMultiple(target, 1, () => {
                    this.showToast(I18n.t('drew_card', { name: target.name }));
                    this.finishTurn(card, player);
                });
            }
        } else {
            this.pickTargetPlayer(player, (target) => {
                this.showChoiceModal(
                    I18n.t('um_choice', { name: target.name }),
                    I18n.t('um_discard'), I18n.t('um_draw'),
                    () => {
                        if (target.hand.length > 0) {
                            target.hand.splice(Math.floor(Math.random() * target.hand.length), 1);
                            this.showToast(I18n.t('discarded_extra', { name: target.name }));
                        }
                        this.updateUI();
                        this.finishTurn(card, player);
                    },
                    () => {
                        this.drawMultiple(target, 1, () => {
                            this.showToast(I18n.t('drew_card', { name: target.name }));
                            this.finishTurn(card, player);
                        });
                    }
                );
            });
        }
    }

    pickTargetPlayer(player, callback) {
        if (player.isBot) {
            const targets = this.players.filter(p => p.id !== player.id);
            callback(targets[Math.floor(Math.random() * targets.length)]);
            return;
        }
        UI.playerPickerList.innerHTML = '';
        this.players.filter(p => p.id !== player.id).forEach(target => {
            const btn = document.createElement('button');
            btn.className = 'picker-btn';
            btn.innerText = target.name;
            btn.onclick = () => {
                UI.playerPicker.classList.add('hidden');
                callback(target);
            };
            UI.playerPickerList.appendChild(btn);
        });
        UI.playerPicker.classList.remove('hidden');
    }

    showChoiceModal(title, opt1Text, opt2Text, cb1, cb2) {
        const modal = UI.choiceModal;
        modal.querySelector('h3').innerText = title;
        const btns = modal.querySelectorAll('.choice-btn');
        btns[0].innerText = opt1Text;
        btns[1].innerText = opt2Text;
        btns[0].onclick = () => { modal.classList.add('hidden'); cb1(); };
        btns[1].onclick = () => { modal.classList.add('hidden'); cb2(); };
        modal.classList.remove('hidden');
    }

    endGame(winner) {
        const humanWon = !winner.isBot;
        Storage.recordResult(humanWon);
        this.humanProfile = Storage.getCurrentProfile() || this.humanProfile;
        this.updateMenuChip();

        WakeLock.disable();
        Sound.play(humanWon ? 'win' : 'lose');
        if (humanWon) this.launchConfetti();

        UI.winnerText.innerText = winner.isBot
            ? I18n.t('bot_win', { name: winner.name })
            : I18n.t('you_win');

        // إحصائيات العضو
        const statsEl = document.getElementById('end-stats');
        if (statsEl) {
            if (this.humanProfile && !this.humanProfile.guest) {
                const s = this.humanProfile.stats || { wins: 0, losses: 0, games: 0 };
                statsEl.innerHTML = `🏆 ${s.wins} ${I18n.t('wins')} · ❌ ${s.losses} ${I18n.t('losses')} · 🎮 ${s.games} ${I18n.t('games')}`;
            } else {
                statsEl.innerHTML = '';
            }
        }
        this.showScreen('end-screen');
    }

    launchConfetti() {
        if (this.settings.batterySaver) return;
        const colors = ['#fbbf24', '#f97316', '#8b5cf6', '#22c55e', '#ef4444', '#38bdf8', '#ffffff'];
        for (let i = 0; i < 90; i++) {
            const c = document.createElement('div');
            c.className = 'confetti';
            c.style.left = (Math.random() * 100) + 'vw';
            c.style.background = colors[i % colors.length];
            c.style.width = c.style.height = (6 + Math.random() * 9) + 'px';
            c.style.animationDelay = (Math.random() * 0.7) + 's';
            c.style.animationDuration = (1.9 + Math.random() * 1.7) + 's';
            document.body.appendChild(c);
            setTimeout(() => c.remove(), 4000);
        }
    }

    // ========== RENDERING ==========
    createCardElement(card, isHidden = false, playable = false, index = -1) {
        const div = document.createElement('div');
        let cls = 'card';
        if (isHidden) { cls += ' back'; }
        else if (card) { cls += ` ${card.color}`; }
        if (playable && !isHidden) cls += ' playable';
        if (!playable && !isHidden && !this.currentPlayer.isBot) cls += ' disabled';
        div.className = cls;

        if (!isHidden && card) {
            const img = document.createElement('img');
            img.src = card.svgFile;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '11px';
            img.style.pointerEvents = 'none';
            img.style.transform = 'scale(1.045)';   // قصّ الإطار المدمج المتضارب داخل الصورة

            img.onerror = () => {
                img.style.display = 'none';
                div.innerHTML = `
                    <div class="card-wheel">
                        <span class="card-emoji">${card.emoji}</span>
                    </div>
                    <div class="card-label">${I18n.cardName(card)}</div>`;
                this._addColorSymbol(div, card);
            };

            div.appendChild(img);
            this._addColorSymbol(div, card);

            if (playable && index !== -1) {
                div.onclick = () => {
                    if (!this.humanCanPlay || this.isAwaitingColor || this.actionInProgress) return;
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

    updateUI() {
        // Discard pile
        UI.discardPile.innerHTML = '';
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

        // Bot hands — 2D table fan effect
        this.players.filter(p => p.isBot).forEach(bot => {
            const el = document.getElementById(bot.countId);
            if (el) el.innerText = bot.hand.length;
            const container = document.getElementById(bot.containerId);
            container.innerHTML = '';
            const count = Math.min(bot.hand.length, 9);
            if (count === 0) { container.style.transform = 'none'; return; }

            // دوران اليد الجانبية 90° لتبدو واقعية (يمين +90، يسار -90، العلوي بلا دوران)
            const area = document.getElementById(`player-${bot.id}`);
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
        hc.innerHTML = '';
        // اسم وصورة العضو
        const hArea = document.getElementById('player-human');
        if (hArea) {
            hArea.querySelector('.player-name').textContent = human.name;
            hArea.querySelector('.player-avatar').textContent = human.avatar;
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
        const cardW = 115;
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
                if (this.pendingDraws > 0) {
                    playable = ['draw2', 'draw4Wild', 'meh', 'counterAttack'].includes(card.type)
                        || (card.type === 'phantom' && card.isPlayable(this.topCard, this.activeColor));
                } else {
                    playable = card.isPlayable(this.topCard, this.activeColor);
                }
            }
            const el = this.createCardElement(card, false, playable, i);

            // قوس لطيف — الحواف ترتفع قليلاً للأعلى
            const offset = i - mid;
            const rot = offset * step;
            const ty = -Math.min(26, offset * offset * 0.7);
            el.style.setProperty('--rot', rot.toFixed(2) + 'deg');
            el.style.setProperty('--ty', ty.toFixed(1) + 'px');
            el.style.marginInlineEnd = (i < n - 1 ? overlap : 0) + 'px';
            el.style.zIndex = i;

            if (i === this.selectedCardIndex) el.classList.add('selected');

            hc.appendChild(el);
        });

        // Active player highlight
        document.querySelectorAll('.player-area').forEach(a => a.classList.remove('active-player'));
        const activeArea = document.getElementById(`player-${this.currentPlayer.id}`);
        if (activeArea) activeArea.classList.add('active-player');

        // اتجاه المؤشّر الدوّار (RTL يقلب ترتيب الجلوس، فنعكس الشرط ليطابق الدور الفعلي)
        const dirRing = document.getElementById('dir-ring');
        if (dirRing) dirRing.classList.toggle('ccw', this.direction === 1);

        // علامة التوقف 🛑 للاعبين الذين سيُتخطّون (رمادي + إشارة حمراء)
        this.players.forEach(p => {
            const a = document.getElementById(`player-${p.id}`);
            if (a) a.classList.toggle('skipped', !!this.skipNextMap[p.id]);
        });

        // إخفاء شريط التأكيد إن لم تعد هناك بطاقة مختارة أو ليس دور اللاعب
        if (this.selectedCardIndex < 0 || !isHumanTurn) this.hideConfirmBar();
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

    // تأثيرات بصرية لكل بطاقة (اهتزاز + وميض)
    screenFx(kind) {
        if (this.settings.batterySaver) return;
        const gs = document.getElementById('game-screen');
        const shake = () => {
            if (!gs) return;
            gs.classList.remove('shake'); void gs.offsetWidth; gs.classList.add('shake');
            setTimeout(() => gs.classList.remove('shake'), 460);
        };
        const flash = (col) => {
            const f = document.createElement('div');
            f.className = 'screen-flash';
            f.style.background = `radial-gradient(circle, ${col} 0%, transparent 72%)`;
            document.body.appendChild(f);
            setTimeout(() => f.remove(), 520);
        };
        switch (kind) {
            case 'draw4':   shake(); flash('rgba(239,68,68,0.55)'); break;
            case 'counter': shake(); flash('rgba(255,255,255,0.6)'); break;
            case 'wild':    flash('rgba(168,85,247,0.45)'); break;
            case 'draw2':   flash('rgba(249,115,22,0.4)'); break;
            case 'skip':    flash('rgba(148,163,184,0.35)'); break;
        }
    }

    colorName(c) {
        return I18n.colorName(c);
    }
}

document.addEventListener('DOMContentLoaded', () => { window.game = new MehGame(); });
