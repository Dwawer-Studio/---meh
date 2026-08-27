'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'coverage']);

function collectJavaScriptFiles(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...collectJavaScriptFiles(fullPath));
        else if (/\.(?:js|cjs|mjs)$/i.test(entry.name)) files.push(fullPath);
    }
    return files;
}

const files = collectJavaScriptFiles(ROOT).sort();
let failed = false;

for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
        encoding: 'utf8',
        cwd: ROOT,
    });
    if (result.status !== 0) {
        failed = true;
        process.stderr.write(`\nSyntax check failed: ${path.relative(ROOT, file)}\n`);
        process.stderr.write(result.stderr || result.stdout || 'Unknown syntax error\n');
    }
}

if (failed) process.exit(1);
console.log(`Syntax OK: ${files.length} JavaScript files.`);
