'use strict';

// Actual LOCAL rule runtime, not an alternate simulator. Both policies use the
// identical current rule engine and seeded deals. Headless timings are not human timings.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const harness = path.join(root, 'tests/core-replay.test.js');
const localRequire = createRequire(harness);
const source = fs.readFileSync(harness, 'utf8');
const baseline = execFileSync('git', ['show', 'ed2928f:game/game-rules.js'], { cwd: root, encoding: 'utf8' });
const instrumentation = `
const baselineMethods = require('node:vm').runInNewContext(baselineSource + '\\nMehGameRuleMethods;', {
    Math: deterministicMath, ONLINE_COLORS: ['orange', 'gray', 'purple'],
    setTimeout: callback => activeScheduler.setTimeout(callback),
    I18n: { t: key => key, cardName: card => card.name },
});
const oldInitialize = initializeGame;
let mode, metrics;
initializeGame = function(game) {
    oldInitialize(game);
    const currentPlay = game.playBotTurn;
    const currentDecision = game._autoEffectDecision;
    const useNew = player => mode === 'new' || (typeof mode === 'number' && thisSeat(player) === mode);
    const thisSeat = player => game.players.indexOf(player);
    game.playBotTurn = function() {
        const count = this.currentPlayer.hand.filter(card => this.isCardPlayableNow(card)).length;
        metrics.choices[count === 0 ? 'none' : count === 1 ? 'one' : 'multiple']++;
        return (useNew(this.currentPlayer) ? currentPlay : baselineMethods.playBotTurn).call(this);
    };
    game._autoEffectDecision = function(player, kind, data) {
        return (useNew(player) ? currentDecision : baselineMethods._autoEffectDecision).call(this, player, kind, data);
    };
    const turn = game.playTurn;
    game.playTurn = function() {
        if (!this.players.some(player => player.hand.length === 0)) {
            metrics.turns++;
            if (this.skipNextMap[this.currentPlayer.id]) metrics.skips++;
            else if (this.pendingDraws > 0 && !this.currentPlayer.hand.some(card => this.canRespondToPendingDraw(card))) metrics.penalties++;
        }
        return turn.call(this);
    };
};
function sample(seed, selected) {
    mode = selected;
    metrics = { turns: 0, skips: 0, penalties: 0, choices: { none: 0, one: 0, multiple: 0 } };
    const replay = runBotMatch(seed);
    return { ...metrics, winner: replay.actions.find(event => event.type === 'match.completed').payload.winnerId,
        initial: replay.initialFingerprint };
}
function summarize(samples) {
    const turns = samples.map(item => item.turns).sort((a, b) => a - b);
    const sum = key => samples.reduce((total, item) => total + item[key], 0);
    const choices = samples.reduce((total, item) => {
        for (const key of Object.keys(total)) total[key] += item.choices[key];
        return total;
    }, { none: 0, one: 0, multiple: 0 });
    return { completed: samples.length, turns: { total: sum('turns'), median: turns[Math.ceil(turns.length * .5) - 1],
        p90: turns[Math.ceil(turns.length * .9) - 1], max: turns.at(-1) },
        skips: sum('skips'), penalties: sum('penalties'), choices,
        noCardActionPercent: Number((100 * (sum('skips') + sum('penalties') + choices.none) / sum('turns')).toFixed(1)) };
}
const before = [], after = [];
for (let seed = 1; seed <= 300; seed++) {
    const old = sample(seed, 'old'), current = sample(seed, 'new');
    assert.equal(current.initial, old.initial, 'same seeded initial deal');
    before.push(old); after.push(current);
}
let wins = 0;
const seatWins = [0, 0, 0, 0];
for (let seed = 1; seed <= 100; seed++) {
    for (let seat = 0; seat < 4; seat++) {
        const result = sample(seed, seat);
        if (result.winner === runtime.playersConfig[seat].id) { wins++; seatWins[seat]++; }
    }
}
console.log(JSON.stringify({ baselineCommit: 'ed2928f', evidence: 'Local engine; seeded deals; 60 unique cards asserted on every completion; no human-play claim',
    before: summarize(before), after: summarize(after),
    mixed: { matches: 400, newPolicySeatsPerMatch: 1, newPolicyWins: wins, newPolicyWinPercent: wins / 4,
        winsByRotatedSeat: seatWins, caveat: 'Against three old policies, not human skill or a balance certification.' } }, null, 2));
`;
vm.runInNewContext(source + '\n' + instrumentation, {
    require: id => id === 'node:test' ? () => {} : localRequire(id),
    baselineSource: baseline, console, Math, Map, Set, Array,
}, { filename: harness, timeout: 60000 });
