'use strict';

const { validateProtocolId } = require('./security');

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 16 * 1024;
const CLIENT_TYPES = new Set([
    'session.hello', 'room.create', 'room.join', 'seat.resume', 'seat.ready',
    'match.action', 'snapshot.request', 'seat.leave', 'majlis.create', 'majlis.accept',
    'chat.send', 'report.submit', 'recipe.contribute',
]);

class ProtocolError extends Error {
    constructor(code, details = null) {
        super(code);
        this.name = 'ProtocolError';
        this.code = code;
        this.details = details;
    }
}

function parseClientMessage(raw) {
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    if (bytes.length > MAX_MESSAGE_BYTES) throw new ProtocolError('MESSAGE_TOO_LARGE');
    let message;
    try {
        message = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
        throw new ProtocolError('BAD_JSON');
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new ProtocolError('BAD_ENVELOPE');
    if (message.v !== PROTOCOL_VERSION) throw new ProtocolError('BAD_VERSION');
    if (!CLIENT_TYPES.has(message.type)) throw new ProtocolError('BAD_TYPE');
    if (!validateProtocolId(message.requestId)) throw new ProtocolError('BAD_REQUEST_ID');
    if (!Number.isSafeInteger(message.clientSeq) || message.clientSeq < 1) throw new ProtocolError('BAD_SEQUENCE');
    if (!Number.isSafeInteger(message.lastServerSeq) || message.lastServerSeq < 0) {
        throw new ProtocolError('BAD_SERVER_SEQUENCE');
    }
    if (!message.payload || typeof message.payload !== 'object' || Array.isArray(message.payload)) {
        throw new ProtocolError('BAD_PAYLOAD');
    }
    return message;
}

function serverMessage(type, options = {}) {
    const message = {
        v: PROTOCOL_VERSION,
        type,
        serverSeq: options.serverSeq || 0,
        payload: options.payload || {},
    };
    if (options.ackRequestId) message.ackRequestId = options.ackRequestId;
    if (Number.isSafeInteger(options.stateVersion)) message.stateVersion = options.stateVersion;
    if (options.stateFingerprint) message.stateFingerprint = options.stateFingerprint;
    return message;
}

module.exports = {
    CLIENT_TYPES,
    MAX_MESSAGE_BYTES,
    PROTOCOL_VERSION,
    ProtocolError,
    parseClientMessage,
    serverMessage,
};
