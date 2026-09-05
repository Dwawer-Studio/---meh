'use strict';

class MehGameBotsModule {
    _botObservation(player = this.currentPlayer) {
        const actorIndex = this.players.indexOf(player);
        const project = card => ({ id: card.id, definitionId: card.definitionId, name: card.name, type: card.type, color: card.color });
        return {
            actorIndex, style: player.botStyle || BotStrategy.styleForSeat(actorIndex),
            hand: player.hand.map(project),
            legalIds: player.hand.filter(card => this.isCardPlayableNow(card)).map(card => card.id),
            players: this.players.map(seat => ({ id: seat.id, count: seat.hand.length,
                shield: !!this.drawImmune[seat.id], skipped: !!this.skipNextMap[seat.id] })),
            top: this.topCard && project(this.topCard), discard: this.discardPile.slice(-4).map(project),
            activeColor: this.activeColor, direction: this.direction, pending: this.pendingDraws,
            powersDisabled: this.superpowersDisabled, colors: ONLINE_COLORS.slice(),
        };
    }

    _chooseBotEffect(player, kind, data) {
        const observation = this._botObservation(player);
        const value = BotStrategy.chooseDecision(observation, kind, {
            sourceType: this._resolvingCard && this._resolvingCard.type,
            ids: (data.options || []).map(option => option.id),
            targetIds: kind === 'target' ? (data.options || []).map(option => this.players[option.idx].id) : [],
        });
        return kind === 'target' ? this.players.findIndex(seat => seat.id === value) : value;
    }
}

const MehGameBotsMethods = MehGameBotsModule.prototype;
delete MehGameBotsMethods.constructor;
Object.freeze(MehGameBotsMethods);
