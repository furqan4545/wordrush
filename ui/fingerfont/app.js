import {bounds, CHARACTERS, GROUPS, outline, PAPER, svgPath, variation} from './ink.js';
import {generateSet} from './generate.js';
import {signatureBlob, signatureSVG} from './signature.js';
import {openDraft} from './storage.js';

const $ = (id) => document.getElementById(id);
const ns = 'http://www.w3.org/2000/svg';
const drawings = Object.create(null);
let generated = {};
const history = new Map();
const font = {
  width: 6,
  smoothness: 55,
  variation: 55,
  name: 'My Handwriting',
  format: 'ttf',
  sentence: null,
};
const signature = {width: 5, smoothness: 55, transparent: true};
const session = {studio: 'font', char: 'A', guides: true, swipeInk: false};
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
const handDrawn = (char) => Boolean(drawings[char]?.length);
const glyphInk = (char) => handDrawn(char) ? drawings[char] : generated[char];
const sampleSentences = [
  'A little ink goes a long way.', 'Between the lines, a story begins.', 'Coffee tastes better with company.',
  'Draw something worth keeping.', 'Every letter has a little rhythm.', 'Fold the paper into a tiny boat.',
  'Good ideas start in the margins.', 'Here is a note for tomorrow.', 'I kept your letter in my pocket.',
  'Just leave a note on the table.', 'Keep a pencil by the window.', 'Leave a little room for wonder.',
  'Meet me where the wildflowers grow.', 'Nothing beats a handwritten note.', 'One more page before bed.',
  'Paper planes drift across the room.', 'Quiet mornings belong to dreamers.', 'Rain taps softly on the window.',
  'Some words are worth keeping.', 'Take the long way home.', 'Under the stars, we wrote our names.',
  'Violets grow beside the garden gate.', 'Write me when you get there.', 'X marks the spot on my map.',
  'Your postcard made my day.', 'Zinnias bloom outside my window.',
];
function previewText() {
  if (font.sentence !== null) return font.sentence;
  const char = session.char;
  if (/^[A-Z]$/.test(char)) return sampleSentences[char.charCodeAt(0) - 65];
  if (/^[a-z]$/.test(char)) return 'The quick brown fox jumps over a lazy dog.';
  if (/^[0-9]$/.test(char)) return 'Meet me at ' + char + ' by the old oak tree.';
  return 'I wrote ' + char + ' in the margin of my notebook.';
}
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

