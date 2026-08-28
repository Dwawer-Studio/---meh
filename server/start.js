'use strict';

const { Pool } = require('pg');
const { runMigrations } = require('./migration-runner');
const { RealtimeRuntime } = require('./runtime');
const { MemoryStore } = require('./stores/memory-store');
const { PostgresStore } = require('./stores/postgres-store');

async function main() {
    const production = process.env.NODE_ENV === 'production';
    const pepper = process.env.MEH_APP_SECRET;
    if (!pepper || pepper.length < 32) throw new Error('MEH_APP_SECRET must contain at least 32 characters');
    const internalAdminToken = process.env.MEH_INTERNAL_ADMIN_TOKEN || null;
    if (production && (!internalAdminToken || internalAdminToken.length < 32)) {
        throw new Error('MEH_INTERNAL_ADMIN_TOKEN must contain at least 32 characters in production');
    }
    let store;
    let pool = null;
    if (process.env.DATABASE_URL) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: Number(process.env.PG_POOL_MAX || 10),
            ssl: process.env.PG_SSL === 'disable' ? false : { rejectUnauthorized: true },
        });
        await runMigrations(pool);
        store = new PostgresStore(pool);
    } else {
        if (production) throw new Error('DATABASE_URL is mandatory in production');
        store = new MemoryStore();
    }
    const allowedOrigins = String(process.env.MEH_ALLOWED_ORIGINS || 'http://127.0.0.1:4173')
        .split(',').map(value => value.trim()).filter(Boolean);
    const runtime = new RealtimeRuntime({
        store,
        pepper,
        allowedOrigins,
        requireTls: production,
        trustProxy: process.env.MEH_TRUST_PROXY === 'true',
        internalAdminToken,
    });
    const port = Number(process.env.PORT || 8787);
    const host = process.env.HOST || '127.0.0.1';
    await runtime.listen(port, host);
    process.stdout.write(`Meh authoritative service listening on ${host}:${port}\n`);
    const shutdown = async () => {
        await runtime.close();
        if (pool) await pool.end();
    };
    process.once('SIGINT', () => shutdown().finally(() => process.exit(0)));
    process.once('SIGTERM', () => shutdown().finally(() => process.exit(0)));
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = { main };
