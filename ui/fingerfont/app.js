import {bounds, CHARACTERS, GROUPS, outline, PAPER, svgPath, variation} from './ink.js';
import {generateSet, MIN_SAMPLES} from './generate.js';
import {signatureBlob, signatureSVG} from './signature.js';
import {openDraft} from './storage.js';

const $ = (id) => document.getElementById(id);
const ns = 'http://www.w3.org/2000/svg';
const drawings = Object.create(null);
let generated = {};
const autoUpdates = () => Boolean(generated.A);
const manualCount = () => [...CHARACTERS].filter(handDrawn).length;
let updateTimer;
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
const session = {studio: 'font', char: 'A', guides: true};
let drawQuickSwipes = true;
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
function save(record, value, related = []) {
  if (!draft) return;
  const entries = [[record, value], ...related];
  const write = draft.save(entries);
  for (const [name] of entries) saving.set(name, write);
  status();
  function settled(success) {
    for (const [name] of entries) {
      if (saving.get(name) !== write) continue;
      saving.delete(name);
      if (success) dirty.delete(name);
      else dirty.add(name);
    }
    status();
  }
  write.then(() => settled(true), () => settled(false));
}
function showSetUpdate() {
  const status = $('set-status');
  status.classList.add('updating');
  $('set-status-text').textContent = 'Updating character set…';
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    status.classList.remove('updating');
    $('set-status-text').textContent = 'Character set auto-updated';
  }, 320);
}
function undoStack() {
  if (!history.has(key())) history.set(key(), {past: [], future: []});
  return history.get(key());
}
function apply(strokesToKeep) {
  drawings[key()] = strokesToKeep;
  const related = [];
  if (isFont() && autoUpdates()) {
    if (manualCount() >= MIN_SAMPLES) {
      generated = generateSet(drawings);
    }
    related.push(['generated', generated]);
    showSetUpdate();
  }
  save('ink/' + key(), strokesToKeep, related);
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
    if (!$('variation-settings').open) return;
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
    cell.onclick = () => selectChar(char);
    gridButtons.set(char, cell);
    $('glyphs').append(cell);
  }
}
// Both pickers show the same outline as the exported font. Each tile keeps
// its miniature until its character or source strokes change.
const miniatures = new Map();
const tileSources = new WeakMap();
const pendingTiles = new Map();
let tileFrame = 0;
function requestTiles() {
  if (!tileFrame && pendingTiles.size) tileFrame = requestAnimationFrame(paintTiles);
}
function paintTiles() {
  tileFrame = 0;
  if (pointer) return;
  const deadline = performance.now() + 4;
  for (const [button, char] of pendingTiles) {
    pendingTiles.delete(button);
    const source = glyphInk(char);
    if (!button.hidden && source?.length) {
      paintGlyph(button, char, source);
      tileSources.set(button, {char, source});
    }
    if (performance.now() >= deadline) break;
  }
  requestTiles();
}
function showGlyph(button, char) {
  const source = glyphInk(char) ?? null;
  const previous = tileSources.get(button);
  pendingTiles.delete(button);
  if (previous?.char === char && previous.source === source) return;
  if (!source?.length || previous?.char !== char) {
    button.textContent = char;
    tileSources.set(button, {char, source: null});
  }
  if (source?.length) {
    pendingTiles.set(button, char);
    requestTiles();
  }
}
function paintGlyph(button, char, source) {
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

const strip = $('upcoming');
const stripTiles = new Map();
const visibleTiles = new Set();
const tileVisibility = new IntersectionObserver(entries => {
  for (const {target, isIntersecting} of entries) {
    if (isIntersecting) {
      visibleTiles.add(target);
      showGlyph(target, target.dataset.char);
    } else {
      visibleTiles.delete(target);
      pendingTiles.delete(target);
    }
  }
}, {root: strip, rootMargin: '0px 20%'});
for (const char of CHARACTERS) {
  const tile = document.createElement('button');
  tile.dataset.char = tile.textContent = char;
  tile.setAttribute('aria-label', 'Draw ' + char);
  tile.onclick = () => selectChar(char);
  strip.append(tile);
  stripTiles.set(char, tile);
  tileVisibility.observe(tile);
}

function revealCharacter(stepAtEdge) {
  const view = strip.getBoundingClientRect();
  if (!view.width) return;
  const rect = stripTiles.get(session.char).getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(strip).columnGap);
  const step = rect.width + gap;
  // An explicit jump from the full glyph grid (or restoring a saved draft)
  // can land outside the viewport. Ordinary interior taps never move the strip.
  if (rect.right <= view.left || rect.left >= view.right) {
    strip.scrollLeft += rect.left - view.left;
  } else if (stepAtEdge && rect.left <= view.left + gap + 1) {
    strip.scrollLeft -= step;
  } else if (stepAtEdge && rect.right >= view.right - gap - 1) {
    strip.scrollLeft += step;
  }
}
strip.addEventListener('keydown', event => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const index = CHARACTERS.indexOf(event.target.dataset.char);
  if (index < 0) return;
  event.preventDefault();
  const char = CHARACTERS[index + (event.key === 'ArrowLeft' ? -1 : 1)];
  if (char) {
    selectChar(char);
    stripTiles.get(char).focus({preventScroll: true});
  }
});

