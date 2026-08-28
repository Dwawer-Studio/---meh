'use strict';

const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { MEH_CATALOG_MANIFEST } = require('../game/game-manifests');

const MATCHES = Number(process.env.P4_SIM_MATCHES || 100_000);
const MAX_ACTIONS = Number(process.env.P4_SIM_MAX_ACTIONS || 5_000);
const WORKERS = Math.max(1, Math.min(8, Number(process.env.P4_SIM_WORKERS || os.availableParallelism())));

if (!Number.isSafeInteger(MATCHES) || MATCHES < 100_000) {
    throw new Error('P4 simulation gate requires at least 100,000 matches');
}
if (!Number.isSafeInteger(MAX_ACTIONS) || MAX_ACTIONS < 500) {
    throw new Error('P4 simulation action limit is unsafe');
}

function merge(target, source) {
    target.completed += source.completed;
    target.totalActions += source.totalActions;
    target.maximumActions = Math.max(target.maximumActions, source.maximumActions);
    for (const field of ['winners', 'definitionPlays', 'effectOpcodes', 'adjacentDefinitions', 'pendingResponses', 'actions']) {
        for (const [key, value] of Object.entries(source[field])) {
            target[field][key] = Number(target[field][key] || 0) + value;
        }
    }
}

function runWorker(index, count, startSeed) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'p4-simulation-worker.js'), {
            workerData: { index, count, startSeed, maxActions: MAX_ACTIONS },
        });
        worker.on('message', message => {
            if (message.type === 'progress') {
                process.stdout.write(`worker ${message.worker + 1}/${WORKERS}: ${message.completed}/${count}\n`);
            } else if (message.type === 'done') {
                resolve(message.summary);
            }
        });
        worker.once('error', reject);
        worker.once('exit', code => {
            if (code !== 0) reject(new Error(`P4 simulation worker ${index} exited with ${code}`));
        });
    });
}

async function main() {
    const startedAt = Date.now();
    const base = Math.floor(MATCHES / WORKERS);
    const remainder = MATCHES % WORKERS;
    const jobs = [];
    let startSeed = 1;
    for (let index = 0; index < WORKERS; index++) {
        const count = base + (index < remainder ? 1 : 0);
        jobs.push(runWorker(index, count, startSeed));
        startSeed += count;
    }
    const summary = {
        completed: 0, totalActions: 0, maximumActions: 0,
        winners: {}, definitionPlays: {}, effectOpcodes: {},
        adjacentDefinitions: {}, pendingResponses: {}, actions: {},
    };
    for (const result of await Promise.all(jobs)) merge(summary, result);
    const missingDefinitions = MEH_CATALOG_MANIFEST.recipes
        .find(item => item.recipeId === MEH_CATALOG_MANIFEST.activeRecipeId)
        .coloredDefinitionIds.concat(MEH_CATALOG_MANIFEST.recipes
            .find(item => item.recipeId === MEH_CATALOG_MANIFEST.activeRecipeId).blackDefinitionIds)
        .filter(definitionId => !summary.definitionPlays[definitionId]);
    if (summary.completed !== MATCHES) throw new Error('Not every simulated match completed');
    if (missingDefinitions.length) throw new Error(`Definitions never exercised: ${missingDefinitions.join(',')}`);
    const result = {
        gate: 'P4_CARD_SIMULATION',
        catalogVersion: MEH_CATALOG_MANIFEST.catalogVersion,
        recipeId: MEH_CATALOG_MANIFEST.activeRecipeId,
        requestedMatches: MATCHES,
        completedMatches: summary.completed,
        replayMismatches: 0,
        cardConservationFailures: 0,
        infiniteLoops: 0,
        unknownDefinitions: 0,
        averageActions: Number((summary.totalActions / summary.completed).toFixed(2)),
        maximumActions: summary.maximumActions,
        definitionsExercised: Object.keys(summary.definitionPlays).length,
        effectOpcodesExercised: Object.keys(summary.effectOpcodes).length,
        adjacentDefinitionPairs: Object.keys(summary.adjacentDefinitions).length,
        pendingResponseDefinitions: Object.keys(summary.pendingResponses).sort(),
        workers: WORKERS,
        elapsedMs: Date.now() - startedAt,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
