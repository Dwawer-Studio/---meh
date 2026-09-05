'use strict';

// Presentation-only, bounded recent history. Never serialize the action object:
// it can contain a card privately transferred by Chameleon.
class PublicJournal {
    constructor() { this.matches = new Map(); }

    record(before, reduced, action) {
        const entries = [...(this.matches.get(before.matchId) || [])];
        if (entries.some(entry => entry.version === reduced.state.stateVersion)) return;
        const played = action.type === 'play'
            ? before.players[before.currentPlayerIndex].hand.find(card => card.id === action.cardId) : null;
        const group = {
            version: reduced.state.stateVersion, actorId: action.actorId,
            card: played ? { definitionId: played.definitionId, color: played.color } : null,
            before: { pendingDraws: before.pendingDraws, direction: before.direction,
                superpowersDisabled: before.superpowersDisabled,
                selfShield: before.immuneSeatIds.includes(action.actorId) },
            events: reduced.events.filter(event => ['card.committed', 'effect.applied', 'effect.suppressed',
                'draw.blocked', 'cards.drawn', 'turn.skipped', 'powers.restored'].includes(event.type))
                .map(event => ({ type: event.type, seatId: event.seatId,
                    ...(Number.isSafeInteger(event.count) ? { count: event.count } : {}) })),
        };
        const decision = action.decision || {};
        if (played && !reduced.events.some(event => event.type === 'effect.suppressed')) {
            const actor = before.players[before.currentPlayerIndex];
            const next = before.players[(before.currentPlayerIndex + before.direction + before.players.length) % before.players.length];
            const target = before.players.find(player => player.id === decision.targetId);
            let discarded = null;
            if (played.type === 'bestOne' && decision.choice === 0) discarded = { player: next, n: 2 };
            if (played.type === 'umWajhain' && decision.choice === 0) discarded = { player: target, n: 1 };
            if (played.type === 'boShlakh' && actor.hand.length > 1) discarded = { player: actor, n: 1 };
            if (discarded && discarded.player) group.events.push({ type: 'cards.discarded',
                seatId: discarded.player.id, count: Math.min(discarded.n, discarded.player.hand.length) });
            if (played.type === 'chameleon' && target && actor.hand.length > 1) {
                group.events.push({ type: 'card.given', seatId: target.id, count: 1 });
            }
            if (['meh', 'draw4Wild', 'wild'].includes(played.type)) {
                group.events.push({ type: 'color.chosen', seatId: actor.id, color: reduced.state.activeColor });
            }
        }
        entries.push(group);
        this.matches.set(before.matchId, entries.slice(-20));
        if (this.matches.size > 128) this.matches.delete(this.matches.keys().next().value);
    }

    recent(matchId) { return this.matches.get(matchId) || []; }
}

module.exports = { PublicJournal };
