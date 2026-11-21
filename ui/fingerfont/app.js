import {bounds, CHARACTERS, GROUPS, outline, PAPER, svgPath, variation} from './ink.js';
import {signatureBlob, signatureSVG} from './signature.js';
import {openDraft} from './storage.js';

const $ = (id) => document.getElementById(id);
const ns = 'http://www.w3.org/2000/svg';
const drawings = Object.create(null);
const history = new Map();
const font = {
  width: 6,
  smoothness: 55,
  variation: 55,
  name: 'My Handwriting',
  format: 'ttf',
  sentence: 'Aa Bb Cc',
};
const signature = {width: 5, smoothness: 55, transparent: true};
const session = {studio: 'font', char: 'A', guides: true};
const dirty = new Set(),
  saving = new Map();
let draft, pointer;
let previewTimer,
  previewVersion = 0,
  previewFace;

const isFont = () => session.studio === 'font';
const key = () => (isFont() ? session.char : 'signature');
const strokes = () => drawings[key()] ?? [];
const settings = () => (isFont() ? font : signature);
const group = () => Object.keys(GROUPS).find((name) => GROUPS[name].includes(session.char));
const completed = () => [...CHARACTERS].filter((char) => drawings[char]?.length).length;
function svg(tag, attributes) {
  const node = document.createElementNS(ns, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}
function status() {
  $('save-state').textContent = !draft
    ? 'Local saving unavailable'
    : saving.size
      ? 'Saving on this device…'
      : dirty.size
        ? 'Unsaved changes on this device'
        : 'Saved on this device';
}
function save(record, value) {
  if (!draft) return;
  const write = draft.save(record, value);
  saving.set(record, write);
  status();
  write
    .then(
      () => {
        if (saving.get(record) === write) dirty.delete(record);
      },
      () => {
        if (saving.get(record) === write) dirty.add(record);
      },
    )
    .finally(() => {
      if (saving.get(record) === write) saving.delete(record);
      status();
    });
}
function undoStack() {
  if (!history.has(key())) history.set(key(), {past: [], future: []});
  return history.get(key());
}
function apply(strokesToKeep) {
  drawings[key()] = strokesToKeep;
  save('ink/' + key(), strokesToKeep);
  $('feedback').textContent = '';
  render();
}
function edit(next) {
  const stack = undoStack();
  stack.past.push(strokes());
  if (stack.past.length > 80) stack.past.shift();
  stack.future = [];
  apply(next);
}
function restore(from, to) {
  cancelPointer();
  const stack = undoStack();
  if (!stack[from].length) return;
  stack[to].push(strokes());
  apply(stack[from].pop());
}
function currentContours() {
  return strokes().map((stroke) => outline(stroke, settings()));
}

function refreshPad() {
  const paths = currentContours();
  $('ink').replaceChildren(...paths.map((points) => svg('path', {d: svgPath(points)})));
  $('trace').textContent = session.char;
  $('trace').style.display = isFont() && session.guides && !paths.length ? '' : 'none';
  document.querySelector('.rules').style.display = session.guides ? '' : 'none';
  for (const id of ['cap-rule', 'cap-label', 'waist-rule']) $(id).style.display = isFont() ? '' : 'none';
  $('pad').setAttribute('aria-label', isFont() ? 'Drawing pad for ' + session.char : 'Signature drawing pad');
  $('undo').disabled = !undoStack().past.length;
  $('redo').disabled = !undoStack().future.length;
  $('clear').disabled = !paths.length;
  if (isFont()) {
    $('variants').replaceChildren();
    $('alternates-note').hidden = !font.variation || !paths.length;
    if (!paths.length) return;
    const versions = font.variation ? [0, 1, 2] : [0];
    versions.forEach((i) => {
      const contours = variation(paths, session.char, i, font.variation);
      const box = bounds(contours);
      const figure = document.createElement('figure');
      const drawing = svg('svg', {
        viewBox: [box.left - 8, -6, box.right - box.left + 16, 252].join(' '),
        'aria-hidden': true,
      });
      drawing.append(...contours.map((points) => svg('path', {d: svgPath(points), fill: '#232322'})));
      const caption = document.createElement('figcaption');
      caption.className = 'variant-caption';
      caption.textContent = ['Original', 'Alternate 1', 'Alternate 2'][i];
      figure.append(drawing, caption);
      $('variants').append(figure);
    });
  } else {
    $('sig-proof').replaceChildren();
    if (paths.length) {
      const proof = new DOMParser().parseFromString(signatureSVG(strokes(), signature), 'image/svg+xml');
      $('sig-proof').append(document.importNode(proof.documentElement, true));
    }
    $('svg-export').disabled = $('png-export').disabled = !paths.length;
  }
}

const gridButtons = new Map();
for (const [name, chars] of Object.entries(GROUPS)) {
  const button = document.createElement('button');
  button.textContent = name;
  button.onclick = () => selectChar(chars[0]);
  document.querySelector('.group-row').append(button);
  for (const char of chars) {
    const cell = document.createElement('button');
    cell.textContent = char;
    cell.onclick = () => selectChar(char);
    gridButtons.set(char, cell);
    $('glyphs').append(cell);
  }
}
function refreshGrid() {
  const activeGroup = group();
  for (const b of document.querySelector('.group-row').children)
    b.setAttribute('aria-pressed', b.textContent === activeGroup);
  for (const [char, cell] of gridButtons) {
    cell.hidden = !GROUPS[activeGroup].includes(char);
    cell.setAttribute('aria-pressed', char === session.char);
    const done = Boolean(drawings[char]?.length);
    cell.classList.toggle('drawn', done);
    cell.setAttribute('aria-label', char + (done ? ', drawn' : ', to draw'));
  }
  const count = completed();
  $('progress').textContent = count + ' / ' + CHARACTERS.length;
  $('progress-bar').value = count;
  $('font-export').disabled = count !== CHARACTERS.length;
  $('export-note').textContent =
    count === CHARACTERS.length
      ? 'Ready to install. Spacing and handwriting alternates are included.'
      : 'Draw ' +
        (CHARACTERS.length - count) +
        ' more character' +
        (count === CHARACTERS.length - 1 ? '' : 's') +
        ' to unlock export. Space is included automatically.';
  const index = CHARACTERS.indexOf(session.char);
  $('prev').disabled = index === 0;
  $('next').disabled = index === CHARACTERS.length - 1;
}

function scheduleProof() {
  const version = ++previewVersion;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const available = Object.create(null),
      missing = new Set(),
      parts = [];
    for (const char of font.sentence) {
      const drawn = char === ' ' || Boolean(drawings[char]?.length);
      if (drawn && char !== ' ') available[char] = drawings[char];
      if (!drawn) missing.add(char);
      if (!parts.length || parts.at(-1).drawn !== drawn) parts.push({drawn, text: ''});
      parts.at(-1).text += char;
    }
    let face;
    try {
      if (Object.keys(available).length) {
        const {buildFont} = await import('./font.js');
        if (version !== previewVersion) return;
        face = new FontFace('FingerFontProof' + version, buildFont(available, font, 'otf', true));
        await face.load();
      }
      if (version !== previewVersion) return;
      if (face) document.fonts.add(face);
      if (previewFace) document.fonts.delete(previewFace);
      previewFace = face;
      $('proof').replaceChildren(
        ...parts.map((part) => {
          const span = document.createElement('span');
          span.textContent = part.text;
          if (part.drawn && face) span.style.fontFamily = face.family;
          else span.className = 'fallback';
          return span;
        }),
      );
      $('fallback-note').textContent = missing.size
        ? 'Gray characters use a fallback: ' + [...missing].join(' ')
        : font.sentence
          ? 'All characters in this preview are available.'
          : 'Type a sentence to preview your handwriting.';
    } catch {
      if (version === previewVersion) $('fallback-note').textContent = 'Could not load this font preview.';
    }
  }, 100);
}