function refreshPad() {
  const manual = strokes();
  const suggested = isFont() && !manual.length && generated[session.char]?.length;
  const paths = (suggested ? generated[session.char] : manual).map(stroke => outline(stroke, settings()));
  const ink = paths.map(points => svg('path', {d: svgPath(points)}));
  $('generated-ink').replaceChildren(...(suggested ? ink : []));
  $('ink').replaceChildren(...(suggested ? [] : ink));
  $('trace').textContent = session.char;
  $('trace').style.display = isFont() && session.guides && !paths.length ? '' : 'none';
  document.querySelector('.rules').style.display = session.guides ? '' : 'none';
  for (const id of ['cap-rule', 'cap-label', 'waist-rule']) $(id).style.display = isFont() ? '' : 'none';
  $('pad').setAttribute('aria-label', isFont() ? 'Drawing pad for ' + session.char : 'Signature drawing pad');
  $('undo').disabled = !undoStack().past.length;
  $('redo').disabled = !undoStack().future.length;
  $('clear').disabled = !manual.length;
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
      drawing.append(...contours.map((points) => svg('path', {d: svgPath(points), fill: 'currentColor'})));
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
    cell.onclick = () => {
      selectChar(char);
      const rect = $('pad').getBoundingClientRect();
      if (rect.bottom < 100 || rect.top >= innerHeight) $('editor').scrollIntoView({block: 'start'});
    };
    gridButtons.set(char, cell);
    $('glyphs').append(cell);
  }
}
// Both pickers show the same outline as the exported font. Each tile keeps
// its miniature until its character or source strokes change.
const miniatures = new Map();
const tileSources = new WeakMap();
function showGlyph(button, char) {
  const source = glyphInk(char);
  const previous = tileSources.get(button);
  if (previous?.char === char && previous.source === source) return;
  tileSources.set(button, {char, source});
  if (!source?.length) {
    button.textContent = char;
    return;
  }
  let cached = miniatures.get(char);
  if (cached?.source !== source) {
    const paths = source.map(stroke => outline(stroke, font));
    const box = bounds(paths);
    const viewBox = [box.left - 5, 12, box.right - box.left + 10, 216].join(' ');
    const miniature = svg('svg', {viewBox, 'aria-hidden': true, class: 'glyph-miniature'});
    miniature.append(...paths.map(points => svg('path', {d: svgPath(points)})));
    cached = {source, miniature};
    miniatures.set(char, cached);
  }
  button.replaceChildren(cached.miniature.cloneNode(true));
}
function refreshGrid() {
  const activeGroup = group();
  for (const b of document.querySelector('.group-row').children)
    b.setAttribute('aria-pressed', b.textContent === activeGroup);
  for (const [char, cell] of gridButtons) {
    cell.hidden = !GROUPS[activeGroup].includes(char);
    if (!cell.hidden) showGlyph(cell, char);
    cell.setAttribute('aria-pressed', char === session.char);
    const state = handDrawn(char) ? 'drawn' : generated[char] ? 'generated' : 'to draw';
    cell.classList.toggle('drawn', state === 'drawn');
    cell.classList.toggle('generated', state === 'generated');
    cell.setAttribute('aria-label', char + ', ' + state);
  }
  const chars = [...CHARACTERS];
  const manual = chars.filter(handDrawn).length;
  const count = chars.filter(c => glyphInk(c)?.length).length;
  const complete = count === chars.length;
  $('progress').textContent = count + ' / ' + chars.length;
  $('progress-bar').value = count;
  $('font-export').disabled = !complete;
  $('export-note').textContent = complete
    ? 'Ready to install. Includes uppercase, lowercase, numbers and punctuation.'
    : 'Generate the remaining characters or draw them yourself to download.';
  $('generate').disabled = manual < 3 || manual === chars.length;
  $('generate').firstChild.textContent = count > manual ? 'Regenerate character set' : 'Generate character set';
  for (const [i, bar] of [...$('sample-progress').children].entries())
    bar.classList.toggle('filled', i < manual);
  const remaining = Math.max(0, 3 - manual);
  $('generate-note').textContent = complete
    ? manual + ' hand-drawn · ' + (count - manual) + ' generated. Select any character to redraw it.'
    : remaining
      ? 'Draw ' + (manual ? remaining + ' more' : 'any 3') + (remaining === 1 ? ' character' : ' characters') + ' to generate the rest in your style.'
      : 'Use your ' + manual + ' hand-drawn samples to fill in the rest. Your drawings are kept.';
  const index = CHARACTERS.indexOf(session.char);
  $('position').textContent = (index + 1) + ' of ' + chars.length;
  $('prev').disabled = index === 0;
  $('next').disabled = index === chars.length - 1;
  const first = Math.min(index, chars.length - 6);
  // Reuse buttons across strokes so keyboard focus stays on the selected tile.
  for (let i = 0; i < 6; i++) {
    let tile = $('upcoming').children[i];
    if (!tile) {
      tile = document.createElement('button');
      tile.onclick = () => {
        selectChar(tile.dataset.char);
        $('upcoming').querySelector('[aria-pressed="true"]').focus({preventScroll: true});
      };
      $('upcoming').append(tile);
    }
    const c = chars[first + i];
    tile.dataset.char = c;
    showGlyph(tile, c);
    tile.setAttribute('aria-label', 'Draw ' + c);
    tile.setAttribute('aria-pressed', c === session.char);
    tile.classList.toggle('drawn', handDrawn(c));
    tile.classList.toggle('generated', !handDrawn(c) && Boolean(generated[c]));
  }
}

function scheduleProof() {
  const version = ++previewVersion;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const available = Object.create(null),
      missing = new Set(),
      parts = [];
    const sentence = previewText();
    for (const char of sentence) {
      const drawn = char === ' ' || Boolean(glyphInk(char)?.length);
      if (drawn && char !== ' ') available[char] = glyphInk(char);
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
      $('fallback-note').textContent = !sentence ? 'Type a sentence to preview your handwriting.'
        : missing.size ? 'Gray letters are placeholders. Your ink appears in purple.'
        : 'This sentence is set in your font.';
    } catch {
      if (version === previewVersion) $('fallback-note').textContent = 'Could not load this font preview.';
    }
  }, 100);
}

