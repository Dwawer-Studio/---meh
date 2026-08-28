'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildTelemetryReport } = require('../tools/telemetry-report');

function event(eventId, appSessionId, name, occurredAt, properties) {
    return {
        eventId,
        appSessionId,
        name,
        ...(occurredAt === undefined ? {} : { occurredAt }),
        ...(properties === undefined ? {} : { properties }),
    };
}

test('P0 telemetry report builds a session funnel without exposing identifiers', () => {
    const report = buildTelemetryReport({
        exportSchemaVersion: 1,
        rulesVersion: '1.0.0',
        catalogVersion: '1.0.0',
        events: [
            event('e1', 's1', 'app.session_started'),
            event('e2', 's1', 'entry.viewed'),
            event('e3', 's1', 'room.join_started'),
            event('e4', 's1', 'seat.ready'),
            event('e5', 's1', 'match.started'),
            event('e6', 's1', 'match.completed'),
            event('e7', 's1', 'rematch.ready'),
            event('e8', 's2', 'app.session_started'),
            event('e9', 's2', 'entry.viewed'),
            event('e10', 's2', 'room.join_started'),
            event('e11', 's2', 'reconnect.started'),
            event('e12', 's2', 'reconnect.completed'),
        ],
    });
    assert.equal(report.integrity.valid, true);
    assert.equal(report.sessions, 2);
    assert.equal(report.funnel.matchCompleted.sessions, 1);
    assert.equal(report.funnel.matchCompleted.fromAllSessionsPercent, 50);
    assert.equal(report.reconnect.completionPercent, 100);
    assert.doesNotMatch(JSON.stringify(report), /\"s1\"|\"s2\"|\"e1\"/);
});

test('P0 telemetry report flags malformed and duplicate records', () => {
    const report = buildTelemetryReport({ events: [
        event('same', 'session', 'entry.viewed'),
        event('same', 'session', 'match.started'),
        { name: 'entry.viewed' },
    ] });
    assert.equal(report.integrity.valid, false);
    assert.equal(report.integrity.duplicateEventIds, 1);
    assert.equal(report.integrity.malformedEvents, 1);
});

test('P1 telemetry report computes I2S, TTS, MCR, M1→M2, and Wilson intervals', () => {
    const report = buildTelemetryReport({ events: [
        event('a1', 's1', 'invite.opened', 0),
        event('a2', 's1', 'seat.ready', 20_000),
        event('a3', 's1', 'match.started', 30_000, { mode: 'online-host' }),
        event('a4', 's1', 'match.completed', 60_000, { mode: 'online-host' }),
        event('a5', 's1', 'match.started', 70_000, { mode: 'online-host' }),
        event('b1', 's2', 'invite.opened', 0),
        event('b2', 's2', 'seat.ready', 40_000),
        event('b3', 's2', 'match.started', 50_000, { mode: 'online-host' }),
        event('b4', 's2', 'match.completed', 80_000, { mode: 'online-host' }),
        event('c1', 's3', 'invite.opened', 0),
        event('c2', 's3', 'seat.ready', 700_000),
        event('c3', 's3', 'match.started', 710_000, { mode: 'online-host' }),
    ] });
    assert.deepEqual(report.p1.i2s, {
        successes: 2,
        total: 3,
        percent: 66.67,
        confidence95: { lowerPercent: 20.77, upperPercent: 93.85 },
    });
    assert.deepEqual(report.p1.ttsMilliseconds, { samples: 2, p50: 20_000, p90: 40_000 });
    assert.equal(report.p1.mcr.percent, 50);
    assert.equal(report.p1.m1ToM2.percent, 50);
    assert.equal(report.p1.unguidedSocialSessions, 2);
});
