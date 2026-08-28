'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function run(command, args, label) {
    console.log(`\n== ${label} ==`);
    const result = spawnSync(command, args, {
        cwd: ROOT,
        stdio: 'inherit',
    });
    if (result.status !== 0) process.exit(result.status || 1);
}

function runNode(args, label) {
    run(process.execPath, args, label);
}

runNode(['tools/check-syntax.js'], 'JavaScript syntax');
runNode(['node_modules/html-validate/bin/html-validate.mjs', 'index.html'], 'HTML standards validation');
runNode(['node_modules/stylelint/bin/stylelint.mjs', 'style.css'], 'CSS standards validation');
runNode(['--test'], 'Baseline tests');
runNode(['node_modules/@playwright/test/cli.js', 'test'], 'Browser end-to-end tests');
console.log('\nAll repository checks passed.');
