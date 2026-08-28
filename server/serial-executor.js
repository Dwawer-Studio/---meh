'use strict';

class KeyedSerialExecutor {
    constructor(onDepth = null) {
        this.tails = new Map();
        this.depths = new Map();
        this.onDepth = onDepth;
    }

    async run(key, operation) {
        this.depths.set(key, (this.depths.get(key) || 0) + 1);
        if (this.onDepth) this.onDepth(this.totalDepth(), key);
        const previous = this.tails.get(key) || Promise.resolve();
        let release;
        const current = new Promise(resolve => { release = resolve; });
        this.tails.set(key, current);
        await previous.catch(() => {});
        try {
            return await operation();
        } finally {
            release();
            if (this.tails.get(key) === current) this.tails.delete(key);
            const depth = (this.depths.get(key) || 1) - 1;
            if (depth > 0) this.depths.set(key, depth);
            else this.depths.delete(key);
            if (this.onDepth) this.onDepth(this.totalDepth(), key);
        }
    }

    totalDepth() {
        let total = 0;
        for (const depth of this.depths.values()) total += depth;
        return total;
    }
}

module.exports = { KeyedSerialExecutor };
