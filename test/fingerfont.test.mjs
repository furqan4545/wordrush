import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parse} from 'opentype.js';
import {CHARACTERS, outline, variation} from '../ui/fingerfont/ink.js';
import {generateSet} from '../ui/fingerfont/generate.js';
import {buildFont} from '../ui/fingerfont/font.js';
import {signatureSVG} from '../ui/fingerfont/signature.js';

const stroke = {
  pen: true,
  points: [
    [155, 179, 0.6],
    [198, 48, 0.75],
    [232, 182, 0.5],
  ],
};
const bar = {
  pen: true,
  points: [
    [172, 118, 0.4],
    [220, 118, 0.6],
  ],
};
const settings = {name: 'Handwritten Proof', width: 5, smoothness: 60, variation: 65, transparent: true};
const alphabet = Object.fromEntries([...CHARACTERS].map((c) => [c, [stroke, bar]]));

test('only the live preview can build an incomplete character set', () => {
  const partial = {A: [stroke]};
  assert.throws(() => buildFont(partial, settings, 'ttf'), /character set/);
  const preview = parse(buildFont(partial, settings, 'otf', true));
  assert.equal(preview.charToGlyphIndex('A'), 2);
  assert.equal(preview.charToGlyphIndex('a'), 0);
});

for (const format of ['ttf', 'otf']) {
  test(format + ' maps printable ASCII, includes space and preserves contextual substitutions', () => {
    const bytes = buildFont(alphabet, settings, format);
    const view = new DataView(bytes);
    assert.equal(view.getUint32(0), format === 'ttf' ? 0x00010000 : 0x4f54544f);
    let checksum = 0;
    for (let i = 0; i < bytes.byteLength; i += 4) checksum = (checksum + view.getUint32(i)) >>> 0;
    assert.equal(checksum, 0xb1b0afba);
    const font = parse(bytes);
    assert.equal(font.names.fontFamily.en, settings.name);
    assert.equal(font.numGlyphs, 94 * 3 + 2);
    assert.equal(font.charToGlyph(' ').path.commands.length, 0);
    assert(font.charToGlyph(' ').advanceWidth > 0);
    for (let code = 33; code <= 126; code++) {
      const char = String.fromCharCode(code);
      assert.notEqual(font.charToGlyphIndex(char), 0);
      assert(font.charToGlyph(char).path.commands.length > 0);
    }
    assert.equal(font.tables.gsub.features[0].tag, 'calt');
    assert.deepEqual(
      font.tables.gsub.lookups.map((lookup) => lookup.lookupType),
      [6, 1, 1],
    );
  });
}

test('zero variation exports only the original strokes, including single-point marks', () => {
  const glyph = {'.': [{pen: false, points: [[80, 184, 0.5]]}]};
  const font = parse(buildFont(glyph, {...settings, variation: 0}, 'ttf', true));
  assert.equal(font.numGlyphs, 3);
  assert.equal(font.tables.gsub, undefined);
  assert(font.charToGlyph('.').getBoundingBox().y2 < 0);
});

test('varying handwriting is reproducible and leaves original contours intact', () => {
  const original = [outline(stroke, settings), outline(bar, settings)];
  const snapshot = structuredClone(original);
  const first = variation(original, 'A', 1, 65);
  assert.deepEqual(first, variation(original, 'A', 1, 65));
  assert.notDeepEqual(first, variation(original, 'A', 2, 65));
  assert.deepEqual(original, snapshot);
  assert.deepEqual(
    first.map((c) => c.length),
    original.map((c) => c.length),
  );
});

test('signature exports crop to ink and make the paper background optional', () => {
  const markup = signatureSVG([stroke, bar], settings);
  assert.doesNotMatch(markup, /<rect/);
  assert.equal(markup.match(/<path /g).length, 2);
  assert(Number(markup.match(/width="(\d+)"/)[1]) < 120);
  assert.match(signatureSVG([stroke], {...settings, transparent: false}), /fill="white"/);
  assert.throws(() => signatureSVG([], settings), /signature/);
});

test('three distinct drawn characters generate a complete installable set while preserving the samples', () => {
  const samples = {a: [stroke], '7': [bar], '?': [stroke, bar]};
  const snapshot = structuredClone(samples);
  assert.throws(() => generateSet({a: [stroke, bar], '7': [bar], signature: [stroke]}), /three/);
  const generated = generateSet(samples);
  assert.deepEqual(samples, snapshot);
  assert.deepEqual(Object.keys(generated).sort(), [...CHARACTERS].sort());
  for (const format of ['ttf', 'otf']) {
    const ready = parse(buildFont({...generated, ...samples}, settings, format));
    const original = parse(buildFont(samples, settings, format, true));
    for (const char of Object.keys(samples))
      assert.deepEqual(ready.charToGlyph(char).path.commands, original.charToGlyph(char).path.commands);
    for (const char of CHARACTERS) {
      assert(ready.charToGlyph(char).path.commands.length > 0, char);
      assert(Number.isFinite(ready.charToGlyph(char).getBoundingBox().x1), char);
    }
  }
});

test('generated forms follow sample proportions and reuse corresponding handwritten case shapes', () => {
  const samples = {C: [stroke, bar], A: [stroke], B: [stroke]};
  const wide = Object.fromEntries(Object.entries(samples).map(([char, ink]) => [
    char, ink.map(s => ({...s, points: s.points.map(([x,y,p]) => [240 + 1.6*(x-240), y, p])})),
  ]));
  const normal = generateSet(samples), wider = generateSet(wide);
  const width = strokes => {
    const xs = strokes.flatMap(s => s.points.map(p => p[0]));
    return Math.max(...xs) - Math.min(...xs);
  };
  assert(width(wider.e) > width(normal.e) * 1.4);
  assert.deepEqual(normal.c.map(s => s.points.length), samples.C.map(s => s.points.length));
  assert.deepEqual(normal.c.map(s => s.points.map(p => p[2])), samples.C.map(s => s.points.map(p => p[2])));
});
