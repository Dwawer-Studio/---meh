'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { migrationFiles } = require('../server/migration-runner');
const { parseClientMessage, ProtocolError } = require('../server/protocol');
const { TokenBucketLimiter } = require('../server/rate-limiter');

function message(overrides = {}) {
    return JSON.stringify({
        v: 1,
        type: 'snapshot.request',
        requestId: 'request_000000000001',
        clientSeq: 1,
        lastServerSeq: 0,
        payload: {},
        ...overrides,
    });
}

test('protocol rejects oversized, unknown, malformed, and out-of-range envelopes', () => {
    assert.equal(parseClientMessage(message()).type, 'snapshot.request');
    assert.throws(() => parseClientMessage('{'), error => error instanceof ProtocolError && error.code === 'BAD_JSON');
    assert.throws(() => parseClientMessage(message({ type: 'system.timeout' })), { code: 'BAD_TYPE' });
    assert.throws(() => parseClientMessage(message({ clientSeq: 0 })), { code: 'BAD_SEQUENCE' });
    assert.throws(() => parseClientMessage(Buffer.alloc(17 * 1024, 65)), { code: 'MESSAGE_TOO_LARGE' });
});

test('token bucket has a bounded burst, deterministic refill, and pruning', () => {
    const limiter = new TokenBucketLimiter({ capacity: 2, refillPerSecond: 1, idleTtlMs: 1_000 });
    assert.equal(limiter.consume('a', 0).allowed, true);
    assert.equal(limiter.consume('a', 0).allowed, true);
    assert.equal(limiter.consume('a', 0).allowed, false);
    assert.equal(limiter.consume('a', 1_000).allowed, true);
    assert.equal(limiter.prune(2_001), 1);
});

test('numbered SQL migrations have stable checksums and required authority tables', () => {
    const migrations = migrationFiles(require('node:path').join(__dirname, '..', 'server', 'migrations'));
    assert.ok(migrations.length >= 1);
    assert.deepEqual(migrations.map(item => item.name), [...migrations.map(item => item.name)].sort());
    const sql = migrations.map(item => item.sql).join('\n');
    for (const table of ['accounts', 'account_sessions', 'majalis', 'majlis_memberships', 'rooms', 'seats',
        'request_idempotency', 'match_actions', 'audit_log', 'deletion_tombstones']) {
        assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    }
    assert.ok(migrations.every(item => /^[a-f0-9]{64}$/.test(item.checksum)));
});
