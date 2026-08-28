'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { MEH_CORE_MANIFEST, MEH_CATALOG_MANIFEST } = require('../game/game-manifests');
const { planBotAction } = require('../server/bot-policy');
const { MatchReducer } = require('../shared/match-reducer');

function increment(object, key) {
    object[key] = Number(object[key] || 0) + 1;
}

function simulateOne(seed, summary) {
    const options = {
        seed,
        matchId: `p4-sim-${seed}`,
        coreManifest: MEH_CORE_MANIFEST,
        catalogManifest: MEH_CATALOG_MANIFEST,
        deckRecipeId: MEH_CATALOG_MANIFEST.activeRecipeId,
        players: [0, 1, 2, 3].map(index => ({ id: `seat-${index}`, isBot: true })),
    };
    let state = MatchReducer.createMatch(options);
    let replay = MatchReducer.createMatch(options);
    if (JSON.stringify(state) !== JSON.stringify(replay)) {
        throw new Error(`Initial replay mismatch at seed ${seed}`);
    }
    let previousDefinitionId = 'opening';
    for (let step = 0; step < workerData.maxActions; step++) {
        if (state.phase === 'COMPLETE') {
            MatchReducer.assertCardConservation(state);
            MatchReducer.assertCardConservation(replay);
            summary.completed++;
            summary.totalActions += state.actionCount;
            summary.maximumActions = Math.max(summary.maximumActions, state.actionCount);
            increment(summary.winners, state.winnerId);
            return;
        }
        const pendingBefore = state.pendingDraws;
        const action = planBotAction(state, MatchReducer, { force: true });
        if (!action) throw new Error(`No action at seed ${seed}, step ${step}`);
        const actor = state.players[state.currentPlayerIndex];
        const played = action.type === 'play'
            ? actor.hand.find(card => card.id === action.cardId)
            : null;
        const left = MatchReducer.reduce(state, action);
        const right = MatchReducer.reduce(replay, action);
        if (!left.ok || !right.ok) {
            throw new Error(`Reducer rejection at seed ${seed}: ${left.code}/${right.code}`);
        }
        state = left.state;
        replay = right.state;
        MatchReducer.assertCardConservation(state);
        // MatchReducer returns canonical key order. Direct serialization keeps
        // the exact per-action replay comparison without canonicalizing both
        // trees a second time inside fingerprint().
        if (JSON.stringify(state) !== JSON.stringify(replay)) {
            throw new Error(`Replay mismatch at seed ${seed}, action ${state.actionCount}`);
        }
        if (played) {
            increment(summary.definitionPlays, played.definitionId);
            increment(summary.effectOpcodes, played.type);
            increment(summary.adjacentDefinitions, `${previousDefinitionId}>${played.definitionId}`);
            previousDefinitionId = played.definitionId;
            if (pendingBefore > 0) increment(summary.pendingResponses, played.definitionId);
        } else {
            increment(summary.actions, action.type);
        }
    }
    throw new Error(`Simulation loop limit at seed ${seed}`);
}

const summary = {
    requested: workerData.count,
    completed: 0,
    totalActions: 0,
    maximumActions: 0,
    winners: {},
    definitionPlays: {},
    effectOpcodes: {},
    adjacentDefinitions: {},
    pendingResponses: {},
    actions: {},
};

for (let offset = 0; offset < workerData.count; offset++) {
    simulateOne(workerData.startSeed + offset, summary);
    if ((offset + 1) % 5_000 === 0) {
        parentPort.postMessage({ type: 'progress', completed: offset + 1, worker: workerData.index });
    }
}
parentPort.postMessage({ type: 'done', summary });