function render() {
  const fontOpen = isFont();
  $('font-mode').setAttribute('aria-pressed', fontOpen);
  $('signature-mode').setAttribute('aria-pressed', !fontOpen);
  for (const id of ['glyph-step', 'character-card', 'font-details']) $(id).hidden = !fontOpen;
  for (const id of ['sig-settings', 'signature-card']) $(id).hidden = fontOpen;
  $('draw-label').textContent = fontOpen ? group() : 'Signature Studio';
  const noun = group() === 'Numbers' ? 'number' : group() === 'Symbols' ? 'symbol' : 'letter';
  $('draw-heading').textContent = fontOpen ? 'Draw the ' + noun + ' ' + session.char : 'Draw your signature';
  $('guides').checked = session.guides;
  $('family').value = font.name;
  $('format').value = font.format;
  $('sentence').value = font.sentence;
  $('strength').value = font.variation;
  $('strength-out').textContent = font.variation + '%';
  $('sig-width').value = signature.width;
  $('width-out').textContent = signature.width;
  $('sig-smooth').value = signature.smoothness;
  $('smooth-out').textContent = signature.smoothness + '%';
  $('transparent').checked = signature.transparent;
  refreshPad();
  if (fontOpen) {
    refreshGrid();
    scheduleProof();
  }
}

