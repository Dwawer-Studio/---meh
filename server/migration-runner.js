'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function migrationFiles(directory) {
    return fs.readdirSync(directory)
        .filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
        .sort()
        .map(name => {
            const sql = fs.readFileSync(path.join(directory, name), 'utf8');
            return { name, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') };
        });
}

async function runMigrations(pool, directory = path.join(__dirname, 'migrations')) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
            migration_name text PRIMARY KEY,
            checksum text NOT NULL,
            applied_at timestamptz NOT NULL DEFAULT now()
        )`);
        for (const migration of migrationFiles(directory)) {
            const result = await client.query(
                'SELECT checksum FROM schema_migrations WHERE migration_name = $1',
                [migration.name],
            );
            if (result.rows.length) {
                if (result.rows[0].checksum !== migration.checksum) {
                    throw new Error(`Applied migration checksum changed: ${migration.name}`);
                }
                continue;
            }
            await client.query(migration.sql);
            await client.query(
                'INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, $2)',
                [migration.name, migration.checksum],
            );
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { migrationFiles, runMigrations };
