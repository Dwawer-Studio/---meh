'use strict';

class ProductTelemetryClient {
    constructor(options = {}) {
        this.storage = options.storage || null;
        this.sink = typeof options.sink === 'function' ? options.sink : null;
        this.now = typeof options.now === 'function' ? options.now : () => Date.now();
        this.idFactory = typeof options.idFactory === 'function' ? options.idFactory : null;
        this.queueKey = options.queueKey || 'meh_telemetry_queue_v1';
        this.consentKey = options.consentKey || 'meh_telemetry_consent_v1';
        this.installKey = options.installKey || 'meh_telemetry_install_v1';
        this.maxQueueSize = Number.isSafeInteger(options.maxQueueSize) ? options.maxQueueSize : 5000;
        this.batchSize = Number.isSafeInteger(options.batchSize) ? options.batchSize : 50;
        this.buildVersion = options.buildVersion || '0.1.0-dev';
        this._idSequence = 0;
        this._flushPromise = null;
        this.queue = [];
        this._queuedIds = new Set();
        this.appSessionId = this._newId('app');
        this.consent = this._readConsent(options.consent);
        this.installId = this.consent === 'granted' ? this._loadOrCreateInstallId() : null;
        if (this.consent === 'granted') this._loadQueue();
    }

    _storageGet(key) {
        try { return this.storage && this.storage.getItem ? this.storage.getItem(key) : null; }
        catch (error) { return null; }
    }

    _storageSet(key, value) {
        try {
            if (!this.storage || !this.storage.setItem) return false;
            this.storage.setItem(key, value);
            return true;
        } catch (error) { return false; }
    }

    _storageRemove(key) {
        try {
            if (!this.storage || !this.storage.removeItem) return false;
            this.storage.removeItem(key);
            return true;
        } catch (error) { return false; }
    }

    _readConsent(explicitConsent) {
        if (['granted', 'denied', 'unknown'].includes(explicitConsent)) return explicitConsent;
        const stored = this._storageGet(this.consentKey);
        return stored === 'granted' || stored === 'denied' ? stored : 'unknown';
    }

