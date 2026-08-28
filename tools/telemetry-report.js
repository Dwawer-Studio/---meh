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
        if (!sessions.has(event.appSessionId)) sessions.set(event.appSessionId, new Set());
        sessions.get(event.appSessionId).add(event.name);
    }

    const funnel = {};
    let eligibleSessions = new Set(sessions.keys());
    let previous = eligibleSessions.size;
    for (const [key, eventName] of FUNNEL_STAGES) {
        eligibleSessions = new Set(
            [...eligibleSessions].filter(sessionId => sessions.get(sessionId).has(eventName)),
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
    return {
        reportSchemaVersion: 1,
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

module.exports = { buildTelemetryReport };
