'use strict';

const crypto = require('node:crypto');
const { CatalogError } = require('../catalog/catalog-registry');
const { reconcileEconomySnapshot } = require('./economy-reconciliation');
const { randomId } = require('./security');

const P4_ECONOMY_POLICY = Object.freeze({
    schemaVersion: 1,
    modelVersion: 'p4-provisional-v1',
    currencyId: 'tamashi',
    completionReward: 100,
    healthyParticipationReward: 20,
    winBonus: 20,
    maximumWinPremiumPercent: 20,
    minimumHumanSeats: 2,
    cohortWindowMs: 24 * 60 * 60 * 1000,
    cohortRewardedMatches: 8,
    accountRewardedMatchesPerUtcDay: 20,
    assumedWinRateForPricing: 0.25,
    minimumTargetMatches: 4,
    maximumTargetMatches: 40,
    maximumCatchUpAmount: 100_000,
    allowedPriceVariancePercent: 10,
    calibrationStatus: 'telemetry-required-before-production-card-pricing',
    products: Object.freeze({
        tamashi_500: 500,
        tamashi_1200: 1_200,
        tamashi_2600: 2_600,
    }),
});

class TamashiError extends Error {
    constructor(code, status = 400) {
        super(code);
        this.name = 'TamashiError';
        this.code = code;
        this.status = status;
    }
}

function validatePolicy(policy = P4_ECONOMY_POLICY) {
    const completion = policy.completionReward;
    const participation = policy.healthyParticipationReward;
    const win = policy.winBonus;
    if (![completion, participation, win].every(Number.isSafeInteger)
        || completion <= 0 || participation < 0 || win < 0 || completion <= participation
        || (win / completion) * 100 > policy.maximumWinPremiumPercent
        || policy.minimumHumanSeats < 2 || policy.cohortRewardedMatches < 1
        || policy.accountRewardedMatchesPerUtcDay < policy.cohortRewardedMatches
        || !Number.isSafeInteger(policy.maximumCatchUpAmount) || policy.maximumCatchUpAmount <= 0) {
        throw new TamashiError('UNSAFE_ECONOMY_POLICY');
    }
    return true;
}

function expectedReward(policy = P4_ECONOMY_POLICY) {
    return policy.completionReward + policy.healthyParticipationReward
        + policy.winBonus * policy.assumedWinRateForPricing;
}

function priceBand(targetMatches, policy = P4_ECONOMY_POLICY) {
    if (!Number.isSafeInteger(targetMatches)
        || targetMatches < policy.minimumTargetMatches || targetMatches > policy.maximumTargetMatches) {
        throw new TamashiError('INVALID_TARGET_MATCHES');
    }
    // A healthy player reaches the stated target without needing wins. The
    // bounded win bonus may accelerate access, but never becomes a grind gate.
    const center = targetMatches * (policy.completionReward + policy.healthyParticipationReward);
    const variance = policy.allowedPriceVariancePercent / 100;
    return Object.freeze({
        center,
        minimum: Math.floor(center * (1 - variance)),
        maximum: Math.ceil(center * (1 + variance)),
    });
}

function utcDate(nowMs) {
    return new Date(nowMs).toISOString().slice(0, 10);
}

