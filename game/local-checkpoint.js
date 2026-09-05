'use strict';

// Local practice/solo persistence only. Never an authority for Tamashi or online results.
const LocalCheckpoint = Object.freeze({
    capture(game, resume, core, catalog) {
        const card = held => ({ id: held.id, definitionId: held.definitionId, color: held.color });
        const index = id => game.players.findIndex(player => player.id === id);
        return {
            schemaVersion: 1, rulesVersion: core.rulesVersion, catalogVersion: catalog.catalogVersion,
            recipeId: catalog.activeRecipeId, profileId: game.humanProfile.id || 'guest',
            runId: game._localRunId,
            deck: game.deck.cards.map(card), discard: game.discardPile.map(card),
            hands: game.players.map(player => player.hand.map(card)),
            current: game.currentPlayerIndex, direction: game.direction, activeColor: game.activeColor,
            pending: game.pendingDraws, skipped: Object.keys(game.skipNextMap).filter(id => game.skipNextMap[id]).map(index),
            pendingReason: game._pendingDrawReason || '',
            skipReasons: game.players.map(player => game._lastSkipReason && game._lastSkipReason[player.id] || ''),
            shields: Object.keys(game.drawImmune).filter(id => game.drawImmune[id]).map(index),
            powersDisabled: game.superpowersDisabled, sugarOwner: index(game._sugarOwnerId),
            resume, journal: (game._actionJournal || []).slice(-20).map(entry => ({ text: entry.text, reason: entry.reason, kind: entry.kind })),
            series: game._localSeries || { rounds: 0, wins: [0, 0, 0, 0] },
            highlights: (game._localHighlights || []).slice(-6),
        };
    },

    validate(raw, profileId, core, catalog) {
        const record = value => value && typeof value === 'object' && !Array.isArray(value);
        const int = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
        const text = (value, max) => typeof value === 'string' && value.length <= max;
        const seats = value => Array.isArray(value) && value.length <= 4 && new Set(value).size === value.length && value.every(index => int(index, 3));
        if (!record(raw) || raw.schemaVersion !== 1 || raw.profileId !== profileId
            || raw.rulesVersion !== core.rulesVersion || raw.catalogVersion !== catalog.catalogVersion
            || raw.recipeId !== catalog.activeRecipeId || !text(raw.runId, 80) || !raw.runId) return null;
        if (!Array.isArray(raw.deck) || !Array.isArray(raw.discard) || !raw.discard.length
            || !Array.isArray(raw.hands) || raw.hands.length !== 4 || !raw.hands.every(Array.isArray)) return null;
        const zones = [raw.deck, raw.discard, ...raw.hands];
        if (zones.some(zone => zone.length > 60) || zones.reduce((sum, zone) => sum + zone.length, 0) !== 60) return null;
        const recipe = catalog.recipes.find(item => item.recipeId === raw.recipeId);
        const expected = new Set(recipe.coloredDefinitionIds.flatMap(id => core.standardColors.map(color => `${color}/${id}`))
            .concat(recipe.blackDefinitionIds.map(id => `black/${id}`)));
        const ids = new Set();
        for (const held of zones.flat()) {
            if (!record(held) || typeof held.id !== 'string' || !/^[a-z0-9]{1,32}$/.test(held.id) || ids.has(held.id)
                || !expected.delete(`${held.color}/${held.definitionId}`)) return null;
            ids.add(held.id);
        }
        if (expected.size || !int(raw.current, 3) || ![1, -1].includes(raw.direction)
            || !core.standardColors.includes(raw.activeColor) || !int(raw.pending, 999)
            || !seats(raw.skipped) || !seats(raw.shields) || typeof raw.powersDisabled !== 'boolean'
            || !(raw.sugarOwner === -1 || int(raw.sugarOwner, 3)) || (raw.powersDisabled && raw.sugarOwner < 0)) return null;
        if (!text(raw.pendingReason, 400) || !Array.isArray(raw.skipReasons) || raw.skipReasons.length !== 4
            || !raw.skipReasons.every(reason => text(reason, 400))) return null;
        const resume = raw.resume;
        if (!record(resume) || !['turn', 'advance', 'play', 'draw'].includes(resume.kind)) return null;
        if (resume.kind === 'play') {
            if (!raw.hands[raw.current].some(held => held.id === resume.cardId)
                || !Array.isArray(resume.decisions) || resume.decisions.length > 2) return null;
            for (const decision of resume.decisions) {
                if (!record(decision) || !['color', 'target', 'card', 'choice'].includes(decision.kind)) return null;
                if (decision.kind === 'color' && !core.standardColors.includes(decision.value)) return null;
                if (decision.kind === 'target' && (!int(decision.value, 3) || decision.value === raw.current)) return null;
                if (decision.kind === 'choice' && ![0, 1].includes(decision.value)) return null;
                if (decision.kind === 'card' && !raw.hands[raw.current].some(held => held.id === decision.value && held.id !== resume.cardId)) return null;
            }
        }
        if (!Array.isArray(raw.journal) || raw.journal.length > 20 || !raw.journal.every(entry => record(entry)
            && text(entry.text, 400) && text(entry.reason, 400) && ['system', 'play', 'draw', 'effect', 'decision', 'skip', 'penalty'].includes(entry.kind))) return null;
        if (!record(raw.series) || !int(raw.series.rounds, 9999) || !Array.isArray(raw.series.wins)
            || raw.series.wins.length !== 4 || !raw.series.wins.every(value => int(value, 9999))) return null;
        if (!Array.isArray(raw.highlights) || raw.highlights.length > 6 || !raw.highlights.every(entry =>
            record(entry) && text(entry.text, 400) && int(entry.weight, 100))) return null;
        return JSON.parse(JSON.stringify(raw));
    },
});

if (typeof module !== 'undefined' && module.exports) module.exports = { LocalCheckpoint };
