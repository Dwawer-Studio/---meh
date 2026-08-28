'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { CatalogRegistry } = require('../catalog/catalog-registry');
const { AccountService } = require('../server/account-service');
const { MemoryStore } = require('../server/stores/memory-store');
const {
    P4_ECONOMY_POLICY, TamashiService, expectedReward, priceBand, validatePolicy,
} = require('../server/tamashi-service');
const { expansionCatalog } = require('./helpers/p4-fixture');

const PEPPER = 'p4-tamashi-test-pepper-at-least-32-characters';

async function fixture() {
    let now = Date.parse('2026-08-28T12:00:00.000Z');
    const store = new MemoryStore();
    const accounts = new AccountService(store, { pepper: PEPPER, now: () => now });
    const first = await accounts.createGuest('P4 First');
    const second = await accounts.createGuest('P4 Second');
    const registry = new CatalogRegistry({
        catalogManifest: expansionCatalog(),
        expansionEnabled: true,
        enabledContentFlags: ['card_test_strategist'],
    });
    const verifier = {
        async verify(input) {
            return {
                provider: input.provider,
                providerTransactionId: 'provider.transaction.0001',
                productSku: input.productSku,
                tamashiAmount: P4_ECONOMY_POLICY.products[input.productSku],
            };
        },
    };
    const tamashi = new TamashiService(store, {
        catalogRegistry: registry, now: () => now, hashSecret: PEPPER,
        receiptVerifier: verifier, purchaseEnabled: true,
    });
    return { store, accounts, first, second, tamashi, now: () => now, advance: ms => { now += ms; } };
}

async function completedRoom(f, suffix, options = {}) {
    const nowIso = new Date(f.now()).toISOString();
    const roomId = `room_p4_reward_${suffix}`;
    const matchId = `match_p4_reward_${suffix}`;
    const seats = [f.first.account, f.second.account].map((account, index) => ({
        seatId: `seat_p4_${suffix}_${index}`, seatIndex: index, accountId: account.accountId,
        displayName: account.displayName, isBot: false,
        status: options.afkIndex === index ? 'LEASED' : 'CONNECTED', ready: false,
        leaseTokenHash: null, leaseExpiresAt: null,
        connectionSessionId: options.afkIndex === index ? null : `conn_p4_${suffix}_${index}`,
        lastClientSeq: 1,
    }));
    for (let index = 2; index < 4; index++) seats.push({
        seatId: `seat_p4_${suffix}_${index}`, seatIndex: index, accountId: null,
        displayName: `Bot ${index}`, isBot: true, status: 'BOT', ready: true,
        leaseTokenHash: null, leaseExpiresAt: null, connectionSessionId: null, lastClientSeq: 0,
    });
    await f.store.createRoom({
        roomId, roomCode: `R${suffix.padStart(4, '0').slice(-4)}`.toUpperCase(), mode: 'private', phase: 'RESULTS',
        rulesVersion: '1.0.0', catalogVersion: '1.1.0', deckRecipeId: 'classic-60-v1',
        baseRecipeId: 'classic-60-v1', recipeContributions: [], recipeSnapshot: null,
        recipeLockedAt: nowIso, matchParticipants: seats.map(seat => ({
            seatId: seat.seatId, accountId: seat.accountId, isBot: seat.isBot,
        })),
        matchId, matchState: { phase: 'COMPLETE', winnerId: seats[0].seatId },
        stateVersion: 20, serverSeq: 20, createdAt: nowIso, lastActivityAt: nowIso,
    }, seats);
    f.store.actions.push(
        { roomId, matchId, accountId: f.first.account.accountId, action: {}, createdAt: nowIso },
        { roomId, matchId, accountId: f.second.account.accountId, action: {}, createdAt: nowIso },
    );
    if (Number.isInteger(options.timedOutIndex)) {
        f.store.actions.push({
            roomId, matchId, accountId: null, createdAt: nowIso,
            action: { actorId: seats[options.timedOutIndex].seatId, automatic: true, type: 'draw' },
        });
    }
    return { roomId, matchId };
}

test('P4 policy bounds the win premium and derives prices from target completed matches', () => {
    assert.equal(validatePolicy(), true);
    assert.equal(expectedReward(), 125);
    assert.deepEqual(priceBand(10), { center: 1_200, minimum: 1_080, maximum: 1_320 });
    assert.ok(P4_ECONOMY_POLICY.winBonus / P4_ECONOMY_POLICY.completionReward <= 0.2);
    assert.equal(P4_ECONOMY_POLICY.calibrationStatus,
        'telemetry-required-before-production-card-pricing');
});

