'use strict';

const crypto = require('node:crypto');

function stableIndex(state, label, length) {
    if (!length) return 0;
    const hash = crypto.createHash('sha256')
        .update(`${state.matchId}:${state.stateVersion}:${state.turnId}:${label}`)
        .digest();
    return hash.readUInt32BE(0) % length;
}

function planBotAction(state, reducer, options = {}) {
    const actor = state.players[state.currentPlayerIndex];
    if (!actor || (!actor.isBot && options.force !== true) || state.phase !== 'ACTIVE') return null;
    let playable = actor.hand.filter(card => reducer.isPlayable(state, card));
    if (!state.pendingDraws) {
        const preferred = playable.filter(card => !['sorry', 'plato', 'hamour'].includes(card.type));
        if (preferred.length) playable = preferred;
    }
    if (!playable.length) return { type: 'draw', actorId: actor.id, turnId: state.turnId };
    const card = playable[0];
    const action = { type: 'play', actorId: actor.id, turnId: state.turnId, cardId: card.id };
    const colors = state.standardColors;
    if (['meh', 'draw4Wild', 'wild'].includes(card.type)) {
        const counts = new Map(colors.map(color => [color, 0]));
        for (const held of actor.hand) if (counts.has(held.color)) counts.set(held.color, counts.get(held.color) + 1);
        action.decision = { color: [...colors].sort((a, b) => counts.get(b) - counts.get(a))[0] };
    } else if (card.type === 'bestOne') {
        action.decision = { choice: 1 };
    } else if (card.type === 'chameleon') {
        const targets = state.players.filter(player => player.id !== actor.id);
        const target = targets[stableIndex(state, 'chameleon-target', targets.length)];
        action.decision = { targetId: target.id };
        const remaining = actor.hand.filter(held => held.id !== card.id);
        if (remaining.length) action.decision.cardId = remaining[stableIndex(state, 'chameleon-card', remaining.length)].id;
    } else if (card.type === 'boShlakh') {
        const remaining = actor.hand.filter(held => held.id !== card.id);
        if (remaining.length) action.decision = { cardId: remaining[stableIndex(state, 'discard-card', remaining.length)].id };
    } else if (card.type === 'umWajhain') {
        const targets = state.players.filter(player => player.id !== actor.id);
        action.decision = {
            targetId: targets[stableIndex(state, 'um-target', targets.length)].id,
            choice: stableIndex(state, 'um-choice', 2),
        };
    }
    return action;
}

module.exports = { planBotAction };
