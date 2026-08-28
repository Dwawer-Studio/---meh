'use strict';

const crypto = require('node:crypto');

const BACKUP_FORMAT = 'meh.logical.aes256gcm.v1';

function deriveKey(passphrase, salt) {
    if (typeof passphrase !== 'string' || passphrase.length < 24) {
        throw new TypeError('Backup passphrase must contain at least 24 characters');
    }
    return crypto.scryptSync(passphrase, salt, 32, {
        N: 32768,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
    });
}

class BackupService {
    constructor(store, options = {}) {
        this.store = store;
        this.now = options.now || Date.now;
    }

    async createEncrypted(passphrase) {
        const logical = await this.store.exportLogicalBackup(new Date(this.now()).toISOString());
        const salt = crypto.randomBytes(16);
        const nonce = crypto.randomBytes(12);
        const key = deriveKey(passphrase, salt);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
        cipher.setAAD(Buffer.from(BACKUP_FORMAT));
        const plaintext = Buffer.from(JSON.stringify(logical), 'utf8');
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return Buffer.from(JSON.stringify({
            format: BACKUP_FORMAT,
            salt: salt.toString('base64url'),
            nonce: nonce.toString('base64url'),
            tag: cipher.getAuthTag().toString('base64url'),
            ciphertext: ciphertext.toString('base64url'),
        }), 'utf8');
    }

    async restoreEncrypted(buffer, passphrase) {
        let envelope;
        try {
            envelope = JSON.parse(Buffer.from(buffer).toString('utf8'));
        } catch (error) {
            throw new Error('INVALID_BACKUP_ENVELOPE');
        }
        if (!envelope || envelope.format !== BACKUP_FORMAT) throw new Error('INVALID_BACKUP_FORMAT');
        try {
            const salt = Buffer.from(envelope.salt, 'base64url');
            const nonce = Buffer.from(envelope.nonce, 'base64url');
            const tag = Buffer.from(envelope.tag, 'base64url');
            const ciphertext = Buffer.from(envelope.ciphertext, 'base64url');
            const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), nonce);
            decipher.setAAD(Buffer.from(BACKUP_FORMAT));
            decipher.setAuthTag(tag);
            const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
            return await this.store.restoreLogicalBackup(JSON.parse(plaintext.toString('utf8')));
        } catch (error) {
            if (error && error.code) throw error;
            throw new Error('BACKUP_AUTHENTICATION_FAILED');
        }
    }
}

module.exports = { BACKUP_FORMAT, BackupService };