// Touch and wheel swipes scroll natively. A display which emulates a held
// mouse button can also drag the strip, without activating a tile on release.
let mouseDrag;
let suppressDragClick = false;
strip.addEventListener('pointerdown', e => {
  suppressDragClick = false;
  mouseDrag = e.pointerType === 'mouse' && e.button === 0
    ? {id: e.pointerId, x: e.clientX, y: e.clientY, left: strip.scrollLeft, moved: false} : null;
});
strip.addEventListener('pointermove', e => {
  if (!mouseDrag || e.pointerId !== mouseDrag.id || !(e.buttons & 1)) return;
  const dx = e.clientX - mouseDrag.x;
  if (!mouseDrag.moved) {
    if (Math.abs(dx) <= 8 || Math.abs(dx) <= Math.abs(e.clientY - mouseDrag.y)) return;
    mouseDrag.moved = true;
    strip.setPointerCapture(e.pointerId);
  }
  strip.scrollLeft = mouseDrag.left - dx;
});
window.addEventListener('pointerup', e => {
  if (mouseDrag?.id !== e.pointerId) return;
  suppressDragClick = mouseDrag.moved;
  mouseDrag = null;
}, true);
strip.addEventListener('pointercancel', () => { mouseDrag = null; });
strip.addEventListener('click', e => {
  if (suppressDragClick && e.detail > 0) {
    e.preventDefault();
    e.stopPropagation();
  }
  suppressDragClick = false;
}, true);

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
  $('generate').hidden = autoUpdates();
  $('generate').disabled = manual < MIN_SAMPLES || manual === chars.length;
  $('set-status').hidden = !autoUpdates();
  for (const [i, bar] of [...$('sample-progress').children].entries())
    bar.classList.toggle('filled', i < manual);
  const remaining = MIN_SAMPLES - manual;
  $('generate-note').textContent = complete
    ? manual + ' hand-drawn · ' + (count - manual) + ' generated.'
    : remaining > 0
      ? 'Draw ' + (manual ? '1 more character' : 'any 2 characters') + ' to generate your font.'
      : 'Ready to fill in the remaining characters from your handwriting.';
  const index = CHARACTERS.indexOf(session.char);
  $('position').textContent = (index + 1) + ' of ' + chars.length;
  $('prev').disabled = index === 0;
  $('next').disabled = index === chars.length - 1;
  for (const [c, tile] of stripTiles) {
    tile.setAttribute('aria-pressed', c === session.char);
    tile.tabIndex = c === session.char ? 0 : -1;
    tile.classList.toggle('drawn', handDrawn(c));
    tile.classList.toggle('generated', !handDrawn(c) && Boolean(generated[c]));
  }
  for (const tile of visibleTiles) showGlyph(tile, tile.dataset.char);
}

