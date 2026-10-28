const panel = document.querySelector('.preview-panel');
const cards = [...document.querySelectorAll('.example-card')];
const switches = [...document.querySelectorAll('.example-switches button')];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let active = 0, timer, hovered = false;

function stop() {
  clearTimeout(timer);
  timer = undefined;
}
function canAdvance() {
  return !document.hidden && !reducedMotion.matches && !hovered &&
    !panel.contains(document.activeElement) && cards.every(card => card.querySelector('video').paused);
}
function schedule() {
  stop();
  if (canAdvance()) timer = setTimeout(() => show((active + 1) % cards.length), 3000);
}
function show(index) {
  active = index;
  cards.forEach((card, position) => {
    const depth = (position - active + cards.length) % cards.length;
    card.classList.toggle('is-front', depth === 0);
    card.classList.toggle('is-middle', depth === 1);
    card.classList.toggle('is-back', depth === 2);
    card.inert = depth !== 0;
    card.setAttribute('aria-hidden', String(depth !== 0));
    card.querySelector('video').tabIndex = depth === 0 ? 0 : -1;
    switches[position].setAttribute('aria-pressed', String(depth === 0));
  });
  schedule();
}

if (panel && cards.length === 3 && switches.length === 3) {
  switches.forEach((button, index) => button.addEventListener('click', () => show(index)));
  panel.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'touch') {hovered = true; stop();}
  });
  panel.addEventListener('pointerleave', () => {hovered = false; schedule();});
  panel.addEventListener('focusin', stop);
  panel.addEventListener('focusout', () => queueMicrotask(schedule));
  cards.forEach(card => {
    const video = card.querySelector('video');
    video.addEventListener('play', stop);
    video.addEventListener('pause', schedule);
    video.addEventListener('ended', schedule);
  });
  document.addEventListener('visibilitychange', schedule);
  reducedMotion.addEventListener('change', schedule);
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', schedule);
  show(0);
}
