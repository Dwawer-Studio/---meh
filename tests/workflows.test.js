'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const YAML = require('yaml');
const { ROOT } = require('./helpers/load-script');

const ciPath = path.join(ROOT, '.github', 'workflows', 'ci.yml');
const deployPath = path.join(ROOT, '.github', 'workflows', 'azure-static-web-apps-ashy-sky-0922a8610.yml');
const packageJson = require(path.join(ROOT, 'package.json'));
const packageLock = require(path.join(ROOT, 'package-lock.json'));

test('CI runs repository checks without coupling them to deployment', () => {
    assert.ok(fs.existsSync(ciPath), 'the test-only CI workflow must exist');
    const workflow = fs.readFileSync(ciPath, 'utf8');
    const parsedWorkflow = YAML.parse(workflow);

    assert.equal(parsedWorkflow.name, 'CI');
    assert.ok(parsedWorkflow.on.pull_request === null);
    assert.ok(parsedWorkflow.on.push);
    assert.match(workflow, /^name: CI$/m);
    assert.match(workflow, /^permissions:\s*\n\s+contents: read$/m);
    assert.match(workflow, /^\s{2}pull_request:$/m);
    assert.match(workflow, /^\s{2}push:$/m);
    assert.match(workflow, /hardening\/\*\*/);
    assert.match(workflow, /npm ci/);
    assert.match(workflow, /playwright install --with-deps chromium/);
    assert.match(workflow, /npm run check/);
    assert.doesNotMatch(workflow, /static-web-apps-deploy/i);
    assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
    assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/);
    assert.match(workflow, /node-version: 24\.8\.0/);
    assert.equal(packageJson.engines.node, '^22.22.0 || >=24.8.0');
    assert.equal(packageLock.packages[''].engines.node, packageJson.engines.node);
});

test('Azure deployment is retained as an explicit manual action only', () => {
    const workflow = fs.readFileSync(deployPath, 'utf8');
    const parsedWorkflow = YAML.parse(workflow);

    assert.ok(parsedWorkflow.on.workflow_dispatch);
    assert.match(workflow, /^\s{2}workflow_dispatch:$/m);
    assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request):$/m);
    assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
    assert.match(workflow, /Azure\/static-web-apps-deploy@1a947af9992250f3bc2e68ad0754c0b0c11566c9/);
    assert.match(workflow, /AZURE_STATIC_WEB_APPS_API_TOKEN_ASHY_SKY_0922A8610/);
    assert.doesNotMatch(workflow, /close_pull_request_job/);
});
