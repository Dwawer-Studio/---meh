'use strict';

class TokenBucketLimiter {
    constructor(options = {}) {
        this.capacity = options.capacity || 8;
        this.refillPerSecond = options.refillPerSecond || 4;
        this.idleTtlMs = options.idleTtlMs || 120_000;
        this.buckets = new Map();
    }

    consume(key, nowMs = Date.now(), cost = 1) {
        const current = this.buckets.get(key) || { tokens: this.capacity, updatedAt: nowMs };
        const elapsedSeconds = Math.max(0, nowMs - current.updatedAt) / 1000;
        current.tokens = Math.min(this.capacity, current.tokens + elapsedSeconds * this.refillPerSecond);
        current.updatedAt = nowMs;
        const allowed = current.tokens >= cost;
        if (allowed) current.tokens -= cost;
        this.buckets.set(key, current);
        return {
            allowed,
            retryAfterMs: allowed ? 0 : Math.ceil(((cost - current.tokens) / this.refillPerSecond) * 1000),
            remaining: Math.max(0, Math.floor(current.tokens)),
        };
    }

    prune(nowMs = Date.now()) {
        let removed = 0;
        for (const [key, bucket] of this.buckets) {
            if (nowMs - bucket.updatedAt > this.idleTtlMs) {
                this.buckets.delete(key);
                removed++;
            }
        }
        return removed;
    }
}

module.exports = { TokenBucketLimiter };
