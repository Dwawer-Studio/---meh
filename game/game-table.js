'use strict';

class MehGameTableModule {
    _initializeTableRuntime() {
        this.tableSession = null;
        this.tableSnapshot = null;
        this._nextMatchTimer = null;
        this._seatLeaseTimers = new Map();
        this._localReady = false;
        this._turnDurationSeconds = 10;
    }

    _createHostTable(code) {
        if (!this._productFeatureEnabled('persistent_table')) return false;
        this.tableSession = new TableSession({ tableId: code, hostOwnerId: 'host' });
        this.tableSession.addHuman({
            ownerId: 'host',
            displayName: this.humanProfile.name,
            avatar: this.humanProfile.avatar,
        });
        this.tableSnapshot = this.tableSession.snapshot();
        return true;
    }

    _tableAddLobbyPlayer(player) {
        if (!this.tableSession || !player) return { ok: false, reason: 'no-table' };
        const result = this.tableSession.addHuman({
            ownerId: player.seatToken || player.id,
            displayName: player.name,
            avatar: player.avatar,
        });
        this.tableSnapshot = this.tableSession.snapshot();
        return result;
    }

    _publicTableSnapshot() {
        if (!this.tableSession) return null;
        const snapshot = this.tableSession.snapshot();
        return {
            schemaVersion: snapshot.schemaVersion,
            tableId: snapshot.tableId,
            phase: snapshot.phase,
            matchNumber: snapshot.matchNumber,
            maxSeats: snapshot.maxSeats,
            seats: snapshot.seats.map(seat => ({
                seatId: seat.seatId,
                displayName: seat.displayName,
                avatar: seat.avatar,
                host: seat.host,
                kind: seat.kind,
                controller: seat.controller,
                connected: seat.connected,
                ready: seat.ready,
                score: seat.score,
                wins: seat.wins,
            })),
        };
    }

    _applyTableSnapshot(snapshot) {
        if (!this._isRecord(snapshot) || snapshot.schemaVersion !== 1
            || !['FORMING', 'IN_MATCH', 'RESULTS'].includes(snapshot.phase)
            || !Array.isArray(snapshot.seats) || snapshot.seats.length > 4) return false;
        const seats = [];
        for (const seat of snapshot.seats) {
            if (!this._isRecord(seat) || !/^seat-[0-3]$/.test(seat.seatId)
                || !this._safePlayerName(seat.displayName) || !this._safeAvatar(seat.avatar)
                || !['human', 'bot'].includes(seat.kind) || !['human', 'bot'].includes(seat.controller)
                || typeof seat.connected !== 'boolean' || typeof seat.ready !== 'boolean'
                || !Number.isSafeInteger(seat.score) || seat.score < 0 || seat.score > 999) return false;
            seats.push({ ...seat });
        }
        this.tableSnapshot = { ...snapshot, seats };
        if (snapshot.phase === TABLE_PHASES.IN_MATCH) this._localReady = false;
        this._renderTableResults();
        if (snapshot.phase === TABLE_PHASES.RESULTS) {
            UI.winnerText.innerText = I18n.t('table_results_title');
            this.showScreen('end-screen');
        }
        return true;
    }

    _broadcastTable() {
        if (!this.isHost || !this.tableSession) return;
        const snapshot = this._publicTableSnapshot();
        this.tableSnapshot = snapshot;
        Net.broadcast({ t: 'table', snapshot });
        this._renderTableResults();
    }

    _renderTableResults() {
        const snapshot = this.tableSession ? this._publicTableSnapshot() : this.tableSnapshot;
        if (!snapshot) return;
        const score = document.getElementById('session-score');
        const readiness = document.getElementById('table-ready-list');
        if (score) {
            score.classList.toggle('hidden', !this._productFeatureEnabled('session_score'));
        }
        if (score && this._productFeatureEnabled('session_score')) {
            score.replaceChildren(...snapshot.seats.map(seat =>
                this._createTextElement('div', 'session-score-seat', `${seat.avatar} ${seat.displayName} · ${seat.score}`)));
        }
        if (readiness) {
            readiness.replaceChildren(...snapshot.seats.filter(seat => seat.kind === 'human').map(seat =>
                this._createTextElement(
                    'div',
                    `ready-seat ${seat.ready ? 'is-ready' : ''}`,
                    `${seat.ready ? '✓' : '…'} ${seat.displayName}`,
                )));
        }
        const primary = document.getElementById('restart-btn');
        if (primary && snapshot.phase === TABLE_PHASES.RESULTS) {
            primary.textContent = I18n.t('ready_next_match');
            primary.disabled = this._localReady === true;
        }
    }