let proofWorker;
const proofRequests = new Map();
function buildProof(glyphs, version) {
  if (!proofWorker) {
    proofWorker = new Worker(new URL('./proof-worker.js', import.meta.url), {type: 'module'});
    proofWorker.onmessage = ({data}) => {
      const request = proofRequests.get(data.version);
      if (!request) return;
      proofRequests.delete(data.version);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data.bytes);
    };
    proofWorker.onerror = () => {
      for (const request of proofRequests.values()) request.reject(new Error('Preview worker unavailable.'));
      proofRequests.clear();
      proofWorker.terminate();
      proofWorker = null;
    };
  }
  return new Promise((resolve, reject) => {
    proofRequests.set(version, {resolve, reject});
    proofWorker.postMessage({version, glyphs, settings: font});
  });
}

function scheduleProof() {
  const version = ++previewVersion;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    if (pointer || !isFont()) return;
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
        const bytes = await buildProof(available, version);
        if (version !== previewVersion || pointer || !isFont()) return;
        face = new FontFace('FingerFontProof' + version, bytes);
        await face.load();
      }
      if (version !== previewVersion || pointer || !isFont()) return;
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
        : missing.size ? 'Gray letters are placeholders.'
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
  $('subtitle').textContent = fontOpen ? 'Draw two characters. Make a font in your own hand.'
    : 'Draw your signature and save it for your documents.';
  $('font-mode').setAttribute('aria-pressed', fontOpen);
  $('signature-mode').setAttribute('aria-pressed', !fontOpen);
  for (const id of ['glyph-step', 'proof-card', 'font-details']) $(id).hidden = !fontOpen;
  for (const id of ['sig-settings', 'signature-card']) $(id).hidden = fontOpen;
  $('draw-label').textContent = fontOpen ? group() + (handDrawn(session.char) ? ' · Hand-drawn' : generated[session.char] ? ' · Generated' : '') : 'Signature Studio';
  $('draw-heading').textContent = fontOpen ? 'Draw ' + session.char : 'Draw your signature';
  $('guides').checked = session.guides;
  $('swipe-ink').checked = drawQuickSwipes;
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
  if (pointer) finishStroke();
  session.char = char;
  save('session', session);
  render();
  revealCharacter(true);
}
function openStudio(mode) {
  cancelPointer();
  session.studio = mode;
  save('session', session);
  $('feedback').textContent = '';
  render();
  if (isFont()) revealCharacter(false);
}
$('generate').onclick = () => {
  generated = generateSet(drawings);
  save('generated', generated);
  showSetUpdate();
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
  drawQuickSwipes = e.target.checked;
  save('quick-swipes', drawQuickSwipes);
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
if (new URLSearchParams(location.search).has('input-check')) import('./input-check.js');
let hoverPoint = null;
let frame = 0;
let swipeTimer;
const swipeIdleMs = 150;
let releasedWheel = null;
let afterInk = false;
let buttonPress;
let buttonClickTimer;
const displayTapSlop = 6;
let awaitingDisplayTap = false;
let mouseX, mouseY;
let displayContact;

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
  clearButtonPress();
  awaitingDisplayTap = false;
  displayContact = null;
  pointer = {source, id, type: contact.pointerType, stroke: {points: [], pen: contact.pointerType === 'pen'}};
  sample(contact, timeStamp);
  paintWet();
}

function cancelPointer() {
  clearTimeout(swipeTimer);
  pointer = null;
  requestTiles();
  cancelAnimationFrame(frame);
  frame = 0;
  $('wet-ink').removeAttribute('d');
}

function finishStroke() {
  const stroke = pointer.stroke;
  awaitingDisplayTap = pointer.source === 'swipe';
  cancelPointer();
  afterInk = true;
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
  const {startX, startY} = pointer.swipe;
  releasedWheel = {x: startX, y: startY, until: performance.now() + swipeIdleMs};
  endSwipe();
}

// Some displays deliver a finger swipe as pixel scrolling without a preceding
// pointerdown. The first such event inside the pad can start a stroke.
paper.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) return;
  const rect = pad.getBoundingClientRect();
  if (!insidePad(e.clientX, e.clientY, rect)) {
    releaseSwipe();
    return;
  }
  preventPan(e);
  // macOS can send a long train of inertial events after finger-up. Finish
  // the ink on the first one, but keep the entire tail out of native scrolling.
  if (e.momentum) {
    endSwipe();
    releasedWheel = null;
    return;
  }
  const now = performance.now();
  // A wheel-only display may latch its event target and coordinates for a
  // whole gesture. A fresh contact or a new start location can draw immediately.
  if (releasedWheel && now < releasedWheel.until &&
      e.clientX === releasedWheel.x && e.clientY === releasedWheel.y) return;
  releasedWheel = null;
  if (!drawQuickSwipes || e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
      (pointer && pointer.source !== 'swipe') || (!e.deltaX && !e.deltaY)) {
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
  if (!frame) frame = requestAnimationFrame(paintWet);
  clearTimeout(swipeTimer);
  swipeTimer = setTimeout(endSwipe, swipeIdleMs);
}, {passive: false});

