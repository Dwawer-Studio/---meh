'use strict';

class MehGameAuthoritativeModule {
    _authoritativeServiceAvailable() {
        return this._productFeatureEnabled('authoritative_service')
            && typeof window.MEH_SERVICE_URL === 'string'
            && /^wss?:\/\//.test(window.MEH_SERVICE_URL);
    }

    async _ensureAuthoritativeClient() {
        if (this._authoritativeClient && this._authoritativeClient.socket) return this._authoritativeClient;
        const serviceUrl = window.MEH_SERVICE_URL;
        const httpUrl = window.MEH_SERVICE_HTTP_URL
            || serviceUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/\/v1\/realtime$/, '');
        let accessToken;
        try { accessToken = sessionStorage.getItem('meh_authoritative_access'); } catch (error) {}
        const createAccount = async () => {
            const created = await AuthoritativeAccountClient.createGuest(httpUrl, this.humanProfile.name);
            accessToken = created.accessToken;
            try { sessionStorage.setItem('meh_authoritative_access', accessToken); } catch (error) {}
        };
        if (!accessToken) await createAccount();
        const client = new AuthoritativeGameClient({
            url: serviceUrl,
            onSnapshot: snapshot => this._applyAuthoritativeSnapshot(snapshot),
            onConnectionState: state => this._handleAuthoritativeConnectionState(state),
            onRejected: code => this._handleAuthoritativeReject(code),
            onEvent: message => this._handleMajlisEvent(message),
        });
        let welcome;
        try {
            welcome = await client.connect(accessToken);
        } catch (error) {
            if (error.code !== 'UNAUTHENTICATED') throw error;
            try { sessionStorage.removeItem('meh_authoritative_access'); } catch (storageError) {}
            await createAccount();
            welcome = await client.connect(accessToken);
        }
        this._authoritativeAccessToken = accessToken;
        this._authoritativeHttpUrl = httpUrl;
        const remoteSettings = welcome && welcome.payload && welcome.payload.account && welcome.payload.account.settings;
        if (remoteSettings && Object.keys(remoteSettings).length) {
            this.settings = { ...this.settings, ...remoteSettings };
            Storage.saveSettings(this.settings);
            this.applySettings();
        }
        this._authoritativeClient = client;
        return client;
    }

    _syncAuthoritativeSettings() {
        if (!this._authoritativeAccessToken || !this._authoritativeHttpUrl) return;
        AuthoritativeAccountClient.updateSettings(
            this._authoritativeHttpUrl,
            this._authoritativeAccessToken,
            this.settings,
        ).catch(() => {});
    }

    async _createAuthoritativeRoom(mode = 'private', majlisId = null) {
        this._trackProductEvent('room.join_started', { role: 'host', method: mode });
        this.showOnlineStatus(I18n.t(mode === 'quick' ? 'quick_play_connecting' : 'creating_room'));
        try {
            const client = await this._ensureAuthoritativeClient();
            const response = await client.createRoom(mode, majlisId);
            Net.roomCode = client.roomCode;
            Net.isHost = true;
            this.isHost = false;
            this._applyAuthoritativeSnapshot(response.payload.snapshot);
            this._trackProductEvent('invite.created', { method: mode === 'quick' ? 'quick' : 'code' });
        } catch (error) {
            this.showOnlineStatus(I18n.t('conn_error'), true);
            this._trackProductEvent('room.join_failed', { stage: 'service', reason: error.code || 'unknown' });
        }
    }

    async _joinAuthoritativeRoom(options = {}) {
        const input = document.getElementById('room-code-input');
        const code = String(options.code || (input && input.value) || '').trim().toUpperCase();
        this._activeJoinSurface = options.surface === 'invite' ? 'invite' : 'online';
        this._showJoinStatus(I18n.t('connecting'));
        try {
            const client = await this._ensureAuthoritativeClient();
            const response = await client.joinRoom(code);
            Net.roomCode = client.roomCode;
            Net.isHost = false;
            this.isHost = false;
            this._applyAuthoritativeSnapshot(response.payload.snapshot);
        } catch (error) {
            this._showJoinStatus(I18n.t('conn_error'), true);
            this._trackProductEvent('room.join_failed', { stage: 'service', reason: error.code || 'unknown' });
        }
    }

    _applyAuthoritativeSnapshot(snapshot) {
        if (!snapshot || snapshot.type !== 'room.snapshot' || !snapshot.payload) return false;
        const payload = snapshot.payload;
        const room = payload.room;
        const seats = Array.isArray(payload.seats) ? [...payload.seats].sort((a, b) => a.seatIndex - b.seatIndex) : [];
        if (!room || seats.length !== 4) return false;
        this._authoritativeSnapshot = snapshot;
        Net.roomCode = room.roomCode;
        const viewerSeatId = payload.match && payload.match.me && payload.match.me.id
            || this._authoritativeClient && this._authoritativeClient.seatId;
        const viewerIndex = seats.findIndex(seat => seat.seatId === viewerSeatId);
        this.lobbyPlayers = seats.filter(seat => !seat.isBot).map(seat => ({
            id: seat.seatId,
            name: seat.displayName,
            avatar: seat.seatId === viewerSeatId ? this.humanProfile.avatar : '😎',
            host: seat.seatIndex === 0,
        }));
        this._syncAuthoritativeTable(room, seats, viewerSeatId);
        this._syncMajlisFromSnapshot(room, seats);
        this._syncFriendlyRecipeFromSnapshot(room, seats);

        if (room.phase === 'FORMING') {
            document.getElementById('lobby-room-code').textContent = room.roomCode;
            document.getElementById('lobby-start-btn').classList.remove('hidden');
            document.getElementById('lobby-start-btn').textContent = I18n.t('ready_to_start');
            document.getElementById('lobby-wait').classList.add('hidden');
            document.getElementById('turn-time-setting').classList.add('hidden');
            this._setLobbyInvite(room.roomCode);
            this.showScreen('lobby-screen');
            this.renderLobby();
            return true;
        }

        const match = payload.match;
        if (!match || viewerIndex < 0) return false;
        if (match.phase === 'ACTIVE' && this._authoritativeMatchId !== room.matchId) {
            this._authoritativeMatchId = room.matchId;
            this._authoritativeInMatch = true;
            this.beginClientGame();
        }
        if (match.phase === 'ACTIVE') {
            const rotatedSeats = [];
            for (let offset = 0; offset < seats.length; offset++) rotatedSeats.push(seats[(viewerIndex + offset) % seats.length]);
            const counts = new Map(match.others.map(other => [other.id, other]));
            this._authoritativeSeatIds = rotatedSeats.map(seat => seat.seatId);
            this._authoritativeMatchView = match;
            this.superpowersDisabled = match.superpowersDisabled === true;
            const card = raw => this._hydrateAuthoritativeCard(raw);
            const normalized = {
                t: 'state',
                me: { name: seats[viewerIndex].displayName, avatar: this.humanProfile.avatar },
                hand: match.me.hand.map(card),
                others: rotatedSeats.slice(1).map(seat => ({
                    name: seat.displayName,
                    avatar: seat.isBot ? '🤖' : '😎',
                    count: (counts.get(seat.seatId) || {}).handCount || 0,
                    isBot: seat.isBot,
                })),
                top: card(match.topCard),
                second: card(match.secondCard),
                activeColor: match.activeColor,
                direction: match.direction,
                current: rotatedSeats.findIndex(seat => seat.seatId === match.currentPlayerId),
                pending: match.pendingDraws,
                skipped: match.skippedSeatIds.map(id => rotatedSeats.findIndex(seat => seat.seatId === id)).filter(index => index >= 0),
                canPlay: match.currentPlayerId === viewerSeatId,
            };
            this.online = true;
            this.isHost = false;
            this.applyState(normalized);
            this._startTurnCountdownVisual(10);
            document.body.classList.add('turn-ticking');
            return true;
        }
        if (match.phase === 'COMPLETE' && this._authoritativeCompletedMatchId !== room.matchId) {
            this._authoritativeCompletedMatchId = room.matchId;
            this._authoritativeInMatch = false;
            const winnerSeat = seats.find(seat => seat.seatId === match.winnerId);
            this.onlineGameOver({
                youWon: match.winnerId === viewerSeatId,
                winnerName: winnerSeat ? winnerSeat.displayName : I18n.t('guest'),
                keepTable: true,
            });
            return true;
        }
        return true;
    }

    _syncAuthoritativeTable(room, seats, viewerSeatId) {
        const phase = ['FORMING', 'IN_MATCH', 'RESULTS'].includes(room.phase) ? room.phase : 'FORMING';
        this.tableSnapshot = {
            schemaVersion: 1,
            sessionId: room.roomId,
            rulesVersion: room.rulesVersion,
            catalogVersion: room.catalogVersion,
            deckRecipeId: room.deckRecipeId,
            phase,
            matchNumber: room.matchId ? 1 : 0,
            maxSeats: 4,
            seats: seats.map((seat, index) => ({
                seatId: `seat-${index}`,
                displayName: seat.displayName,
                avatar: seat.seatId === viewerSeatId ? this.humanProfile.avatar : (seat.isBot ? '🤖' : '😎'),
                host: seat.seatIndex === 0,
                kind: seat.isBot ? 'bot' : 'human',
                controller: seat.isBot ? 'bot' : 'human',
                connected: seat.status === 'CONNECTED' || seat.isBot,
                ready: seat.ready === true,
                score: 0,
                wins: 0,
            })),
        };
        this._renderTableResults();
    }

    _hydrateAuthoritativeCard(raw) {
        if (!raw) return null;
        const definition = MEH_CATALOG_MANIFEST.definitions.find(item => item.definitionId === raw.definitionId);
        if (!definition) return null;
        return {
            id: raw.id,
            definitionId: definition.definitionId,
            color: raw.color,
            name: definition.nameAr,
            type: definition.type,
            emoji: definition.emoji,
            svgFile: `assets/cards/${raw.color}-${definition.assetBase}.webp`,
        };
    }

    async _submitAuthoritativePlay(card) {
        if (!card || !this._authoritativeClient || !this._authoritativeMatchView) return false;
        this.humanCanPlay = false;
        this.actionInProgress = true;
        try {
            const decision = await this._authoritativeDecision(card);
            await this._authoritativeClient.play(card.id, this._authoritativeMatchView.turnId, decision);
            this._trackProductEvent('action.committed', { actor: 'self', action: 'play', definitionId: card.definitionId });
            return true;
        } catch (error) {
            this.actionInProgress = false;
            this.humanCanPlay = true;
            this.showToast(I18n.t('conn_error'));
            this.updateUI();
            return false;
        }
    }

    async _submitAuthoritativeDraw() {
        if (!this._authoritativeClient || !this._authoritativeMatchView) return false;
        this.humanCanPlay = false;
        this.actionInProgress = true;
        try {
            await this._authoritativeClient.draw(this._authoritativeMatchView.turnId);
            this._trackProductEvent('action.committed', { actor: 'self', action: 'draw' });
            return true;
        } catch (error) {
            this.actionInProgress = false;
            this.humanCanPlay = true;
            this.showToast(I18n.t('conn_error'));
            this.updateUI();
            return false;
        }
    }

    async _authoritativeDecision(card) {
        const actor = this.players[0];
        const powerTypes = ['chameleon', 'boShlakh', 'hamour', 'nokhtha', 'dramaQueen', 'sugar', 'umWajhain'];
        if (this.superpowersDisabled && powerTypes.includes(card.type)) return null;
        const ask = (kind, data) => new Promise(resolve => this.requestEffectDecision(actor, kind, data, resolve));
        const targets = this.players.slice(1).map((player, index) => ({ idx: index + 1, name: player.name }));
        if (['meh', 'draw4Wild', 'wild'].includes(card.type)) {
            return { color: await ask('color', {}) };
        }
        if (card.type === 'bestOne') {
            return { choice: await ask('choice', {
                title: I18n.t('best_one_choice', { name: this.players[1].name }),
                opt1: I18n.t('throw_two'), opt2: I18n.t('draw_two'),
            }) };
        }
        if (card.type === 'chameleon') {
            const targetIndex = await ask('target', { options: targets });
            const remaining = actor.hand.filter(item => item && item.id !== card.id);
            const decision = { targetId: this._authoritativeSeatIds[targetIndex] };
            if (remaining.length) decision.cardId = await this._authoritativePickCard(remaining);
            return decision;
        }
        if (card.type === 'boShlakh') {
            const remaining = actor.hand.filter(item => item && item.id !== card.id);
            return remaining.length ? { cardId: await this._authoritativePickCard(remaining) } : null;
        }
        if (card.type === 'umWajhain') {
            const targetIndex = await ask('target', { options: targets });
            const choice = await ask('choice', {
                title: I18n.t('um_choice', { name: this.players[targetIndex].name }),
                opt1: I18n.t('um_discard'), opt2: I18n.t('um_draw'),
            });
            return { targetId: this._authoritativeSeatIds[targetIndex], choice };
        }
        return null;
    }

    _authoritativePickCard(cards) {
        return new Promise(resolve => {
            const heading = UI.playerPicker && UI.playerPicker.querySelector('h3');
            if (heading) heading.textContent = I18n.t('choose_card');
            UI.playerPickerList.replaceChildren();
            cards.forEach(card => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'picker-btn';
                button.textContent = I18n.cardName(card);
                button.onclick = () => {
                    this.setDialogOpen(UI.playerPicker, false);
                    resolve(card.id);
                };
                UI.playerPickerList.appendChild(button);
            });
            this.setDialogOpen(UI.playerPicker, true);
        });
    }

    _handleAuthoritativeConnectionState(state) {
        if (state === 'resyncing' || state === 'reconnecting') this.showToast(I18n.t('reconnecting'));
        if (state === 'disconnected' && this._authoritativeClient) this.showToast(I18n.t('connection_lost'));
        if (state === 'recovery_failed') this.showToast(I18n.t('conn_error'));
    }

    _handleAuthoritativeReject(code) {
        if (code === 'STALE_TURN' || code === 'BAD_SEQUENCE') {
            this._authoritativeClient.requestSnapshot().catch(() => {});
        }
    }
}

const MehGameAuthoritativeMethods = MehGameAuthoritativeModule.prototype;
delete MehGameAuthoritativeMethods.constructor;
Object.freeze(MehGameAuthoritativeMethods);