    _markLocalReady() {
        if (!this.tableSession && !this.tableSnapshot) return false;
        this._localReady = true;
        if (this._authoritativeClient) {
            this._authoritativeClient.setReady(true).catch(() => {
                this._localReady = false;
                const button = document.getElementById('restart-btn');
                if (button) button.disabled = false;
                this.showToast(I18n.t('conn_error'));
            });
            this._trackProductEvent('rematch.ready', { mode: 'authoritative-service' });
            const button = document.getElementById('restart-btn');
            if (button) button.disabled = true;
            return true;
        }
        if (this.isHost) {
            if (!this.tableSession.setReady('host', true)) return false;
            this._trackProductEvent('rematch.ready', { mode: 'online-host' });
            this._broadcastTable();
            this._maybeScheduleNextMatch();
        } else {
            Net.send({ t: 'ready', ready: true });
            this._trackProductEvent('rematch.ready', { mode: 'online-client' });
        }
        const primary = document.getElementById('restart-btn');
        if (primary) primary.disabled = true;
        return true;
    }

    _handleRemoteReady(conn, message) {
        if (!this.tableSession || this.tableSession.phase !== TABLE_PHASES.RESULTS || message.ready !== true) return false;
        const player = (this.lobbyPlayers || []).find(item => item.id === conn.peer);
        if (!player || !this.tableSession.setReady(player.seatToken || player.id, true)) return false;
        this._broadcastTable();
        this._maybeScheduleNextMatch();
        return true;
    }

    _maybeScheduleNextMatch() {
        if (!this.isHost || !this.tableSession || !this.tableSession.allHumansReady() || this._nextMatchTimer) return false;
        const status = document.getElementById('rematch-status');
        if (status) status.textContent = I18n.t('next_match_starting');
        this._nextMatchTimer = setTimeout(() => {
            this._nextMatchTimer = null;
            this.startOnlineGame();
        }, 1500);
        return true;
    }

    _beginTableMatch() {
        if (!this.tableSession) return true;
        const result = this.tableSession.startMatch();
        if (!result.ok) return false;
        this._localReady = false;
        this.tableSnapshot = this.tableSession.snapshot();
        this._broadcastTable();
        return true;
    }

    _completeHostTableMatch(winner) {
        if (!this.tableSession || this.tableSession.phase !== TABLE_PHASES.IN_MATCH) return false;
        const result = this.tableSession.endMatch(winner.id);
        if (!result.ok) return false;
        this._localReady = false;
        const publicSnapshot = this._publicTableSnapshot();
        this.tableSnapshot = publicSnapshot;
        (Net.conns || []).forEach(conn => {
            Net.sendTo(conn, {
                t: 'matchresult',
                youWon: winner.connPeer === conn.peer,
                winnerName: winner.name,
                snapshot: publicSnapshot,
            });
        });
        this._renderTableResults();
        return true;
    }

    _completeClientTableMatch(message) {
        if (!this._applyTableSnapshot(message.snapshot)) return false;
        this.onlineGameOver({ youWon: message.youWon, winnerName: message.winnerName, keepTable: true });
        return true;
    }

    _closeTableSession() {
        if (this._nextMatchTimer) clearTimeout(this._nextMatchTimer);
        this._nextMatchTimer = null;
        for (const timer of this._seatLeaseTimers.values()) clearTimeout(timer);
        this._seatLeaseTimers.clear();
        if (this.tableSession) this.tableSession.close();
        this.tableSession = null;
        this.tableSnapshot = null;
        this._localReady = false;
    }
}

const MehGameTableMethods = MehGameTableModule.prototype;
delete MehGameTableMethods.constructor;
Object.freeze(MehGameTableMethods);
