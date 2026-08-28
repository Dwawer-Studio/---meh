'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
    assertForwardCompatibleCatalog, canonicalJson, MAX_CATALOG_BYTES,
    validateCatalogManifest, verifySignedEnvelope,
} = require('../catalog/catalog-registry');
const { MEH_CATALOG_MANIFEST, MEH_CORE_MANIFEST } = require('../game/game-manifests');

function createSignedEnvelope(manifest, privateKey) {
    validateCatalogManifest(MEH_CORE_MANIFEST, manifest);
    assertForwardCompatibleCatalog(MEH_CATALOG_MANIFEST, manifest);
    const key = privateKey && privateKey.type === 'private' && privateKey.asymmetricKeyType
        ? privateKey
        : crypto.createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('CATALOG_KEY_MUST_BE_ED25519');
    return {
        algorithm: 'Ed25519',
        manifest,
        signature: crypto.sign(
            null, Buffer.from(canonicalJson(manifest)), key,
        ).toString('base64url'),
    };
}

function parseArguments(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        if (!['--manifest', '--private-key', '--out'].includes(key) || !value) {
            throw new Error('USAGE: --manifest <json> --private-key <pem> --out <json>');
        }
        result[key.slice(2)] = value;
    }
    if (!result.manifest || !result['private-key'] || !result.out) {
        throw new Error('USAGE: --manifest <json> --private-key <pem> --out <json>');
    }
    return result;
}

function main(argv = process.argv.slice(2)) {
    const args = parseArguments(argv);
    const manifestPath = path.resolve(args.manifest);
    const privateKeyPath = path.resolve(args['private-key']);
    const outputPath = path.resolve(args.out);
    if (outputPath === manifestPath || outputPath === privateKeyPath) {
        throw new Error('CATALOG_OUTPUT_MUST_NOT_OVERWRITE_INPUT');
    }
    if (fs.statSync(manifestPath).size > MAX_CATALOG_BYTES) throw new Error('CATALOG_TOO_LARGE');
    if (fs.statSync(privateKeyPath).size > 16 * 1024) throw new Error('CATALOG_PRIVATE_KEY_FILE_TOO_LARGE');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
    const envelope = createSignedEnvelope(manifest, privateKey);
    const publicKey = crypto.createPublicKey(privateKey);
    verifySignedEnvelope(envelope, publicKey);
    const serialized = `${JSON.stringify(envelope, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_CATALOG_BYTES) throw new Error('CATALOG_TOO_LARGE');
    fs.writeFileSync(outputPath, serialized, { flag: 'wx', mode: 0o600 });
    process.stdout.write(`Signed catalog ${manifest.catalogVersion} -> ${outputPath}\n`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = { createSignedEnvelope, main, parseArguments };
