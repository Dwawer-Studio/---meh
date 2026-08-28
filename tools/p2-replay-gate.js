'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MEH_CORE_MANIFEST, MEH_CATALOG_MANIFEST } = require('../game/game-manifests');
const { MatchReducer: serverReducer } = require('../shared/match-reducer');
const { planBotAction } = require('../server/bot-policy');

const matchCount = Number(process.env.MEH_P2_REPLAY_COUNT || 10_000);
if (!Number.isSafeInteger(matchCount) || matchCount < 1) throw new Error('Invalid replay count');

const source = fs.readFileSync(path.join(__dirname, '..', 'shared', 'match-reducer.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'shared/match-reducer.js' });
const clientReducer = sandbox.window.MatchReducer;

function options(seed) {
    return {
        seed,
        matchId: `p2-replay-${seed}`,
        coreManifest: MEH_CORE_MANIFEST,
        catalogManifest: MEH_CATALOG_MANIFEST,
        players: [0, 1, 2, 3].map(index => ({ id: `player-${index}`, isBot: true })),
    };
}

const startedAt = process.hrtime.bigint();
let completed = 0;
let actions = 0;
let maxActions = 0;
const playedDefinitions = new Set();

for (let seed = 1; seed <= matchCount; seed++) {
    let serverState = serverReducer.createMatch(options(seed));
    let clientState = clientReducer.createMatch(options(seed));
    if (serverReducer.fingerprint(serverState) !== clientReducer.fingerprint(clientState)) {
        throw new Error(`Initial state mismatch at seed ${seed}`);
    }
    let actionCount = 0;
    while (serverState.phase === 'ACTIVE' && actionCount < 5_000) {
        const action = planBotAction(serverState, serverReducer);
        const serverResult = serverReducer.reduce(serverState, action);
        const clientResult = clientReducer.reduce(clientState, JSON.parse(JSON.stringify(action)));
        if (!serverResult.ok || !clientResult.ok) {
            throw new Error(`Reducer rejection at seed ${seed}, action ${actionCount}: ${serverResult.code}/${clientResult.code}`);
        }
        serverReducer.assertCardConservation(serverResult.state);
        clientReducer.assertCardConservation(clientResult.state);
        const serverFingerprint = serverReducer.fingerprint(serverResult.state);
        const clientFingerprint = clientReducer.fingerprint(clientResult.state);
        if (serverFingerprint !== clientFingerprint) {
            throw new Error(`State mismatch at seed ${seed}, action ${actionCount + 1}`);
        }
        for (const event of serverResult.events) {
            if (event.type === 'card.committed') playedDefinitions.add(event.definitionId);
        }
        serverState = serverResult.state;
        clientState = clientResult.state;
        actionCount++;
    }
    if (serverState.phase !== 'COMPLETE' || clientState.phase !== 'COMPLETE') {
        throw new Error(`Match did not complete at seed ${seed}`);
    }
    completed++;
    actions += actionCount;
    maxActions = Math.max(maxActions, actionCount);
    if (seed % 1_000 === 0) process.stdout.write(`replay ${seed}/${matchCount}\n`);
}

const missingDefinitions = MEH_CATALOG_MANIFEST.definitions
    .map(definition => definition.definitionId)
    .filter(definitionId => !playedDefinitions.has(definitionId));
if (missingDefinitions.length) throw new Error(`Replay missed card definitions: ${missingDefinitions.join(', ')}`);

const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
process.stdout.write(`${JSON.stringify({
    matches: matchCount,
    completed,
    mismatches: 0,
    actions,
    maxActions,
    cardDefinitionsCovered: playedDefinitions.size,
    elapsedMs: Math.round(elapsedMs),
})}\n`);
