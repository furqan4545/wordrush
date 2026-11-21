import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parse} from 'opentype.js';
import {CHARACTERS, outline, variation} from '../ui/fingerfont/ink.js';
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
