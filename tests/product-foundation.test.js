'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadScripts, ROOT } = require('./helpers/load-script');

const loaded = loadScripts([
    'game/game-manifests.js',
    'product/feature-flags.js',
    'product/telemetry-schema.js',
    'product/telemetry.js',
], [
    'ProductFeatureFlagService',
    'PRODUCT_FEATURE_FLAG_DEFINITIONS',
    'ProductTelemetryClient',
    'PRODUCT_EVENT_SCHEMAS',
]);

function createMemoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
        snapshot() { return Object.fromEntries(values); },
    };
}

function deterministicIds() {
    let sequence = 0;
    return prefix => `${prefix}-test-${String(++sequence).padStart(4, '0')}`;
}

function createClient(options = {}) {
    return new loaded.ProductTelemetryClient({
        storage: options.storage || createMemoryStorage(),
        consent: options.consent,
        sink: options.sink,
        batchSize: options.batchSize || 50,
        maxQueueSize: options.maxQueueSize || 5000,
        now: options.now || (() => 1000),
        idFactory: options.idFactory || deterministicIds(),
        buildVersion: 'test-build',
    });
}

test('P0 product feature flags default off and ignore unknown or malformed overrides', () => {
    const flags = new loaded.ProductFeatureFlagService(loaded.PRODUCT_FEATURE_FLAG_DEFINITIONS, {
        deep_link_join: true,
        persistent_table: 'yes',
        unknown_rule_change: true,
    });
    assert.equal(flags.isEnabled('deep_link_join'), true);
    assert.equal(flags.isEnabled('persistent_table'), false);
    assert.equal(flags.isEnabled('unknown_rule_change'), false);
    flags.reset();
    assert.equal(Object.values(flags.snapshot()).every(value => value === false), true);
});

test('P0 core rules and deck construction cannot depend on product feature flags', () => {
    const sources = ['deck.js', 'game/game-rules.js']
        .map(file => fs.readFileSync(path.join(ROOT, file), 'utf8'))
        .join('\n');
    assert.doesNotMatch(sources, /ProductFeatureFlags|MEH_FEATURE_FLAGS/);
});

test('P0 telemetry is opt-in and writes nothing before consent', () => {
    const storage = createMemoryStorage();
    const client = createClient({ storage, consent: 'unknown' });
    assert.equal(client.track('entry.viewed', { screenId: 'main-menu' }), false);
    assert.deepEqual(storage.snapshot(), {});
    assert.equal(client.export().events.length, 0);
});

test('P0 telemetry accepts only schema fields and rejects prohibited personal data', () => {
    const client = createClient({ consent: 'granted' });
    assert.equal(client.track('entry.viewed', { screenId: 'main-menu' }), true);
    assert.equal(client.track('entry.viewed', { screenId: 'main-menu', playerName: 'Secret' }), false);
    assert.equal(client.track('room.join_started', { role: 'host', method: 'create', roomCode: 'ABCDE' }), false);
    assert.equal(client.track('action.committed', { actor: 'self', action: 'play', definitionId: 'skip' }), true);
    assert.equal(client.export().events.length, 2);
});

test('P4 economy telemetry records bounded product facts without identity or receipt data', () => {
    const client = createClient({ consent: 'granted' });
    assert.equal(client.track('catalog.viewed', { cardCount: 22, unlockedCount: 22 }), true);
    assert.equal(client.track('economy.balance_viewed', { balanceBand: '1-499' }), true);
    assert.equal(client.track('economy.balance_viewed', { balance: 140 }), false);
    assert.equal(client.track('catalog.unlock', {
        result: 'completed', definitionId: 'future-card',
    }), true);
    assert.equal(client.track('recipe.contribution_changed', {
        action: 'set', contributionCount: 1, definitionId: 'future-card',
    }), true);
    assert.equal(client.track('catalog.unlock', {
        result: 'completed', definitionId: 'future-card', receipt: 'secret',
    }), false);
    assert.equal(client.export().events.length, 4);
});

test('P0 telemetry persists offline events and reloads each event id once', () => {
    const storage = createMemoryStorage();
    const first = createClient({ storage, consent: 'granted' });
    first.track('entry.viewed', { screenId: 'main-menu' });
    first.track('room.join_started', { role: 'guest', method: 'code' });

    const second = createClient({ storage, consent: 'granted' });
    const events = second.export().events;
    assert.equal(events.length, 2);
    assert.equal(new Set(events.map(event => event.eventId)).size, 2);
});

