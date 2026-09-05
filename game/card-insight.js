'use strict';

// Presentation only. This module never mutates a hand or resolves an effect.
const CardInsight = Object.freeze({
    powerTypes: Object.freeze(['chameleon', 'boShlakh', 'hamour', 'nokhtha', 'dramaQueen', 'sugar', 'umWajhain']),
    describe(card, state, t) {
        const players = state.players || [];
        const actorIndex = Number.isInteger(state.actorIndex) ? state.actorIndex : 0;
        const actor = players[actorIndex] || { name: '', hand: [] };
        const direction = state.direction === -1 ? -1 : 1;
        const at = offset => players[(actorIndex + offset * direction + players.length * 3) % players.length] || {};
        const next = at(1);
        const pending = Math.max(0, state.pendingDraws || 0);
        const parameters = { name: next.name || '', second: at(2).name || '',
            previous: at(-1).name || '', n: pending + ({ draw2: 2, draw4Wild: 4, meh: 1, counterAttack: 2 }[card.type] || 0) };
        const suppressed = state.superpowersDisabled && this.powerTypes.includes(card.type);
        const key = suppressed ? 'insight_suppressed'
            : card.type === 'sorry' && state.selfShield ? 'insight_sorry_shield' : `insight_${card.type}`;
        const description = t(key, parameters);
        let detail = '';
        if (card.type === 'hamour' && !suppressed) {
            // Hosts know the public discard stack. Remote snapshots may contain only its top.
            detail = state.discardComplete === false ? t('insight_public_stack')
                : t('insight_hamour_count', { n: Math.min(4, (state.discardPile || []).length) });
        }
        if (card.type === 'sorry' && !state.selfShield) detail = t('insight_self_cost');
        if (card.type === 'plato') detail = t('insight_skip_cost');
        return { description, detail, suppressed, actorName: actor.name };
    },
});

if (typeof module !== 'undefined' && module.exports) module.exports = { CardInsight };