test('P4 gameplay rewards are server-derived, participation-aware, idempotent, and AFK-safe', async () => {
    const f = await fixture();
    const match = await completedRoom(f, '0001');
    const first = await f.tamashi.rewardCompletedMatch(match.roomId);
    assert.equal(first.status, 'granted');
    assert.deepEqual(first.grants.map(item => item.amount).sort((a, b) => a - b), [120, 140]);
    const duplicate = await f.tamashi.rewardCompletedMatch(match.roomId);
    assert.equal(duplicate.duplicate, true);
    assert.equal((await f.tamashi.catalogState(f.first.account.accountId)).currency.balance, 140);

    const afk = await completedRoom(f, '0002', { afkIndex: 1 });
    const afkResult = await f.tamashi.rewardCompletedMatch(afk.roomId);
    assert.equal(afkResult.grants.length, 1);
    assert.equal(afkResult.grants[0].accountId, f.first.account.accountId);

    const timedOut = await completedRoom(f, '0003', { timedOutIndex: 1 });
    const timedOutResult = await f.tamashi.rewardCompletedMatch(timedOut.roomId);
    assert.equal(timedOutResult.grants.length, 1);
    assert.equal(timedOutResult.grants[0].accountId, f.first.account.accountId);
});

test('P4 exact-cohort abuse cap suppresses artificial repetition without a daily streak', async () => {
    const f = await fixture();
    for (let index = 0; index < P4_ECONOMY_POLICY.cohortRewardedMatches; index++) {
        const match = await completedRoom(f, String(index + 10).padStart(4, '0'));
        assert.equal((await f.tamashi.rewardCompletedMatch(match.roomId)).status, 'granted');
    }
    const capped = await completedRoom(f, '0099');
    assert.equal((await f.tamashi.rewardCompletedMatch(capped.roomId)).status, 'suppressed_group_cap');
});

test('P4 direct unlock spends Tamashi once and never creates duplicates or paid exclusivity', async () => {
    const f = await fixture();
    await assert.rejects(
        () => f.tamashi.applyCatchUp(f.first.account.accountId, {
            campaignId: 'campaign_p4_bad_date', amount: 1_200,
            eligibleCreatedAfter: 'not-a-date', expiresAt: 'also-not-a-date',
        }),
        error => error.code === 'INVALID_CATCH_UP_CAMPAIGN',
    );
    await assert.rejects(
        () => f.tamashi.applyCatchUp(f.first.account.accountId, {
            campaignId: 'campaign_p4_too_large',
            amount: P4_ECONOMY_POLICY.maximumCatchUpAmount + 1,
            eligibleCreatedAfter: '2026-01-01T00:00:00.000Z',
            expiresAt: '2027-01-01T00:00:00.000Z',
        }),
        error => error.code === 'INVALID_CATCH_UP_CAMPAIGN',
    );
    const campaign = {
        campaignId: 'campaign_p4_00000001', amount: 1_200,
        eligibleCreatedAfter: '2026-01-01T00:00:00.000Z',
        expiresAt: '2027-01-01T00:00:00.000Z',
    };
    assert.equal((await f.tamashi.applyCatchUp(f.first.account.accountId, campaign)).duplicate, false);
    assert.equal((await f.tamashi.applyCatchUp(f.first.account.accountId, campaign)).duplicate, true);
    const unlocked = await f.tamashi.unlockCard(
        f.first.account.accountId, 'test-strategist', 'unlock_request_00000001',
    );
    assert.equal(unlocked.wallet.balance, 0);
    const duplicate = await f.tamashi.unlockCard(
        f.first.account.accountId, 'test-strategist', 'unlock_request_00000002',
    );
    assert.equal(duplicate.duplicate, true);
    const state = await f.tamashi.catalogState(f.first.account.accountId);
    assert.equal(state.cards.find(card => card.definitionId === 'test-strategist').unlocked, true);
    assert.equal(state.policy.randomizedPacks, false);
    assert.equal(state.policy.paidExclusiveGameplayCards, false);
    assert.deepEqual(state.policy.earning, {
        completionReward: 100,
        healthyParticipationReward: 20,
        winBonus: 20,
        minimumHumanSeats: 2,
    });
});