const narrowScreen = matchMedia('(max-width: 740px)');
function positionProof() {
  const mobile = $('mobile-proof-slot'), block = $('proof-block');
  mobile.hidden = !narrowScreen.matches || !isFont();
  const parent = narrowScreen.matches ? mobile : $('proof-card');
  if (block.parentElement !== parent) parent.prepend(block);
}
narrowScreen.addEventListener('change', positionProof);

function render() {
  positionProof();
  const fontOpen = isFont();
  $('subtitle').textContent = fontOpen ? 'Draw three characters. Make a font in your own hand.'
    : 'Draw your signature and save it for your documents.';
  $('font-mode').setAttribute('aria-pressed', fontOpen);
  $('signature-mode').setAttribute('aria-pressed', !fontOpen);
  for (const id of ['glyph-step', 'proof-card', 'font-details']) $(id).hidden = !fontOpen;
  for (const id of ['sig-settings', 'signature-card']) $(id).hidden = fontOpen;
  $('draw-label').textContent = fontOpen ? group() + (handDrawn(session.char) ? ' · Hand-drawn' : generated[session.char] ? ' · Generated' : '') : 'Signature Studio';
  const noun = group() === 'Numbers' ? 'number' : group() === 'Symbols' ? 'symbol' : 'letter';
  $('draw-heading').textContent = fontOpen ? 'Draw the ' + noun + ' ' + session.char : 'Draw your signature';
  $('pen-hint').textContent = fontOpen && !strokes().length && generated[session.char]
    ? 'Draw here to replace the generated character.' : 'Draw with one finger or a pen.';
  $('guides').checked = session.guides;
  $('swipe-ink').checked = session.swipeInk;
  $('family').value = font.name;
  $('format').value = font.format;
  $('sentence').value = previewText();
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
$('generate').onclick = () => {
  generated = generateSet(drawings);
  save('generated', generated);
  render();
};
$('edit-sentence').onclick = () => {
  const editor = $('sentence-editor');
  editor.hidden = !editor.hidden;
  $('edit-sentence').setAttribute('aria-expanded', !editor.hidden);
  $('edit-sentence').lastChild.textContent = editor.hidden ? 'Edit text' : 'Done';
  if (!editor.hidden) $('sentence').focus();
};
$('use-sample').onclick = () => {
  font.sentence = null;
  save('font', font);
  $('sentence').value = previewText();
  scheduleProof();
};
$('font-mode').onclick = () => openStudio('font');
$('signature-mode').onclick = () => openStudio('signature');
$('prev').onclick = () => selectChar(CHARACTERS[CHARACTERS.indexOf(session.char) - 1]);
$('next').onclick = () => selectChar(CHARACTERS[CHARACTERS.indexOf(session.char) + 1]);
$('swipe-ink').onchange = (e) => {
  endSwipe();
  session.swipeInk = e.target.checked;
  save('session', session);
};
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
let swipeTimer;
const swipeIdleMs = 150;
let ignoreSwipeUntil = 0;

function insidePad(x, y, rect = pad.getBoundingClientRect()) {
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

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
  clearTimeout(swipeTimer);
  pointer = null;
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

function endSwipe() {
  if (pointer?.source === 'swipe') finishStroke();
}

function releaseSwipe() {
  if (pointer?.source !== 'swipe') return;
  endSwipe();
  // Ignore the rest of a wheel transaction still targeted at the original pad.
  ignoreSwipeUntil = performance.now() + swipeIdleMs;
}

// A web view may expose a quick display drag as pixel scrolling. This input
// is opt-in because ordinary trackpad scrolling can have the same event shape.
paper.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) return;
  const now = performance.now();
  if (now < ignoreSwipeUntil) {
    ignoreSwipeUntil = now + swipeIdleMs;
    return;
  }
  const rect = pad.getBoundingClientRect();
  if (!insidePad(e.clientX, e.clientY, rect)) {
    releaseSwipe();
    return;
  }
  if (!session.swipeInk || e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || e.momentum ||
      (pointer && pointer.source !== 'swipe') || (!e.deltaX && !e.deltaY)) {
    preventPan(e);
    if (e.momentum) releaseSwipe();
    return;
  }
  if (!pointer) {
    beginStroke('swipe', null, e);
    pointer.swipe = {startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, absolute: false};
  }
  const pos = pointer.swipe;
  if (e.clientX !== pos.startX || e.clientY !== pos.startY) pos.absolute = true;
  pos.x = pos.absolute ? e.clientX : pos.x - e.deltaX;
  pos.y = pos.absolute ? e.clientY : pos.y - e.deltaY;
  sample({clientX: pos.x, clientY: pos.y}, e.timeStamp);
  if (!insidePad(pos.x, pos.y, rect)) {
    releaseSwipe();
    return;
  }
  preventPan(e);
  if (!frame) frame = requestAnimationFrame(paintWet);
  clearTimeout(swipeTimer);
  swipeTimer = setTimeout(endSwipe, swipeIdleMs);
}, {passive: false});

