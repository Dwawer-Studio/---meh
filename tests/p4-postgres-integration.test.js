'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { CatalogRegistry } = require('../catalog/catalog-registry');
const { AccountService } = require('../server/account-service');
const { BackupService } = require('../server/backup-service');
const { reconcileEconomySnapshot } = require('../server/economy-reconciliation');
const { runMigrations } = require('../server/migration-runner');
const { PostgresStore } = require('../server/stores/postgres-store');
const { P4_ECONOMY_POLICY, TamashiService } = require('../server/tamashi-service');
const { expansionCatalog } = require('./helpers/p4-fixture');

class PGlitePool {
    constructor(database) { this.database = database; }
    query(text, values) { return this._query(this.database, text, values); }
    async connect() {
        return { query: (text, values) => this._query(this.database, text, values), release() {} };
    }
    _query(database, text, values) {
        const statements = text.split(';').filter(statement => statement.trim()).length;
        return values === undefined && statements > 1
            ? database.exec(text).then(results => results.at(-1) || { rows: [] })
            : database.query(text, values);
    }
}

test('P4 PostgreSQL serializes wallet and room parents before idempotency reads', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'stores', 'postgres-store.js'), 'utf8');
    const method = name => source.slice(source.indexOf(`async ${name}`),
        source.indexOf('\n    async ', source.indexOf(`async ${name}`) + 1));
    const unlock = method('purchaseCardUnlock');
    assert.ok(unlock.indexOf('SELECT * FROM tamashi_wallets WHERE account_id=$1 FOR UPDATE')
        < unlock.indexOf('SELECT * FROM card_unlocks WHERE account_id=$1 AND definition_id=$2'));
    const purchase = method('creditVerifiedPurchase');
    assert.ok(purchase.indexOf('SELECT * FROM tamashi_wallets WHERE account_id=$1 FOR UPDATE')
        < purchase.indexOf('SELECT * FROM verified_iap_receipts'));
    const catchUp = method('creditCatchUp');
    assert.ok(catchUp.indexOf('SELECT * FROM tamashi_wallets WHERE account_id=$1 FOR UPDATE')
        < catchUp.indexOf('SELECT 1 FROM tamashi_ledger_entries'));
    const settlement = method('settleGameplayRewards');
    assert.ok(settlement.indexOf('SELECT room_id FROM rooms WHERE room_id=$1 FOR UPDATE')
        < settlement.indexOf('SELECT * FROM match_reward_settlements'));
    const reconciliation = method('getEconomyReconciliationSnapshot');
    assert.match(reconciliation, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    assert.doesNotMatch(reconciliation, /this\.pool\.query/);
});