function safeIdempotencyKey(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

class TamashiService {
    constructor(store, options = {}) {
        this.store = store;
        this.catalogRegistry = options.catalogRegistry;
        if (!this.catalogRegistry) throw new TypeError('catalogRegistry is required');
        this.policy = Object.freeze({ ...P4_ECONOMY_POLICY, ...(options.policy || {}) });
        validatePolicy(this.policy);
        this.now = options.now || Date.now;
        this.metrics = options.metrics || null;
        this.receiptVerifier = options.receiptVerifier || null;
        this.receiptVerificationTimeoutMs = options.receiptVerificationTimeoutMs || 10_000;
        if (!Number.isSafeInteger(this.receiptVerificationTimeoutMs)
            || this.receiptVerificationTimeoutMs < 100 || this.receiptVerificationTimeoutMs > 30_000) {
            throw new TamashiError('UNSAFE_RECEIPT_VERIFICATION_TIMEOUT');
        }
        this.purchaseEnabled = options.purchaseEnabled === true;
        this.hashSecret = options.hashSecret || 'tamashi-participant-hash';
        this.economyFrozen = false;
        this.lastReconciliation = null;
        this._validateExpansionPrices();
    }

    async catalogState(accountId) {
        const state = await this.store.getEconomyState(accountId);
        const unlocks = new Set(state.unlocks.map(item => item.definitionId));
        const manifest = this.catalogRegistry.current();
        return {
            rulesVersion: this.catalogRegistry.coreManifest.rulesVersion,
            catalogVersion: manifest.catalogVersion,
            activeRecipeId: manifest.activeRecipeId,
            currency: {
                currencyId: this.policy.currencyId,
                displayNameAr: manifest.economy.displayNameAr,
                balance: state.wallet.balance,
                revision: state.wallet.revision,
                frozen: this.economyFrozen,
            },
            policy: {
                directFixedPrice: true,
                randomizedPacks: false,
                duplicates: false,
                paidExclusiveGameplayCards: false,
                publicRecipeStandardized: true,
                friendlyOwnershipModel: 'shared-deck-contribution',
                calibrationStatus: this.policy.calibrationStatus,
                earning: {
                    completionReward: this.policy.completionReward,
                    healthyParticipationReward: this.policy.healthyParticipationReward,
                    winBonus: this.policy.winBonus,
                    minimumHumanSeats: this.policy.minimumHumanSeats,
                },
            },
            cards: manifest.definitions
                .filter(definition => definition.releaseStatus !== 'disabled')
                .map(definition => ({
                    definitionId: definition.definitionId,
                    nameAr: definition.nameAr,
                    effectOpcode: definition.effectOpcode,
                    emoji: definition.emoji,
                    assetBase: definition.assetBase,
                    replacementClass: definition.replacementClass,
                    powerBudget: definition.powerBudget,
                    tamashiPrice: definition.tamashiPrice,
                    includedByDefault: definition.availableByDefault === true,
                    unlocked: definition.availableByDefault === true || unlocks.has(definition.definitionId),
                    inFreeRotation: this.catalogRegistry.isInFreeRotation(definition.definitionId),
                    contentEnabled: this.catalogRegistry.isDefinitionEnabled(definition.definitionId),
                    purchasable: definition.availableByDefault !== true
                        && this.catalogRegistry.isDefinitionEnabled(definition.definitionId)
                        && ['friendly-5', 'live'].includes(definition.releaseStatus),
                    trialEligible: definition.trialEligible === true,
                    releaseStatus: definition.releaseStatus || 'classic',
                    design: definition.design || null,
                })),
            recentLedger: state.ledger.map(entry => ({
                ledgerId: entry.ledgerId,
                direction: entry.direction,
                amount: entry.amount,
                sourceType: entry.sourceType,
                definitionId: entry.definitionId || null,
                createdAt: entry.createdAt,
            })),
        };
    }

    async rewardCompletedMatch(roomId) {
        this._assertEconomyOpen();
        const context = await this.store.getMatchRewardContext(roomId);
        if (!context || !context.room || context.room.phase !== 'RESULTS'
            || !context.room.matchState || context.room.matchState.phase !== 'COMPLETE') return null;
        const participants = Array.isArray(context.room.matchParticipants)
            ? context.room.matchParticipants.filter(item => item && item.accountId && item.isBot !== true)
            : [];
        const distinctAccounts = [...new Set(participants.map(item => item.accountId))].sort();
        if (distinctAccounts.length < this.policy.minimumHumanSeats) {
            this._metric('tamashi.reward_suppressed', { reason: 'insufficient_humans' });
            return null;
        }
        const participantHash = crypto.createHmac('sha256', this.hashSecret)
            .update(distinctAccounts.join('\n')).digest('base64url');
        const currentSeats = new Map(context.seats.map(item => [item.seatId, item]));
        const actionCounts = new Map(Object.entries(context.actionCounts || {}));
        const timedOutSeatIds = new Set(context.timedOutSeatIds || []);
        const rewards = [];
        for (const participant of participants) {
            const seat = currentSeats.get(participant.seatId);
            if (!seat || seat.accountId !== participant.accountId || seat.isBot
                || seat.status !== 'CONNECTED' || timedOutSeatIds.has(participant.seatId)) continue;
            const actions = Number(actionCounts.get(participant.accountId) || 0);
            const won = context.room.matchState.winnerId === participant.seatId;
            const amount = this.policy.completionReward
                + (actions > 0 ? this.policy.healthyParticipationReward : 0)
                + (won ? this.policy.winBonus : 0);
            rewards.push({
                accountId: participant.accountId,
                amount,
                healthyParticipation: actions > 0,
                won,
                actionCount: actions,
            });
        }
        const nowMs = this.now();
        rewards.sort((left, right) => left.accountId.localeCompare(right.accountId));
        const result = await this.store.settleGameplayRewards({
            roomId: context.room.roomId,
            matchId: context.room.matchId,
            participantHash,
            rewards,
            cohortWindowStartedBefore: new Date(nowMs - this.policy.cohortWindowMs).toISOString(),
            cohortCap: this.policy.cohortRewardedMatches,
            accountBucketDate: utcDate(nowMs),
            accountCap: this.policy.accountRewardedMatchesPerUtcDay,
            nowIso: new Date(nowMs).toISOString(),
        });
        this._metric('tamashi.match_settled', { status: result.status });
        if (result.grants) this._metric('tamashi.gameplay_granted', {}, result.grants.length);
        return result;
    }

    async unlockCard(accountId, definitionId, idempotencyKey) {
        this._assertEconomyOpen();
        if (!safeIdempotencyKey(idempotencyKey)) throw new TamashiError('BAD_IDEMPOTENCY_KEY');
        const definition = this.catalogRegistry.current().definitions
            .find(item => item.definitionId === definitionId);
        if (!definition || definition.availableByDefault === true
            || !this.catalogRegistry.isDefinitionEnabled(definitionId)
            || !['friendly-5', 'live'].includes(definition.releaseStatus)) {
            throw new TamashiError('CARD_NOT_PURCHASABLE', 404);
        }
        const result = await this.store.purchaseCardUnlock({
            accountId,
            definitionId,
            price: definition.tamashiPrice,
            idempotencyKey,
            ledgerId: randomId('ledger'),
            nowIso: new Date(this.now()).toISOString(),
        });
        this._metric('tamashi.card_unlock', { duplicate: result.duplicate === true });
        return result;
    }

    async verifyPurchase(accountId, input) {
        this._assertEconomyOpen();
        if (!this.purchaseEnabled || !this.receiptVerifier) throw new TamashiError('PURCHASE_VERIFICATION_DISABLED', 404);
        if (!input || !safeIdempotencyKey(input.idempotencyKey)
            || !['apple', 'google'].includes(input.provider)
            || typeof input.productSku !== 'string' || !Object.hasOwn(this.policy.products, input.productSku)
            || typeof input.purchaseToken !== 'string'
            || input.purchaseToken.length < 16 || input.purchaseToken.length > 7_500) {
            throw new TamashiError('INVALID_PURCHASE_REQUEST');
        }
        const controller = new AbortController();
        let timeoutHandle;
        const timeoutError = new TamashiError('PURCHASE_VERIFICATION_UNAVAILABLE', 503);
        let verified;
        try {
            verified = await Promise.race([
                Promise.resolve().then(() => this.receiptVerifier.verify({
                    provider: input.provider,
                    productSku: input.productSku,
                    purchaseToken: input.purchaseToken,
                    signal: controller.signal,
                })),
                new Promise((_, reject) => {
                    timeoutHandle = setTimeout(() => {
                        controller.abort();
                        reject(timeoutError);
                    }, this.receiptVerificationTimeoutMs);
                }),
            ]);
        } catch (error) {
            this._metric('tamashi.iap_verifier_error', { provider: input.provider });
            if (error === timeoutError) throw error;
            throw new TamashiError('PURCHASE_VERIFICATION_UNAVAILABLE', 503);
        } finally {
            if (timeoutHandle) clearTimeout(timeoutHandle);
        }
        const expectedAmount = this.policy.products[input.productSku];
        if (!verified || verified.provider !== input.provider
            || verified.productSku !== input.productSku
            || verified.tamashiAmount !== expectedAmount
            || typeof verified.providerTransactionId !== 'string'
            || !/^[A-Za-z0-9._:-]{8,256}$/.test(verified.providerTransactionId)) {
            throw new TamashiError('PURCHASE_VERIFICATION_MISMATCH');
        }
        const receiptHash = crypto.createHmac('sha256', this.hashSecret)
            .update(`${input.provider}\n${input.purchaseToken}`).digest('base64url');
        const result = await this.store.creditVerifiedPurchase({
            accountId,
            provider: verified.provider,
            providerTransactionId: verified.providerTransactionId,
            productSku: verified.productSku,
            amount: verified.tamashiAmount,
            receiptHash,
            idempotencyKey: input.idempotencyKey,
            ledgerId: randomId('ledger'),
            nowIso: new Date(this.now()).toISOString(),
        });
        this._metric('tamashi.iap_verified', { provider: verified.provider, duplicate: result.duplicate === true });
        return result;
    }

    async applyCatchUp(accountId, campaign) {
        this._assertEconomyOpen();
        const eligibleCreatedAfter = campaign && Date.parse(campaign.eligibleCreatedAfter);
        const expiresAt = campaign && Date.parse(campaign.expiresAt);
        if (!campaign || !safeIdempotencyKey(campaign.campaignId)
            || !Number.isSafeInteger(campaign.amount) || campaign.amount <= 0
            || campaign.amount > this.policy.maximumCatchUpAmount
            || typeof campaign.eligibleCreatedAfter !== 'string'
            || typeof campaign.expiresAt !== 'string'
            || !Number.isFinite(eligibleCreatedAfter) || !Number.isFinite(expiresAt)
            || eligibleCreatedAfter > this.now() || expiresAt <= this.now()) {
            throw new TamashiError('INVALID_CATCH_UP_CAMPAIGN');
        }
        const account = await this.store.getAccount(accountId);
        if (!account || Date.parse(account.createdAt) < Date.parse(campaign.eligibleCreatedAfter)) {
            throw new TamashiError('CATCH_UP_NOT_ELIGIBLE', 403);
        }
        return this.store.creditCatchUp({
            accountId,
            amount: campaign.amount,
            idempotencyKey: `catchup_${campaign.campaignId}`,
            ledgerId: randomId('ledger'),
            nowIso: new Date(this.now()).toISOString(),
        });
    }

    async reconcileEconomy() {
        try {
            const snapshot = await this.store.getEconomyReconciliationSnapshot();
            const report = reconcileEconomySnapshot(snapshot, {
                checkedAt: new Date(this.now()).toISOString(),
            });
            if (!report.ok) {
                this.economyFrozen = true;
                this._metric('tamashi.reconciliation_failure', {}, report.issueCount);
            } else {
                this._metric('tamashi.reconciliation_success');
            }
            this.lastReconciliation = Object.freeze({ ...report, economyFrozen: this.economyFrozen });
        } catch (error) {
            this.economyFrozen = true;
            this._metric('tamashi.reconciliation_failure');
            this.lastReconciliation = Object.freeze({
                ok: false,
                checkedAt: new Date(this.now()).toISOString(),
                issueCount: 1,
                issues: Object.freeze([{ code: 'RECONCILIATION_UNAVAILABLE', reference: '' }]),
                truncated: false,
                freezeRequired: Object.freeze(['tamashi_wallet', 'verified_iap']),
                counts: null,
                economyFrozen: true,
            });
        }
        return this.lastReconciliation;
    }

    _assertEconomyOpen() {
        if (this.economyFrozen) throw new TamashiError('ECONOMY_FROZEN', 503);
    }

    _validateExpansionPrices() {
        for (const definition of this.catalogRegistry.current().definitions) {
            if (definition.availableByDefault === true) continue;
            const band = priceBand(definition.gameplayTargetMatches, this.policy);
            if (definition.tamashiPrice < band.minimum || definition.tamashiPrice > band.maximum) {
                throw new CatalogError('CARD_PRICE_OUTSIDE_CALIBRATED_BAND');
            }
        }
    }

    _metric(name, labels = {}, amount = 1) {
        if (this.metrics) this.metrics.increment(name, labels, amount);
    }
}

module.exports = {
    P4_ECONOMY_POLICY,
    TamashiError,
    TamashiService,
    expectedReward,
    priceBand,
    validatePolicy,
};
