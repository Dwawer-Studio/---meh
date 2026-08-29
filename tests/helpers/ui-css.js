'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./load-script');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const PRODUCTION_STYLESHEETS = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/g)]
    .map(match => match[1])
    .filter(reference => !/^https?:/i.test(reference));

function readUiCss() {
    return PRODUCTION_STYLESHEETS
        .map(relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8'))
        .join('\n');
}

module.exports = { PRODUCTION_STYLESHEETS, readUiCss };
