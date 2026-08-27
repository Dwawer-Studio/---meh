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
const ONLINE_COLORS = ['orange', 'gray', 'purple'];
const MAX_ONLINE_PLAYERS = 4;
const MAX_PLAYER_NAME_LENGTH = 24;

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
        this._sugarOwnerId = null;
        this.selectedCardIndex = -1;      // لتأكيد رمي البطاقة
        this.drawImmune = {};             // درع الفانتوم: حصانة ضد السحب
        this.humanCanPlay = false;        // بوابة صريحة: متى يُسمح للاعب البشري بالفعل
        this.lobbyPlayers = [];           // لاعبو الردهة (أونلاين)
        this.online = false;              // وضع اللعب الجماعي
        this.isHost = false;              // المضيف يدير منطق اللعبة
        this.myIndex = 0;                 // مقعد هذا الجهاز (دائماً 0 في عرضه)
        this.awaitingRemote = false;      // المضيف ينتظر حركة لاعب بعيد
        this.turnTimer = null;            // مؤقّت الدور (لعب تلقائي عند التأخّر)
        this._promptTimer = null;
        this._bcTimer = null;
        this._disconnectTurnTimer = null;
        this._remoteResolve = null;
        this._remotePromptSeq = 0;
        this._remotePromptId = null;
        this._remotePromptPeer = null;
        this._remoteAllowedValues = null;
        this._colorCallback = null;
        this._joinRejected = false;
        this._rejectedConnections = new WeakSet();
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
        this.bindOnlineEvents();
        this.renderInstructions();
        this.initProfile();
        this.syncScreenAccessibility();
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
            const toggleSetting = () => {
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
            row.onclick = toggleSetting;
            row.onkeydown = (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                toggleSetting();
            };
        });
    }

    refreshSettingsUI() {
        document.querySelectorAll('.lang-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.lang === this.settings.lang));
        document.querySelectorAll('.toggle-row').forEach(row => {
            const key = row.dataset.setting;
            const enabled = !!this.settings[key];
            row.querySelector('.switch').classList.toggle('on', enabled);
            row.setAttribute('aria-checked', String(enabled));
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
        wrap.replaceChildren();
        this._pendingAvatar = this._pendingAvatar || AVATARS[0];
        AVATARS.forEach(a => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'avatar-option' + (a === this._pendingAvatar ? ' selected' : '');
            b.textContent = a;
            b.setAttribute('aria-label', `${I18n.t('choose_avatar')}: ${a}`);
            b.setAttribute('aria-pressed', String(a === this._pendingAvatar));
            b.onclick = () => {
                this._pendingAvatar = a;
                wrap.querySelectorAll('.avatar-option').forEach(x => {
                    x.classList.remove('selected');
                    x.setAttribute('aria-pressed', 'false');
                });
                b.classList.add('selected');
                b.setAttribute('aria-pressed', 'true');
            };
            wrap.appendChild(b);
        });
    }

    renderProfileList() {
        const list = document.getElementById('profile-list');
        list.replaceChildren();
        const profiles = Storage.getProfiles();
        const currentId = (Storage.getCurrentProfile() || {}).id;
        profiles.forEach(p => {
            const item = document.createElement('div');
            item.className = 'profile-item' + (p.id === currentId ? ' current' : '');
            const s = p.stats || { wins: 0, losses: 0, games: 0 };
            const avatar = this._safeAvatar(p.avatar) || '😎';
            const name = this._safePlayerName(p.name) || I18n.t('guest');
            const wins = Number.isSafeInteger(s.wins) && s.wins >= 0 ? s.wins : 0;
            const games = Number.isSafeInteger(s.games) && s.games >= 0 ? s.games : 0;
            const chooseButton = document.createElement('button');
            chooseButton.type = 'button';
            chooseButton.className = 'profile-select';
            chooseButton.setAttribute('aria-label', `${I18n.t('select_profile')}: ${name}`);
            const deleteButton = this._createTextElement('button', 'profile-del', '🗑️');
            deleteButton.type = 'button';
            deleteButton.title = 'delete';
            deleteButton.setAttribute('aria-label', `${I18n.t('delete_profile')}: ${name}`);
            chooseButton.appendChild(this._createTextElement('span', 'profile-avatar', avatar));
            chooseButton.appendChild(this._createTextElement('span', 'profile-name', name));
            chooseButton.appendChild(this._createTextElement('span', 'profile-stats', `🏆 ${wins} · 🎮 ${games}`));
            item.appendChild(chooseButton);
            item.appendChild(deleteButton);
            deleteButton.onclick = (e) => {
                e.stopPropagation();
                Storage.deleteProfile(p.id);
                if (this.humanProfile && this.humanProfile.id === p.id) {
                    this.humanProfile = { name: I18n.t('guest'), avatar: '😎', guest: true };
                    this.updateMenuChip();
                }
                this.renderProfileList();
            };
            const chooseProfile = () => {
                Storage.setCurrentProfile(p.id);
                this.humanProfile = p;
                this.updateMenuChip();
                this.showScreen('main-menu');
                this.showToast(I18n.t('welcome', { name: p.name }));
            };
            chooseButton.onclick = chooseProfile;
            list.appendChild(item);
        });
    }

    updateMenuChip() {
        const chip = document.getElementById('current-player-chip');
        if (!chip) return;
        if (this.humanProfile && !this.humanProfile.guest) {
            const s = this.humanProfile.stats || { wins: 0, games: 0 };
            const avatar = this._safeAvatar(this.humanProfile.avatar) || '😎';
            const name = this._safePlayerName(this.humanProfile.name) || I18n.t('guest');
            const wins = Number.isSafeInteger(s.wins) && s.wins >= 0 ? s.wins : 0;
            const games = Number.isSafeInteger(s.games) && s.games >= 0 ? s.games : 0;
            chip.replaceChildren(
                this._createTextElement('span', 'chip-avatar', `${avatar} `),
                this._createTextElement('strong', 'chip-name', name),
                this._createTextElement('span', 'chip-stats', `  🏆 ${wins} · 🎮 ${games}`),
            );
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
            b.type = 'button';
            b.className = 'emoji-btn';
            b.textContent = e;
            b.setAttribute('aria-label', `${I18n.t('send_emoji')}: ${e}`);
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

    // ============ الأونلاين (المرحلة 1: الاتصال + الردهة) ============
    bindOnlineEvents() {
        const g = (id) => document.getElementById(id);
        g('online-btn').onclick = () => {
            if (!Net.available()) { this.showToast(I18n.t('no_peerjs')); return; }
            this.showScreen('online-screen');
            this.showOnlineStatus('');
            g('room-code-input').value = '';
        };
        g('online-back-btn').onclick = () => this._leaveOnlineSession('main-menu');
        g('create-room-btn').onclick = () => this.createRoom();
        g('join-room-btn').onclick = () => this.joinRoom();
        g('copy-code-btn').onclick = () => {
            if (Net.roomCode && navigator.clipboard) navigator.clipboard.writeText(Net.roomCode).catch(() => {});
            this.showToast(I18n.t('code_copied'));
        };
        g('lobby-leave-btn').onclick = () => this._leaveOnlineSession('main-menu');
        g('lobby-start-btn').onclick = () => this.startOnlineGame();
    }

    showOnlineStatus(msg, isError) {
        const el = document.getElementById('online-status');
        if (el) { el.textContent = msg || ''; el.classList.toggle('error', !!isError); }
    }

    _isRecord(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    _safeText(value, maxLength) {
        if (typeof value !== 'string') return null;
        const normalized = typeof value.normalize === 'function' ? value.normalize('NFKC') : value;
        const text = normalized.trim();
        if (!text || Array.from(text).length > maxLength) return null;
        if (/[\u0000-\u001f\u007f]/.test(text)) return null;
        return text;
    }

    _safePlayerName(value) {
        return this._safeText(value, MAX_PLAYER_NAME_LENGTH);
    }

    _safeAvatar(value) {
        return typeof value === 'string' && AVATARS.includes(value) ? value : null;
    }

    _safePeerId(value) {
        return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
    }

    _createTextElement(tagName, className, value) {
        const element = document.createElement(tagName);
        element.className = className;
        element.textContent = String(value ?? '');
        return element;
    }

    _sanitizeLobbyPlayers(players) {
        if (!Array.isArray(players) || players.length < 1 || players.length > MAX_ONLINE_PLAYERS) return null;
        const ids = new Set();
        const result = [];
        for (let i = 0; i < players.length; i++) {
            const player = players[i];
            if (!this._isRecord(player)) return null;
            const id = this._safePeerId(player.id);
            const name = this._safePlayerName(player.name);
            const avatar = this._safeAvatar(player.avatar);
            const host = player.host === true;
            if (!id || ids.has(id) || !name || !avatar) return null;
            if ((i === 0) !== host) return null;
            ids.add(id);
            result.push({ id, name, avatar, host });
        }
        return result;
    }

    _rejectConnection(conn, reason) {
        if (!conn || typeof conn !== 'object') return;
        if (!this._rejectedConnections) this._rejectedConnections = new WeakSet();
        if (this._rejectedConnections.has(conn)) return;
        this._rejectedConnections.add(conn);
        Net.sendTo(conn, { t: 'rejected', reason });
        Net.disconnect(conn);
    }

    _clearRemotePrompt() {
        if (this._promptTimer) clearTimeout(this._promptTimer);
        this._promptTimer = null;
        this._remoteResolve = null;
        this._remoteKind = null;
        this._remotePromptId = null;
        this._remotePromptPeer = null;
        this._remoteAllowedValues = null;
    }

    _clearOnlineRuntime() {
        this.clearTurnTimer();
        this._clearRemotePrompt();
        if (this._bcTimer) clearTimeout(this._bcTimer);
        if (this._disconnectTurnTimer) clearTimeout(this._disconnectTurnTimer);
        this._bcTimer = null;
        this._disconnectTurnTimer = null;
        this.awaitingRemote = false;
        this.humanCanPlay = false;
        this._colorCallback = null;
        ['color-picker', 'player-picker', 'choice-modal'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.classList.add('hidden');
        });
    }

    _leaveOnlineSession(screenId, messageKey) {
        this._clearOnlineRuntime();
        this.online = false;
        this.isHost = false;
        WakeLock.disable();
        Net.close();
        if (screenId) this.showScreen(screenId);
        if (messageKey) this.showToast(I18n.t(messageKey));
    }

    _resumeRemotePlayer(conn) {
        const peer = conn && conn.peer;
        const seat = this.players && this.players.find(player => player.connPeer === peer);
        if (!seat) return false;
        const wasDisconnected = seat.isBot || !seat.isRemote;
        seat.isBot = false;
        seat.isRemote = true;

        if (wasDisconnected && this.players[this.currentPlayerIndex] === seat
            && !this.actionInProgress && !this._remoteResolve) {
            if (this._disconnectTurnTimer) clearTimeout(this._disconnectTurnTimer);
            this._disconnectTurnTimer = null;
            this.awaitingRemote = true;
            this.startTurnTimer();
        }

        Net.sendTo(conn, { t: 'resumed' });
        this.showToast(I18n.t('net_player_reconnected', { name: seat.name }));
        this.updateUI();
        this._doBroadcast();
        return true;
    }

    handleHostMessage(msg, conn) {
        if (!this._isRecord(msg) || !conn || !this._safePeerId(conn.peer)) return false;

        if (msg.t === 'hello') {
            if (this.online) {
                if (this._resumeRemotePlayer(conn)) return true;
                this._rejectConnection(conn, 'started');
                return false;
            }
            if ((this.lobbyPlayers || []).some(p => p.id === conn.peer)) {
                Net.sendTo(conn, { t: 'lobby', players: this.lobbyPlayers });
                return true;
            }
            if ((this.lobbyPlayers || []).length >= MAX_ONLINE_PLAYERS) {
                this._rejectConnection(conn, 'full');
                return false;
            }

            const name = this._safePlayerName(msg.name);
            const avatar = this._safeAvatar(msg.avatar);
            if (!name || !avatar) {
                this._rejectConnection(conn, 'invalid');
                return false;
            }

            this.lobbyPlayers.push({ id: conn.peer, name, avatar, host: false });
            this.showToast(I18n.t('net_player_joined', { name }));
            this._broadcastLobby();
            this.renderLobby();
            return true;
        }

        if (msg.t === 'play' || msg.t === 'draw') {
            this.applyRemoteAction(conn, msg);
            return true;
        }
        if (msg.t === 'choice') {
            this.resolveRemotePrompt(msg, conn);
            return true;
        }
        return false;
    }

    handleClientMessage(msg) {
        if (!this._isRecord(msg) || typeof msg.t !== 'string') return false;
        if (msg.t === 'lobby') {
            const players = this._sanitizeLobbyPlayers(msg.players);
            if (!players) return false;
            this.lobbyPlayers = players;
            this.renderLobby();
        } else if (msg.t === 'gamestart') {
            this.beginClientGame();
        } else if (msg.t === 'state') {
            return this.applyState(msg);
        } else if (msg.t === 'prompt') {
            return this.showRemotePrompt(msg);
        } else if (msg.t === 'gameover') {
            const winnerName = this._safePlayerName(msg.winnerName);
            if (typeof msg.youWon !== 'boolean' || !winnerName) return false;
            this.onlineGameOver({ youWon: msg.youWon, winnerName });
        } else if (msg.t === 'toast') {
            const message = this._safeText(msg.text, 160);
            if (!message) return false;
            this.showToast(message);
        } else if (msg.t === 'rejected') {
            if (this._joinRejected) return true;
            const key = msg.reason === 'full' ? 'room_full'
                : msg.reason === 'started' ? 'game_already_started'
                    : 'invalid_player_data';
            this._joinRejected = true;
            this.online = false;
            this.showScreen('online-screen');
            this.showOnlineStatus(I18n.t(key), true);
            Net.close();
        } else if (msg.t === 'resumed') {
            this.online = true;
            this.showToast(I18n.t('connection_restored'));
        } else {
            return false;
        }
        return true;
    }

    // ----- المضيف -----
    createRoom() {
        if (!Net.available()) { this.showOnlineStatus(I18n.t('no_peerjs'), true); return; }
        this.showOnlineStatus(I18n.t('creating_room'));
        const hostName = this._safePlayerName(this.humanProfile.name) || I18n.t('guest');
        const hostAvatar = this._safeAvatar(this.humanProfile.avatar) || '😎';
        this.lobbyPlayers = [{ id: 'host', name: hostName, avatar: hostAvatar, host: true }];

        Net.onPlayerJoin = (conn) => {
            if (this.online) {
                if (!(this.players || []).some(player => player.connPeer === conn.peer)) {
                    this._rejectConnection(conn, 'started');
                }
                return;
            }
            if (this.lobbyPlayers.length >= MAX_ONLINE_PLAYERS) this._rejectConnection(conn, 'full');
        };
        Net.onData = (msg, conn) => this.handleHostMessage(msg, conn);
        Net.onPlayerLeave = (conn) => this._handleHostPlayerLeave(conn);
        Net.onReconnecting = () => this.showToast(I18n.t('reconnecting'));
        Net.onReconnect = null;
        Net.onSignalReconnect = () => this.showToast(I18n.t('connection_restored'));
        Net.onError = (error) => this._handleOnlineNetworkError(error);

        Net.host((code) => {
            document.getElementById('lobby-room-code').textContent = code;
            document.getElementById('lobby-start-btn').classList.remove('hidden');
            document.getElementById('lobby-wait').classList.add('hidden');
            this.showScreen('lobby-screen');
            this.renderLobby();
        });
    }

    _broadcastLobby() {
        Net.broadcast({ t: 'lobby', players: this.lobbyPlayers });
    }

    _handleHostPlayerLeave(conn) {
        const peer = conn && conn.peer;
        if (this.online) {
            const seat = this.players && this.players.find(player => player.connPeer === peer);
            if (!seat) return;
            seat.isBot = true;
            seat.isRemote = false;
            this.showToast(I18n.t('net_player_left', { name: seat.name }));

            if (this._remoteResolve && this._remotePromptPeer === peer) {
                const resolve = this._remoteResolve;
                const fallback = this._autoPromptValue(this._remoteKind);
                this._clearRemotePrompt();
                resolve(fallback);
            } else if (this.players[this.currentPlayerIndex] === seat && this.awaitingRemote) {
                this.clearTurnTimer();
                this.awaitingRemote = false;
                if (this._disconnectTurnTimer) clearTimeout(this._disconnectTurnTimer);
                this._disconnectTurnTimer = setTimeout(() => {
                    this._disconnectTurnTimer = null;
                    if (this.online && this.isHost && this.currentPlayer === seat
                        && seat.isBot && !this.actionInProgress) this.playBotTurn();
                }, 600);
            }
            this.updateUI();
            return;
        }

        const left = (this.lobbyPlayers || []).find(player => player.id === peer);
        this.lobbyPlayers = (this.lobbyPlayers || []).filter(player => player.id !== peer);
        if (left) this.showToast(I18n.t('net_player_left', { name: left.name }));
        this._broadcastLobby();
        this.renderLobby();
    }

    // ----- العميل -----
    joinRoom() {
        if (!Net.available()) { this.showOnlineStatus(I18n.t('no_peerjs'), true); return; }
        const code = (document.getElementById('room-code-input').value || '').trim().toUpperCase();
        if (!/^[A-HJ-NP-Z2-9]{5}$/.test(code)) { this.showOnlineStatus(I18n.t('conn_error'), true); return; }
        this._joinRejected = false;
        this.showOnlineStatus(I18n.t('connecting'));

        Net.onData = (msg) => this.handleClientMessage(msg);
        Net.onPlayerLeave = () => this._handleClientPlayerLeave();
        Net.onReconnecting = () => {
            if (this.online) this.showToast(I18n.t('reconnecting'));
            else this.showOnlineStatus(I18n.t('reconnecting'));
        };
        Net.onReconnect = () => {
            Net.send({ t: 'hello', name: this.humanProfile.name, avatar: this.humanProfile.avatar });
        };
        Net.onSignalReconnect = () => this.showToast(I18n.t('connection_restored'));
        Net.onError = (error) => this._handleOnlineNetworkError(error);

        Net.join(code, () => {
            Net.send({ t: 'hello', name: this.humanProfile.name, avatar: this.humanProfile.avatar });
            document.getElementById('lobby-room-code').textContent = code;
            document.getElementById('lobby-start-btn').classList.add('hidden');
            document.getElementById('lobby-wait').classList.remove('hidden');
            this.showScreen('lobby-screen');
        });
    }

    _handleClientPlayerLeave() {
        if (this._joinRejected) return;
        this.humanCanPlay = false;
        this.hideConfirmBar();
        if (this.online) this.showToast(I18n.t('reconnecting'));
        else this.showOnlineStatus(I18n.t('reconnecting'), true);
    }

    _handleOnlineNetworkError(error) {
        if (error && error.type === 'reconnect-failed') {
            this._leaveOnlineSession('main-menu', 'reconnect_failed');
            return;
        }
        if (this.online) this.showToast(I18n.t('conn_error'));
        else this.showOnlineStatus(I18n.t('conn_error'), true);
    }

    renderLobby() {
        const wrap = document.getElementById('lobby-players');
        if (!wrap) return;
        wrap.replaceChildren();
        (this.lobbyPlayers || []).forEach(p => {
            const div = document.createElement('div');
            div.className = 'lobby-player';
            div.appendChild(this._createTextElement('span', 'lp-avatar', p.avatar || '😎'));
            div.appendChild(this._createTextElement('span', 'lp-name', p.name || ''));
            if (p.host) {
                div.appendChild(this._createTextElement(
                    'span',
                    'lp-host',
                    `👑 ${I18n.lang === 'ar' ? 'المضيف' : 'Host'}`,
                ));
            }
            wrap.appendChild(div);
        });
    }

    // ============ المرحلة 2: نواة اللعب الجماعي ============
    autoDecide(player) { return player.isBot; }   // البوتات فقط تُحسم تلقائياً

    // المضيف يطلب اختياراً من اللاعب البعيد عبر الشبكة
    promptRemote(kind, data, resolve) {
        const conn = (Net.conns || []).find(c => c.peer === this.currentPlayer.connPeer);
        if (!conn) { resolve(this._autoPromptValue(kind)); return; }
        this._remotePromptSeq = (this._remotePromptSeq % Number.MAX_SAFE_INTEGER) + 1;
        const promptId = this._remotePromptSeq;
        this._remoteResolve = resolve;
        this._remoteKind = kind;
        this._remotePromptId = promptId;
        this._remotePromptPeer = conn.peer;
        if ((kind === 'target' || kind === 'card') && Array.isArray(data.options)) {
            this._remoteAllowedValues = data.options
                .map(option => kind === 'target' ? option.idx : option.id)
                .filter(value => kind === 'target' ? Number.isSafeInteger(value) : typeof value === 'string');
        } else {
            this._remoteAllowedValues = null;
        }
        this.clearTurnTimer();
        if (this._promptTimer) clearTimeout(this._promptTimer);
        this._promptTimer = setTimeout(() => this.autoResolvePrompt(), 12000);
        Net.sendTo(conn, Object.assign({ t: 'prompt', kind, promptId }, data));
    }

    _autoPromptValue(kind) {
        const player = this.currentPlayer;
        if (kind === 'color') {
            const colors = ['orange', 'gray', 'purple']; const cc = {};
            player.hand.forEach(c => { if (c.color !== 'black') cc[c.color] = (cc[c.color] || 0) + 1; });
            return colors.sort((a, b) => (cc[b] || 0) - (cc[a] || 0))[0];
        }
        if (kind === 'target') {
            const others = this.players.filter(p => p.id !== player.id);
            return this.players.indexOf(others[Math.floor(Math.random() * others.length)]);
        }
        if (kind === 'card') {
            const hand = player && Array.isArray(player.hand) ? player.hand : [];
            return hand.length ? hand[Math.floor(Math.random() * hand.length)].id : null;
        }
        return 0; // choice
    }

    autoResolvePrompt() {
        if (!this._remoteResolve) return;
        const r = this._remoteResolve; this._remoteResolve = null;
        const v = this._autoPromptValue(this._remoteKind);
        this._remoteKind = null;
        this._remotePromptId = null;
        this._remotePromptPeer = null;
        this._remoteAllowedValues = null;
        this._promptTimer = null;
        this.showToast('⏱️ لعب تلقائي');
        r(v);
    }

    _validateRemotePromptValue(kind, value) {
        if (kind === 'color') return ONLINE_COLORS.includes(value) ? value : null;
        if (kind === 'choice') return value === 0 || value === 1 ? value : null;
        if (kind === 'target') {
            return Number.isSafeInteger(value)
                && Array.isArray(this._remoteAllowedValues)
                && this._remoteAllowedValues.includes(value)
                ? value : null;
        }
        if (kind === 'card') {
            return typeof value === 'string'
                && Array.isArray(this._remoteAllowedValues)
                && this._remoteAllowedValues.includes(value)
                ? value : null;
        }
        return null;
    }

    // المضيف يستقبل اختيار اللاعب البعيد
    resolveRemotePrompt(msg, conn) {
        if (!this._remoteResolve || !this._isRecord(msg)) return false;
        if (!Number.isSafeInteger(msg.promptId) || msg.promptId !== this._remotePromptId) return false;
        if (!conn || conn.peer !== this._remotePromptPeer) return false;
        if (!this.currentPlayer || this.currentPlayer.connPeer !== conn.peer) return false;
        const value = this._validateRemotePromptValue(this._remoteKind, msg.value);
        if (value === null) return false;
        if (this._promptTimer) { clearTimeout(this._promptTimer); this._promptTimer = null; }
        const r = this._remoteResolve;
        this._remoteResolve = null;
        this._remoteKind = null;
        this._remotePromptId = null;
        this._remotePromptPeer = null;
        this._remoteAllowedValues = null;
        r(value);
        return true;
    }

    _normalizeRemotePrompt(msg) {
        if (!this._isRecord(msg) || !Number.isSafeInteger(msg.promptId) || msg.promptId < 1) return null;
        if (msg.kind === 'color') return { kind: 'color', promptId: msg.promptId };
        if (msg.kind === 'choice') {
            const title = this._safeText(msg.title, 120);
            const opt1 = this._safeText(msg.opt1, 80);
            const opt2 = this._safeText(msg.opt2, 80);
            return title && opt1 && opt2 ? { kind: 'choice', promptId: msg.promptId, title, opt1, opt2 } : null;
        }
        if (msg.kind === 'target') {
            if (!Array.isArray(msg.options) || msg.options.length < 1 || msg.options.length > 3) return null;
            const seen = new Set();
            const options = [];
            for (const option of msg.options) {
                if (!this._isRecord(option) || !Number.isSafeInteger(option.idx)
                    || option.idx < 0 || option.idx >= MAX_ONLINE_PLAYERS || seen.has(option.idx)) return null;
                const name = this._safePlayerName(option.name);
                if (!name) return null;
                seen.add(option.idx);
                options.push({ idx: option.idx, name });
            }
            return { kind: 'target', promptId: msg.promptId, options };
        }
        if (msg.kind === 'card') {
            if (!Array.isArray(msg.options) || msg.options.length < 1 || msg.options.length > 60) return null;
            const title = this._safeText(msg.title, 120);
            if (!title) return null;
            const seen = new Set();
            const options = [];
            for (const option of msg.options) {
                if (!this._isRecord(option) || typeof option.id !== 'string'
                    || !/^[a-z0-9-]{1,32}$/.test(option.id) || seen.has(option.id)) return null;
                const name = this._safeText(option.name, 80);
                if (!name) return null;
                seen.add(option.id);
                options.push({ id: option.id, name });
            }
            return { kind: 'card', promptId: msg.promptId, title, options };
        }
        return null;
    }

    // العميل يعرض نافذة الاختيار المطلوبة من المضيف
    showRemotePrompt(msg) {
        const prompt = this._normalizeRemotePrompt(msg);
        if (!prompt) return false;
        const send = (value) => Net.send({ t: 'choice', promptId: prompt.promptId, value });
        if (prompt.kind === 'color') {
            this.isAwaitingColor = false;
            this.setDialogOpen(UI.colorPicker, true);
            document.querySelectorAll('.color-btn').forEach(b => {
                b.onclick = () => {
                    if (!ONLINE_COLORS.includes(b.dataset.color)) return;
                    this.setDialogOpen(UI.colorPicker, false);
                    send(b.dataset.color);
                };
            });
        } else if (prompt.kind === 'choice') {
            this.showChoiceModal(prompt.title, prompt.opt1, prompt.opt2, () => send(0), () => send(1));
        } else if (prompt.kind === 'target') {
            const heading = UI.playerPicker && UI.playerPicker.querySelector('h3');
            if (heading) heading.textContent = I18n.t('choose_player');
            UI.playerPickerList.replaceChildren();
            prompt.options.forEach(o => {
                const btn = document.createElement('button');
                btn.type = 'button'; btn.className = 'picker-btn'; btn.textContent = o.name;
                btn.onclick = () => { this.setDialogOpen(UI.playerPicker, false); send(o.idx); };
                UI.playerPickerList.appendChild(btn);
            });
            this.setDialogOpen(UI.playerPicker, true);
        } else if (prompt.kind === 'card') {
            const heading = UI.playerPicker && UI.playerPicker.querySelector('h3');
            if (heading) heading.textContent = prompt.title;
            UI.playerPickerList.replaceChildren();
            prompt.options.forEach(option => {
                const btn = document.createElement('button');
                btn.type = 'button'; btn.className = 'picker-btn'; btn.textContent = option.name;
                btn.onclick = () => { this.setDialogOpen(UI.playerPicker, false); send(option.id); };
                UI.playerPickerList.appendChild(btn);
            });
            this.setDialogOpen(UI.playerPicker, true);
        }
        return true;
    }

    _areaEl(p) {
        if (!p) return null;
        const key = p.containerId === 'human-hand' ? 'human' : p.containerId.replace('-hand', '');
        return document.getElementById('player-' + key);
    }

    _serCard(c) {
        return c ? { color: c.color, name: c.name, type: c.type, emoji: c.emoji, svgFile: c.svgFile, id: c.id } : null;
    }

    _networkCardCatalog() {
        if (!this._trustedNetworkCards) {
            this._trustedNetworkCards = new Map();
            const deck = new Deck();
            deck.cards.forEach(card => {
                this._trustedNetworkCards.set(`${card.color}\u0000${card.name}`, {
                    color: card.color,
                    name: card.name,
                    type: card.type,
                    emoji: card.emoji,
                    svgFile: card.svgFile,
                });
            });
        }
        return this._trustedNetworkCards;
    }

    _deserializeNetworkCard(raw) {
        if (!this._isRecord(raw) || typeof raw.id !== 'string' || !/^[a-z0-9]{1,32}$/.test(raw.id)) return null;
        if (typeof raw.color !== 'string' || typeof raw.name !== 'string') return null;
        const definition = this._networkCardCatalog().get(`${raw.color}\u0000${raw.name}`);
        if (!definition) return null;
        const card = new Card(
            definition.color,
            definition.name,
            definition.type,
            definition.emoji,
            definition.svgFile,
        );
        card.id = raw.id;
        return card;
    }

    _normalizeGameState(state) {
        if (!this._isRecord(state) || !this._isRecord(state.me)) return null;
        const meName = this._safePlayerName(state.me.name);
        const meAvatar = this._safeAvatar(state.me.avatar);
        if (!meName || !meAvatar || !Array.isArray(state.hand) || state.hand.length > 60) return null;

        const seenCardIds = new Set();
        const parseCard = (raw) => {
            const card = this._deserializeNetworkCard(raw);
            if (!card || seenCardIds.has(card.id)) return null;
            seenCardIds.add(card.id);
            return card;
        };
        const hand = [];
        for (const rawCard of state.hand) {
            const card = parseCard(rawCard);
            if (!card) return null;
            hand.push(card);
        }

        const top = parseCard(state.top);
        if (!top) return null;
        const second = state.second == null ? null : parseCard(state.second);
        if (state.second != null && !second) return null;

        if (!Array.isArray(state.others) || state.others.length > 3) return null;
        const others = [];
        for (const other of state.others) {
            if (!this._isRecord(other)) return null;
            const name = this._safePlayerName(other.name);
            const avatar = this._safeAvatar(other.avatar);
            if (!name || !avatar || typeof other.isBot !== 'boolean'
                || !Number.isSafeInteger(other.count) || other.count < 0 || other.count > 60) return null;
            others.push({ name, avatar, isBot: other.isBot, count: other.count });
        }

        const playerCount = 1 + others.length;
        if (!ONLINE_COLORS.includes(state.activeColor) || (state.direction !== 1 && state.direction !== -1)) return null;
        if (!Number.isSafeInteger(state.current) || state.current < 0 || state.current >= playerCount) return null;
        if (!Number.isSafeInteger(state.pending) || state.pending < 0 || state.pending > 60) return null;
        if (typeof state.canPlay !== 'boolean' || !Array.isArray(state.skipped)) return null;

        const skipped = [];
        const seenSkipped = new Set();
        for (const index of state.skipped) {
            if (!Number.isSafeInteger(index) || index < 0 || index >= playerCount || seenSkipped.has(index)) return null;
            seenSkipped.add(index);
            skipped.push(index);
        }

        return {
            me: { name: meName, avatar: meAvatar },
            hand,
            others,
            top,
            second,
            activeColor: state.activeColor,
            direction: state.direction,
            current: state.current,
            pending: state.pending,
            skipped,
            canPlay: state.canPlay,
        };
    }

    buildOnlineSeats() {
        const humans = (this.lobbyPlayers || []).slice(0, 4);
        const layout = [
            { containerId: 'human-hand', countId: null },
            { containerId: 'bot-1-hand', countId: 'bot-1-count' },
            { containerId: 'bot-2-hand', countId: 'bot-2-count' },
            { containerId: 'bot-3-hand', countId: 'bot-3-count' },
        ];
        const botNames = ['نورة', 'خالد', 'سارة'];
        const seats = [];
        for (let i = 0; i < 4; i++) {
            const cfg = layout[i];
            if (i < humans.length) {
                const h = humans[i];
                seats.push({
                    id: 'seat-' + i, name: h.name, avatar: h.avatar,
                    isBot: false, isRemote: i !== 0, connPeer: i === 0 ? null : h.id,
                    containerId: cfg.containerId, countId: cfg.countId, hand: [],
                });
            } else {
                seats.push({
                    id: 'seat-' + i, name: botNames[i - humans.length] || 'بوت', avatar: '🤖',
                    isBot: true, isRemote: false, connPeer: null,
                    containerId: cfg.containerId, countId: cfg.countId, hand: [],
                });
            }
        }
        return seats;
    }

    // ----- المضيف يبدأ اللعبة -----
    startOnlineGame() {
        if (!Net.isHost || this.online) return;
        this._clearOnlineRuntime();
        const acceptedPeers = new Set((this.lobbyPlayers || []).slice(1).map(player => player.id));
        (Net.conns || []).slice().forEach(conn => {
            if (!acceptedPeers.has(conn.peer)) this._rejectConnection(conn, 'started');
        });
        this.online = true; this.isHost = true; this.myIndex = 0;
        Net.broadcast({ t: 'gamestart' });

        this.showScreen('game-screen');
        if (this.settings.wakeLock) WakeLock.enable();
        this.deck = new Deck();
        this.discardPile = [];
        this.pendingDraws = 0; this.direction = 1; this.currentPlayerIndex = 0;
        this.isAwaitingColor = false; this.actionInProgress = false;
        this.skipNextMap = {}; this.superpowersDisabled = false;
        this._sugarOwnerId = null;
        this.selectedCardIndex = -1; this.drawImmune = {}; this.humanCanPlay = false;
        this.awaitingRemote = false; this.activeColor = ''; this.hideConfirmBar();

        this.players = this.buildOnlineSeats();
        for (let i = 0; i < 7; i++) for (const p of this.players) p.hand.push(this.deck.draw());
        const initial = this.drawInitialCard();
        this.discardPile.push(initial);
        this.activeColor = initial.color;

        this.bindGameEvents();
        this.updateUI();
        this.playTurn();
    }

    // ----- العميل يدخل شاشة اللعبة -----
    beginClientGame() {
        this._clearOnlineRuntime();
        this.online = true; this.isHost = false; this.myIndex = 0;
        this.actionInProgress = false; this.humanCanPlay = false;
        this.selectedCardIndex = -1; this.isAwaitingColor = false;
        this.bindGameEvents();
        this.showScreen('game-screen');
        if (this.settings.wakeLock) WakeLock.enable();
    }

    // ----- المضيف يبثّ الحالة (مخفّف: يجمع التحديثات المتسارعة في بثّة واحدة) -----
    broadcastGameState() {
        if (!this.online || !this.isHost) return;
        if (this._bcTimer) return;
        this._bcTimer = setTimeout(() => { this._bcTimer = null; this._doBroadcast(); }, 90);
    }

    _doBroadcast() {
        if (!Net.conns || !Net.conns.length) return;
        const n = this.players.length;
        const top = this.topCard;
        const second = this.discardPile.length > 1 ? this.discardPile[this.discardPile.length - 2] : null;

        Net.conns.forEach(conn => {
            const k = this.players.findIndex(p => p.connPeer === conn.peer);
            if (k < 0) return;
            const rot = (i) => ((i - k) % n + n) % n;
            const me = this.players[k];
            const others = [];
            for (let r = 1; r < n; r++) {
                const p = this.players[(k + r) % n];
                others.push({ name: p.name, avatar: p.avatar, count: p.hand.length, isBot: p.isBot });
            }
            const skipped = [];
            this.players.forEach((p, i) => { if (this.skipNextMap[p.id]) skipped.push(rot(i)); });

            Net.sendTo(conn, {
                t: 'state',
                me: { name: me.name, avatar: me.avatar },
                hand: me.hand.map(c => this._serCard(c)),
                others,
                top: this._serCard(top), second: this._serCard(second),
                activeColor: this.activeColor, direction: this.direction,
                current: rot(this.currentPlayerIndex), pending: this.pendingDraws,
                skipped,
                canPlay: (this.currentPlayerIndex === k) && me.isRemote && !!this.awaitingRemote && !this.actionInProgress,
            });
        });
    }

    // ----- العميل يطبّق الحالة ويعرض -----
    applyState(s) {
        s = this._normalizeGameState(s);
        if (!s) return false;
        const layout = [
            { id: 'seat-0', containerId: 'human-hand', countId: null },
            { id: 'seat-1', containerId: 'bot-1-hand', countId: 'bot-1-count' },
            { id: 'seat-2', containerId: 'bot-2-hand', countId: 'bot-2-count' },
            { id: 'seat-3', containerId: 'bot-3-hand', countId: 'bot-3-count' },
        ];
        const players = [];
        players.push({ ...layout[0], name: s.me.name, avatar: s.me.avatar, isBot: false, isRemote: false, hand: s.hand });
        (s.others || []).forEach((o, i) => {
            players.push({ ...layout[i + 1], name: o.name, avatar: o.avatar, isBot: o.isBot, isRemote: !o.isBot, hand: new Array(o.count).fill(null) });
        });
        this.players = players;

        this.discardPile = [];
        if (s.second) this.discardPile.push(s.second);
        this.discardPile.push(s.top);
        this.activeColor = s.activeColor;
        this.direction = s.direction;
        this.currentPlayerIndex = s.current;
        this.pendingDraws = s.pending;
        this.skipNextMap = {};
        (s.skipped || []).forEach(idx => { if (players[idx]) this.skipNextMap[players[idx].id] = true; });
        this.humanCanPlay = !!s.canPlay;
        this.actionInProgress = false;
        this.isAwaitingColor = false;
        if (this.selectedCardIndex >= (this.players[0].hand.length)) this.selectedCardIndex = -1;
        this.updateUI();
        if (this.humanCanPlay) this.focusTurnAction();
        return true;
    }

    // ----- المضيف يطبّق حركة لاعب بعيد -----
    applyRemoteAction(conn, msg) {
        if (!this.online || !this.isHost || !conn || !this._isRecord(msg)) return;
        const seat = this.players.find(p => p.connPeer === conn.peer);
        if (!seat || this.players[this.currentPlayerIndex] !== seat) return;
        if (!this.awaitingRemote || this.actionInProgress) return;

        if (msg.t === 'draw') {
            this.clearTurnTimer();
            this.awaitingRemote = false;
            this.actionInProgress = true;
            this.doDrawForCurrent();
        } else if (msg.t === 'play') {
            if (typeof msg.cardId !== 'string' || !/^[a-z0-9]{1,32}$/.test(msg.cardId)) return;
            const idx = seat.hand.findIndex(c => c.id === msg.cardId);
            if (idx < 0) return;
            const card = seat.hand[idx];
            if (!this.isCardPlayableNow(card)) return;
            this.clearTurnTimer();
            this.awaitingRemote = false;
            this.actionInProgress = true;
            this.playCard(seat, idx);
        }
    }

    // ----- مؤقّت الدور: لعب تلقائي عند تأخّر اللاعب (أونلاين فقط، يُدار من المضيف) -----
    startTurnTimer() {
        this.clearTurnTimer();
        if (!this.online || !this.isHost) return;
        document.body.classList.add('turn-ticking');
        this.turnTimer = setTimeout(() => this.autoPlayCurrent(), 10000);
    }
    clearTurnTimer() {
        if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
        document.body.classList.remove('turn-ticking');
    }
    autoPlayCurrent() {
        this.clearTurnTimer();
        if (this.actionInProgress) return;
        const player = this.currentPlayer;
        if (!player || player.isBot) return;
        this.awaitingRemote = false; this.humanCanPlay = false;
        this.actionInProgress = true;
        const idx = player.hand.findIndex(card => this.isCardPlayableNow(card));
        this.showToast('⏱️ ' + player.name + ' تأخّر — لعب تلقائي');
        if (idx >= 0) this.playCard(player, idx);
        else this.doDrawForCurrent();
    }

    // ----- سحب للّاعب الحالي (يُستخدم محلياً وعن بُعد) -----
    doDrawForCurrent() {
        this.clearTurnTimer();
        if (this.pendingDraws > 0) {
            const n = this.pendingDraws; this.pendingDraws = 0;
            this.drawMultiple(this.currentPlayer, n, () => this.advanceTurn());
        } else {
            this.handleDrawCard(this.currentPlayer);
            setTimeout(() => this.advanceTurn(), 500);
        }
    }

    // ----- نهاية اللعبة أونلاين (لدى العميل) -----
    onlineGameOver(msg) {
        this._clearOnlineRuntime();
        this.online = false;
        WakeLock.disable();
        Storage.recordResult(!!msg.youWon);
        this.humanProfile = Storage.getCurrentProfile() || this.humanProfile;
        this.updateMenuChip();
        Sound.play(msg.youWon ? 'win' : 'lose');
        if (msg.youWon) this.launchConfetti();
        UI.winnerText.innerText = msg.youWon ? I18n.t('you_win') : I18n.t('bot_win', { name: msg.winnerName });
        const st = document.getElementById('end-stats'); if (st) st.replaceChildren();
        this.showScreen('end-screen');
        Net.close();
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
        document.getElementById('restart-btn').addEventListener('click', () => this.startGame());
        document.getElementById('end-menu-btn').addEventListener('click', () => this.showScreen('main-menu'));
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

    startGame() {
        this._clearOnlineRuntime();
        this.online = false; this.isHost = false; this.awaitingRemote = false;
        Net.close();
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
        let initial = this.deck.draw();
        while (initial && initial.type !== 'normal') {
            this.deck.cards.unshift(initial);
            initial = this.deck.draw();
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
            : card.isPlayable(this.topCard, this.activeColor);
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
        this.awaitingRemote = false;
        const player = this.currentPlayer;
        this.updateSugarLockForTurn(player);
        UI.turnIndicator.innerText = player.name;

        if (this.skipNextMap[player.id]) {
            delete this.skipNextMap[player.id];
            Sound.play('skip');
            this.showToast(I18n.t('skips_turn', { name: player.name }));
            setTimeout(() => this.advanceTurn(), 1000);
            return;
        }

        if (this.pendingDraws > 0) {
            const hasResponse = player.hand.some(card => this.canRespondToPendingDraw(card));
            if (!hasResponse) {
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
        } else if (this.online && player.isRemote) {
            // المضيف ينتظر حركة اللاعب البعيد (لا يلعب نيابةً عنه)
            this.awaitingRemote = true;
            this.updateUI();   // يبثّ canPlay=true لذلك العميل
            this.startTurnTimer();
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
            this.handleDrawCard(bot);
            setTimeout(() => this.advanceTurn(), 800);
        }
    }

    handleDrawClick() {
        if (!this.humanCanPlay || this.isAwaitingColor || this.actionInProgress) return;
        if (this.online && !this.isHost) {
            this.humanCanPlay = false; this.selectedCardIndex = -1; this.hideConfirmBar();
            Net.send({ t: 'draw' });
            return;
        }
        this.humanCanPlay = false;
        this.actionInProgress = true;
        this.selectedCardIndex = -1;
        this.hideConfirmBar();
        this.doDrawForCurrent();
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
        const confirmButton = document.getElementById('confirm-play-btn');
        if (confirmButton) confirmButton.focus();
    }
    confirmSelectedCard() {
        if (this.selectedCardIndex < 0 || !this.humanCanPlay) return;
        const idx = this.selectedCardIndex;
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
        const area = this._areaEl(player);
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
        this.clearTurnTimer();
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
        if (this.autoDecide(player)) {
            resolve(this._autoEffectDecision(player, kind, data));
            return;
        }

        if (this.online && this.isHost && player.isRemote) {
            const payload = {};
            if (kind === 'choice') {
                payload.title = data.title;
                payload.opt1 = data.opt1;
                payload.opt2 = data.opt2;
            } else if (kind === 'target') {
                payload.options = data.options.map(option => ({ idx: option.idx, name: option.name }));
            } else if (kind === 'card') {
                payload.title = data.title;
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
            if (heading) heading.textContent = I18n.t('choose_player');
            UI.playerPickerList.replaceChildren();
            data.options.forEach(option => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'picker-btn';
                btn.textContent = option.name;
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
            this.showChoiceModal(data.title, data.opt1, data.opt2, () => resolve(0), () => resolve(1));
            return;
        }
        if (kind === 'card') {
            const heading = UI.playerPicker && UI.playerPicker.querySelector('h3');
            if (heading) heading.textContent = data.title;
            const container = document.getElementById(data.owner.containerId);
            if (!container) { resolve(data.options[0].id); return; }
            const elements = container.querySelectorAll('.card');
            elements.forEach((element, index) => {
                const option = data.options[index];
                if (!option) return;
                element.classList.add('playable');
                element.classList.remove('disabled');
                element.disabled = false;
                element.setAttribute('aria-label', `${I18n.t('choose_card')}: ${option.name}`);
                element.onclick = () => resolve(option.id);
            });
            const firstCard = container.querySelector('.card.playable');
            if (firstCard) firstCard.focus();
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
        if (this.online && this.isHost) {
            (Net.conns || []).forEach(conn => {
                Net.sendTo(conn, { t: 'gameover', youWon: winner.connPeer === conn.peer, winnerName: winner.name });
            });
        }
        this._clearOnlineRuntime();
        const humanWon = this.online ? (winner === this.players[0]) : !winner.isBot;
        Storage.recordResult(humanWon);
        this.humanProfile = Storage.getCurrentProfile() || this.humanProfile;
        this.updateMenuChip();

        WakeLock.disable();
        Sound.play(humanWon ? 'win' : 'lose');
        if (humanWon) this.launchConfetti();

        UI.winnerText.innerText = humanWon
            ? I18n.t('you_win')
            : I18n.t('bot_win', { name: winner.name });

        if (this.online) { this.online = false; Net.close(); }

        // إحصائيات العضو
        const statsEl = document.getElementById('end-stats');
        if (statsEl) {
            if (this.humanProfile && !this.humanProfile.guest) {
                const s = this.humanProfile.stats || { wins: 0, losses: 0, games: 0 };
                statsEl.textContent = `🏆 ${s.wins} ${I18n.t('wins')} · ❌ ${s.losses} ${I18n.t('losses')} · 🎮 ${s.games} ${I18n.t('games')}`;
            } else {
                statsEl.textContent = '';
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
            img.style.objectFit = 'cover';
            img.style.borderRadius = '11px';
            img.style.pointerEvents = 'none';
            img.style.transform = 'scale(1.045)';   // قصّ الإطار المدمج المتضارب داخل الصورة

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
                playable = this.isCardPlayableNow(card);
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
                this._timerShown = true;
            } else if (!myTurn && this._timerShown) {
                tt.classList.add('hidden'); tt.classList.remove('run');
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
