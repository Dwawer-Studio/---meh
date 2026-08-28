'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildTelemetryReport } = require('../tools/telemetry-report');

function event(eventId, appSessionId, name, occurredAt, properties, installId) {
    return {
        eventId,
        appSessionId,
        name,
        ...(occurredAt === undefined ? {} : { occurredAt }),
        ...(properties === undefined ? {} : { properties }),
        ...(installId === undefined ? {} : { installId }),
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

test('P3 telemetry report deduplicates Majlis sessions and computes mature W1-GR cohorts', () => {
    const day = 24 * 60 * 60 * 1000;
    const start = Date.parse('2026-08-03T09:00:00.000Z');
    const report = buildTelemetryReport({
        exportedAt: start + 21 * day,
        events: [
            event('p3-a1', 'p3-s1', 'majlis.created', start,
                { groupToken: 'group-a' }, 'install-a'),
            event('p3-a2', 'p3-s2', 'majlis.session_started', start + day, {
                groupToken: 'group-a', sessionToken: 'match-a', humanSeats: 2,
            }, 'install-a'),
            event('p3-a3', 'p3-s3', 'majlis.session_started', start + day + 1_000, {
                groupToken: 'group-a', sessionToken: 'match-a', humanSeats: 2,
            }, 'install-a'),
            event('p3-b1', 'p3-s4', 'majlis.created', start + day,
                { groupToken: 'group-b' }, 'install-b'),
            event('p3-c1', 'p3-s5', 'majlis.created', start + 8 * day,
                { groupToken: 'group-c' }, 'install-c'),
            event('p3-c2', 'p3-s6', 'majlis.session_started', start + 10 * day, {
                groupToken: 'group-c', sessionToken: 'match-c', humanSeats: 2,
            }, 'install-c'),
            event('p3-e1', 'p3-s7', 'experiment.exposed', start, {
                experimentId: 'p3_recent_majalis', variant: 'treatment',
            }, 'install-a'),
            event('p3-e2', 'p3-s8', 'experiment.exposed', start + 1_000, {
                experimentId: 'p3_recent_majalis', variant: 'treatment',
            }, 'install-a'),
            event('p3-e3', 'p3-s9', 'experiment.exposed', start + day, {
                experimentId: 'p3_recent_majalis', variant: 'control',
            }, 'install-b'),
            event('p3-e4', 'p3-s10', 'experiment.exposed', start + 8 * day, {
                experimentId: 'p3_recent_majalis', variant: 'treatment',
            }, 'install-c'),
            event('p3-x1', 'p3-s11', 'experiment.exposed', start, {
                experimentId: 'p3_recent_majalis', variant: 'control',
            }, 'install-x'),
            event('p3-x2', 'p3-s12', 'experiment.exposed', start + 1_000, {
                experimentId: 'p3_recent_majalis', variant: 'treatment',
            }, 'install-x'),
            event('p3-r1', 'p3-s7', 'moderation.report_submitted', start, { reasonCode: 'spam' }),
        ],
    });
    assert.equal(report.p3.w1GroupReturn.total, 3);
    assert.equal(report.p3.w1GroupReturn.successes, 2);
    assert.equal(report.p3.w1GroupReturn.percent, 66.67);
    assert.equal(report.p3.weeklyCohorts.length, 2);
    const experiment = report.p3.experiments.p3_recent_majalis;
    assert.deepEqual(experiment.assignedInstalls, { control: 1, treatment: 2 });
    assert.equal(experiment.crossoverInstalls, 1);
    assert.equal(experiment.analyzedUnits, 3);
    assert.equal(experiment.control.successes, 0);
    assert.equal(experiment.treatment.successes, 2);
    assert.equal(experiment.effect.differencePercentagePoints, 100);
    assert.equal(report.p3.safetyActions.reports, 1);
    assert.doesNotMatch(JSON.stringify(report),
        /group-a|group-b|group-c|match-a|match-c|install-a|install-b|install-c|install-x/);
});

test('P3 telemetry report analyzes regroup, second-match, and schedule experiments by assigned install', () => {
    const minute = 60 * 1_000;
    const day = 24 * 60 * minute;
    const start = Date.parse('2026-08-03T09:00:00.000Z');
    const events = [
        event('e02-c-exp', 'e02-c', 'experiment.exposed', start, {
            experimentId: 'p3_one_tap_reinvite', variant: 'control',
        }, 'install-e02-c'),
        event('e02-t-exp', 'e02-t', 'experiment.exposed', start, {
            experimentId: 'p3_one_tap_reinvite', variant: 'treatment',
        }, 'install-e02-t'),
        event('e02-c-match', 'e02-c', 'match.started', start + 11 * minute,
            { humanSeats: 2 }, 'install-e02-c'),
        event('e02-t-match', 'e02-t', 'match.started', start + 5 * minute,
            { humanSeats: 2 }, 'install-e02-t'),

        event('e03-c-done', 'e03-c', 'majlis.session_completed', start, {
            groupToken: 'e03-group-c', sessionToken: 'e03-match-c1',
        }, 'install-e03-c'),
        event('e03-t-done', 'e03-t', 'majlis.session_completed', start, {
            groupToken: 'e03-group-t', sessionToken: 'e03-match-t1',
        }, 'install-e03-t'),
        event('e03-c-exp', 'e03-c', 'experiment.exposed', start + minute, {
            experimentId: 'p3_majlis_session_score', variant: 'control', groupToken: 'e03-group-c',
        }, 'install-e03-c'),
        event('e03-t-exp', 'e03-t', 'experiment.exposed', start + minute, {
            experimentId: 'p3_majlis_session_score', variant: 'treatment', groupToken: 'e03-group-t',
        }, 'install-e03-t'),
        event('e03-t-next', 'e03-t', 'majlis.session_started', start + 2 * minute, {
            groupToken: 'e03-group-t', sessionToken: 'e03-match-t2', humanSeats: 2,
        }, 'install-e03-t'),

        event('e04-c-new', 'e04-c', 'majlis.created', start,
            { groupToken: 'e04-group-c' }, 'install-e04-c'),
        event('e04-t-new', 'e04-t', 'majlis.created', start,
            { groupToken: 'e04-group-t' }, 'install-e04-t'),
        event('e04-c-exp', 'e04-c', 'experiment.exposed', start + minute, {
            experimentId: 'p3_majlis_schedule', variant: 'control', groupToken: 'e04-group-c',
        }, 'install-e04-c'),
        event('e04-t-exp', 'e04-t', 'experiment.exposed', start + minute, {
            experimentId: 'p3_majlis_schedule', variant: 'treatment', groupToken: 'e04-group-t',
        }, 'install-e04-t'),
        event('e04-t-return', 'e04-t', 'majlis.session_started', start + 2 * day, {
            groupToken: 'e04-group-t', sessionToken: 'e04-match-t2', humanSeats: 2,
        }, 'install-e04-t'),
    ];
    const report = buildTelemetryReport({ exportedAt: start + 8 * day, events });
    for (const experimentId of [
        'p3_one_tap_reinvite', 'p3_majlis_session_score', 'p3_majlis_schedule',
    ]) {
        const result = report.p3.experiments[experimentId];
        assert.equal(result.analyzedUnits, 2);
        assert.equal(result.control.successes, 0);
        assert.equal(result.treatment.successes, 1);
        assert.equal(result.effect.differencePercentagePoints, 100);
    }
    assert.doesNotMatch(JSON.stringify(report), /install-e0|e03-group|e04-group|e03-match|e04-match/);
});
