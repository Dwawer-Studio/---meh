'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CLIENT = path.join(DIST, 'client');
const SERVER = path.join(DIST, 'server');
const DIRECTORIES = ['assets', 'catalog', 'game', 'product', 'shared', 'ui', 'vendor'];
const FILES = [
    'index.html', 'deck.js', 'features.js', 'game.js', 'i18n.js',
    'net.js', 'script.js', 'sound.js', 'storage.js',
];

async function copyTree(source, destination) {
    await fs.mkdir(destination, { recursive: true });
    const entries = await fs.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
        const from = path.join(source, entry.name);
        const to = path.join(destination, entry.name);
        if (entry.isDirectory()) await copyTree(from, to);
        else if (entry.isFile()) await fs.copyFile(from, to);
        else throw new Error(`Unsupported runtime entry: ${from}`);
    }
}

async function build() {
    await fs.mkdir(CLIENT, { recursive: true });
    await fs.mkdir(SERVER, { recursive: true });
    for (const directory of DIRECTORIES) {
        await copyTree(path.join(ROOT, directory), path.join(CLIENT, directory));
    }
    for (const file of FILES) {
        await fs.copyFile(path.join(ROOT, file), path.join(CLIENT, file));
    }
    await fs.copyFile(path.join(ROOT, 'hosting', 'worker.js'), path.join(SERVER, 'index.js'));
    await fs.access(path.join(DIST, '.openai', 'hosting.json'));
    await fs.access(path.join(CLIENT, 'assets', 'cards', 'card-back.webp'));
    await fs.access(path.join(SERVER, 'index.js'));
}

build().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