function selectChar(char) {
  if (!char) return;
  cancelPointer();
  session.char = char;
  save('session', session);
  render();
}
function openStudio(mode) {
  cancelPointer();
  session.studio = mode;
  save('session', session);
  $('feedback').textContent = '';
  render();
}
$('font-mode').onclick = () => openStudio('font');
$('signature-mode').onclick = () => openStudio('signature');
$('prev').onclick = () => selectChar(CHARACTERS[CHARACTERS.indexOf(session.char) - 1]);
$('next').onclick = () => selectChar(CHARACTERS[CHARACTERS.indexOf(session.char) + 1]);
$('guides').onchange = (e) => {
  session.guides = e.target.checked;
  save('session', session);
  refreshPad();
};
$('undo').onclick = () => restore('past', 'future');
$('redo').onclick = () => restore('future', 'past');
$('clear').onclick = () => {
  cancelPointer();
  if (strokes().length) edit([]);
};
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input,select,textarea') || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z')
    return;
  e.preventDefault();
  if (e.shiftKey) restore('future', 'past');
  else restore('past', 'future');
});

const pad = $('pad');
const paper = pad.closest('.paper-pad');
let hoverPoint = null;
let frame = 0;

function sample(contact, timeStamp = contact.timeStamp) {
  const point = new DOMPoint(contact.clientX, contact.clientY).matrixTransform(pad.getScreenCTM().inverse());
  const x = Math.max(0, Math.min(PAPER.width, point.x));
  const y = Math.max(0, Math.min(PAPER.height, point.y));
  const points = pointer.stroke.points;
  const last = points.at(-1);
  if (last && Math.hypot(x - last[0], y - last[1]) < 0.5) return;
  points.push([x, y, contact.pressure || contact.force || last?.[2] || 0.5, timeStamp]);
}

function paintWet() {
  frame = 0;
  if (pointer) $('wet-ink').setAttribute('d', svgPath(outline(pointer.stroke, settings())));
}

function beginStroke(source, id, contact, timeStamp) {
  pointer = {source, id, stroke: {points: [], pen: contact.pointerType === 'pen'}};
  sample(contact, timeStamp);
  paintWet();
}

function cancelPointer() {
  const previous = pointer;
  pointer = null;
  if (previous?.source === 'pointer' && pad.hasPointerCapture(previous.id)) pad.releasePointerCapture(previous.id);
  cancelAnimationFrame(frame);
  frame = 0;
  $('wet-ink').removeAttribute('d');
}

function finishStroke() {
  const stroke = pointer.stroke;
  cancelPointer();
  edit([...strokes(), stroke]);
}

function preventPan(e) {
  if (e.cancelable) e.preventDefault();
}

// A trackpad scroll is a wheel event, independent of CSS touch-action.
paper.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) preventPan(e);
}, {passive: false});

// Some touch displays emit touch events even when the host has PointerEvent.
// The first input stream owns the stroke so dual delivery never doubles the ink.
paper.addEventListener('touchstart', (e) => {
  preventPan(e);
  if (pointer || e.touches.length !== 1) return;
  const touch = e.changedTouches[0];
  beginStroke('touch', touch.identifier, touch, e.timeStamp);
}, {passive: false});
paper.addEventListener('touchmove', (e) => {
  preventPan(e);
  if (pointer?.source !== 'touch') return;
  const touch = Array.from(e.changedTouches).find(t => t.identifier === pointer.id);
  if (!touch) return;
  sample(touch, e.timeStamp);
  if (!frame) frame = requestAnimationFrame(paintWet);
}, {passive: false});
paper.addEventListener('touchend', (e) => {
  if (pointer?.source !== 'touch') return;
  const touch = Array.from(e.changedTouches).find(t => t.identifier === pointer.id);
  if (touch) {
    sample(touch, e.timeStamp);
    finishStroke();
  }
});
paper.addEventListener('touchcancel', (e) => {
  if (pointer?.source === 'touch' && Array.from(e.changedTouches).some(t => t.identifier === pointer.id)) cancelPointer();
});

