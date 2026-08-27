'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TEMP_ROOT = fs.realpathSync(os.tmpdir());
const TEMP_DIR = fs.mkdtempSync(path.join(TEMP_ROOT, 'meh-phase0-'));
const EXCLUDED = new Set(['.git', 'node_modules']);

function assertTemporaryTarget(target) {
    const relative = path.relative(TEMP_ROOT, path.resolve(target));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Refusing to operate outside the temporary directory: ${target}`);
    }
}

function copySnapshot() {
    for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
        if (EXCLUDED.has(entry.name)) continue;
        fs.cpSync(path.join(ROOT, entry.name), path.join(TEMP_DIR, entry.name), {
            recursive: true,
            force: true,
        });
    }
}

function run(command, args, label, options = {}) {
    console.log(`\n== ${label} ==`);
    const result = spawnSync(command, args, {
        cwd: TEMP_DIR,
        stdio: options.capture ? 'pipe' : 'inherit',
        encoding: options.capture ? 'utf8' : undefined,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}.`);
    return result;
}

function runNpm(args, label) {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error('Run this check through "npm run check:clean".');
    run(process.execPath, [npmCli, ...args], label);
}

function assertGitClean() {
    const result = run('git', ['status', '--porcelain'], 'Verify clean isolated Git tree', { capture: true });
    if (result.stdout.trim()) {
        throw new Error(`Isolated Git tree is dirty:\n${result.stdout}`);
    }
}

assertTemporaryTarget(TEMP_DIR);
console.log(`Isolated snapshot: ${TEMP_DIR}`);

try {
    copySnapshot();
    run('git', ['init', '--quiet'], 'Initialize isolated Git tree');
    run('git', ['add', '--all'], 'Stage isolated snapshot');
    run('git', [
        '-c', 'user.name=Phase 0 Check',
        '-c', 'user.email=phase0-check@example.invalid',
        'commit', '--quiet', '-m', 'Isolated phase 0 snapshot',
    ], 'Commit isolated snapshot');
    assertGitClean();
    runNpm(['ci', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund'], 'Clean dependency install');
    runNpm(['run', 'check'], 'Full check in isolated snapshot');
    assertGitClean();
    console.log('\nIsolated clean-tree check passed.');
} finally {
    assertTemporaryTarget(TEMP_DIR);
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}