function hitAt(point) {
  return document.elementFromPoint(point.clientX, point.clientY);
}

function displayButton(target) {
  const button = target?.closest?.('#workspace button, .studios button, #workspace summary, #workspace label, #workspace input[type="checkbox"]');
  if (!button || button.disabled) return null;
  if (button.matches('label') && (button.control?.type !== 'checkbox' || button.control.disabled)) return null;
  return button;
}

// The Mac temporarily moves its mouse pointer to the finger's location. The
// original pointer can be anywhere, including on the paper or the same button.
function startDisplayContact(e) {
  if (!awaitingDisplayTap || e.buttons || mouseX === undefined ||
      Math.hypot(e.clientX - mouseX, e.clientY - mouseY) <= 8) return;
  const button = displayButton(hitAt(e));
  if (button) displayContact = {button, x: e.clientX, y: e.clientY, returnX: mouseX, returnY: mouseY,
    time: e.timeStamp, travel: 0, left: strip.scrollLeft};
}

function endDisplayContact(e) {
  const contact = displayContact;
  displayContact = null;
  if (!contact.travel || e.buttons || e.timeStamp - contact.time > 220 ||
      Math.hypot(e.clientX - contact.returnX, e.clientY - contact.returnY) > 2) return;
  if (strip.contains(contact.button)) {
    if (Math.abs(strip.scrollLeft - contact.left) > displayTapSlop + 1) return;
    strip.scrollLeft = contact.left;
  }
  awaitingDisplayTap = false;
  afterInk = false;
  clearButtonPress();
  buttonPress = {button: contact.button, recovered: true};
  buttonClickTimer = setTimeout(clearButtonPress, 600);
  contact.button.click();
}

document.addEventListener('pointerover', e => {
  if (pointer?.source === 'swipe' && !insidePad(e.clientX, e.clientY)) releaseSwipe();
  if (e.pointerType === 'mouse' && !displayContact) startDisplayContact(e);
}, true);

// Real pans and their momentum scroll natively. A tiny wheel packet can be a
// tap only when the pointer also completes the round trip to its prior spot.
document.addEventListener('wheel', e => {
  if (!displayContact && awaitingDisplayTap && !e.momentum) startDisplayContact(e);
  const contact = displayContact;
  if (!contact) {
    if (awaitingDisplayTap && !e.momentum && !insidePad(e.clientX, e.clientY)) awaitingDisplayTap = false;
    return;
  }
  contact.travel += Math.hypot(e.deltaX, e.deltaY);
  if (!contact.button.contains(hitAt(e)) || e.momentum || e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
      e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || contact.travel > displayTapSlop ||
      Math.hypot(e.clientX - contact.x, e.clientY - contact.y) > displayTapSlop) {
    displayContact = null;
    awaitingDisplayTap = false;
  }
}, {capture: true, passive: true});

document.addEventListener('pointerout', e => {
  if (e.pointerType !== 'mouse') return;
  if (displayContact?.button.contains(e.target) && !displayContact.button.contains(e.relatedTarget)) endDisplayContact(e);
  // An exit to another element already uses the destination coordinates.
  // Keep the previous mousemove as the return point until pointerover runs.
  if (!e.relatedTarget) {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }
}, true);

function clearButtonPress() {
  clearTimeout(buttonClickTimer);
  buttonPress = null;
}

function startOutsidePress(point, id, hit) {
  hoverPoint = null;
  releasedWheel = null;
  if (pointer) finishStroke();
  awaitingDisplayTap = false;
  if (!afterInk) return;
  afterInk = false;
  const button = displayButton(hit);
  if (button) buttonPress = {button, id, x: point.clientX, y: point.clientY, scroll: strip.scrollLeft};
}

