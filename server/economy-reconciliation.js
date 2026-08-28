'use strict';

const MAX_REPORTED_ISSUES = 100;

function number(value) {
    const result = Number(value);
    return Number.isSafeInteger(result) ? result : NaN;
}

function reconcileEconomySnapshot(snapshot, options = {}) {
    const checkedAt = options.checkedAt || new Date().toISOString();
    const wallets = snapshot.wallets || [];
    const ledger = snapshot.ledger || [];
    const unlocks = snapshot.unlocks || [];
    const receipts = snapshot.receipts || [];
    const settlements = snapshot.settlements || [];
    const issues = [];
    let issueCount = 0;
    const report = (code, reference) => {
        issueCount++;
        if (issues.length < MAX_REPORTED_ISSUES) issues.push({ code, reference: String(reference || '') });
    };

    const walletByAccount = new Map(wallets.map(item => [item.accountId, item]));
    const ledgerByAccount = new Map();
    const unlockDebitsByKey = new Map();
    const receiptCreditsByKey = new Map();
    const gameplayByMatch = new Map();
    const unlockByKey = new Map(unlocks.map(item => [`${item.accountId}:${item.definitionId}`, item]));
    const receiptByKey = new Map(receipts.map(item => [
        `${item.provider}:${item.providerTransactionId}`, item,
    ]));
    const settlementByMatch = new Map(settlements.map(item => [item.matchId, item]));
    const appendIndex = (index, key, value) => {
        const items = index.get(key) || [];
        items.push(value);
        index.set(key, items);
    };

    for (const entry of ledger) {
        if (!['credit', 'debit'].includes(entry.direction)
            || !Number.isSafeInteger(number(entry.amount)) || number(entry.amount) <= 0
            || !Number.isSafeInteger(number(entry.balanceAfter)) || number(entry.balanceAfter) < 0) {
            report('LEDGER_ENTRY_INVALID', entry.ledgerId);
        }
        if (entry.accountId) {
            const items = ledgerByAccount.get(entry.accountId) || [];
            items.push(entry);
            ledgerByAccount.set(entry.accountId, items);
            if (!walletByAccount.has(entry.accountId)) report('LEDGER_WITHOUT_WALLET', entry.ledgerId);
        }
        if (entry.sourceType === 'card_unlock' && entry.accountId) {
            appendIndex(unlockDebitsByKey, `${entry.accountId}:${entry.definitionId}`, entry);
        }
        if (entry.sourceType === 'verified_in_app_purchase') {
            appendIndex(receiptCreditsByKey, `${entry.provider}:${entry.providerTransactionId}`, entry);
        }
        if (entry.sourceType === 'verified_gameplay') {
            appendIndex(gameplayByMatch, entry.matchId, entry);
            const settlement = settlementByMatch.get(entry.matchId);
            if (!settlement || settlement.roomId !== entry.roomId
                || settlement.participantHash !== entry.participantHash) {
                report('GAMEPLAY_CREDIT_WITHOUT_SETTLEMENT', entry.ledgerId);
            }
        }
    }

    for (const wallet of wallets) {
        const entries = (ledgerByAccount.get(wallet.accountId) || [])
            .slice().sort((left, right) => number(left.walletRevision) - number(right.walletRevision));
        let runningBalance = 0;
        let gameplay = 0;
        let purchased = 0;
        let spent = 0;
        entries.forEach((entry, index) => {
            const expectedRevision = index + 1;
            if (number(entry.walletRevision) !== expectedRevision) {
                report('WALLET_REVISION_GAP', `${wallet.accountId}:${entry.ledgerId}`);
            }
            runningBalance += entry.direction === 'credit' ? number(entry.amount) : -number(entry.amount);
            if (runningBalance < 0 || number(entry.balanceAfter) !== runningBalance) {
                report('LEDGER_BALANCE_CHAIN_MISMATCH', entry.ledgerId);
            }
            if (entry.sourceType === 'verified_gameplay') gameplay += number(entry.amount);
            if (entry.sourceType === 'verified_in_app_purchase') purchased += number(entry.amount);
            if (entry.sourceType === 'card_unlock') spent += number(entry.amount);
        });
        const comparisons = [
            ['WALLET_BALANCE_MISMATCH', wallet.balance, runningBalance],
            ['WALLET_REVISION_MISMATCH', wallet.revision, entries.length],
            ['LIFETIME_GAMEPLAY_MISMATCH', wallet.lifetimeGameplay, gameplay],
            ['LIFETIME_PURCHASED_MISMATCH', wallet.lifetimePurchased, purchased],
            ['LIFETIME_SPENT_MISMATCH', wallet.lifetimeSpent, spent],
        ];
        for (const [code, actual, expected] of comparisons) {
            if (number(actual) !== expected) report(code, wallet.accountId);
        }
    }

    for (const unlock of unlocks) {
        const matches = unlockDebitsByKey.get(`${unlock.accountId}:${unlock.definitionId}`) || [];
        if (matches.length !== 1 || matches[0].direction !== 'debit'
            || number(matches[0].amount) !== number(unlock.tamashiPrice)) {
            report('UNLOCK_DEBIT_MISMATCH', `${unlock.accountId}:${unlock.definitionId}`);
        }
    }
    for (const entry of ledger) {
        if (entry.sourceType === 'card_unlock' && entry.accountId
            && !unlockByKey.has(`${entry.accountId}:${entry.definitionId}`)) {
            report('DEBIT_WITHOUT_UNLOCK', entry.ledgerId);
        }
    }

    for (const receipt of receipts) {
        const matches = receiptCreditsByKey.get(
            `${receipt.provider}:${receipt.providerTransactionId}`,
        ) || [];
        if (matches.length !== 1 || matches[0].direction !== 'credit'
            || matches[0].accountId !== receipt.accountId
            || number(matches[0].amount) !== number(receipt.tamashiAmount)) {
            report('RECEIPT_CREDIT_MISMATCH', `${receipt.provider}:${receipt.providerTransactionId}`);
        }
    }
    for (const entry of ledger) {
        if (entry.sourceType === 'verified_in_app_purchase'
            && !receiptByKey.has(`${entry.provider}:${entry.providerTransactionId}`)) {
            report('CREDIT_WITHOUT_RECEIPT', entry.ledgerId);
        }
    }

    for (const settlement of settlements) {
        const grants = gameplayByMatch.get(settlement.matchId) || [];
        if ((settlement.status === 'granted' && grants.length === 0)
            || (settlement.status !== 'granted' && grants.length > 0)) {
            report('SETTLEMENT_GRANT_MISMATCH', settlement.matchId);
        }
    }

    return Object.freeze({
        ok: issueCount === 0,
        checkedAt,
        issueCount,
        issues: Object.freeze(issues),
        truncated: issueCount > issues.length,
        freezeRequired: issueCount ? Object.freeze(['tamashi_wallet', 'verified_iap']) : Object.freeze([]),
        counts: Object.freeze({
            wallets: wallets.length,
            ledgerEntries: ledger.length,
            unlocks: unlocks.length,
            receipts: receipts.length,
            settlements: settlements.length,
        }),
    });
}

module.exports = { MAX_REPORTED_ISSUES, reconcileEconomySnapshot };
