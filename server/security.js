'use strict';

const crypto = require('node:crypto');

const TOKEN_BYTES = 32;
const ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

function randomToken(prefix = '') {
    return `${prefix}${crypto.randomBytes(TOKEN_BYTES).toString('base64url')}`;
}

function randomId(prefix) {
    return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function hashSecret(secret, pepper = '') {
    if (typeof secret !== 'string' || secret.length < 16 || secret.length > 256) {
        throw new TypeError('Secret length is outside the accepted range');
    }
    return crypto.createHmac('sha256', pepper).update(secret, 'utf8').digest('base64url');
}

function safeEqual(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function validateProtocolId(value) {
    return typeof value === 'string' && ID_PATTERN.test(value);
}

function normalizeDisplayName(value) {
    if (typeof value !== 'string') return null;
    const name = value.normalize('NFKC').trim();
    if (!name || Array.from(name).length > 24 || /[\u0000-\u001f\u007f]/u.test(name)) return null;
    return name;
}

function ipHash(value, pepper) {
    return crypto.createHmac('sha256', pepper).update(String(value || 'unknown')).digest('base64url').slice(0, 22);
}

module.exports = {
    hashSecret,
    ipHash,
    normalizeDisplayName,
    randomId,
    randomToken,
    safeEqual,
    validateProtocolId,
};
