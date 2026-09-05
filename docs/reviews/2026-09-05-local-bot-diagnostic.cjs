'use strict';

// Review-only diagnostic. Reuses the existing LOCAL four-bot headless harness.
// No production files, card rules, RNG distributions or browser state are edited.
// Presentation is stubbed by that harness: these are NOT human-session timings.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const file = path.join(root, 'tests/core-replay.test.js');
const localRequire = createRequire(file);
const source = fs.readFileSync(file, 'utf8');
const baseline = require('node:child_process').execFileSync('git', ['show', 'ed2928f:game/game-rules.js'], {
    cwd: root, encoding: 'utf8',
});

const instrumentation = `
const originalInitialize = initializeGame;
const baselineMethods = require('node:vm').runInNewContext(baselineSource + '\\nMehGameRuleMethods;', {
    Math: deterministicMath, ONLINE_COLORS: ['orange', 'gray', 'purple'],
    setTimeout: callback => activeScheduler.setTimeout(callback),
    I18n: { t: key => key, cardName: card => card.name },
});
let metrics;
initializeGame = function(game) {
    originalInitialize(game);
    game.playBotTurn = baselineMethods.playBotTurn;
    game._autoEffectDecision = baselineMethods._autoEffectDecision;
    const originalTurn = game.playTurn;
    game.playTurn = function() {
        if (!this.players.some(player => player.hand.length === 0)) {
            metrics.turns++;
            if (this.skipNextMap[this.currentPlayer.id]) metrics.skips++;
            else if (this.pendingDraws > 0
                && !this.currentPlayer.hand.some(card => this.canRespondToPendingDraw(card))) {
                metrics.forcedPenaltyTurns++;
                metrics.forcedPenaltyCards += this.pendingDraws;
                metrics.maxPenalty = Math.max(metrics.maxPenalty, this.pendingDraws);
            }
        }
        return originalTurn.call(this);
    };
    const originalBot = game.playBotTurn;
    game.playBotTurn = function() {
        const count = this.currentPlayer.hand.filter(card => this.isCardPlayableNow(card)).length;
        metrics.choices[count === 0 ? 'none' : count === 1 ? 'one' : 'multiple']++;
        return originalBot.call(this);
    };
};
const samples = [];
for (let seed = 1; seed <= 300; seed++) {
    metrics = { seed, turns: 0, skips: 0, forcedPenaltyTurns: 0,
        forcedPenaltyCards: 0, maxPenalty: 0, choices: { none: 0, one: 0, multiple: 0 } };
    runBotMatch(seed); // Includes completion + 60-card conservation assertions.
    samples.push(metrics);
}
const percentile = (key, p) => {
    const values = samples.map(sample => sample[key]).sort((a, b) => a - b);
    return values[Math.ceil(values.length * p) - 1];
};
const sum = key => samples.reduce((value, sample) => value + sample[key], 0);
const choices = samples.reduce((values, sample) => {
    for (const key of Object.keys(values)) values[key] += sample.choices[key];
    return values;
}, { none: 0, one: 0, multiple: 0 });
const totalTurns = sum('turns');
const noPlayableActionTurns = sum('skips') + sum('forcedPenaltyTurns') + choices.none;
if (sum('skips') + sum('forcedPenaltyTurns') + Object.values(choices).reduce((a, b) => a + b, 0)
    !== totalTurns) throw new Error('Turn classification does not reconcile');
console.log(JSON.stringify({
    scenario: 'Actual local bot rules; all four seats bots; presentation stubbed; not human play or elapsed-time measurement',
    seeds: '1..300', completedMatches: samples.length,
    turns: { total: totalTurns, median: percentile('turns', 0.5),
        p90: percentile('turns', 0.9), maximum: percentile('turns', 1) },
    skips: sum('skips'), forcedPenaltyTurns: sum('forcedPenaltyTurns'),
    forcedPenaltyCards: sum('forcedPenaltyCards'), maximumSinglePenalty: percentile('maxPenalty', 1),
    legalCardCountsAtBotDecision: choices,
    noPlayableActionTurns,
    noPlayableActionPercent: Number((100 * noPlayableActionTurns / totalTurns).toFixed(1)),
}, null, 2));
`;

// Do not register/run the harness's test suite: invoke only the diagnostic above.
vm.runInNewContext(source + '\n' + instrumentation, {
    require: id => id === 'node:test' ? () => {} : localRequire(id),
    baselineSource: baseline, console, Math, Map, Set, Array,
}, { filename: file, timeout: 60000 });
