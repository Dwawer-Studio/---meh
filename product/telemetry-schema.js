'use strict';

const TELEMETRY_ACTORS = Object.freeze(['self', 'remote', 'bot', 'unknown']);
const TELEMETRY_MODES = Object.freeze(['local', 'online-host', 'online-client']);

const PRODUCT_EVENT_SCHEMAS = Object.freeze({
    'app.session_started': Object.freeze({
        required: ['entrySource', 'language'],
        fields: Object.freeze({
            entrySource: Object.freeze({ type: 'enum', values: ['direct', 'reload', 'unknown'] }),
            language: Object.freeze({ type: 'enum', values: ['ar', 'en', 'unknown'] }),
        }),
    }),
    'entry.viewed': Object.freeze({
        required: ['screenId'],
        fields: Object.freeze({ screenId: Object.freeze({ type: 'token', maxLength: 48 }) }),
    }),
    'invite.created': Object.freeze({
        required: ['method'],
        fields: Object.freeze({ method: Object.freeze({ type: 'enum', values: ['code', 'link', 'share', 'qr'] }) }),
    }),
    'invite.opened': Object.freeze({
        required: ['method'],
        fields: Object.freeze({ method: Object.freeze({ type: 'enum', values: ['code', 'link', 'unknown'] }) }),
    }),
    'room.join_started': Object.freeze({
        required: ['role', 'method'],
        fields: Object.freeze({
            role: Object.freeze({ type: 'enum', values: ['host', 'guest'] }),
            method: Object.freeze({ type: 'enum', values: ['create', 'code', 'link'] }),
        }),
    }),
    'room.join_failed': Object.freeze({
        required: ['stage', 'reason'],
        fields: Object.freeze({
            stage: Object.freeze({ type: 'token', maxLength: 32 }),
            reason: Object.freeze({ type: 'token', maxLength: 48 }),
        }),
    }),
    'seat.ready': Object.freeze({
        required: ['role', 'humanSeats'],
        fields: Object.freeze({
            role: Object.freeze({ type: 'enum', values: ['host', 'guest'] }),
            humanSeats: Object.freeze({ type: 'integer', min: 1, max: 4 }),
        }),
    }),
    'table.phase_changed': Object.freeze({
        required: ['from', 'to'],
        fields: Object.freeze({
            from: Object.freeze({ type: 'token', maxLength: 24 }),
            to: Object.freeze({ type: 'token', maxLength: 24 }),
        }),
    }),
    'match.started': Object.freeze({
        required: ['mode', 'humanSeats', 'botSeats', 'rematch'],
        fields: Object.freeze({
            mode: Object.freeze({ type: 'enum', values: TELEMETRY_MODES }),
            humanSeats: Object.freeze({ type: 'integer', min: 1, max: 4 }),
            botSeats: Object.freeze({ type: 'integer', min: 0, max: 3 }),
            rematch: Object.freeze({ type: 'boolean' }),
        }),
    }),
    'turn.started': Object.freeze({
        required: ['actor', 'pendingDraws'],
        fields: Object.freeze({
            actor: Object.freeze({ type: 'enum', values: TELEMETRY_ACTORS }),
            pendingDraws: Object.freeze({ type: 'integer', min: 0, max: 999 }),
        }),
    }),
    'action.committed': Object.freeze({
        required: ['actor', 'action'],
        fields: Object.freeze({
            actor: Object.freeze({ type: 'enum', values: TELEMETRY_ACTORS }),
            action: Object.freeze({ type: 'enum', values: ['play', 'draw', 'auto-play'] }),
            definitionId: Object.freeze({ type: 'token', maxLength: 48, optional: true }),
        }),
    }),
    'action.rejected': Object.freeze({
        required: ['action', 'reason'],
        fields: Object.freeze({
            action: Object.freeze({ type: 'enum', values: ['play', 'draw', 'choice'] }),
            reason: Object.freeze({ type: 'token', maxLength: 48 }),
        }),
    }),
    'reconnect.started': Object.freeze({
        required: ['kind'],
        fields: Object.freeze({
            kind: Object.freeze({ type: 'enum', values: ['signal', 'data', 'unknown'] }),
            attempt: Object.freeze({ type: 'integer', min: 1, max: 20, optional: true }),
        }),
    }),
    'reconnect.completed': Object.freeze({
        required: ['kind'],
        fields: Object.freeze({ kind: Object.freeze({ type: 'enum', values: ['signal', 'data', 'seat', 'unknown'] }) }),
    }),
    'reconnect.failed': Object.freeze({
        required: ['kind'],
        fields: Object.freeze({ kind: Object.freeze({ type: 'enum', values: ['signal', 'data', 'seat', 'unknown'] }) }),
    }),
    'match.completed': Object.freeze({
        required: ['mode', 'outcome', 'winnerActor'],
        fields: Object.freeze({
            mode: Object.freeze({ type: 'enum', values: TELEMETRY_MODES }),
            outcome: Object.freeze({ type: 'enum', values: ['win', 'loss'] }),
            winnerActor: Object.freeze({ type: 'enum', values: TELEMETRY_ACTORS }),
        }),
    }),
    'rematch.prompted': Object.freeze({
        required: ['mode'],
        fields: Object.freeze({ mode: Object.freeze({ type: 'enum', values: TELEMETRY_MODES }) }),
    }),
    'rematch.ready': Object.freeze({
        required: ['mode'],
        fields: Object.freeze({ mode: Object.freeze({ type: 'enum', values: TELEMETRY_MODES }) }),
    }),
    'table.completed': Object.freeze({
        required: ['reason', 'completedMatches'],
        fields: Object.freeze({
            reason: Object.freeze({ type: 'token', maxLength: 48 }),
            completedMatches: Object.freeze({ type: 'integer', min: 0, max: 999 }),
        }),
    }),
    'majlis.list_viewed': Object.freeze({
        required: ['count'],
        fields: Object.freeze({ count: Object.freeze({ type: 'integer', min: 0, max: 8 }) }),
    }),
    'majlis.create_prompted': Object.freeze({
        required: ['humanSeats'],
        fields: Object.freeze({ humanSeats: Object.freeze({ type: 'integer', min: 2, max: 4 }) }),
    }),
    'majlis.created': Object.freeze({
        required: ['memberCount', 'groupToken'],
        fields: Object.freeze({
            memberCount: Object.freeze({ type: 'integer', min: 1, max: 4 }),
            groupToken: Object.freeze({ type: 'token', maxLength: 48 }),
        }),
    }),
    'majlis.join_accepted': Object.freeze({
        required: ['source', 'groupToken', 'memberCount'],
        fields: Object.freeze({
            source: Object.freeze({ type: 'enum', values: ['results'] }),
            groupToken: Object.freeze({ type: 'token', maxLength: 48 }),
            memberCount: Object.freeze({ type: 'integer', min: 1, max: 4 }),
        }),
    }),
    'majlis.regroup_started': Object.freeze({
        required: ['memberCount', 'groupToken'],
        fields: Object.freeze({
            memberCount: Object.freeze({ type: 'integer', min: 1, max: 4 }),
            groupToken: Object.freeze({ type: 'token', maxLength: 48 }),
        }),
    }),
    'majlis.session_started': Object.freeze({
        required: ['groupToken', 'sessionToken', 'humanSeats'],
        fields: Object.freeze({
            groupToken: Object.freeze({ type: 'token', maxLength: 48 }),
            sessionToken: Object.freeze({ type: 'token', maxLength: 48 }),
            humanSeats: Object.freeze({ type: 'integer', min: 1, max: 4 }),
        }),
    }),
    'majlis.session_completed': Object.freeze({
        required: ['groupToken', 'sessionToken'],
        fields: Object.freeze({
            groupToken: Object.freeze({ type: 'token', maxLength: 48 }),
            sessionToken: Object.freeze({ type: 'token', maxLength: 48 }),
        }),
    }),
    'majlis.invitation_scheduled': Object.freeze({
        required: ['leadMinutes', 'groupToken'],
        fields: Object.freeze({
            leadMinutes: Object.freeze({ type: 'integer', min: 15, max: 43200 }),
            groupToken: Object.freeze({ type: 'token', maxLength: 48 }),
        }),
    }),
    'majlis.reminder_changed': Object.freeze({
        required: ['enabled'],
        fields: Object.freeze({ enabled: Object.freeze({ type: 'boolean' }) }),
    }),
    'chat.phrase_sent': Object.freeze({
        required: ['phraseId'],
        fields: Object.freeze({
            phraseId: Object.freeze({ type: 'enum', values: [
                'salam', 'yalla', 'kafo', 'meh', 'good_game', 'one_more',
            ] }),
        }),
    }),
    'chat.player_muted': Object.freeze({
        required: ['muted'],
        fields: Object.freeze({ muted: Object.freeze({ type: 'boolean' }) }),
    }),
    'moderation.report_submitted': Object.freeze({
        required: ['reasonCode'],
        fields: Object.freeze({
            reasonCode: Object.freeze({ type: 'enum', values: [
                'spam', 'harassment', 'stalling', 'collusion',
            ] }),
        }),
    }),
    'catalog.viewed': Object.freeze({
        required: ['cardCount', 'unlockedCount'],
        fields: Object.freeze({
            cardCount: Object.freeze({ type: 'integer', min: 0, max: 256 }),
            unlockedCount: Object.freeze({ type: 'integer', min: 0, max: 256 }),
        }),
    }),
    'catalog.unlock': Object.freeze({
        required: ['result', 'definitionId'],
        fields: Object.freeze({
            result: Object.freeze({ type: 'enum', values: ['started', 'completed', 'failed'] }),
            definitionId: Object.freeze({ type: 'token', maxLength: 48 }),
            reason: Object.freeze({ type: 'token', maxLength: 48, optional: true }),
        }),
    }),
    'economy.balance_viewed': Object.freeze({
        required: ['balanceBand'],
        fields: Object.freeze({
            balanceBand: Object.freeze({ type: 'enum', values: [
                'zero', '1-499', '500-999', '1000-1999', '2000-4999', '5000-plus',
            ] }),
        }),
    }),
    'recipe.contribution_changed': Object.freeze({
        required: ['action', 'contributionCount'],
        fields: Object.freeze({
            action: Object.freeze({ type: 'enum', values: ['set', 'clear'] }),
            contributionCount: Object.freeze({ type: 'integer', min: 0, max: 4 }),
            definitionId: Object.freeze({ type: 'token', maxLength: 48, optional: true }),
        }),
    }),
    'experiment.exposed': Object.freeze({
        required: ['experimentId', 'variant'],
        fields: Object.freeze({
            experimentId: Object.freeze({ type: 'enum', values: [
                'p3_recent_majalis', 'p3_one_tap_reinvite',
                'p3_majlis_session_score', 'p3_majlis_schedule',
            ] }),
            variant: Object.freeze({ type: 'enum', values: ['control', 'treatment'] }),
            groupToken: Object.freeze({ type: 'token', maxLength: 48, optional: true }),
        }),
    }),
});

const TELEMETRY_FORBIDDEN_FIELDS = Object.freeze([
    'name', 'playername', 'roomcode', 'hand', 'cards', 'ip', 'ipaddress',
    'contacts', 'clipboard', 'idfa', 'email', 'phone', 'avatar', 'message',
]);

if (typeof window !== 'undefined') {
    window.PRODUCT_EVENT_SCHEMAS = PRODUCT_EVENT_SCHEMAS;
    window.TELEMETRY_FORBIDDEN_FIELDS = TELEMETRY_FORBIDDEN_FIELDS;
}
