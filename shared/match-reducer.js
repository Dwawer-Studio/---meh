'use strict';

/*
 * Pure, transport-agnostic match authority. The browser and Node service load
 * this exact file; clocks, sockets, storage and presentation stay outside it.
 */
const MatchReducer = (() => {
    const SCHEMA_VERSION = 1;
    const MAX_NORMALIZE_STEPS = 24;
    const POWER_TYPES = new Set([
        'chameleon', 'boShlakh', 'hamour', 'nokhtha', 'dramaQueen', 'sugar', 'umWajhain',
    ]);

    class ReducerError extends Error {
        constructor(code, message) {
            super(message || code);
            this.name = 'ReducerError';
            this.code = code;
        }
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function canonicalize(value) {
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) throw new TypeError('State values must be finite');
            return value;
        }
        if (Array.isArray(value)) return value.map(canonicalize);
        if (!value || typeof value !== 'object') throw new TypeError('Unsupported state value');
        const output = {};
        for (const key of Object.keys(value).sort()) {
            if (value[key] !== undefined) output[key] = canonicalize(value[key]);
        }
        return output;
    }

    function fingerprint(value) {
        const source = JSON.stringify(canonicalize(value));
        let hash = 0x811c9dc5;
        for (let index = 0; index < source.length; index++) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }
        return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`;
    }

    function random(state) {
        state.rngState = (state.rngState + 0x6D2B79F5) >>> 0;
        let value = state.rngState;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }

    function shuffle(state, cards) {
        for (let index = cards.length - 1; index > 0; index--) {
            const other = Math.floor(random(state) * (index + 1));
            [cards[index], cards[other]] = [cards[other], cards[index]];
        }
    }

    function nextPlayerIndex(state, from = state.currentPlayerIndex, steps = 1) {
        let index = from;
        for (let count = 0; count < steps; count++) {
            index += state.direction;
            if (index >= state.players.length) index = 0;
            if (index < 0) index = state.players.length - 1;
        }
        return index;
    }

    function topCard(state) {
        return state.discard[state.discard.length - 1] || null;
    }

    function canRespondToPendingDraw(state, card) {
        return !!card && state.pendingDrawResponses.includes(card.type);
    }

    function isPlayable(state, card) {
        if (!card) return false;
        if (state.pendingDraws > 0) return canRespondToPendingDraw(state, card);
        const top = topCard(state);
        return card.color === state.wildColor
            || card.color === state.activeColor
            || (!!top && card.definitionId === top.definitionId);
    }

    function assertManifest(core, catalog, recipeId) {
        if (!core || !catalog) throw new TypeError('Core and catalog manifests are required');
        if (core.seats !== 4 || core.initialHandSize !== 7 || core.deckSize !== 60) {
            throw new ReducerError('UNSUPPORTED_RULES', 'Core contract differs from the locked game');
        }
        const recipe = catalog.recipes.find(item => item.recipeId === recipeId);
        if (!recipe || recipe.rulesVersion !== core.rulesVersion) {
            throw new ReducerError('UNKNOWN_RECIPE', 'Deck recipe is missing or incompatible');
        }
        return recipe;
    }

    function buildCards(core, catalog, recipe) {
        const definitions = new Map(catalog.definitions.map(definition => [definition.definitionId, definition]));
        const cards = [];
        let sequence = 0;
        const append = (definitionId, color) => {
            const definition = definitions.get(definitionId);
            if (!definition || !core.effectOpcodes.includes(definition.effectOpcode)) {
                throw new ReducerError('UNKNOWN_CARD', `Unsupported card definition: ${definitionId}`);
            }
            cards.push({
                id: `c${String(sequence++).padStart(2, '0')}`,
                definitionId,
                type: definition.effectOpcode,
                color,
            });
        };
        for (const color of core.standardColors) {
            for (const definitionId of recipe.coloredDefinitionIds) append(definitionId, color);
        }
        for (const definitionId of recipe.blackDefinitionIds) append(definitionId, core.wildColor);
        if (cards.length !== core.deckSize) throw new ReducerError('BAD_RECIPE_SIZE');
        return cards;
    }

    function createMatch(options) {
        const core = options && options.coreManifest;
        const catalog = options && options.catalogManifest;
        const recipeId = options && options.deckRecipeId || (catalog && catalog.activeRecipeId);
        const recipe = assertManifest(core, catalog, recipeId);
        if (!Number.isSafeInteger(options.seed)) throw new TypeError('A safe integer seed is required');
        if (!Array.isArray(options.players) || options.players.length !== core.seats) {
            throw new ReducerError('BAD_SEATS', 'Exactly four players are required');
        }
        const ids = new Set();
        const players = options.players.map((player, index) => {
            if (!player || typeof player.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(player.id)) {
                throw new ReducerError('BAD_SEAT_ID');
            }
            if (ids.has(player.id)) throw new ReducerError('DUPLICATE_SEAT_ID');
            ids.add(player.id);
            return { id: player.id, seatIndex: index, isBot: player.isBot === true, hand: [] };
        });
        const state = {
            schemaVersion: SCHEMA_VERSION,
            matchId: String(options.matchId || `match-${options.seed}`),
            rulesVersion: core.rulesVersion,
            catalogVersion: catalog.catalogVersion,
            deckRecipeId: recipeId,
            phase: 'ACTIVE',
            stateVersion: 0,
            turnId: 1,
            rngState: options.seed >>> 0,
            standardColors: [...core.standardColors],
            wildColor: core.wildColor,
            pendingDrawResponses: [...core.pendingDrawResponses],
            deck: [],
            discard: [],
            players,
            currentPlayerIndex: 0,
            direction: 1,
            activeColor: '',
            pendingDraws: 0,
            skippedSeatIds: [],
            immuneSeatIds: [],
            superpowersDisabled: false,
            sugarOwnerId: null,
            winnerId: null,
            actionCount: 0,
        };
        state.deck = buildCards(core, catalog, recipe);
        shuffle(state, state.deck);
        for (let round = 0; round < core.initialHandSize; round++) {
            for (const player of state.players) player.hand.push(state.deck.pop());
        }
        let opening = state.deck.pop();
        while (opening && opening.type !== core.openingCardType) {
            state.deck.unshift(opening);
            opening = state.deck.pop();
        }
        if (!opening) throw new ReducerError('NO_OPENING_CARD');
        state.discard.push(opening);
        state.activeColor = opening.color;
        return canonicalize(state);
    }

    function reshuffle(state, events) {
        if (state.deck.length || state.discard.length <= 1) return;
        const top = state.discard.pop();
        state.deck = state.discard;
        shuffle(state, state.deck);
        state.discard = [top];
        events.push({ type: 'deck.reshuffled', remaining: state.deck.length });
    }

    function drawOne(state, player, events) {
        reshuffle(state, events);
        const card = state.deck.pop() || null;
        if (card) player.hand.push(card);
        return card;
    }

    function drawMany(state, player, count, events) {
        const immuneIndex = state.immuneSeatIds.indexOf(player.id);
        if (immuneIndex >= 0) {
            state.immuneSeatIds.splice(immuneIndex, 1);
            events.push({ type: 'draw.blocked', seatId: player.id, count });
            return 0;
        }
        let drawn = 0;
        for (let index = 0; index < count; index++) {
            if (drawOne(state, player, events)) drawn++;
        }
        events.push({ type: 'cards.drawn', seatId: player.id, count: drawn, requested: count });
        return drawn;
    }

    function storeDiscardedCards(state, cards) {
        const valid = cards.filter(Boolean);
        if (!valid.length) return;
        state.discard.splice(Math.max(0, state.discard.length - 1), 0, ...valid);
    }

    function decisionObject(action) {
        return action.decision && typeof action.decision === 'object' && !Array.isArray(action.decision)
            ? action.decision
            : {};
    }

    function requireColor(state, decision) {
        if (!state.standardColors.includes(decision.color)) throw new ReducerError('BAD_DECISION');
        return decision.color;
    }

    function requireTarget(state, actor, decision) {
        const target = state.players.find(player => player.id === decision.targetId);
        if (!target || target.id === actor.id) throw new ReducerError('BAD_TARGET');
        return target;
    }

    function requireOwnCard(player, cardId) {
        const index = player.hand.findIndex(card => card.id === cardId);
        if (index < 0) throw new ReducerError('BAD_DECISION_CARD');
        return index;
    }

    function applyEffect(state, card, actor, action, events) {
        const decision = decisionObject(action);
        if (POWER_TYPES.has(card.type) && state.superpowersDisabled) {
            events.push({ type: 'effect.suppressed', seatId: actor.id, cardId: card.id });
            return { extraTurn: false };
        }
        switch (card.type) {
            case 'normal':
                break;
            case 'skip':
                state.skippedSeatIds.push(state.players[nextPlayerIndex(state)].id);
                break;
            case 'reverse':
                state.direction *= -1;
                if (state.players.length === 2) {
                    state.skippedSeatIds.push(state.players[nextPlayerIndex(state)].id);
                }
                break;
            case 'draw2':
                state.pendingDraws += 2;
                break;
            case 'sorry':
                drawMany(state, actor, 2, events);
                break;
            case 'counterAttack':
                state.pendingDraws = Math.max(0, state.pendingDraws) + 2;
                state.direction *= -1;
                break;
            case 'bestOne': {
                const target = state.players[nextPlayerIndex(state)];
                if (![0, 1].includes(decision.choice)) throw new ReducerError('BAD_DECISION');
                if (decision.choice === 0) storeDiscardedCards(state, target.hand.splice(0, 2));
                else drawMany(state, target, 2, events);
                break;
            }
            case 'dramaQueen': {
                const first = nextPlayerIndex(state);
                const second = nextPlayerIndex(state, first);
                state.skippedSeatIds.push(state.players[first].id, state.players[second].id);
                break;
            }
            case 'nokhtha':
                return { extraTurn: true };
            case 'plato':
                state.skippedSeatIds.push(actor.id);
                break;
            case 'chameleon': {
                const target = requireTarget(state, actor, decision);
                if (actor.hand.length) target.hand.push(actor.hand.splice(requireOwnCard(actor, decision.cardId), 1)[0]);
                break;
            }
            case 'boShlakh':
                if (actor.hand.length) storeDiscardedCards(state, actor.hand.splice(requireOwnCard(actor, decision.cardId), 1));
                break;
            case 'hamour': {
                const count = Math.min(4, state.discard.length - 1);
                if (count > 0) actor.hand.push(...state.discard.splice(state.discard.length - 1 - count, count));
                break;
            }
            case 'sugar':
                state.superpowersDisabled = true;
                state.sugarOwnerId = actor.id;
                break;
            case 'umWajhain': {
                const target = requireTarget(state, actor, decision);
                if (![0, 1].includes(decision.choice)) throw new ReducerError('BAD_DECISION');
                if (decision.choice === 0 && target.hand.length) {
                    const index = Math.floor(random(state) * target.hand.length);
                    storeDiscardedCards(state, target.hand.splice(index, 1));
                } else if (decision.choice === 1) {
                    drawMany(state, target, 1, events);
                }
                break;
            }
            case 'phantom':
                state.pendingDraws = 0;
                if (!state.immuneSeatIds.includes(actor.id)) state.immuneSeatIds.push(actor.id);
                break;
            case 'meh':
                state.pendingDraws += 1;
                state.activeColor = requireColor(state, decision);
                break;
            case 'draw4Wild':
                state.pendingDraws += 4;
                state.activeColor = requireColor(state, decision);
                break;
            case 'wild':
                state.activeColor = requireColor(state, decision);
                break;
            default:
                throw new ReducerError('UNKNOWN_EFFECT');
        }
        events.push({ type: 'effect.applied', seatId: actor.id, opcode: card.type });
        return { extraTurn: false };
    }

    function completeIfWon(state, events) {
        const winner = state.players.find(player => player.hand.length === 0);
        if (!winner) return false;
        state.phase = 'COMPLETE';
        state.winnerId = winner.id;
        events.push({ type: 'match.completed', winnerId: winner.id });
        return true;
    }

    function normalizeTurn(state, events) {
        for (let step = 0; step < MAX_NORMALIZE_STEPS; step++) {
            if (completeIfWon(state, events)) return;
            const player = state.players[state.currentPlayerIndex];
            if (state.superpowersDisabled && state.sugarOwnerId === player.id) {
                state.superpowersDisabled = false;
                state.sugarOwnerId = null;
                events.push({ type: 'powers.restored', seatId: player.id });
            }
            const skipIndex = state.skippedSeatIds.indexOf(player.id);
            if (skipIndex >= 0) {
                state.skippedSeatIds.splice(skipIndex, 1);
                events.push({ type: 'turn.skipped', seatId: player.id });
                state.currentPlayerIndex = nextPlayerIndex(state);
                continue;
            }
            if (state.pendingDraws > 0 && !player.hand.some(card => canRespondToPendingDraw(state, card))) {
                const count = state.pendingDraws;
                state.pendingDraws = 0;
                drawMany(state, player, count, events);
                events.push({ type: 'penalty.resolved', seatId: player.id, count });
                state.currentPlayerIndex = nextPlayerIndex(state);
                continue;
            }
            state.turnId++;
            events.push({ type: 'turn.started', seatId: player.id, turnId: state.turnId });
            return;
        }
        throw new ReducerError('NORMALIZATION_LOOP');
    }

    function applyAction(state, action, events) {
        const actor = state.players[state.currentPlayerIndex];
        if (action.actorId !== actor.id) throw new ReducerError('OUT_OF_TURN');
        if (action.turnId !== state.turnId) throw new ReducerError('STALE_TURN');
        if (action.type === 'draw') {
            const count = state.pendingDraws > 0 ? state.pendingDraws : 1;
            state.pendingDraws = 0;
            drawMany(state, actor, count, events);
            state.currentPlayerIndex = nextPlayerIndex(state);
            return;
        }
        if (action.type === 'timeout') {
            const index = actor.hand.findIndex(card => isPlayable(state, card));
            if (index < 0) {
                const count = state.pendingDraws > 0 ? state.pendingDraws : 1;
                state.pendingDraws = 0;
                drawMany(state, actor, count, events);
                state.currentPlayerIndex = nextPlayerIndex(state);
                return;
            }
            action = { ...action, type: 'play', cardId: actor.hand[index].id };
        }
        if (action.type !== 'play') throw new ReducerError('UNKNOWN_ACTION');
        const cardIndex = actor.hand.findIndex(card => card.id === action.cardId);
        if (cardIndex < 0) throw new ReducerError('CARD_NOT_OWNED');
        const card = actor.hand[cardIndex];
        if (!isPlayable(state, card)) throw new ReducerError('ILLEGAL_CARD');
        actor.hand.splice(cardIndex, 1);
        state.discard.push(card);
        if (card.color !== state.wildColor) state.activeColor = card.color;
        events.push({ type: 'card.committed', seatId: actor.id, cardId: card.id, definitionId: card.definitionId });
        const result = applyEffect(state, card, actor, action, events);
        if (!result.extraTurn) state.currentPlayerIndex = nextPlayerIndex(state);
    }

    function reduce(inputState, action) {
        if (!inputState || inputState.schemaVersion !== SCHEMA_VERSION) {
            return { ok: false, code: 'BAD_STATE', state: inputState, events: [] };
        }
        if (inputState.phase !== 'ACTIVE') {
            return { ok: false, code: 'MATCH_COMPLETE', state: inputState, events: [] };
        }
        if (!action || typeof action !== 'object' || Array.isArray(action)) {
            return { ok: false, code: 'BAD_ACTION', state: inputState, events: [] };
        }
        const state = clone(inputState);
        const events = [];
        try {
            applyAction(state, action, events);
            state.actionCount++;
            state.stateVersion++;
            normalizeTurn(state, events);
            state.skippedSeatIds = [...new Set(state.skippedSeatIds)];
            state.immuneSeatIds = [...new Set(state.immuneSeatIds)];
            return { ok: true, state: canonicalize(state), events: canonicalize(events) };
        } catch (error) {
            if (error instanceof ReducerError) {
                return { ok: false, code: error.code, state: inputState, events: [] };
            }
            throw error;
        }
    }

    function publicView(state, viewerId) {
        const viewer = state.players.find(player => player.id === viewerId);
        if (!viewer) throw new ReducerError('UNKNOWN_VIEWER');
        return canonicalize({
            schemaVersion: state.schemaVersion,
            matchId: state.matchId,
            rulesVersion: state.rulesVersion,
            catalogVersion: state.catalogVersion,
            deckRecipeId: state.deckRecipeId,
            phase: state.phase,
            stateVersion: state.stateVersion,
            turnId: state.turnId,
            currentPlayerId: state.players[state.currentPlayerIndex].id,
            direction: state.direction,
            activeColor: state.activeColor,
            pendingDraws: state.pendingDraws,
            topCard: topCard(state),
            secondCard: state.discard.length > 1 ? state.discard[state.discard.length - 2] : null,
            deckCount: state.deck.length,
            winnerId: state.winnerId,
            skippedSeatIds: [...state.skippedSeatIds],
            superpowersDisabled: state.superpowersDisabled,
            me: { id: viewer.id, hand: viewer.hand },
            others: state.players.filter(player => player.id !== viewer.id).map(player => ({
                id: player.id,
                handCount: player.hand.length,
                isBot: player.isBot,
            })),
            playableCardIds: state.players[state.currentPlayerIndex].id === viewerId
                ? viewer.hand.filter(card => isPlayable(state, card)).map(card => card.id)
                : [],
        });
    }

    function assertCardConservation(state, expected = 60) {
        const cards = [...state.deck, ...state.discard, ...state.players.flatMap(player => player.hand)];
        if (cards.length !== expected) throw new ReducerError('CARD_COUNT_MISMATCH');
        if (new Set(cards.map(card => card.id)).size !== expected) throw new ReducerError('CARD_ID_MISMATCH');
        return true;
    }

    return Object.freeze({
        schemaVersion: SCHEMA_VERSION,
        createMatch,
        reduce,
        publicView,
        fingerprint,
        isPlayable,
        assertCardConservation,
    });
})();

if (typeof window !== 'undefined') window.MatchReducer = MatchReducer;
if (typeof module !== 'undefined' && module.exports) module.exports = { MatchReducer };
