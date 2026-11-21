import {Font, Glyph, Path} from 'opentype.js';
import otfReaderModule from 'fonteditor-core/lib/ttf/otf2ttfobject';
import writerModule from 'fonteditor-core/lib/ttf/ttfwriter';
import {bounds, CHARACTERS, outline, PAPER, variation} from './ink.js';

const convertContours = otfReaderModule.default ?? otfReaderModule;
const TrueTypeWriter = writerModule.default ?? writerModule;

function makeGlyph(character, contours, alternate) {
  const path = new Path();
  const box = bounds(contours);
  const scale = 1000 / PAPER.height;
  const bearing = 38;
  for (const contour of contours) {
    contour.forEach(([px, py], i) => {
      const x = Math.round((px - box.left) * scale) + bearing;
      const y = Math.round((PAPER.baseline - py) * scale);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.close();
  }
  const code = character.codePointAt(0);
  return new Glyph({
    name: 'uni' + code.toString(16).toUpperCase().padStart(4, '0') + (alternate ? '.alt' + alternate : ''),
    unicode: alternate ? undefined : code,
    path,
    advanceWidth: Math.ceil((box.right - box.left) * scale) + 2 * bearing,
  });
}

function contextualAlternates(count) {
  const coverage = (offset) => ({
    format: 1,
    glyphs: Array.from({length: count}, (_, i) => 2 + i + count * offset),
  });
  const chain = (previous, lookup) => ({
    substFormat: 3,
    backtrackCoverage: [coverage(previous)],
    inputCoverage: [coverage(0)],
    lookaheadCoverage: [],
    lookupRecords: [{sequenceIndex: 0, lookupListIndex: lookup}],
  });
  const single = (multiple) => ({
    lookupType: 1,
    lookupFlag: 0,
    subtables: [{substFormat: 1, coverage: coverage(0), deltaGlyphId: count * multiple}],
  });
  return {
    scripts: ['DFLT', 'latn'].map((tag) => ({
      tag,
      script: {
        defaultLangSys: {reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [0]},
        langSysRecords: [],
      },
    })),
    features: [{tag: 'calt', feature: {featureParams: 0, lookupListIndexes: [0]}}],
    lookups: [{lookupType: 6, lookupFlag: 0, subtables: [chain(0, 1), chain(1, 2)]}, single(1), single(2)],
  };
}

function tables(buffer) {
  const view = new DataView(buffer);
  const entries = new Map();
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(...new Uint8Array(buffer, record, 4));
    entries.set(tag, new Uint8Array(buffer, view.getUint32(record + 8), view.getUint32(record + 12)));
  }
  return entries;
}

function checksum(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
  return sum;
}

// The contour converter retains glyph order but drops layout tables. Restore
// the exact GSUB used by the OTF and rebuild the sfnt directory and checksums.
function addLayout(ttf, layout) {
  const entries = tables(ttf);
  entries.set('GSUB', layout);
  const tags = [...entries.keys()].sort();
  const paddedSize = (length) => Math.ceil(length / 4) * 4;
  let offset = 12 + 16 * tags.length;
  const bytes = new Uint8Array(
    offset + tags.reduce((sum, tag) => sum + paddedSize(entries.get(tag).length), 0),
  );
  const view = new DataView(bytes.buffer);
  const exponent = Math.floor(Math.log2(tags.length));
  view.setUint32(0, 0x10000);
  view.setUint16(4, tags.length);
  view.setUint16(6, 16 * 2 ** exponent);
  view.setUint16(8, exponent);
  view.setUint16(10, 16 * tags.length - 16 * 2 ** exponent);
  let adjustment;
  tags.forEach((tag, i) => {
    const data = entries.get(tag);
    const record = 12 + i * 16;
    bytes.set(data, offset);
    if (tag === 'head') {
      adjustment = offset + 8;
      view.setUint32(adjustment, 0);
    }
    for (let j = 0; j < 4; j++) bytes[record + j] = tag.charCodeAt(j);
    view.setUint32(record + 4, checksum(bytes.subarray(offset, offset + paddedSize(data.length))));
    view.setUint32(record + 8, offset);
    view.setUint32(record + 12, data.length);
    offset += paddedSize(data.length);
  });
  view.setUint32(adjustment, (0xb1b0afba - checksum(bytes)) >>> 0);
  return bytes.buffer;
}

export function buildFont(drawings, settings, format, preview = false) {
  const chars = [...CHARACTERS].filter((char) => drawings[char]?.length);
  if (!chars.length || (!preview && chars.length !== CHARACTERS.length))
    throw new Error('Finish the character set before exporting.');
  const missing = new Path();
  missing.moveTo(35, 0);
  missing.lineTo(35, 520);
  missing.lineTo(310, 520);
  missing.lineTo(310, 0);
  missing.close();
  missing.moveTo(65, 30);
  missing.lineTo(280, 30);
  missing.lineTo(280, 490);
  missing.lineTo(65, 490);
  missing.close();
  const glyphs = [
    new Glyph({name: '.notdef', advanceWidth: 345, path: missing}),
    new Glyph({name: 'space', unicode: 32, advanceWidth: 290, path: new Path()}),
  ];
  const outlines = chars.map((char) => drawings[char].map((stroke) => outline(stroke, settings)));
  for (let alt = 0; alt < (settings.variation ? 3 : 1); alt++) {
    chars.forEach((char, i) =>
      glyphs.push(makeGlyph(char, variation(outlines[i], char, alt, settings.variation), alt)),
    );
  }
  const family = settings.name.trim() || 'My Handwriting';
  const postScriptName =
    (family
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .slice(0, 50) || 'FingerFont') + '-Regular';
  const font = new Font({
    familyName: family,
    styleName: 'Regular',
    postScriptName,
    version: 'Version 1.000',
    unitsPerEm: 1000,
    ascender: 790,
    descender: -290,
    glyphs,
    weightClass: 400,
  });
  if (settings.variation) font.tables.gsub = contextualAlternates(chars.length);
  const otf = font.toArrayBuffer();
  if (format === 'otf') return otf;
  const ttf = new TrueTypeWriter().write(convertContours(otf));
  return settings.variation ? addLayout(ttf, tables(otf).get('GSUB')) : ttf;
}
