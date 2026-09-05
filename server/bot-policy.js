'use strict';

const { BotStrategy } = require('../shared/bot-strategy');

function observeBotState(state, reducer) {
    const actor = state.players[state.currentPlayerIndex];
    const project = card => ({ id: card.id, definitionId: card.definitionId, name: card.name, type: card.type, color: card.color });
    return {
        actorIndex: state.currentPlayerIndex, style: actor.botStyle || BotStrategy.styleForSeat(state.currentPlayerIndex),
        hand: actor.hand.map(project), legalIds: actor.hand.filter(card => reducer.isPlayable(state, card)).map(card => card.id),
        players: state.players.map(player => ({ id: player.id, count: player.hand.length,
            shield: state.immuneSeatIds.includes(player.id), skipped: state.skippedSeatIds.includes(player.id) })),
        top: project(state.discard[state.discard.length - 1]), discard: state.discard.slice(-4).map(project),
        activeColor: state.activeColor, direction: state.direction, pending: state.pendingDraws,
        powersDisabled: state.superpowersDisabled, colors: state.standardColors.slice(),
    };
}

function planBotAction(state, reducer, options = {}) {
    const actor = state.players[state.currentPlayerIndex];
    if (!actor || (!actor.isBot && options.force !== true) || state.phase !== 'ACTIVE') return null;
    const observation = observeBotState(state, reducer);
    const id = BotStrategy.choosePlay(observation);
    const base = { actorId: actor.id, turnId: state.turnId };
    if (!id) return { ...base, type: 'draw' };
    const card = actor.hand.find(held => held.id === id);
    const action = { ...base, type: 'play', cardId: id };
    const after = { ...observation, hand: observation.hand.filter(held => held.id !== id) };
    const powerSuppressed = state.superpowersDisabled
        && ['chameleon', 'boShlakh', 'hamour', 'nokhtha', 'dramaQueen', 'sugar', 'umWajhain'].includes(card.type);
    if (powerSuppressed) return action;
    const decide = (kind, data) => BotStrategy.chooseDecision(after, kind, { sourceType: card.type, ...data });
    if (['meh', 'draw4Wild', 'wild'].includes(card.type)) action.decision = { color: decide('color') };
    if (card.type === 'bestOne') action.decision = { choice: decide('choice') };
    if (['chameleon', 'umWajhain'].includes(card.type)) {
        action.decision = { targetId: decide('target', { targetIds: observation.players.filter(player => player.id !== actor.id).map(player => player.id) }) };
        if (card.type === 'umWajhain') action.decision.choice = decide('choice');
    }
    if (['boShlakh', 'chameleon'].includes(card.type) && after.hand.length) {
        action.decision = { ...action.decision, cardId: decide('card', { ids: after.hand.map(held => held.id) }) };
    }
    return action;
}

module.exports = { planBotAction, observeBotState };
