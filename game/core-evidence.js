'use strict';

const CoreEvidence = Object.freeze({
    replayFormatVersion: 1,

    createSeededRandom(seed) {
        if (!Number.isSafeInteger(seed)) throw new TypeError('Replay seed must be a safe integer');
        let state = seed >>> 0;
        return () => {
            state = (state + 0x6D2B79F5) >>> 0;
            let value = state;
            value = Math.imul(value ^ (value >>> 15), value | 1);
            value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
            return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
    },

    canonicalize(value) {
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) throw new TypeError('Replay values must be finite');
            return value;
        }
        if (Array.isArray(value)) return value.map(item => this.canonicalize(item));
        if (!value || typeof value !== 'object') throw new TypeError('Unsupported replay value');
        const result = {};
        for (const key of Object.keys(value).sort()) {
            if (value[key] === undefined) continue;
            result[key] = this.canonicalize(value[key]);
        }
        return result;
    },

    fingerprint(value) {
        const source = JSON.stringify(this.canonicalize(value));
        let hash = 0x811c9dc5;
        for (let index = 0; index < source.length; index++) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }
        return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`;
    },

    snapshot(game) {
        if (!game || !game.deck || !Array.isArray(game.players)) {
            throw new TypeError('A live game state is required');
        }
        const card = value => value && ({
            id: value.id,
            definitionId: value.definitionId || value.type,
            color: value.color,
            type: value.type,
        });
        return this.canonicalize({
            rulesVersion: MEH_CORE_MANIFEST.rulesVersion,
            catalogVersion: MEH_CATALOG_MANIFEST.catalogVersion,
            deckRecipeId: game.deck.recipeId || MEH_CATALOG_MANIFEST.activeRecipeId,
            deck: game.deck.cards.map(card),
            discard: (game.discardPile || []).map(card),
            players: game.players.map(player => ({
                id: player.id,
                hand: (player.hand || []).map(card),
            })),
            currentPlayerIndex: game.currentPlayerIndex,
            direction: game.direction,
            activeColor: game.activeColor,
            pendingDraws: game.pendingDraws,
            skipped: Object.keys(game.skipNextMap || {}).sort(),
            immune: Object.keys(game.drawImmune || {}).sort(),
            superpowersDisabled: !!game.superpowersDisabled,
            sugarOwnerId: game._sugarOwnerId || null,
        });
    },

    createReplay(seed, mode = 'evidence') {
        return {
            replayFormatVersion: this.replayFormatVersion,
            rulesVersion: MEH_CORE_MANIFEST.rulesVersion,
            catalogVersion: MEH_CATALOG_MANIFEST.catalogVersion,
            deckRecipeId: MEH_CATALOG_MANIFEST.activeRecipeId,
            seed,
            mode,
            initialState: null,
            initialFingerprint: null,
            actions: [],
            finalState: null,
            finalFingerprint: null,
        };
    },

    setInitialState(replay, state) {
        if (!replay || replay.initialState) throw new Error('Replay initial state is already set');
        replay.initialState = this.canonicalize(state);
        replay.initialFingerprint = this.fingerprint(replay.initialState);
    },

    recordAction(replay, type, payload = {}) {
        if (!replay || replay.finalState) throw new Error('Cannot append to a completed replay');
        if (typeof type !== 'string' || !/^[a-z][a-z0-9_.-]{1,63}$/.test(type)) {
            throw new TypeError('Invalid replay action type');
        }
        replay.actions.push({
            sequence: replay.actions.length + 1,
            type,
            payload: this.canonicalize(payload),
        });
    },

    completeReplay(replay, state) {
        if (!replay || !replay.initialState || replay.finalState) {
            throw new Error('Replay cannot be completed in its current state');
        }
        replay.finalState = this.canonicalize(state);
        replay.finalFingerprint = this.fingerprint(replay.finalState);
        return this.canonicalize(replay);
    },

    validateReplay(replay) {
        if (!replay || replay.replayFormatVersion !== this.replayFormatVersion) return false;
        if (replay.rulesVersion !== MEH_CORE_MANIFEST.rulesVersion) return false;
        if (replay.catalogVersion !== MEH_CATALOG_MANIFEST.catalogVersion) return false;
        if (!MEH_CATALOG_MANIFEST.recipes.some(recipe => recipe.recipeId === replay.deckRecipeId)) return false;
        if (!Array.isArray(replay.actions) || !replay.initialState || !replay.finalState) return false;
        if (replay.initialFingerprint !== this.fingerprint(replay.initialState)) return false;
        if (replay.finalFingerprint !== this.fingerprint(replay.finalState)) return false;
        return replay.actions.every((action, index) => action.sequence === index + 1);
    },
});

if (typeof window !== 'undefined') window.CoreEvidence = CoreEvidence;