pad.onpointerdown = (e) => {
  if (pointer || !e.isPrimary || e.button !== 0) return;
  e.preventDefault();
  pad.setPointerCapture(e.pointerId);
  beginStroke('pointer', e.pointerId, e);
};
pad.onpointerenter = (e) => { if (e.pointerType === 'mouse') hoverPoint = e; };
pad.onpointermove = (e) => {
  if (e.pointerType === 'mouse') hoverPoint = e;
  if (!pointer || pointer.source === 'touch' || pointer.id !== e.pointerId) return;
  for (const item of e.getCoalescedEvents?.() ?? []) sample(item);
  sample(e);
  if (!frame) frame = requestAnimationFrame(paintWet);
};
pad.onpointerup = (e) => {
  if (pointer?.source !== 'pointer' || pointer.id !== e.pointerId) return;
  sample(e);
  finishStroke();
};
pad.onpointercancel = pad.onlostpointercapture = (e) => {
  if (pointer?.source === 'pointer' && pointer.id === e.pointerId) cancelPointer();
};
pad.onpointerleave = (e) => {
  if (e.pointerType !== 'mouse') return;
  hoverPoint = null;
  if (pointer?.source === 'space') finishStroke();
};

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.altKey || e.metaKey || e.ctrlKey || !hoverPoint ||
      $('workspace').inert || e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
  if (pointer?.source === 'space') { e.preventDefault(); return; }
  if (pointer || e.repeat) return;
  e.preventDefault();
  beginStroke('space', hoverPoint.pointerId, hoverPoint, e.timeStamp);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && pointer?.source === 'space') {
    e.preventDefault();
    finishStroke();
  }
});
window.addEventListener('blur', () => {
  hoverPoint = null;
  if (pointer?.source === 'space') finishStroke();
  else cancelPointer();
});

$('sentence').oninput = (e) => {
  font.sentence = e.target.value;
  save('font', font);
  scheduleProof();
};
$('family').oninput = (e) => {
  font.name = e.target.value;
  save('font', font);
};
$('format').onchange = (e) => {
  font.format = e.target.value;
  save('font', font);
};
$('strength').oninput = (e) => {
  font.variation = Number(e.target.value);
  $('strength-out').textContent = font.variation + '%';
  save('font', font);
  refreshPad();
  scheduleProof();
};
$('sig-width').oninput = (e) => {
  signature.width = Number(e.target.value);
  save('signature-settings', signature);
  render();
};
$('sig-smooth').oninput = (e) => {
  signature.smoothness = Number(e.target.value);
  save('signature-settings', signature);
  render();
};
$('transparent').onchange = (e) => {
  signature.transparent = e.target.checked;
  save('signature-settings', signature);
  refreshPad();
};

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function exportFile(button, format) {
  button.disabled = true;
  try {
    if (isFont()) {
      const {buildFont} = await import('./font.js');
      const bytes = buildFont(drawings, font, format);
      const filename =
        (font.name.trim().replace(/[^\p{L}\p{N} _-]+/gu, '') || 'My Handwriting') + '.' + format;
      download(new Blob([bytes], {type: 'font/' + format}), filename);
    } else {
      download(await signatureBlob(strokes(), signature, format), 'Signature.' + format);
    }
    $('feedback').textContent = format.toUpperCase() + ' download started.';
  } catch {
    $('feedback').textContent = 'Export failed. Try again with your saved drawing.';
  } finally {
    render();
  }
}
$('font-export').onclick = (e) => exportFile(e.currentTarget, font.format);
$('svg-export').onclick = (e) => exportFile(e.currentTarget, 'svg');
$('png-export').onclick = (e) => exportFile(e.currentTarget, 'png');

try {
  draft = await openDraft();
  for (const [name, value] of draft.records) {
    if (name.startsWith('ink/')) drawings[name.slice(4)] = value;
    else if (name === 'font') Object.assign(font, value);
    else if (name === 'session') Object.assign(session, value);
    else if (name === 'signature-settings') Object.assign(signature, value);
  }
} catch {
  /* Drawing and downloads also work with browser storage disabled. */
}
render();
status();
$('workspace').inert = false;
document.querySelector('.studios').inert = false;