test('P4 PostgreSQL makes wallet, ledger, receipt, unlock, and backup operations atomic',
    { timeout: 30_000 }, async () => {
        const sourceDb = new PGlite();
        const targetDb = new PGlite();
        await Promise.all([sourceDb.waitReady, targetDb.waitReady]);
        try {
            const sourcePool = new PGlitePool(sourceDb);
            await runMigrations(sourcePool);
            const store = new PostgresStore(sourcePool);
            const now = Date.parse('2026-08-28T12:00:00.000Z');
            const accounts = new AccountService(store, {
                pepper: 'p4-postgres-pepper-at-least-32-characters', now: () => now,
            });
            const player = await accounts.createGuest('P4 PostgreSQL');
            const registry = new CatalogRegistry({
                catalogManifest: expansionCatalog(),
                expansionEnabled: true,
                enabledContentFlags: ['card_test_strategist'],
            });
            const tamashi = new TamashiService(store, {
                catalogRegistry: registry,
                now: () => now,
                hashSecret: 'p4-postgres-pepper-at-least-32-characters',
                purchaseEnabled: true,
                receiptVerifier: {
                    async verify(input) {
                        return {
                            ...input,
                            providerTransactionId: 'postgres.provider.transaction.0001',
                            tamashiAmount: P4_ECONOMY_POLICY.products[input.productSku],
                        };
                    },
                },
            });
            assert.equal((await store.getEconomyState(player.account.accountId)).wallet.balance, 0);
            assert.equal((await sourceDb.query(
                'SELECT count(*)::int AS count FROM tamashi_wallets')).rows[0].count, 0);
            const timeoutRoomId = 'room_p4_pg_timeout';
            const timeoutMatchId = 'match_p4_pg_timeout';
            const timeoutSeatId = 'seat_p4_pg_timeout';
            const nowIso = new Date(now).toISOString();
            await store.createRoom({
                roomId: timeoutRoomId, roomCode: 'PGT01', mode: 'private', phase: 'RESULTS',
                rulesVersion: '1.0.0', catalogVersion: '1.1.0', deckRecipeId: 'classic-60-v1',
                baseRecipeId: 'classic-60-v1', recipeContributions: [], recipeSnapshot: null,
                recipeLockedAt: nowIso, matchParticipants: [{
                    seatId: timeoutSeatId, accountId: player.account.accountId, isBot: false,
                }],
                matchId: timeoutMatchId,
                matchState: { phase: 'COMPLETE', winnerId: timeoutSeatId },
                stateVersion: 1, serverSeq: 1, createdAt: nowIso, lastActivityAt: nowIso,
            }, [{
                seatId: timeoutSeatId, seatIndex: 0, accountId: player.account.accountId,
                displayName: player.account.displayName, isBot: false, status: 'CONNECTED', ready: false,
                leaseTokenHash: null, leaseExpiresAt: null, connectionSessionId: 'conn_p4_pg_timeout',
                lastClientSeq: 1,
            }]);
            await sourceDb.query(
                `INSERT INTO match_actions (room_id, match_id, action_sequence, account_id,
                    request_id, action, result_fingerprint, created_at)
                 VALUES ($1,$2,1,NULL,$3,$4::jsonb,$5,$6)`,
                [timeoutRoomId, timeoutMatchId, 'timeout_p4_pg_request',
                    JSON.stringify({ actorId: timeoutSeatId, automatic: true, type: 'draw' }),
                    'timeout-fingerprint', nowIso],
            );
            assert.deepEqual(
                (await store.getMatchRewardContext(timeoutRoomId)).timedOutSeatIds,
                [timeoutSeatId],
            );
            await tamashi.applyCatchUp(player.account.accountId, {
                campaignId: 'campaign_pg_00000001', amount: 1_200,
                eligibleCreatedAfter: '2026-01-01T00:00:00.000Z',
                expiresAt: '2027-01-01T00:00:00.000Z',
            });
            const unlocked = [
                await tamashi.unlockCard(
                    player.account.accountId, 'test-strategist', 'unlock_pg_request_0001'),
                await tamashi.unlockCard(
                    player.account.accountId, 'test-strategist', 'unlock_pg_request_0002'),
            ];
            assert.equal(unlocked.filter(item => item.duplicate === false).length, 1);
            assert.equal((await sourceDb.query(
                'SELECT count(*)::int AS count FROM card_unlocks')).rows[0].count, 1);
            const purchaseInput = {
                provider: 'google', productSku: 'tamashi_500',
                purchaseToken: 'postgres-signed-token-00000001',
                idempotencyKey: 'iap_pg_request_000001',
            };
            assert.equal((await tamashi.verifyPurchase(player.account.accountId, purchaseInput))
                .wallet.balance, 500);
            assert.equal((await tamashi.verifyPurchase(player.account.accountId, {
                ...purchaseInput, idempotencyKey: 'iap_pg_request_000002',
            })).duplicate, true);
            assert.equal((await sourceDb.query(
                'SELECT count(*)::int AS count FROM verified_iap_receipts')).rows[0].count, 1);
            assert.equal(reconcileEconomySnapshot(
                await store.getEconomyReconciliationSnapshot(),
            ).ok, true);
            await assert.rejects(() => sourceDb.query(
                'UPDATE tamashi_wallets SET balance=-1 WHERE account_id=$1',
                [player.account.accountId],
            ));

            const encrypted = await new BackupService(store).createEncrypted(
                'p4-postgres-backup-passphrase-32-characters',
            );
            const targetPool = new PGlitePool(targetDb);
            await runMigrations(targetPool);
            const targetStore = new PostgresStore(targetPool);
            await new BackupService(targetStore).restoreEncrypted(
                encrypted, 'p4-postgres-backup-passphrase-32-characters',
            );
            const restored = await targetStore.getEconomyState(player.account.accountId);
            assert.equal(restored.wallet.balance, 500);
            assert.equal(restored.unlocks[0].definitionId, 'test-strategist');
            assert.deepEqual(restored.ledger.map(item => item.sourceType).sort(),
                ['card_unlock', 'catch_up_adjustment', 'verified_in_app_purchase'].sort());
            assert.equal(reconcileEconomySnapshot(
                await targetStore.getEconomyReconciliationSnapshot(),
            ).ok, true);

            await accounts.deleteAccount(player.account.accountId);
            assert.equal((await sourceDb.query(
                'SELECT count(*)::int AS count FROM tamashi_wallets')).rows[0].count, 0);
            assert.equal((await sourceDb.query(
                'SELECT count(*)::int AS count FROM card_unlocks')).rows[0].count, 0);
            assert.equal((await sourceDb.query(
                'SELECT count(*)::int AS count FROM tamashi_ledger_entries WHERE account_id IS NOT NULL'))
                .rows[0].count, 0);
            assert.equal((await sourceDb.query(
                'SELECT count(*)::int AS count FROM verified_iap_receipts WHERE account_id IS NOT NULL'))
                .rows[0].count, 0);
        } finally {
            await Promise.all([sourceDb.close(), targetDb.close()]);
        }
    });
