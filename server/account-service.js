'use strict';

const crypto = require('node:crypto');
const {
    hashSecret, normalizeDisplayName, randomId, randomToken,
} = require('./security');

class AccountService {
    constructor(store, options = {}) {
        this.store = store;
        this.pepper = options.pepper || '';
        this.sessionTtlMs = options.sessionTtlMs || 30 * 24 * 60 * 60 * 1000;
        this.tombstoneTtlMs = options.tombstoneTtlMs || 400 * 24 * 60 * 60 * 1000;
        this.now = options.now || Date.now;
    }

    async createGuest(displayName) {
        const name = normalizeDisplayName(displayName);
        if (!name) throw new TypeError('INVALID_DISPLAY_NAME');
        const nowMs = this.now();
        const account = {
            accountId: randomId('acct'),
            accountKind: 'guest',
            displayName: name,
            credentialHash: null,
            settings: {},
            syncRevision: 0,
            createdAt: new Date(nowMs).toISOString(),
            upgradedAt: null,
            deletedAt: null,
        };
        await this.store.createAccount(account);
        const session = await this._issueSession(account.accountId, nowMs);
        return { account: this._publicAccount(account), ...session };
    }

    async authenticate(accessToken) {
        if (typeof accessToken !== 'string') return null;
        const result = await this.store.authenticateSession(hashSecret(accessToken, this.pepper), this.now());
        return result ? { session: result.session, account: this._publicAccount(result.account) } : null;
    }

    async upgrade(accountId, credential, displayName) {
        const name = normalizeDisplayName(displayName);
        if (!name || typeof credential !== 'string' || credential.length < 12 || credential.length > 256) {
            throw new TypeError('INVALID_UPGRADE');
        }
        const upgradedAt = new Date(this.now()).toISOString();
        const salt = crypto.randomBytes(16).toString('base64url');
        const credentialHash = await new Promise((resolve, reject) => {
            crypto.scrypt(credential, salt, 64, { N: 16384, r: 8, p: 1 }, (error, derived) => {
                if (error) reject(error);
                else resolve(`scrypt$16384$8$1$${salt}$${derived.toString('base64url')}`);
            });
        });
        const account = await this.store.upgradeAccount(accountId, { credentialHash, displayName: name, upgradedAt });
        return this._publicAccount(account);
    }

    async login(accountId, credential) {
        if (typeof accountId !== 'string' || !/^acct_[A-Za-z0-9_-]{16,}$/.test(accountId)
            || typeof credential !== 'string' || credential.length < 12 || credential.length > 256) {
            throw new TypeError('INVALID_CREDENTIALS');
        }
        const account = await this.store.getAccount(accountId);
        const valid = await this._verifyCredential(credential, account && account.credentialHash);
        if (!account || account.accountKind !== 'registered' || !valid) {
            throw new TypeError('INVALID_CREDENTIALS');
        }
        const session = await this._issueSession(account.accountId, this.now());
        return { account: this._publicAccount(account), ...session };
    }

    async deleteAccount(accountId) {
        const nowMs = this.now();
        const subjectHash = crypto.createHmac('sha256', this.pepper).update(accountId).digest('base64url');
        return this.store.deleteAccount(accountId, {
            subjectHash,
            deletedAt: new Date(nowMs).toISOString(),
            expiresAt: new Date(nowMs + this.tombstoneTtlMs).toISOString(),
        }, new Date(nowMs).toISOString());
    }

    async updateSettings(accountId, input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('INVALID_SETTINGS');
        const settings = {};
        const booleanKeys = ['colorblind', 'batterySaver', 'wakeLock', 'confirmPlay', 'sound', 'haptics'];
        if (input.lang !== undefined) {
            if (!['ar', 'en'].includes(input.lang)) throw new TypeError('INVALID_SETTINGS');
            settings.lang = input.lang;
        }
        for (const key of booleanKeys) {
            if (input[key] !== undefined) {
                if (typeof input[key] !== 'boolean') throw new TypeError('INVALID_SETTINGS');
                settings[key] = input[key];
            }
        }
        if (Object.keys(settings).length !== Object.keys(input).length) throw new TypeError('INVALID_SETTINGS');
        const account = await this.store.getAccount(accountId);
        if (!account) throw new TypeError('ACCOUNT_NOT_FOUND');
        return this._publicAccount(await this.store.updateAccountSettings(accountId, {
            ...(account.settings || {}),
            ...settings,
        }));
    }

    async syncState(accountId) {
        const account = await this.store.getAccount(accountId);
        if (!account) throw new TypeError('ACCOUNT_NOT_FOUND');
        return {
            account: this._publicAccount(account),
            majalis: await this.store.listAccountMajalis(accountId),
        };
    }

    async _issueSession(accountId, nowMs) {
        const accessToken = randomToken('access_');
        const session = {
            sessionId: randomId('sess'),
            accountId,
            tokenHash: hashSecret(accessToken, this.pepper),
            createdAt: new Date(nowMs).toISOString(),
            expiresAt: new Date(nowMs + this.sessionTtlMs).toISOString(),
            revokedAt: null,
        };
        await this.store.createSession(session);
        return { accessToken, expiresAt: session.expiresAt };
    }

    async _verifyCredential(credential, encoded) {
        const match = typeof encoded === 'string'
            && encoded.match(/^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/);
        const salt = match ? match[4] : 'invalid-account-fixed-salt';
        const expected = match ? Buffer.from(match[5], 'base64url') : Buffer.alloc(64);
        const parameters = match
            ? { N: Number(match[1]), r: Number(match[2]), p: Number(match[3]) }
            : { N: 16384, r: 8, p: 1 };
        if (expected.length !== 64 || parameters.N !== 16384 || parameters.r !== 8 || parameters.p !== 1) {
            return false;
        }
        const derived = await new Promise((resolve, reject) => {
            crypto.scrypt(credential, salt, 64, parameters, (error, value) => {
                if (error) reject(error);
                else resolve(value);
            });
        });
        return crypto.timingSafeEqual(derived, expected);
    }

    _publicAccount(account) {
        return {
            accountId: account.accountId,
            accountKind: account.accountKind,
            displayName: account.displayName,
            settings: account.settings || {},
            syncRevision: Number(account.syncRevision || 0),
        };
    }
}

module.exports = { AccountService };