document.addEventListener('pointerdown', e => {
  if (!e.isPrimary || e.button !== 0) return;
  clearButtonPress();
  displayContact = null;
  const hit = hitAt(e);
  const onPaper = insidePad(e.clientX, e.clientY) && paper.contains(hit);
  // A new press owns whatever is under the finger, even when the browser
  // delivers it to the SVG which received the preceding stroke.
  if (!onPaper) {
    if (pad.hasPointerCapture(e.pointerId)) pad.releasePointerCapture(e.pointerId);
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) startOutsidePress(e, e.pointerId, hit);
    return;
  }
  if ($('workspace').inert) return;
  if (pointer && pointer.source !== 'touch') finishStroke();
  if (pointer) return;
  releasedWheel = null;
  preventPan(e);
  if (e.target.hasPointerCapture?.(e.pointerId)) e.target.releasePointerCapture(e.pointerId);
  beginStroke('pointer', e.pointerId, e);
}, true);
document.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') {
    if (displayContact && Math.hypot(e.clientX - displayContact.x, e.clientY - displayContact.y) > displayTapSlop) {
      endDisplayContact(e);
    }
    if (!displayContact) startDisplayContact(e);
    mouseX = e.clientX;
    mouseY = e.clientY;
  }
  if (buttonPress?.id === e.pointerId &&
      Math.hypot(e.clientX - buttonPress.x, e.clientY - buttonPress.y) > 8) clearButtonPress();
}, true);
document.addEventListener('pointercancel', () => {
  displayContact = null;
  clearButtonPress();
}, true);
function recoverPress(press) {
  clearTimeout(buttonClickTimer);
  if (!press.button.isConnected || press.button.disabled ||
      (strip.contains(press.button) && Math.abs(strip.scrollLeft - press.scroll) > 1)) return;
  press.recovered = true;
  buttonClickTimer = setTimeout(clearButtonPress, 600);
  press.button.click();
}

function endOutsidePress(point, id, target) {
  const press = buttonPress;
  if (!press || press.id !== id || press.released) return;
  if (Math.hypot(point.clientX - press.x, point.clientY - press.y) > 8 ||
      !press.button.contains(hitAt(point))) {
    clearButtonPress();
    return;
  }
  press.released = true;
  if (!press.button.contains(target)) recoverPress(press);
  else buttonClickTimer = setTimeout(() => recoverPress(press), 40);
}

document.addEventListener('pointerup', e => endOutsidePress(e, e.pointerId, e.target), true);
document.addEventListener('click', e => {
  const wheelDrawing = awaitingDisplayTap || pointer?.source === 'swipe';
  displayContact = null;
  awaitingDisplayTap = false;
  const press = buttonPress;
  if (!press) {
    // A wheel-only host can send just a compatibility click for the next
    // contact. A real click outside the paper belongs to its physical hit.
    if (!wheelDrawing || e.detail === 0 || e.button !== 0 || e.ctrlKey || e.metaKey ||
        e.altKey || e.shiftKey || insidePad(e.clientX, e.clientY)) return;
    endSwipe();
    afterInk = awaitingDisplayTap = false;
    const button = displayButton(hitAt(e));
    if (button && !button.contains(e.target)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      button.click();
    }
    return;
  }
  const sameTarget = press.button.contains(e.target);
  if (!sameTarget && !(press.released && e.detail > 0 && press.button.contains(hitAt(e)))) return;
  if (press.recovered && !e.detail) return;
  if (press.recovered || !sameTarget) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!press.recovered) recoverPress(press);
  }
  clearButtonPress();
}, true);
window.addEventListener('pagehide', endSwipe);

