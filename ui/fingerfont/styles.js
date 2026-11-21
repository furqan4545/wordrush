import {bounds, outline, PAPER} from './ink.js';
import {printSample} from './generate.js';

export const presets = {
  original: {label: 'Original', detail: 'Your handwriting', width: 1, spread: 1},
  fine: {label: 'Fine pen', detail: 'Fine, narrow strokes', width: .66, spread: .84},
  marker: {label: 'Felt tip', detail: 'Wide, inky strokes', width: 2.3, spread: 1.09},
  print: {label: 'Studio print', detail: 'Even, printed forms', width: 1.15, spread: 1},
};

export function presetFor(settings) {
  return Object.hasOwn(presets, settings.preset) ? presets[settings.preset] : presets.original;
}

export function emphasis(settings, char) {
  const local = settings.letters?.[char];
  return {bold: local?.bold ?? Boolean(settings.bold), italic: local?.italic ?? Boolean(settings.italic)};
}

export function fontContours(strokes, char, settings) {
  const preset = presetFor(settings);
  const {bold, italic} = emphasis(settings, char);
  if (preset === presets.original && !bold && !italic) return strokes.map(stroke => outline(stroke, settings));
  const pen = {...settings, width: settings.width * preset.width * (bold ? 1.85 : 1)};
  let spread = preset.spread;
  if (preset === presets.print) {
    // Keep some of the writer's proportions while using a uniform set of print forms.
    const original = bounds(strokes.map(s => s.points));
    strokes = printSample(char);
    const reference = bounds(strokes.map(s => s.points));
    const ratio = (original.right - original.left) / Math.max(1, reference.right - reference.left);
    spread = .65 + .35 * Math.max(.55, Math.min(1.65, ratio));
  }
  const lean = italic ? Math.tan(12 * Math.PI / 180) : 0;
  return strokes.map(stroke => outline(stroke, pen).map(([x, y]) => [
    PAPER.width / 2 + (x - PAPER.width / 2) * spread + (PAPER.baseline - y) * lean, y,
  ]));
}

export function fontNames(settings) {
  const preset = presetFor(settings);
  const root = settings.name.trim() || 'My Handwriting';
  const family = preset === presets.original ? root : root + ' ' + preset.label;
  const style = [settings.bold && 'Bold', settings.italic && 'Italic'].filter(Boolean).join(' ') || 'Regular';
  return {family, style, filename: style === 'Regular' ? family : family + ' ' + style};
}
