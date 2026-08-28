'use strict';

class MehGameProductModule {
    _initializeProductEvidence() {
        this._productCompletedMatches = 0;
        this._productMatchActive = false;
        this._productLastReadyKey = '';
        this._productAutoAction = false;
        let entrySource = 'unknown';
        try {
            const navigation = performance.getEntriesByType('navigation')[0];
            entrySource = navigation && navigation.type === 'reload' ? 'reload' : 'direct';
        } catch (error) { entrySource = 'unknown'; }
        this._trackProductEvent('app.session_started', {
            entrySource,
            language: I18n.lang === 'ar' || I18n.lang === 'en' ? I18n.lang : 'unknown',
        });
        this._trackProductEvent('entry.viewed', { screenId: 'main-menu' });
    }

    _trackProductEvent(name, properties) {
        try {
            return typeof ProductTelemetry !== 'undefined'
                && ProductTelemetry.track(name, properties) === true;
        } catch (error) { return false; }
    }

    _productMode() {
        if (!this.online) return 'local';
        return this.isHost ? 'online-host' : 'online-client';
    }

    _productActor(player) {
        if (!player) return 'unknown';
        if (player.isBot) return 'bot';
        if (player.isRemote) return 'remote';
        return 'self';
    }

    _productSeatReady(role, humanSeats) {
        const boundedSeats = Math.max(1, Math.min(4, Number(humanSeats) || 1));
        const key = `${role}:${boundedSeats}`;
        if (this._productLastReadyKey === key) return;
        this._productLastReadyKey = key;
        this._trackProductEvent('seat.ready', { role, humanSeats: boundedSeats });
    }

    _productBeginMatch(matchPlayers = this.players) {
        if (this._productMatchActive) return;
        const players = Array.isArray(matchPlayers) ? matchPlayers : [];
        const humanSeats = Math.max(1, players.filter(player => !player.isBot).length || 1);
        const botSeats = Math.max(0, Math.min(3, players.filter(player => player.isBot).length));
        this._trackProductEvent('table.phase_changed', { from: 'lobby', to: 'match' });
        this._trackProductEvent('match.started', {
            mode: this._productMode(),
            humanSeats: Math.min(4, humanSeats),
            botSeats,
            rematch: this._productCompletedMatches > 0,
        });
        this._productMatchActive = true;
    }

    _productCompleteMatch(humanWon, winner) {
        if (!this._productMatchActive) return;
        this._trackProductEvent('match.completed', {
            mode: this._productMode(),
            outcome: humanWon ? 'win' : 'loss',
            winnerActor: this._productActor(winner),
        });
        this._productCompletedMatches++;
        this._productMatchActive = false;
        this._trackProductEvent('table.phase_changed', { from: 'match', to: 'results' });
        this._trackProductEvent('rematch.prompted', { mode: this._productMode() });
    }

    _productCompleteTable(reason) {
        this._trackProductEvent('table.completed', {
            reason,
            completedMatches: Math.max(0, Math.min(999, this._productCompletedMatches || 0)),
        });
        this._productMatchActive = false;
        this._productCompletedMatches = 0;
        this._productLastReadyKey = '';
    }
}

const MehGameProductMethods = MehGameProductModule.prototype;
delete MehGameProductMethods.constructor;
Object.freeze(MehGameProductMethods);
