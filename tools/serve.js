'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number.parseInt(process.env.MEH_PORT || '4173', 10);
const TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webp': 'image/webp',
};

function resolveRequestPath(requestUrl) {
    const url = new URL(requestUrl, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const target = path.resolve(ROOT, `.${pathname}`);
    const relative = path.relative(ROOT, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return target;
}

const server = http.createServer((request, response) => {
    let target;
    try {
        target = resolveRequestPath(request.url || '/');
    } catch (error) {
        response.writeHead(400).end('Bad request');
        return;
    }
    if (!target) {
        response.writeHead(403).end('Forbidden');
        return;
    }

    fs.stat(target, (error, stats) => {
        if (error || !stats.isFile()) {
            response.writeHead(404).end('Not found');
            return;
        }
        response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
        });
        fs.createReadStream(target).pipe(response);
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Meh development server: http://127.0.0.1:${PORT}`);
});
