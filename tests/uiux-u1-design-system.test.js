'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const exists = relativePath => fs.existsSync(path.join(ROOT, relativePath));

const productionHtml = read('index.html');
const fixtureHtml = read('ui/fixture/index.html');
const tokensCss = read('ui/tokens.css');
const foundationsCss = read('ui/foundations.css');
const componentsCss = read('ui/components.css');
const motionCss = read('ui/motion.css');
const accessibilityCss = read('ui/accessibility.css');
const fixtureJs = read('ui/fixture/fixture.js');
const icons = read('assets/ui/icons.svg');
const contract = JSON.parse(read('docs/uiux-u0/tokens.json'));

function parseCssVariables(source) {
    return Object.fromEntries([...source.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)]
        .map(match => [match[1], match[2].trim()]));
}

function luminance(hex) {
    const channels = hex.slice(1).match(/../g).map(value => Number.parseInt(value, 16) / 255);
    const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

test('UIX-1 production loads the shared design system in dependency order', () => {
    const expected = [
        'ui/tokens.css',
        'ui/foundations.css',
        'ui/components.css',
        'ui/motion.css',
        'ui/accessibility.css',
    ];
    let previous = -1;
    for (const stylesheet of expected) {
        const position = productionHtml.indexOf(`href="${stylesheet}"`);
        assert.ok(position > previous, `${stylesheet} must load after its dependency`);
        previous = position;
        assert.ok(exists(stylesheet), stylesheet);
    }
    assert.match(productionHtml, /<body class="ui-v2" data-ui-system="living-circle">/);
    assert.match(productionHtml, /class="ui-skip-link"/);
});

test('UIX-1 tokens are an exact executable translation of the approved UIX-0 contract', () => {
    const variables = parseCssVariables(tokensCss);
    const mapping = {
        'brand.signal': '--ui-brand-signal',
        'brand.signalDeep': '--ui-brand-signal-deep',
        'brand.ink': '--ui-brand-ink',
        'surface.paper': '--ui-surface-paper',
        'surface.paperBright': '--ui-surface-paper-bright',
        'surface.paperMuted': '--ui-surface-paper-muted',
        'economy.tamashi': '--ui-economy-tamashi',
        'game.orange': '--ui-game-orange',
        'game.purple': '--ui-game-purple',
        'game.gray': '--ui-game-gray',
        'game.black': '--ui-game-black',
    };
    for (const [token, variable] of Object.entries(mapping)) {
        assert.equal(variables[variable].toUpperCase(), contract.color[token].value.toUpperCase(), token);
    }
    assert.equal(variables['--ui-radius-sm'], `${contract.geometry.radiiPx.small}px`);
    assert.equal(variables['--ui-radius-md'], `${contract.geometry.radiiPx.medium}px`);
    assert.equal(variables['--ui-radius-lg'], `${contract.geometry.radiiPx.large}px`);
    assert.equal(variables['--ui-target-min'], `${contract.geometry.minimumTargetCssPx}px`);
    assert.equal(variables['--ui-duration-blocking-max'], `${contract.motion.blockingMaxMs}ms`);
});

test('UIX-1 ships the selected Arabic font locally and never fetches a runtime font', () => {
    const fontFiles = [
        'assets/fonts/ibm-plex-sans-arabic/IBMPlexSansArabic-Regular.woff2',
        'assets/fonts/ibm-plex-sans-arabic/IBMPlexSansArabic-SemiBold.woff2',
    ];
    for (const font of fontFiles) {
        assert.ok(exists(font), font);
        assert.match(tokensCss, new RegExp(font.split('/').at(-1).replace('.', '\\.')));
    }
    assert.equal((tokensCss.match(/@font-face/g) || []).length, 2);
    assert.doesNotMatch(tokensCss, /https?:|@import/);
    assert.match(foundationsCss, /font-family:\s*var\(--ui-font-family\)/);
});

test('UIX-1 text and semantic color pairs meet their committed contrast gates', () => {
    for (const pair of contract.contrast) {
        assert.ok(contrast(pair.foreground, pair.background) >= pair.minimum, `${pair.foreground} / ${pair.background}`);
    }
    assert.match(componentsCss, /ui-button--primary[\s\S]+color:\s*#fff;[\s\S]+background:\s*var\(--ui-brand-signal-deep\)/);
    assert.match(componentsCss, /ui-badge--tamashi[\s\S]+background:\s*var\(--ui-economy-tamashi\)/);
    assert.doesNotMatch(tokensCss, /--ui-(?:gold|casino)/i);
});

test('UIX-1 exposes every required component state through the production fixture', () => {
    for (const marker of [
        'ui-button--primary', 'ui-button--secondary', 'disabled', 'ui-icon-button',
        'ui-input', 'aria-invalid="true"', 'role="tablist"', 'role="tabpanel"',
        'role="dialog"', 'aria-modal="true"', 'ui-status--success', 'ui-status--warning',
        'ui-spinner', 'ui-skeleton', 'ui-empty-state', 'ui-badge--tamashi',
    ]) assert.ok(fixtureHtml.includes(marker), marker);
    assert.match(fixtureJs, /locale === 'ar' \? 'rtl' : 'ltr'/);
    assert.match(fixtureJs, /dataset\.uiTextScale = scale/);
    assert.match(fixtureJs, /dataset\.uiMotion = motion/);
});

test('UIX-1 input, focus, 200% text and reduced-motion gates are encoded', () => {
    assert.match(tokensCss, /--ui-target-min:\s*44px/);
    assert.match(tokensCss, /--ui-target-primary:\s*48px/);
    assert.match(accessibilityCss, /min-block-size:\s*var\(--ui-target-min\)/);
    assert.match(foundationsCss, /:focus-visible[\s\S]+outline:\s*var\(--ui-stroke-focus\) solid var\(--ui-brand-signal\)/);
    assert.match(accessibilityCss, /data-ui-text-scale="200"[\s\S]+font-size:\s*200%/);
    assert.match(motionCss, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(motionCss, /animation-duration:\s*1ms !important/);
    assert.match(motionCss, /data-ui-motion="reduced"/);
});

test('UIX-1 uses one SVG icon vocabulary and no system emoji in new components', () => {
    const ids = [...icons.matchAll(/<symbol id="([^"]+)"/g)].map(match => match[1]);
    assert.ok(ids.length >= 20, 'shared icon coverage');
    assert.equal(new Set(ids).size, ids.length, 'unique icon IDs');
    for (const required of ['play', 'home', 'people', 'cards', 'store', 'settings', 'invite', 'back', 'history', 'sound', 'mute', 'report', 'refresh']) {
        assert.ok(ids.includes(`icon-${required}`), required);
    }
    const newUiSources = [fixtureHtml, tokensCss, foundationsCss, componentsCss, motionCss, accessibilityCss, fixtureJs, icons].join('\n');
    assert.doesNotMatch(newUiSources, /\p{Extended_Pictographic}/u);
    assert.doesNotMatch(fixtureHtml, /<script[^>]+src="https?:/i);
});