// Finish an outstanding swipe before the next control receives its normal tap.
document.addEventListener('pointerdown', endSwipe, true);
window.addEventListener('pagehide', endSwipe);

// Some touch displays emit touch events even when the host has PointerEvent.
// The first input stream owns the stroke so dual delivery never doubles the ink.
paper.addEventListener('touchstart', (e) => {
  preventPan(e);
  if (pointer || e.touches.length !== 1) return;
  const touch = e.changedTouches[0];
  beginStroke('touch', touch.identifier, touch, e.timeStamp);
}, {passive: false});
paper.addEventListener('touchmove', (e) => {
  if (!pointer) return;
  if (pointer.source !== 'touch') {
    if (Array.from(e.changedTouches).some(t => insidePad(t.clientX, t.clientY))) preventPan(e);
    return;
  }
  const touch = Array.from(e.changedTouches).find(t => t.identifier === pointer.id);
  if (!touch) return;
  sample(touch, e.timeStamp);
  if (!insidePad(touch.clientX, touch.clientY)) { finishStroke(); return; }
  preventPan(e);
  if (!frame) frame = requestAnimationFrame(paintWet);
}, {passive: false});
window.addEventListener('touchend', (e) => {
  if (!e.touches.length) releaseSwipe();
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
  // Native touch and pen may capture implicitly. Let normal hit testing take
  // over as soon as the contact leaves the drawable area.
  if (e.target.hasPointerCapture(e.pointerId)) e.target.releasePointerCapture(e.pointerId);
  beginStroke('pointer', e.pointerId, e);
};
pad.onpointerenter = (e) => { if (e.pointerType === 'mouse') hoverPoint = e; };
pad.onpointermove = (e) => {
  if (e.pointerType === 'mouse') hoverPoint = e;
  if (!pointer || pointer.id !== e.pointerId || !['pointer', 'space'].includes(pointer.source)) return;
  if (pointer.source === 'pointer' && e.pointerType === 'mouse' && !(e.buttons & 1)) { finishStroke(); return; }
  for (const item of e.getCoalescedEvents?.() ?? []) sample(item);
  sample(e);
  if (!frame) frame = requestAnimationFrame(paintWet);
};
window.addEventListener('pointerup', (e) => {
  if (e.isPrimary) releaseSwipe();
  if (pointer?.source !== 'pointer' || pointer.id !== e.pointerId) return;
  sample(e);
  finishStroke();
}, true);
window.addEventListener('pointercancel', (e) => {
  if (pointer?.source === 'pointer' && pointer.id === e.pointerId) cancelPointer();
}, true);
pad.onpointerleave = (e) => {
  if (e.pointerType === 'mouse') hoverPoint = null;
  releaseSwipe();
  if (pointer?.id !== e.pointerId || !['space', 'pointer'].includes(pointer.source)) return;
  sample(e);
  finishStroke();
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
  if (pointer?.source === 'space' || pointer?.source === 'swipe') finishStroke();
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
      const glyphs = Object.fromEntries([...CHARACTERS].map(c => [c, glyphInk(c)]));
      const bytes = buildFont(glyphs, font, format);
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
    else if (name === 'generated') generated = value;
    else if (name === 'font') Object.assign(font, value);
    else if (name === 'session') Object.assign(session, value);
    else if (name === 'signature-settings') Object.assign(signature, value);
  }
} catch {
  /* Drawing and downloads also work with browser storage disabled. */
}
if (font.sentence === 'Aa Bb Cc') font.sentence = null;
render();
status();
$('workspace').inert = false;
document.querySelector('.studios').inert = false;
