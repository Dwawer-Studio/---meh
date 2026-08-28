'use strict';

const fs = require('node:fs');

const FUNNEL_STAGES = Object.freeze([
    ['sessionStarted', 'app.session_started'],
    ['entryViewed', 'entry.viewed'],
    ['joinStarted', 'room.join_started'],
    ['seatReady', 'seat.ready'],
    ['matchStarted', 'match.started'],
    ['matchCompleted', 'match.completed'],
    ['rematchReady', 'rematch.ready'],
]);

function roundRate(numerator, denominator) {
    return denominator ? Math.round((numerator / denominator) * 10000) / 100 : 0;
}

function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
    return sorted[index];
}

function wilsonInterval(successes, total, z = 1.959963984540054) {
    if (!total) return { lowerPercent: null, upperPercent: null };
    const proportion = successes / total;
    const zSquared = z * z;
    const denominator = 1 + zSquared / total;
    const center = (proportion + zSquared / (2 * total)) / denominator;
    const margin = z * Math.sqrt(
        (proportion * (1 - proportion) / total) + (zSquared / (4 * total * total)),
    ) / denominator;
    return {
        lowerPercent: Math.round(Math.max(0, center - margin) * 10000) / 100,
        upperPercent: Math.round(Math.min(1, center + margin) * 10000) / 100,
    };
}

function rateMetric(successes, total) {
    return {
        successes,
        total,
        percent: roundRate(successes, total),
        confidence95: wilsonInterval(successes, total),
    };
}

function buildTelemetryReport(payload) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.events)) {
        throw new TypeError('Expected a telemetry export with an events array.');
    }

    const ids = new Set();
    const sessions = new Map();
    const eventCounts = {};
    let duplicateEventIds = 0;
    let malformedEvents = 0;

    for (const event of payload.events) {
        if (!event || typeof event !== 'object' || typeof event.eventId !== 'string'
            || typeof event.name !== 'string' || typeof event.appSessionId !== 'string') {
            malformedEvents++;
            continue;
        }
        if (ids.has(event.eventId)) duplicateEventIds++;
        ids.add(event.eventId);
        eventCounts[event.name] = (eventCounts[event.name] || 0) + 1;
        if (!sessions.has(event.appSessionId)) sessions.set(event.appSessionId, { names: new Set(), events: [] });
        const session = sessions.get(event.appSessionId);
        session.names.add(event.name);
        session.events.push(event);
    }

    const funnel = {};
    let eligibleSessions = new Set(sessions.keys());
    let previous = eligibleSessions.size;
    for (const [key, eventName] of FUNNEL_STAGES) {
        eligibleSessions = new Set(
            [...eligibleSessions].filter(sessionId => sessions.get(sessionId).names.has(eventName)),
        );
        const reached = eligibleSessions.size;
        funnel[key] = {
            sessions: reached,
            fromPreviousPercent: roundRate(reached, previous),
            fromAllSessionsPercent: roundRate(reached, sessions.size),
        };
        previous = reached;
    }

    const reconnectStarted = eventCounts['reconnect.started'] || 0;
    const reconnectCompleted = eventCounts['reconnect.completed'] || 0;
    const reconnectFailed = eventCounts['reconnect.failed'] || 0;
    const inviteDurations = [];
    let validInviteSessions = 0;
    for (const session of sessions.values()) {
        const opened = session.events
            .filter(event => event.name === 'invite.opened' && Number.isFinite(event.occurredAt))
            .sort((a, b) => a.occurredAt - b.occurredAt)[0];
        if (!opened) continue;
        validInviteSessions++;
        const seated = session.events
            .filter(event => event.name === 'seat.ready' && Number.isFinite(event.occurredAt)
                && event.occurredAt >= opened.occurredAt
                && event.occurredAt - opened.occurredAt <= 600_000)
            .sort((a, b) => a.occurredAt - b.occurredAt)[0];
        if (seated) inviteDurations.push(seated.occurredAt - opened.occurredAt);
    }
    const hostMatchEvents = [...sessions.values()].flatMap(session => session.events)
        .filter(event => (event.name === 'match.started' || event.name === 'match.completed')
            && event.properties && event.properties.mode === 'online-host');
    const hostSocialSessions = [...sessions.values()].filter(session => session.events.some(event =>
        event.name === 'match.started' && event.properties && event.properties.mode === 'online-host'));
    const firstMatchCompletedSessions = hostSocialSessions.filter(session => session.events.some(event =>
        event.name === 'match.completed' && event.properties && event.properties.mode === 'online-host'));
    const secondMatchSessions = firstMatchCompletedSessions.filter(session => session.events.filter(event =>
        event.name === 'match.started' && event.properties && event.properties.mode === 'online-host').length >= 2);
    const matchStarted = hostMatchEvents.filter(event => event.name === 'match.started').length;
    const matchCompleted = hostMatchEvents.filter(event => event.name === 'match.completed').length;
    return {
        reportSchemaVersion: 2,
        source: {
            exportSchemaVersion: payload.exportSchemaVersion || null,
            rulesVersion: payload.rulesVersion || null,
            catalogVersion: payload.catalogVersion || null,
        },
        integrity: {
            inputEvents: payload.events.length,
            acceptedEvents: payload.events.length - malformedEvents,
            malformedEvents,
            duplicateEventIds,
            valid: malformedEvents === 0 && duplicateEventIds === 0,
        },
        sessions: sessions.size,
        eventCounts: Object.fromEntries(Object.entries(eventCounts).sort(([a], [b]) => a.localeCompare(b))),
        funnel,
        reconnect: {
            started: reconnectStarted,
            completed: reconnectCompleted,
            failed: reconnectFailed,
            completionPercent: roundRate(reconnectCompleted, reconnectStarted),
        },
        p1: {
            i2s: rateMetric(inviteDurations.length, validInviteSessions),
            ttsMilliseconds: {
                samples: inviteDurations.length,
                p50: percentile(inviteDurations, 0.5),
                p90: percentile(inviteDurations, 0.9),
            },
            mcr: rateMetric(Math.min(matchCompleted, matchStarted), matchStarted),
            m1ToM2: rateMetric(secondMatchSessions.length, firstMatchCompletedSessions.length),
            unguidedSocialSessions: firstMatchCompletedSessions.length,
        },
    };
}

if (require.main === module) {
    const inputPath = process.argv[2];
    if (!inputPath) {
        console.error('Usage: npm run report:telemetry -- <telemetry-export.json>');
        process.exitCode = 2;
    } else {
        try {
            const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
            process.stdout.write(`${JSON.stringify(buildTelemetryReport(payload), null, 2)}\n`);
        } catch (error) {
            console.error(`Telemetry report failed: ${error.message}`);
            process.exitCode = 1;
        }
    }
}

module.exports = { buildTelemetryReport, percentile, wilsonInterval };
