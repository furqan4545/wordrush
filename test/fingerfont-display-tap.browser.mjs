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
    return page.evaluate(({selector, delta = [2, 1], momentum = false, returns = true, zoom = false, nativeClick = false}) => {
      const pad = document.querySelector('#pad');
      const control = document.querySelector(selector);
      const strip = document.querySelector('#upcoming');
      const initialScroll = strip.scrollLeft;
      const at = el => {
        const r = el.getBoundingClientRect();
        return {clientX: r.left + r.width / 2, clientY: r.top + r.height / 2};
      };
      const park = {clientX: -483.375, clientY: 613.2265625};
      const contact = at(control);
      function pointer(el, type, point) {
        el.dispatchEvent(new PointerEvent(type, {bubbles: true, isPrimary: true, pointerType: 'mouse', ...point}));
      }
      function wheel(el, point, dx, dy, inertial, ctrlKey = false) {
        const event = new WheelEvent('wheel', {bubbles: true, cancelable: true, ...point, deltaX: dx, deltaY: dy, ctrlKey});
        Object.defineProperty(event, 'momentum', {value: inertial});
        el.dispatchEvent(event);
        return event.defaultPrevented;
      }
      wheel(pad, at(pad), -3, 1, false);
      wheel(pad, at(pad), -5, -2, true);
      pointer(pad, 'pointerout', park);
      pointer(control, 'pointerover', contact);
      pointer(control, 'pointermove', contact);
      const canceled = wheel(control, contact, ...delta, momentum, zoom);
      wheel(control, contact, 0, 0, false);
      // dispatchEvent does not run the browser's default wheel scrolling.
      if (!canceled && strip.contains(control)) strip.scrollLeft += delta[0];
      if (nativeClick) {
        pointer(control, 'pointerdown', contact);
        pointer(control, 'pointerup', contact);
        control.dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1}));
      }
      pointer(control, 'pointerout', returns ? park : {clientX: contact.clientX + 12, clientY: contact.clientY});
      return {canceled, initialScroll, finalScroll: strip.scrollLeft};
    }, {selector, ...overrides});
  }
  const tile = char => '#upcoming [data-char="' + char + '"]';
  const b = await replay(tile('B'));
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
  console.log('Passed recorded wheel-only control tap, stationary strip, native clicks, and scroll rejection.');
} finally {
  await browser.close();
}
