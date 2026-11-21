import {bounds, PAPER, svgPath} from './ink.js';
import {printSample} from './generate.js';
import {emphasis, fontContours, presets} from './styles.js';

const ns = 'http://www.w3.org/2000/svg';

// Each card shows the same pair of letters. Substitute a print sample only for
// a letter the writer hasn't supplied yet.
function paintSample(svg, chars, sources, settings) {
  const paths = [];
  let advance = 0;
  for (const [i, char] of chars.entries()) {
    const contours = fontContours(sources[i], char, settings);
    const box = bounds(contours);
    for (const contour of contours) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', svgPath(contour));
      path.setAttribute('transform', 'translate(' + (advance - box.left) + ' 0)');
      paths.push(path);
    }
    advance += box.right - box.left + 14;
  }
  svg.setAttribute('viewBox', [-5, 0, Math.max(advance, 10), PAPER.height].join(' '));
  svg.replaceChildren(...paths);
}

export function installStylePicker(font, glyphInk, onChange) {
  const get = id => document.getElementById(id);
  const section = get('font-styles');
  const scope = get('style-scope');
  const samples = new Map();
  let current = 'A', visible = false, frame = 0, last;
  for (const [id, preset] of Object.entries(presets)) {
    const button = document.createElement('button');
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('preserveAspectRatio', 'xMinYMid meet');
    const name = document.createElement('strong'), detail = document.createElement('small');
    name.textContent = preset.label;
    detail.textContent = preset.detail;
    button.append(svg, name, detail);
    button.onclick = () => {
      if (font.preset === id) return;
      font.preset = id;
      onChange();
    };
    get('style-options').append(button);
    samples.set(id, {button, svg});
  }
  function paint() {
    frame = 0;
    if (!visible || section.hidden) return;
    const chars = /[a-z]/i.test(current) ? [current.toUpperCase(), current.toLowerCase()] : [current];
    const sources = chars.map(char => glyphInk(char) ?? printSample(char));
    const key = JSON.stringify(chars.map(char => [char, emphasis(font, char)]));
    if (last?.key === key && sources.every((s, i) => last.sources[i] === s)) return;
    last = {key, sources};
    for (const [preset, {svg}] of samples) paintSample(svg, chars, sources, {...font, preset});
  }
  function schedule() { if (visible && !frame) frame = requestAnimationFrame(paint); }
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; schedule(); }).observe(section);

  function refresh(char) {
    current = char;
    const letter = scope.value === 'letter';
    const values = letter ? emphasis(font, char) : font;
    for (const flag of ['bold', 'italic']) get(flag).setAttribute('aria-pressed', Boolean(values[flag]));
    for (const [id, {button}] of samples) button.setAttribute('aria-pressed', id === font.preset);
    get('scope-letter').textContent = 'Letter “' + char + '”';
    get('reset-letter').hidden = !letter;
    get('reset-letter').disabled = !font.letters[char];
    schedule();
  }
  scope.onchange = () => refresh(current);
  get('reset-letter').onclick = () => { delete font.letters[current]; onChange(); };
  for (const flag of ['bold', 'italic']) {
    get(flag).onclick = () => {
      if (scope.value === 'font') font[flag] = !font[flag];
      else {
        const local = {...font.letters[current]};
        const next = !emphasis(font, current)[flag];
        if (next === font[flag]) delete local[flag];
        else local[flag] = next;
        if (Object.keys(local).length) font.letters[current] = local;
        else delete font.letters[current];
      }
      onChange();
    };
  }
  return refresh;
}