// Some touch displays emit touch events even when the host has PointerEvent.
// The first input stream owns the stroke so dual delivery never doubles the ink.
document.addEventListener('touchstart', e => {
  const touch = e.changedTouches[0];
  if (buttonPress?.recovered || typeof buttonPress?.id === 'string' || e.touches.length !== 1) clearButtonPress();
  if (touch && e.touches.length === 1 && !buttonPress && !insidePad(touch.clientX, touch.clientY))
    startOutsidePress(touch, 'touch-' + touch.identifier, hitAt(touch));
}, {capture: true, passive: true});
document.addEventListener('touchmove', e => {
  if (typeof buttonPress?.id !== 'string') return;
  for (const touch of e.changedTouches) {
    if (buttonPress.id === 'touch-' + touch.identifier &&
        Math.hypot(touch.clientX - buttonPress.x, touch.clientY - buttonPress.y) > 8) {
      clearButtonPress();
      return;
    }
  }
}, {capture: true, passive: true});
document.addEventListener('touchcancel', clearButtonPress, {capture: true, passive: true});
paper.addEventListener('touchstart', e => {
  const touch = e.changedTouches[0];
  if (!touch || $('workspace').inert || !insidePad(touch.clientX, touch.clientY) || !paper.contains(hitAt(touch))) return;
  preventPan(e);
  if (e.touches.length !== 1) return;
  releasedWheel = null;
  if (pointer?.source === 'swipe' || pointer?.source === 'touch') finishStroke();
  if (pointer) return;
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
  for (const touch of e.changedTouches) endOutsidePress(touch, 'touch-' + touch.identifier, e.target);
  if (!e.touches.length) {
    endSwipe();
    releasedWheel = null;
    if (pointer?.source === 'pointer' && pointer.type === 'touch') {
      if (e.changedTouches.length === 1) sample(e.changedTouches[0], e.timeStamp);
      finishStroke();
      return;
    }
  }
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

paper.addEventListener('contextmenu', preventPan);
pad.onpointerenter = (e) => { if (e.pointerType === 'mouse') hoverPoint = e; };
window.addEventListener('pointermove', e => {
  if (!pointer) {
    if (e.pointerType === 'mouse') hoverPoint = paper.contains(e.target) ? e : null;
    return;
  }
  const onPaper = insidePad(e.clientX, e.clientY);
  if (e.pointerType === 'mouse') hoverPoint = onPaper ? e : null;
  if (pointer.source === 'swipe') {
    if (!onPaper) releaseSwipe();
    return;
  }
  if (pointer.id !== e.pointerId || !['pointer', 'space'].includes(pointer.source)) return;
  if (!onPaper) { sample(e); finishStroke(); return; }
  if (pointer.source === 'pointer' && e.pointerType === 'mouse' && !(e.buttons & 1)) { finishStroke(); return; }
  for (const item of e.getCoalescedEvents?.() ?? []) sample(item);
  sample(e);
  if (!frame) frame = requestAnimationFrame(paintWet);
}, true);
window.addEventListener('pointerup', (e) => {
  if (e.isPrimary) { endSwipe(); releasedWheel = null; }
  if (pointer?.source !== 'pointer' || pointer.id !== e.pointerId) return;
  sample(e);
  finishStroke();
}, true);
window.addEventListener('pointercancel', (e) => {
  if (pointer?.source === 'pointer' && pointer.id === e.pointerId) { cancelPointer(); if (isFont()) scheduleProof(); }
}, true);
pad.onpointerleave = (e) => {
  if (insidePad(e.clientX, e.clientY)) return;
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
  clearButtonPress();
  hoverPoint = null;
  if (pointer?.source === 'space' || pointer?.source === 'swipe') finishStroke();
  else cancelPointer();
  displayContact = null;
  awaitingDisplayTap = false;
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
$('variation-settings').ontoggle = () => { if ($('variation-settings').open) refreshPad(); };
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
    else if (name === 'session') {
      // The previous session blob also stored an implicit false for swipe ink.
      // Only a dedicated preference can distinguish an explicit opt-out.
      for (const field of Object.keys(session)) if (field in value) session[field] = value[field];
    }
    else if (name === 'quick-swipes' && typeof value === 'boolean') drawQuickSwipes = value;
    else if (name === 'signature-settings') Object.assign(signature, value);
  }
} catch {
  /* Drawing and downloads also work with browser storage disabled. */
}
// Older drafts may contain drawings added after the last manual generation.
if (autoUpdates() && manualCount() >= MIN_SAMPLES) generated = generateSet(drawings);
if (font.sentence === 'Aa Bb Cc') font.sentence = null;
render();
if (isFont()) revealCharacter(false);
status();
$('workspace').inert = false;
document.querySelector('.studios').inert = false;
