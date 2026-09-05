'use strict';

// A small, deterministic policy over a PUBLIC observation plus the bot's own hand.
// No RNG/deck access, opponent hands, human-seat preference, or outcome adjustment.
const BotStrategy = (() => {
    const POWERS = new Set(['chameleon', 'boShlakh', 'hamour', 'nokhtha', 'dramaQueen', 'sugar', 'umWajhain']);
    const RESPONSES = new Set(['draw2', 'draw4Wild', 'meh', 'counterAttack', 'phantom']);
    const STYLES = Object.freeze({
        racer: Object.freeze({ shed: 1.25, safety: 0.7, threat: 0.8 }),
        guardian: Object.freeze({ shed: 1, safety: 1.4, threat: 0.85 }),
        tactician: Object.freeze({ shed: 1, safety: 1, threat: 1.35 }),
    });
    const styleForSeat = index => ['racer', 'guardian', 'tactician'][(index + 2) % 3];
    const suppressed = (card, o) => o.powersDisabled && POWERS.has(card.type);
    const at = (o, step) => o.players[(o.actorIndex + step * o.direction + o.players.length * 3) % o.players.length];
    const threat = player => player ? Math.max(0, 4 - player.count) : 0;
    const legalAfter = (card, top, color) => card.color === 'black' || card.color === color
        || (!!card.definitionId && card.definitionId === top.definitionId) || (!!card.name && card.name === top.name);
    const hash = text => {
        let value = 2166136261;
        for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619) >>> 0;
        return value;
    };
    const tie = (o, label) => hash(`${o.seed || ''}:${o.actorIndex}:${o.top && o.top.id}:${o.pending}:`
        + `${o.hand.map(card => card.id).join(',')}:${label}`);
    const rank = (o, values, score, label) => values.map(value => ({ value, score: score(value),
        tie: tie(o, `${label}:${value.id || value}`) })).sort((a, b) => b.score - a.score || a.tie - b.tie);

    function burden(card, o, hand = o.hand) {
        if (suppressed(card, o)) return 1;
        if (card.type === 'sorry') return o.players[o.actorIndex].shield ? -3 : 16;
        if (card.type === 'hamour') return Math.min(4, o.discard.length) * 9;
        if (card.type === 'plato') return 9;
        if (card.color === 'black') return -9;
        if (['boShlakh', 'chameleon', 'nokhtha'].includes(card.type)) return -7;
        if (RESPONSES.has(card.type)) return -4;
        return hand.filter(other => other.id !== card.id && other.color === card.color).length ? 0 : 3;
    }

    function knownFinish(card, o, hand = o.hand) {
        const activePower = !suppressed(card, o);
        if (hand.length === 1) {
            if (card.type === 'sorry') return o.players[o.actorIndex].shield;
            if (card.type === 'hamour' && activePower) return o.discard.length === 0;
            return true;
        }
        if (activePower && hand.length === 2 && ['boShlakh', 'chameleon'].includes(card.type)) return true;
        return false;
    }

    function scorePlay(card, o) {
        if (knownFinish(card, o)) return 10000;
        const weights = STYLES[o.style] || STYLES.tactician;
        const remaining = o.hand.filter(other => other.id !== card.id);
        const next = at(o, 1), previous = at(o, -1);
        const isSuppressed = suppressed(card, o);
        let score = 10 * weights.shed;
        if (card.color !== 'black') score += remaining.filter(other => other.color === card.color).length * 1.4;
        if (isSuppressed) return score;
        if (card.type === 'sorry') score -= o.players[o.actorIndex].shield ? 0 : 20 * weights.shed;
        if (card.type === 'hamour') {
            const returning = o.discard.slice(-4);
            score -= returning.length * 10 * weights.shed;
            // Retrieval may recover a useful public combination, but added hand size still matters.
            score += returning.filter(held => ['boShlakh', 'chameleon', 'nokhtha'].includes(held.type)).length * 3;
        }
        if (card.type === 'plato') score -= 7 * weights.safety;
        if (['boShlakh', 'chameleon'].includes(card.type) && remaining.length) {
            score += 10 * weights.shed + Math.max(...remaining.map(held => burden(held, o, remaining))) * 0.6;
        }
        if (card.type === 'nokhtha') {
            const followups = remaining.filter(held => legalAfter(held, card, card.color));
            if (followups.some(held => knownFinish(held, { ...o, discard: [...o.discard, card] }, remaining))) return 5000;
            score += followups.length ? 13 * weights.shed : -7;
        }
        if (card.type === 'skip') score += 4 + threat(next) * 5 * weights.threat;
        if (card.type === 'dramaQueen') score += 6 + (threat(next) + threat(at(o, 2))) * 4 * weights.threat;
        if (card.type === 'reverse') score += (threat(next) - threat(previous)) * 5 * weights.threat;
        if (['draw2', 'draw4Wild', 'meh', 'counterAttack'].includes(card.type)) {
            const target = card.type === 'counterAttack' ? previous : next;
            score += 3 + threat(target) * 5 * weights.threat;
            if (o.pending > 0) score += 8;
        }
        if (card.type === 'phantom') score += o.pending > 0 ? (12 + Math.min(12, o.pending * 2)) * weights.safety : -3;
        if (card.type === 'bestOne') score += 4 + threat(next) * 4 * weights.threat;
        if (card.type === 'umWajhain') score += 4 + Math.max(...o.players.filter((_, i) => i !== o.actorIndex).map(threat)) * 4 * weights.threat;
        if (card.type === 'sugar') score -= remaining.filter(held => POWERS.has(held.type)).length * 3;
        if (card.color === 'black' && !o.pending) score -= 6 * weights.safety;
        // Keep one counter in reserve when it is not needed to stop a near winner.
        if (!o.pending && RESPONSES.has(card.type) && !remaining.some(held => RESPONSES.has(held.type)) && threat(next) < 2) {
            score -= 4 * weights.safety;
        }
        return score;
    }

    function rankPlays(o) {
        const legal = new Set(o.legalIds);
        return rank(o, o.hand.filter(card => legal.has(card.id)), card => scorePlay(card, o), 'play')
            .map(item => ({ cardId: item.value.id, score: item.score }));
    }

    function chooseDiscard(o, ids) {
        const allowed = new Set(ids);
        return rank(o, o.hand.filter(card => allowed.has(card.id)), card => burden(card, o), 'discard')[0]?.value.id || null;
    }

    function chooseDecision(o, kind, data = {}) {
        if (kind === 'color') {
            return rank(o, o.colors, color => o.hand.filter(card => card.color === color)
                .reduce((sum, card) => sum + 3 + (['boShlakh', 'chameleon', 'nokhtha'].includes(card.type) ? 2 : 0), 0), 'color')[0].value;
        }
        // In a free-for-all, drawing never gifts an opponent an immediate empty hand.
        if (kind === 'choice') return 1;
        if (kind === 'card') return chooseDiscard(o, data.ids || []);
        if (kind === 'target') {
            const allowed = new Set(data.targetIds || []);
            const targets = o.players.filter((player, i) => i !== o.actorIndex && allowed.has(player.id));
            const giftId = data.sourceType === 'chameleon' ? chooseDiscard(o, o.hand.map(card => card.id)) : null;
            const gift = o.hand.find(card => card.id === giftId);
            return rank(o, targets, player => {
                // A useful gift is safer in a larger hand; a burden can slow a leader.
                if (gift && burden(gift, o) < 0) return player.count;
                return threat(player) * 6 - player.count * 0.1;
            }, 'target')[0]?.value.id || null;
        }
        return null;
    }

    return Object.freeze({ styles: STYLES, styleForSeat, rankPlays,
        choosePlay: o => rankPlays(o)[0]?.cardId || null, chooseDecision });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { BotStrategy };
