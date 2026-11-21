// Enabled only in a tab opened with ?input-check. Keep a bounded, in-memory
// report of event routing. Never record stroke coordinates or input values.
const sheet = document.createElement('details');
const title = document.createElement('summary');
title.textContent = 'Touch input check · this tab only';
const report = document.createElement('pre');
report.style.cssText = 'white-space:pre-wrap;overflow:auto;max-height:22em;font:12px/1.5 monospace';
sheet.append(title, report);
document.querySelector('main').append(sheet);
const rows = [];
let timer, lastHeading, previous;
function surface(el) {
  const node = el?.closest?.('button,summary,input,label,#upcoming,.paper-pad,[id]');
  if (node?.closest('.paper-pad')) return 'paper';
  return node?.dataset.char || node?.id || node?.tagName || 'outside';
}
function write(kind, from, data = '') {
  const time = Math.round(performance.now());
  const text = [kind, from, data].filter(Boolean).join(' ');
  if (previous?.text === text && time - previous.end < 90) {
    previous.end = time;
    previous.count++;
  } else {
    previous = {time, end: time, text, count: 1};
    rows.push(previous);
    if (rows.length > 150) rows.shift();
  }
  if (!timer) timer = setTimeout(() => {
    report.textContent = rows.map(r => r.time + ' ' + r.text + (r.count > 1 ? ' ×' + r.count : '')).join('\n');
    timer = null;
  }, 60);
}
for (const kind of ['pointerover','pointerout','pointerdown','pointerup','pointercancel','mousedown','mouseup','touchstart','touchend','click','wheel','scroll','focus','blur']) {
  window.addEventListener(kind, e => {
    if (sheet.contains(e.target instanceof Node ? e.target : null)) return;
    const from = surface(e.target);
    let data = '';
    if (kind === 'wheel') {
      data = e.momentum ? 'momentum' : 'direct';
      if (from !== 'paper') data += ' ' + Math.round(e.deltaX) + ',' + Math.round(e.deltaY);
    } else if (kind === 'pointerover' || kind === 'pointerout') {
      data = 'related=' + surface(e.relatedTarget) + ' buttons=' + e.buttons;
    } else if (kind === 'click') {
      data = e.isTrusted ? 'native' : 'recovered';
    }
    write(kind, from, data);
  }, {capture: true, passive: true});
}
const heading = document.querySelector('#draw-heading');
function update() {
  if (heading.textContent === lastHeading) return;
  lastHeading = heading.textContent;
  write('heading', lastHeading);
}
new MutationObserver(update).observe(heading, {childList: true, subtree: true});
update();
