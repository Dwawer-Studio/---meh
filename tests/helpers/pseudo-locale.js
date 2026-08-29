'use strict';

const LATIN = Object.freeze({
    A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'Ë', F: 'Ƒ', G: 'Ĝ', H: 'Ħ', I: 'Ï',
    J: 'Ĵ', K: 'Ķ', L: 'Ŀ', M: 'M', N: 'Ñ', O: 'Ø', P: 'Þ', Q: 'Q', R: 'Ŕ',
    S: 'Š', T: 'Ţ', U: 'Û', V: 'V', W: 'Ŵ', X: 'X', Y: 'Ÿ', Z: 'Ž',
    a: 'å', b: 'ƀ', c: 'ç', d: 'ð', e: 'ë', f: 'ƒ', g: 'ĝ', h: 'ħ', i: 'ï',
    j: 'ĵ', k: 'ķ', l: 'ŀ', m: 'm', n: 'ñ', o: 'ø', p: 'þ', q: 'q', r: 'ŕ',
    s: 'š', t: 'ţ', u: 'û', v: 'v', w: 'ŵ', x: 'x', y: 'ÿ', z: 'ž',
});

const PROTECTED_TOKEN = /(\{\{?[^{}]+\}?\}|%\d*\$?[a-z]|https?:\/\/\S+)/gi;

function expandSegment(segment) {
    let letters = 0;
    let output = '';
    for (const character of segment) {
        if (/\p{L}/u.test(character)) letters++;
        output += LATIN[character] || character;
        if (letters > 0 && letters % 3 === 0 && /\p{L}/u.test(character)) output += 'ـ';
    }
    return output;
}

function pseudoLocalize(input) {
    const source = String(input ?? '');
    if (!source.trim()) return source;
    const parts = source.split(PROTECTED_TOKEN);
    let expanded = parts.map((part, index) => index % 2 === 1 ? part : expandSegment(part)).join('');
    const targetLength = Math.ceil(source.length * 1.3) - 2;
    while (expanded.length < targetLength) expanded += '·';
    return `⟦${expanded}⟧`;
}

module.exports = { pseudoLocalize };
