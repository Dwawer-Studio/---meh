'use strict';

class MehGameOnlineModule {
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
}

const MehGameOnlineMethods = MehGameOnlineModule.prototype;
delete MehGameOnlineMethods.constructor;
Object.freeze(MehGameOnlineMethods);
