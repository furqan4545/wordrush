// Replay the Mac display's wheel-only tap after a drawn stroke in an isolated browser profile.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://127.0.0.1:4348/fingerfont/';
const browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH});
try {
  const page = await browser.newPage();
  await page.setViewport({width: 1100, height: 900});
  await page.goto(url);
  await page.waitForSelector('#workspace:not([inert])');
  const heading = () => page.$eval('#draw-heading', el => el.textContent);

  async function replay(selector, overrides = {}) {
    return page.evaluate(({selector, delta = [2, 1], momentum = false, returns = true, zoom = false, nativeClick = false, parkOnPaper = false, overlappingTail = false}) => {
      const pad = document.querySelector('#pad');
      const control = document.querySelector(selector);
      const strip = document.querySelector('#upcoming');
      const initialScroll = strip.scrollLeft;
      const at = el => {
        const r = el.getBoundingClientRect();
        return {clientX: r.left + r.width / 2, clientY: r.top + r.height / 2};
      };
      const park = parkOnPaper ? at(pad) : {clientX: -483.375, clientY: 613.2265625};
      const contact = at(control);
      function pointer(el, type, point, relatedTarget = null) {
        el.dispatchEvent(new PointerEvent(type, {bubbles: true, isPrimary: true, pointerType: 'mouse', relatedTarget, ...point}));
      }
      function wheel(el, point, dx, dy, inertial, ctrlKey = false) {
        const event = new WheelEvent('wheel', {bubbles: true, cancelable: true, ...point, deltaX: dx, deltaY: dy, ctrlKey});
        Object.defineProperty(event, 'momentum', {value: inertial});
        el.dispatchEvent(event);
        return event.defaultPrevented;
      }
      wheel(pad, at(pad), -3, 1, false);
      if (!overlappingTail) wheel(pad, at(pad), -5, -2, true);
      // If the mouse rests inside the paper, the cursor returns there without
      // leaving the SVG. The later transition to the tile carries tile coordinates.
      if (parkOnPaper) {
        pointer(pad, 'pointermove', park);
        pointer(pad, 'pointerout', contact, control);
      } else {
        pointer(pad, 'pointerout', park);
      }
      pointer(control, 'pointerover', contact, parkOnPaper ? pad : null);
      pointer(control, 'pointermove', contact);
      if (overlappingTail) wheel(pad, at(pad), -5, -2, true);
      const canceled = wheel(control, contact, ...delta, momentum, zoom);
      if (overlappingTail) {
        wheel(pad, at(pad), -2, -1, true);
        wheel(pad, at(pad), 0, 0, false);
      }
      wheel(control, contact, 0, 0, false);
      // dispatchEvent does not run the browser's default wheel scrolling.
      if (!canceled && strip.contains(control)) strip.scrollLeft += delta[0];
      if (nativeClick) {
        pointer(control, 'pointerdown', contact);
        pointer(control, 'pointerup', contact);
        control.dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1}));
      }
      pointer(control, 'pointerout', returns ? park : {clientX: contact.clientX + 12, clientY: contact.clientY});
      const beforeTailEnded = document.querySelector('#draw-heading').textContent;
      if (overlappingTail) wheel(pad, at(pad), 0, -1, true);
      return {canceled, initialScroll, finalScroll: strip.scrollLeft, beforeTailEnded};
    }, {selector, ...overrides});
  }
  const tile = char => '#upcoming [data-char="' + char + '"]';
  const b = await replay(tile('B'), {overlappingTail: true});
  assert.equal(b.beforeTailEnded, 'Draw B', 'the first tap must work while the previous stroke is still sending momentum');
  assert.equal(await heading(), 'Draw B', 'the recorded wheel-only contact on B must select B');
  assert.equal(b.finalScroll, b.initialScroll, 'a recovered interior tap keeps the strip still');
  await replay('#next');
  assert.equal(await heading(), 'Draw C', 'one wheel-only Next tap advances exactly once');
  await page.$eval('#next', el => el.dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1})));
  assert.equal(await heading(), 'Draw C', 'a delayed click cannot repeat the same action');
  await page.click('#next');
  assert.equal(await heading(), 'Draw D', 'a new physical click still works immediately');
  await replay('#next', {nativeClick: true});
  assert.equal(await heading(), 'Draw E', 'native click and contact-end cannot double-advance');
  for (const gesture of [{delta: [35, 2]}, {delta: [0, 15]}, {momentum: true}, {returns: false}, {zoom: true}, {delta: [0, 0]}]) {
    const gestureResult = await replay(tile('F'), gesture);
    assert.equal(await heading(), 'Draw E', 'scroll, zoom, or cursor movement cannot select F');
    assert.equal(gestureResult.canceled, false, 'real scrolling stays native');
  }
  await replay('#next', {parkOnPaper: true});
  assert.equal(await heading(), 'Draw F', 'the first tap must also work with the mouse resting inside the drawing pad');
  // Deliver a fresh press to the stale drawing target with actual coordinates
  // over Next. Its first release must operate Next, without drawing another dot.
  const routed = await page.evaluate(() => {
    const pad = document.querySelector('#pad'), next = document.querySelector('#next');
    const center = el => {
      const r = el.getBoundingClientRect();
      return {clientX: r.x + r.width / 2, clientY: r.y + r.height / 2};
    };
    const inside = center(pad), outside = center(next);
    const send = (type, point) => pad.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true,
      isPrimary: true, pointerType: 'mouse', pointerId: 11, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...point}));
    send('pointerdown', inside);
    send('pointermove', outside);
    send('pointerup', outside);
    const afterLift = document.querySelector('#draw-heading').textContent;
    const ink = document.querySelectorAll('#ink path').length;
    send('pointerdown', outside);
    send('pointerup', outside);
    pad.dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1, ...outside}));
    const outsideWheel = new WheelEvent('wheel', {bubbles: true, cancelable: true, deltaX: 20, ...outside});
    pad.dispatchEvent(outsideWheel);
    return {afterLift, ink, heading: document.querySelector('#draw-heading').textContent, canceled: outsideWheel.defaultPrevented};
  });
  assert.equal(routed.afterLift, 'Draw F', 'lifting over Next is still the original drawing contact');
  assert(routed.ink > 0);
  assert.equal(routed.heading, 'Draw G', 'the first separate outside tap must activate the hit-tested control exactly once');
  assert.equal(routed.canceled, false, 'a stale pad target cannot consume a fresh outside scroll');
  await page.evaluate(() => {
    const p = document.querySelector('#pad'), pad = p.getBoundingClientRect();
    p.dispatchEvent(new WheelEvent('wheel', {bubbles: true, cancelable: true,
      clientX: pad.left + pad.width / 2, clientY: pad.top + pad.height / 2, deltaX: -3}));
    const next = document.querySelector('#next').getBoundingClientRect();
    p.dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1,
      clientX: next.left + next.width / 2, clientY: next.top + next.height / 2}));
  });
  assert.equal(await heading(), 'Draw H', 'a click-only outside tap routed to the SVG must hit Next immediately');
  console.log('Passed recorded wheel-only control tap, stationary strip, native clicks, and scroll rejection.');
} finally {
  await browser.close();
}
