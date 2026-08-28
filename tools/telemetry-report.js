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

function newcombeDifference(control, treatment) {
    if (!control.total || !treatment.total) {
        return {
            differencePercentagePoints: null,
            confidence95: { lowerPercentagePoints: null, upperPercentagePoints: null },
            decision: 'insufficient-data',
        };
    }
    const controlRate = control.successes / control.total;
    const treatmentRate = treatment.successes / treatment.total;
    const controlWilson = wilsonInterval(control.successes, control.total);
    const treatmentWilson = wilsonInterval(treatment.successes, treatment.total);
    const controlLower = controlWilson.lowerPercent / 100;
    const controlUpper = controlWilson.upperPercent / 100;
    const treatmentLower = treatmentWilson.lowerPercent / 100;
    const treatmentUpper = treatmentWilson.upperPercent / 100;
    const difference = treatmentRate - controlRate;
    const lower = difference - Math.sqrt(
        ((treatmentRate - treatmentLower) ** 2) + ((controlUpper - controlRate) ** 2),
    );
    const upper = difference + Math.sqrt(
        ((treatmentUpper - treatmentRate) ** 2) + ((controlRate - controlLower) ** 2),
    );
    const lowerPercentagePoints = Math.round(lower * 10_000) / 100;
    const upperPercentagePoints = Math.round(upper * 10_000) / 100;
    return {
        differencePercentagePoints: Math.round(difference * 10_000) / 100,
        confidence95: { lowerPercentagePoints, upperPercentagePoints },
        decision: lowerPercentagePoints > 0
            ? 'positive'
            : (upperPercentagePoints < 0 ? 'negative' : 'inconclusive'),
    };
}

function summarizeExperiment(assignments, crossoverInstalls, observations) {
    const arms = {
        control: { successes: 0, total: 0 },
        treatment: { successes: 0, total: 0 },
    };
    const seen = new Set();
    for (const observation of observations) {
        if (!observation.installId || crossoverInstalls.has(observation.installId)
            || seen.has(observation.key)) continue;
        const variant = assignments.get(observation.installId);
        if (!variant) continue;
        seen.add(observation.key);
        arms[variant].total++;
        if (observation.success) arms[variant].successes++;
    }
    const control = rateMetric(arms.control.successes, arms.control.total);
    const treatment = rateMetric(arms.treatment.successes, arms.treatment.total);
    return {
        assignedInstalls: {
            control: [...assignments.values()].filter(variant => variant === 'control').length,
            treatment: [...assignments.values()].filter(variant => variant === 'treatment').length,
        },
        crossoverInstalls: crossoverInstalls.size,
        analyzedUnits: control.total + treatment.total,
        control,
        treatment,
        effect: newcombeDifference(control, treatment),
    };
}

function riyadhDay(timeMs) {
    if (!Number.isFinite(timeMs)) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(timeMs));
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
}