test('P0 telemetry retains a failed batch and removes it only after acknowledged delivery', async () => {
    let attempts = 0;
    const deliveredIds = [];
    const client = createClient({
        consent: 'granted',
        batchSize: 2,
        sink: async events => {
            attempts++;
            if (attempts === 1) throw new Error('offline');
            deliveredIds.push(...events.map(event => event.eventId));
            return true;
        },
    });
    client.track('entry.viewed', { screenId: 'main-menu' });
    client.track('room.join_started', { role: 'host', method: 'create' });
    const retained = await client.flush();
    assert.equal(retained.status, 'retained');
    assert.equal(retained.sent, 0);
    assert.equal(client.export().events.length, 2);
    const sent = await client.flush();
    assert.equal(sent.status, 'sent');
    assert.equal(sent.sent, 2);
    assert.equal(client.export().events.length, 0);
    assert.equal(new Set(deliveredIds).size, 2);
});

test('P0 concurrent flush attempts deliver one batch once', async () => {
    let deliveries = 0;
    let release;
    const waiting = new Promise(resolve => { release = resolve; });
    const client = createClient({
        consent: 'granted',
        sink: async () => { deliveries++; await waiting; return true; },
    });
    client.track('entry.viewed', { screenId: 'main-menu' });
    const first = client.flush();
    const second = client.flush();
    release();
    const results = await Promise.all([first, second]);
    assert.equal(deliveries, 1);
    assert.equal(results.length, 2);
    for (const result of results) {
        assert.equal(result.status, 'sent');
        assert.equal(result.sent, 1);
    }
});

test('P0 denying consent clears queued events and the anonymous install id', () => {
    const storage = createMemoryStorage();
    const client = createClient({ storage, consent: 'granted' });
    client.track('entry.viewed', { screenId: 'main-menu' });
    client.setConsent('denied');
    assert.equal(client.export().events.length, 0);
    assert.equal(client.installId, null);
    const persisted = storage.snapshot();
    assert.equal(persisted.meh_telemetry_queue_v1, undefined);
    assert.equal(persisted.meh_telemetry_install_v1, undefined);
    assert.equal(persisted.meh_telemetry_consent_v1, 'denied');
});

test('P0 blocked storage never blocks telemetry or gameplay-facing calls', async () => {
    const blocked = {
        getItem() { throw new Error('blocked'); },
        setItem() { throw new Error('blocked'); },
        removeItem() { throw new Error('blocked'); },
    };
    const client = createClient({ storage: blocked, consent: 'granted' });
    assert.equal(client.track('entry.viewed', { screenId: 'main-menu' }), true);
    const result = await client.flush();
    assert.equal(result.status, 'no-sink');
    assert.equal(result.sent, 0);
});

test('P0 every declared event schema rejects undeclared properties', () => {
    const client = createClient({ consent: 'granted' });
    for (const [name, schema] of Object.entries(loaded.PRODUCT_EVENT_SCHEMAS)) {
        const properties = {};
        for (const field of schema.required) {
            const rule = schema.fields[field];
            if (rule.type === 'enum') properties[field] = rule.values[0];
            else if (rule.type === 'integer') properties[field] = rule.min;
            else if (rule.type === 'boolean') properties[field] = false;
            else properties[field] = 'valid-token';
        }
        assert.equal(client.validate(name, properties), true, name);
        assert.equal(client.validate(name, { ...properties, unexpected: 'value' }), false, name);
    }
});

test('P0 every gameplay telemetry call is backed by a declared schema', () => {
    const source = [
        'game.js',
        'game/game-product.js',
        'game/game-screen.js',
        'game/game-online.js',
        'game/game-rules.js',
    ].map(file => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
    const usedNames = [...source.matchAll(/_trackProductEvent\('([^']+)'/g)]
        .map(match => match[1]);
    assert.ok(usedNames.length >= 10);
    for (const name of usedNames) {
        assert.ok(Object.hasOwn(loaded.PRODUCT_EVENT_SCHEMAS, name), `${name} has no schema`);
    }
});
