'use strict';

const {
    P4_ECONOMY_POLICY, expectedReward, priceBand, validatePolicy,
} = require('../server/tamashi-service');

const PLAYERS = 100_000;

function deterministicUnit(index, salt) {
    let value = (index + 1) * 0x9E3779B1 ^ salt;
    value = Math.imul(value ^ (value >>> 16), 0x21F0AAAD);
    value = Math.imul(value ^ (value >>> 15), 0x735A2D97);
    return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
}

function earnedForMatch(player, match, winRate, participationRate) {
    const healthy = deterministicUnit(player * 97 + match, 0xA11CE) < participationRate;
    const won = deterministicUnit(player * 131 + match, 0xB0A7) < winRate;
    return P4_ECONOMY_POLICY.completionReward
        + (healthy ? P4_ECONOMY_POLICY.healthyParticipationReward : 0)
        + (won ? P4_ECONOMY_POLICY.winBonus : 0);
}

function scenario(targetMatches, winRate, participationRate) {
    let earned = 0;
    let canAfford = 0;
    const band = priceBand(targetMatches);
    for (let player = 0; player < PLAYERS; player++) {
        let wallet = 0;
        for (let match = 0; match < targetMatches; match++) {
            wallet += earnedForMatch(player, match, winRate, participationRate);
        }
        earned += wallet;
        if (wallet >= band.center) canAfford++;
    }
    return {
        targetMatches,
        winRate,
        participationRate,
        price: band.center,
        meanEarned: Number((earned / PLAYERS).toFixed(2)),
        affordabilityPercent: Number((canAfford / PLAYERS * 100).toFixed(2)),
    };
}

validatePolicy();
const policyExpected = expectedReward();
const winnerReward = P4_ECONOMY_POLICY.completionReward
    + P4_ECONOMY_POLICY.healthyParticipationReward + P4_ECONOMY_POLICY.winBonus;
const healthyLossReward = P4_ECONOMY_POLICY.completionReward
    + P4_ECONOMY_POLICY.healthyParticipationReward;
const winnerPremiumPercent = (winnerReward - healthyLossReward) / healthyLossReward * 100;
if (winnerPremiumPercent > P4_ECONOMY_POLICY.maximumWinPremiumPercent) {
    throw new Error('Win premium exceeds the locked policy');
}
const scenarios = [
    scenario(8, 0.25, 1),
    scenario(12, 0.25, 1),
    scenario(16, 0.25, 1),
    scenario(12, 0, 1),
    scenario(12, 1, 1),
    scenario(12, 0.25, 0),
];
const baseline = scenarios.filter(item => item.winRate === 0.25 && item.participationRate === 1);
for (const item of baseline) {
    const drift = Math.abs(item.meanEarned - item.price) / item.price * 100;
    if (drift > 10) throw new Error(`Baseline source/sink drift exceeded 10%: ${drift}`);
    if (item.affordabilityPercent !== 100) {
        throw new Error('A healthy baseline player cannot afford the card at the stated target');
    }
}
if (scenarios.some(item => item.targetMatches < P4_ECONOMY_POLICY.minimumTargetMatches
    || item.targetMatches > P4_ECONOMY_POLICY.maximumTargetMatches)) {
    throw new Error('A simulated price falls outside the locked target-session range');
}
process.stdout.write(`${JSON.stringify({
    gate: 'P4_TAMASHI_ECONOMY',
    simulatedPlayers: PLAYERS,
    policyExpectedReward: policyExpected,
    winnerPremiumPercent: Number(winnerPremiumPercent.toFixed(2)),
    randomizedPacks: false,
    paidExclusiveCards: false,
    productionPricingStatus: P4_ECONOMY_POLICY.calibrationStatus,
    scenarios,
}, null, 2)}\n`);