function mondayForDay(day) {
    const date = new Date(`${day}T00:00:00.000Z`);
    const offset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
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
    const acceptedEvents = [...sessions.values()].flatMap(session => session.events);
    const observationEnd = Number.isFinite(payload.exportedAt)
        ? payload.exportedAt
        : Math.max(0, ...acceptedEvents.map(event => event.occurredAt).filter(Number.isFinite));
    const createdGroups = new Map();
    const majlisSessions = new Map();
    const majlisCompletions = [];
    const experimentAssignments = new Map();
    const experimentCrossovers = new Map();
    const experimentExposureEvents = [];
    for (const event of acceptedEvents) {
        const properties = event.properties || {};
        if (event.name === 'majlis.created' && typeof properties.groupToken === 'string'
            && Number.isFinite(event.occurredAt)) {
            const existing = createdGroups.get(properties.groupToken);
            if (!existing || event.occurredAt < existing.createdAt) {
                createdGroups.set(properties.groupToken, {
                    createdAt: event.occurredAt,
                    installId: typeof event.installId === 'string' ? event.installId : null,
                });
            }
        }
        if (event.name === 'majlis.session_started' && typeof properties.groupToken === 'string'
            && typeof properties.sessionToken === 'string' && Number.isFinite(event.occurredAt)) {
            if (!majlisSessions.has(properties.groupToken)) majlisSessions.set(properties.groupToken, new Map());
            const groupSessions = majlisSessions.get(properties.groupToken);
            const existing = groupSessions.get(properties.sessionToken);
            if (!existing || event.occurredAt < existing.startedAt) {
                groupSessions.set(properties.sessionToken, {
                    startedAt: event.occurredAt,
                    humanSeats: properties.humanSeats,
                    installId: typeof event.installId === 'string' ? event.installId : null,
                });
            }
        }
        if (event.name === 'majlis.session_completed' && typeof properties.groupToken === 'string'
            && typeof properties.sessionToken === 'string' && Number.isFinite(event.occurredAt)) {
            majlisCompletions.push(event);
        }
        if (event.name === 'experiment.exposed' && typeof event.installId === 'string'
            && typeof properties.experimentId === 'string'
            && ['control', 'treatment'].includes(properties.variant)
            && Number.isFinite(event.occurredAt)) {
            if (!experimentAssignments.has(properties.experimentId)) {
                experimentAssignments.set(properties.experimentId, new Map());
                experimentCrossovers.set(properties.experimentId, new Set());
            }
            const assignments = experimentAssignments.get(properties.experimentId);
            const crossovers = experimentCrossovers.get(properties.experimentId);
            const existing = assignments.get(event.installId);
            if (existing && existing !== properties.variant) {
                assignments.delete(event.installId);
                crossovers.add(event.installId);
            } else if (!crossovers.has(event.installId)) {
                assignments.set(event.installId, properties.variant);
            }
            experimentExposureEvents.push(event);
        }
    }
    const eligibleGroups = [...createdGroups].filter(([, created]) =>
        created.createdAt <= observationEnd - 7 * 24 * 60 * 60 * 1000);
    const returnedGroups = eligibleGroups.filter(([groupToken, created]) => {
        const createdDay = riyadhDay(created.createdAt);
        return [...(majlisSessions.get(groupToken) || new Map()).values()].some(session =>
            session.startedAt > created.createdAt
            && session.startedAt <= created.createdAt + 7 * 24 * 60 * 60 * 1000
            && riyadhDay(session.startedAt) !== createdDay);
    });
    const returnedGroupTokens = new Set(returnedGroups.map(([groupToken]) => groupToken));
    const cohortCounts = new Map();
    for (const [groupToken, created] of eligibleGroups) {
        const week = mondayForDay(riyadhDay(created.createdAt));
        const cohort = cohortCounts.get(week) || { successes: 0, total: 0 };
        cohort.total++;
        if (returnedGroupTokens.has(groupToken)) cohort.successes++;
        cohortCounts.set(week, cohort);
    }
    const groupReturnObservations = eligibleGroups.map(([groupToken, created]) => ({
        key: groupToken,
        installId: created.installId,
        success: returnedGroupTokens.has(groupToken),
    }));
    const e02Exposures = new Map();
    for (const event of experimentExposureEvents.filter(item =>
        item.properties.experimentId === 'p3_one_tap_reinvite')) {
        const existing = e02Exposures.get(event.installId);
        if (!existing || event.occurredAt < existing.occurredAt) e02Exposures.set(event.installId, event);
    }
    const e02Observations = [...e02Exposures].map(([installId, exposure]) => ({
        key: installId,
        installId,
        success: acceptedEvents.some(event => event.installId === installId
            && event.name === 'match.started' && event.occurredAt >= exposure.occurredAt
            && event.occurredAt <= exposure.occurredAt + 10 * 60 * 1000
            && event.properties && event.properties.humanSeats >= 2),
    }));
    const e03Observations = experimentExposureEvents
        .filter(event => event.properties.experimentId === 'p3_majlis_session_score'
            && typeof event.properties.groupToken === 'string')
        .map(exposure => {
            const completion = majlisCompletions
                .filter(event => event.installId === exposure.installId
                    && event.properties.groupToken === exposure.properties.groupToken
                    && event.occurredAt <= exposure.occurredAt)
                .sort((left, right) => right.occurredAt - left.occurredAt)[0];
            const sessions = [...(majlisSessions.get(exposure.properties.groupToken) || new Map()).entries()];
            return {
                key: `${exposure.installId}:${exposure.properties.groupToken}`,
                installId: exposure.installId,
                success: !!completion && sessions.some(([sessionToken, session]) =>
                    sessionToken !== completion.properties.sessionToken
                    && session.startedAt > exposure.occurredAt),
            };
        });
    const eligibleGroupMap = new Map(eligibleGroups);
    const e04Observations = experimentExposureEvents
        .filter(event => event.properties.experimentId === 'p3_majlis_schedule'
            && typeof event.properties.groupToken === 'string'
            && eligibleGroupMap.has(event.properties.groupToken))
        .map(exposure => ({
            key: `${exposure.installId}:${exposure.properties.groupToken}`,
            installId: exposure.installId,
            success: returnedGroupTokens.has(exposure.properties.groupToken),
        }));
    const experimentInput = experimentId => ({
        assignments: experimentAssignments.get(experimentId) || new Map(),
        crossovers: experimentCrossovers.get(experimentId) || new Set(),
    });
    const e01 = experimentInput('p3_recent_majalis');
    const e02 = experimentInput('p3_one_tap_reinvite');
    const e03 = experimentInput('p3_majlis_session_score');
    const e04 = experimentInput('p3_majlis_schedule');
    const experimentResults = {
        p3_recent_majalis: summarizeExperiment(e01.assignments, e01.crossovers, groupReturnObservations),
        p3_one_tap_reinvite: summarizeExperiment(e02.assignments, e02.crossovers, e02Observations),
        p3_majlis_session_score: summarizeExperiment(e03.assignments, e03.crossovers, e03Observations),
        p3_majlis_schedule: summarizeExperiment(e04.assignments, e04.crossovers, e04Observations),
    };
    return {
        reportSchemaVersion: 4,
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
        p3: {
            w1GroupReturn: rateMetric(returnedGroups.length, eligibleGroups.length),
            weeklyCohorts: [...cohortCounts].sort(([left], [right]) => left.localeCompare(right))
                .map(([weekStarting, counts]) => ({ weekStarting, ...rateMetric(counts.successes, counts.total) })),
            experiments: experimentResults,
            safetyActions: {
                quickChatPhrases: eventCounts['chat.phrase_sent'] || 0,
                mutes: eventCounts['chat.player_muted'] || 0,
                reports: eventCounts['moderation.report_submitted'] || 0,
            },
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