    _newId(prefix) {
        if (this.idFactory) return this.idFactory(prefix, this._idSequence++);
        const cryptoObject = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
        if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
            return `${prefix}-${cryptoObject.randomUUID()}`;
        }
        const now = Math.max(0, Number(this.now()) || 0).toString(36);
        const sequence = (this._idSequence++).toString(36).padStart(3, '0');
        const entropy = Math.floor(Math.random() * 0x100000000).toString(36).padStart(7, '0');
        return `${prefix}-${now}-${sequence}-${entropy}`;
    }

    _loadOrCreateInstallId() {
        const stored = this._storageGet(this.installKey);
        if (typeof stored === 'string' && /^install-[a-zA-Z0-9-]{8,100}$/.test(stored)) return stored;
        const created = this._newId('install');
        this._storageSet(this.installKey, created);
        return created;
    }

    _loadQueue() {
        let parsed;
        try { parsed = JSON.parse(this._storageGet(this.queueKey) || '[]'); }
        catch (error) { parsed = []; }
        if (!Array.isArray(parsed)) parsed = [];
        for (const event of parsed.slice(-this.maxQueueSize)) {
            if (!event || typeof event !== 'object' || typeof event.eventId !== 'string') continue;
            if (this._queuedIds.has(event.eventId) || !Object.hasOwn(PRODUCT_EVENT_SCHEMAS, event.name)) continue;
            this.queue.push(event);
            this._queuedIds.add(event.eventId);
        }
        this._persistQueue();
    }

    _persistQueue() {
        if (this.consent !== 'granted') return false;
        return this._storageSet(this.queueKey, JSON.stringify(this.queue));
    }

    _hasForbiddenField(value) {
        if (!value || typeof value !== 'object') return false;
        for (const [key, nested] of Object.entries(value)) {
            const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
            if (TELEMETRY_FORBIDDEN_FIELDS.includes(normalized)) return true;
            if (nested && typeof nested === 'object' && this._hasForbiddenField(nested)) return true;
        }
        return false;
    }

    _validField(value, rule) {
        if (rule.optional && value === undefined) return true;
        if (rule.type === 'boolean') return typeof value === 'boolean';
        if (rule.type === 'integer') {
            return Number.isSafeInteger(value) && value >= rule.min && value <= rule.max;
        }
        if (rule.type === 'enum') return typeof value === 'string' && rule.values.includes(value);
        if (rule.type === 'token') {
            return typeof value === 'string'
                && value.length >= 1
                && value.length <= rule.maxLength
                && /^[a-zA-Z0-9_.-]+$/.test(value);
        }
        return false;
    }

    validate(name, properties) {
        const schema = PRODUCT_EVENT_SCHEMAS[name];
        if (!schema || !properties || typeof properties !== 'object' || Array.isArray(properties)) return false;
        if (this._hasForbiddenField(properties)) return false;
        const keys = Object.keys(properties);
        if (keys.some(key => !Object.hasOwn(schema.fields, key))) return false;
        if (schema.required.some(key => !Object.hasOwn(properties, key))) return false;
        return keys.every(key => this._validField(properties[key], schema.fields[key]));
    }

    setConsent(consent) {
        if (!['granted', 'denied', 'unknown'].includes(consent)) throw new TypeError('Invalid telemetry consent');
        this.consent = consent;
        if (consent === 'granted') {
            this._storageSet(this.consentKey, consent);
            this.installId = this.installId || this._loadOrCreateInstallId();
            this._loadQueue();
        } else {
            if (consent === 'denied') this._storageSet(this.consentKey, consent);
            else this._storageRemove(this.consentKey);
            this.queue = [];
            this._queuedIds.clear();
            this.installId = null;
            this._storageRemove(this.queueKey);
            this._storageRemove(this.installKey);
        }
        return this.consent;
    }

    setSink(sink) {
        if (sink !== null && typeof sink !== 'function') throw new TypeError('Telemetry sink must be a function');
        this.sink = sink;
    }

    track(name, properties) {
        if (this.consent !== 'granted' || !this.validate(name, properties)) return false;
        const event = {
            eventId: this._newId('event'),
            schemaVersion: 1,
            name,
            occurredAt: this.now(),
            buildVersion: this.buildVersion,
            rulesVersion: MEH_CORE_MANIFEST.rulesVersion,
            catalogVersion: MEH_CATALOG_MANIFEST.catalogVersion,
            deckRecipeId: MEH_CATALOG_MANIFEST.activeRecipeId,
            installId: this.installId,
            appSessionId: this.appSessionId,
            properties: JSON.parse(JSON.stringify(properties)),
        };
        if (this._queuedIds.has(event.eventId)) return false;
        this.queue.push(event);
        this._queuedIds.add(event.eventId);
        while (this.queue.length > this.maxQueueSize) {
            const removed = this.queue.shift();
            this._queuedIds.delete(removed.eventId);
        }
        this._persistQueue();
        if (this.sink && this.queue.length >= this.batchSize) void this.flush();
        return true;
    }

    async flush() {
        if (this.consent !== 'granted') return { status: 'disabled', sent: 0 };
        if (!this.sink) return { status: 'no-sink', sent: 0 };
        if (this._flushPromise) return this._flushPromise;
        const batch = this.queue.slice(0, this.batchSize);
        if (!batch.length) return { status: 'empty', sent: 0 };
        this._flushPromise = Promise.resolve()
            .then(() => this.sink(batch.map(event => JSON.parse(JSON.stringify(event)))))
            .then(result => {
                if (result === false) return { status: 'retained', sent: 0 };
                const sentIds = new Set(batch.map(event => event.eventId));
                this.queue = this.queue.filter(event => !sentIds.has(event.eventId));
                sentIds.forEach(id => this._queuedIds.delete(id));
                this._persistQueue();
                return { status: 'sent', sent: batch.length };
            })
            .catch(() => ({ status: 'retained', sent: 0 }))
            .finally(() => { this._flushPromise = null; });
        return this._flushPromise;
    }

    export() {
        return {
            exportSchemaVersion: 1,
            rulesVersion: MEH_CORE_MANIFEST.rulesVersion,
            catalogVersion: MEH_CATALOG_MANIFEST.catalogVersion,
            exportedAt: this.now(),
            consent: this.consent,
            events: this.queue.map(event => JSON.parse(JSON.stringify(event))),
        };
    }

    clearLocalData() {
        this.queue = [];
        this._queuedIds.clear();
        this._storageRemove(this.queueKey);
        this._storageRemove(this.installKey);
        this.installId = this.consent === 'granted' ? this._loadOrCreateInstallId() : null;
    }
}

function safeBrowserStorage() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; }
    catch (error) { return null; }
}

const runtimeConsent = typeof window !== 'undefined' ? window.MEH_TELEMETRY_CONSENT : undefined;
const runtimeBuildVersion = typeof window !== 'undefined' ? window.MEH_BUILD_VERSION : undefined;
const ProductTelemetry = new ProductTelemetryClient({
    storage: safeBrowserStorage(),
    consent: runtimeConsent,
    buildVersion: runtimeBuildVersion || '0.1.0-dev',
});

if (typeof window !== 'undefined') {
    window.ProductTelemetryClient = ProductTelemetryClient;
    window.ProductTelemetry = ProductTelemetry;
}
