'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildTelemetryReport } = require('../tools/telemetry-report');

function event(eventId, appSessionId, name) {
    return { eventId, appSessionId, name };
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
