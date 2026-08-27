'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ROOT } = require('./helpers/load-script');

const ciPath = path.join(ROOT, '.github', 'workflows', 'ci.yml');
const deployPath = path.join(ROOT, '.github', 'workflows', 'azure-static-web-apps-ashy-sky-0922a8610.yml');

test('CI runs repository checks without coupling them to deployment', () => {
    assert.ok(fs.existsSync(ciPath), 'the test-only CI workflow must exist');
    const workflow = fs.readFileSync(ciPath, 'utf8');

    assert.match(workflow, /^name: CI$/m);
    assert.match(workflow, /^permissions:\s*\n\s+contents: read$/m);
    assert.match(workflow, /^\s{2}pull_request:$/m);
    assert.match(workflow, /^\s{2}push:$/m);
    assert.match(workflow, /hardening\/\*\*/);
    assert.match(workflow, /npm ci/);
    assert.match(workflow, /npm run check/);
    assert.doesNotMatch(workflow, /static-web-apps-deploy/i);
    assert.match(workflow, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
    assert.match(workflow, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
});

test('Azure deployment is retained as an explicit manual action only', () => {
    const workflow = fs.readFileSync(deployPath, 'utf8');

    assert.match(workflow, /^\s{2}workflow_dispatch:$/m);
    assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request):$/m);
    assert.match(workflow, /Azure\/static-web-apps-deploy@1a947af9992250f3bc2e68ad0754c0b0c11566c9/);
    assert.match(workflow, /AZURE_STATIC_WEB_APPS_API_TOKEN_ASHY_SKY_0922A8610/);
    assert.doesNotMatch(workflow, /close_pull_request_job/);
});
