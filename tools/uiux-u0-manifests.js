'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const writeMode = process.argv.includes('--write');

function normalized(relativePath) {
    return relativePath.split(path.sep).join('/');
}

function filesUnder(relativeDir, predicate = () => true) {
    const absoluteDir = path.join(root, relativeDir);
    const results = [];
    const visit = current => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const absolute = path.join(current, entry.name);
            if (entry.isDirectory()) visit(absolute);
            else if (entry.isFile() && predicate(absolute)) results.push(absolute);
        }
    };
    visit(absoluteDir);
    return results.sort((left, right) => left.localeCompare(right, 'en'));
}

function digest(absolutePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
}

function hashManifest(absolutePaths) {
    return `${absolutePaths.map(absolute => {
        const relative = normalized(path.relative(root, absolute));
        return `${digest(absolute)}  ${relative}`;
    }).join('\n')}\n`;
}

function jpegSize(buffer) {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
        throw new Error('Expected a JPEG screenshot');
    }
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 8 < buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset++;
            continue;
        }
        const marker = buffer[offset + 1];
        offset += 2;
        if (marker === 0xd8 || marker === 0xd9) continue;
        const length = buffer.readUInt16BE(offset);
        if (startOfFrame.has(marker)) {
            return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
        }
        if (length < 2) throw new Error(`Invalid JPEG marker length: ${length}`);
        offset += length;
    }
    throw new Error('JPEG dimensions were not found');
}

function screenshotRecords(relativeDir) {
    return filesUnder(relativeDir, absolute => absolute.toLowerCase().endsWith('.jpg')).map(absolute => {
        const buffer = fs.readFileSync(absolute);
        return {
            file: normalized(path.relative(root, absolute)),
            sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
            bytes: buffer.length,
            ...jpegSize(buffer)
        };
    });
}

function expectedOutputs() {
    const cardFiles = filesUnder('assets/cards');
    const brandFiles = [
        ...filesUnder('assets/brand'),
        ...filesUnder('assets/fonts/ibm-plex-sans-arabic')
    ].sort((left, right) => left.localeCompare(right, 'en'));
    const protectedFiles = [
        'deck.js',
        'catalog/catalog-registry.js',
        'shared/match-reducer.js'
    ].map(relative => path.join(root, relative));
    const screenshots = {
        schemaVersion: 1,
        baseline: screenshotRecords('artifacts/uiux-u0/baseline'),
        reference: screenshotRecords('artifacts/uiux-u0/reference')
    };

    return new Map([
        ['docs/uiux-u0/card-assets.sha256', hashManifest(cardFiles)],
        ['docs/uiux-u0/brand-and-font-assets.sha256', hashManifest(brandFiles)],
        ['docs/uiux-u0/protected-files.sha256', hashManifest(protectedFiles)],
        ['artifacts/uiux-u0/screenshot-manifest.json', `${JSON.stringify(screenshots, null, 2)}\n`]
    ]);
}

function apply(outputs) {
    for (const [relative, content] of outputs) {
        const absolute = path.join(root, relative);
        if (writeMode) {
            fs.mkdirSync(path.dirname(absolute), { recursive: true });
            fs.writeFileSync(absolute, content, 'utf8');
            continue;
        }
        if (!fs.existsSync(absolute)) throw new Error(`Missing generated UIX-0 manifest: ${relative}`);
        if (fs.readFileSync(absolute, 'utf8') !== content) throw new Error(`Stale UIX-0 manifest: ${relative}`);
    }
}

const outputs = expectedOutputs();
apply(outputs);
console.log(`${writeMode ? 'Wrote' : 'Verified'} ${outputs.size} UIX-0 manifests.`);