test('P4 content kill switch prevents unlock without consuming Tamashi', async () => {
    const f = await fixture();
    await f.tamashi.applyCatchUp(f.first.account.accountId, {
        campaignId: 'campaign_p4_kill_switch', amount: 1_200,
        eligibleCreatedAfter: '2026-01-01T00:00:00.000Z',
        expiresAt: '2027-01-01T00:00:00.000Z',
    });
    f.tamashi.catalogRegistry.disableContentFlag('card_test_strategist');
    const state = await f.tamashi.catalogState(f.first.account.accountId);
    const card = state.cards.find(item => item.definitionId === 'test-strategist');
    assert.equal(card.contentEnabled, false);
    assert.equal(card.purchasable, false);
    await assert.rejects(
        () => f.tamashi.unlockCard(
            f.first.account.accountId, 'test-strategist', 'unlock_request_kill_switch',
        ),
        error => error.code === 'CARD_NOT_PURCHASABLE',
    );
    assert.equal((await f.tamashi.catalogState(f.first.account.accountId)).currency.balance, 1_200);
});

test('P4 reconciliation freezes every mutation after a ledger mismatch', async () => {
    const f = await fixture();
    await f.tamashi.applyCatchUp(f.first.account.accountId, {
        campaignId: 'campaign_p4_reconcile', amount: 1_200,
        eligibleCreatedAfter: '2026-01-01T00:00:00.000Z',
        expiresAt: '2027-01-01T00:00:00.000Z',
    });
    await f.tamashi.unlockCard(
        f.first.account.accountId, 'test-strategist', 'unlock_request_reconcile',
    );
    assert.equal((await f.tamashi.reconcileEconomy()).ok, true);
    f.store.tamashiWallets.get(f.first.account.accountId).balance++;
    const report = await f.tamashi.reconcileEconomy();
    assert.equal(report.ok, false);
    assert.equal(report.economyFrozen, true);
    assert.ok(report.issues.some(item => item.code === 'WALLET_BALANCE_MISMATCH'));
    await assert.rejects(
        () => f.tamashi.applyCatchUp(f.first.account.accountId, {
            campaignId: 'campaign_p4_frozen', amount: 100,
            eligibleCreatedAfter: '2026-01-01T00:00:00.000Z',
            expiresAt: '2027-01-01T00:00:00.000Z',
        }),
        error => error.code === 'ECONOMY_FROZEN' && error.status === 503,
    );
    const secondState = await f.tamashi.catalogState(f.second.account.accountId);
    assert.equal(secondState.currency.balance, 0);
    assert.equal(f.store.tamashiWallets.has(f.second.account.accountId), false);
});

test('P4 account cap emits an auditable suppression status without a grant', async () => {
    const f = await fixture();
    const base = {
        roomId: 'room_account_cap',
        rewards: [{
            accountId: f.first.account.accountId, amount: 120,
            healthyParticipation: true, won: false, actionCount: 1,
        }],
        cohortWindowStartedBefore: '2026-08-27T12:00:00.000Z',
        cohortCap: 8,
        accountBucketDate: '2026-08-28',
        accountCap: 1,
        nowIso: '2026-08-28T12:00:00.000Z',
    };
    const granted = await f.store.settleGameplayRewards({
        ...base, matchId: 'match_account_cap_1', participantHash: 'cohort_account_cap_1',
    });
    assert.equal(granted.status, 'granted');
    const suppressed = await f.store.settleGameplayRewards({
        ...base, matchId: 'match_account_cap_2', participantHash: 'cohort_account_cap_2',
    });
    assert.equal(suppressed.status, 'suppressed_account_cap');
    assert.deepEqual(suppressed.grants, []);
    assert.equal((await f.tamashi.reconcileEconomy()).ok, true);
});

test('P4 purchase credits only the verifier-owned SKU amount and is provider-idempotent', async () => {
    const f = await fixture();
    const input = {
        provider: 'apple', productSku: 'tamashi_500', purchaseToken: 'signed-provider-token-00000001',
        idempotencyKey: 'iap_request_000000001', amount: 999_999,
    };
    const credited = await f.tamashi.verifyPurchase(f.first.account.accountId, input);
    assert.equal(credited.wallet.balance, 500);
    const duplicate = await f.tamashi.verifyPurchase(f.first.account.accountId, {
        ...input, idempotencyKey: 'iap_request_000000002',
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.wallet.balance, 500);
    assert.equal(f.store.verifiedIapReceipts.size, 1);
    assert.equal(JSON.stringify([...f.store.verifiedIapReceipts.values()]).includes(input.purchaseToken), false);

    f.tamashi.receiptVerifier = { async verify() { throw new Error('provider secret detail'); } };
    await assert.rejects(
        () => f.tamashi.verifyPurchase(f.second.account.accountId, {
            ...input,
            purchaseToken: 'different-signed-provider-token-0002',
            idempotencyKey: 'iap_request_provider_failure',
        }),
        error => error.code === 'PURCHASE_VERIFICATION_UNAVAILABLE'
            && error.status === 503 && !error.message.includes('provider secret detail'),
    );
});
