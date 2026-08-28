'use strict';

class ServiceMetrics {
    constructor() {
        this.counters = new Map();
        this.gauges = new Map();
        this.samples = new Map();
    }

    increment(name, labels = {}, amount = 1) {
        const key = this._key(name, labels);
        this.counters.set(key, (this.counters.get(key) || 0) + amount);
    }

    gauge(name, value, labels = {}) {
        this.gauges.set(this._key(name, labels), Number(value));
    }

    observe(name, value, labels = {}) {
        const key = this._key(name, labels);
        const values = this.samples.get(key) || [];
        values.push(Number(value));
        if (values.length > 10_000) values.splice(0, values.length - 10_000);
        this.samples.set(key, values);
    }

    snapshot() {
        const percentiles = {};
        for (const [key, values] of this.samples) {
            const sorted = [...values].sort((a, b) => a - b);
            const pick = percentile => sorted.length
                ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1)]
                : null;
            percentiles[key] = { count: sorted.length, p50: pick(0.5), p95: pick(0.95), p99: pick(0.99) };
        }
        return {
            counters: Object.fromEntries(this.counters),
            gauges: Object.fromEntries(this.gauges),
            percentiles,
        };
    }

    _key(name, labels) {
        const suffix = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${String(value)}`).join(',');
        return suffix ? `${name}{${suffix}}` : name;
    }
}

module.exports = { ServiceMetrics };
