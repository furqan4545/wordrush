// CHROME_PATH=/path/to/Edge node test/fingerfont-character-strip.browser.mjs [url]
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://127.0.0.1:4348/fingerfont/';
const browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH});
try {
  for (const width of [1100, 390]) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({width, height: 950, hasTouch: true});
    await page.goto(url);
    await page.waitForSelector('#workspace:not([inert])');
    const offset = () => page.$eval('#upcoming', strip => strip.scrollLeft);
    const heading = () => page.$eval('#draw-heading', h => h.textContent);
    const center = selector => page.$eval(selector, el => {
      const r = el.getBoundingClientRect();
      return {x: r.left + r.width / 2, y: r.top + r.height / 2};
    });
    async function tap(selector) {
      const {x, y} = await center(selector);
      await page.touchscreen.tap(x, y);
    }
    const tile = char => '#upcoming button[data-char="' + char + '"]';
    const stride = await page.$eval('#upcoming', strip =>
      strip.children[1].getBoundingClientRect().left - strip.children[0].getBoundingClientRect().left);
    const pageY = await page.evaluate(() => scrollY);
    await tap('#pad');
    await tap(tile('C'));
    assert.equal(await heading(), 'Draw C', 'first tap after actual touch ink');
    assert.equal(await offset(), 0, 'interior C stays put');
    await tap('#next');
    assert.equal(await heading(), 'Draw D');
    assert.equal(await offset(), 0);
    await tap(tile('F'));
    assert(Math.abs(await offset() - stride) < 1, 'rightmost F advances exactly one tile');
    await tap(tile('B'));
    assert(Math.abs(await offset()) < 1, 'leftmost B goes back exactly one tile');
    await tap(tile('A'));
    assert.equal(await offset(), 0);
    assert.equal(await page.$$eval('#ink path', paths => paths.length), 1, 'stroke stayed with A');

    // The Mac can deliver wheel ink right up to the edge, then a complete
    // press/release on a button, with the compatibility click missing or late.
    const strokesAfterEdge = await page.$eval('#pad', pad => {
      const rect = pad.getBoundingClientRect();
      for (const deltaX of [-2, -14, -5]) {
        const wheel = new WheelEvent('wheel', {bubbles: true, cancelable: true,
          clientX: rect.right - 6, clientY: rect.top + rect.height / 2, deltaX});
        pad.dispatchEvent(wheel);
      }
      return document.querySelectorAll('#ink path').length;
    });
    assert.equal(strokesAfterEdge, 2, 'crossing the edge must commit exactly one additional stroke');
    await page.$eval('#next', button => {
      const rect = button.getBoundingClientRect();
      for (const type of ['pointerdown', 'pointerup']) {
        button.dispatchEvent(new PointerEvent(type, {bubbles: true, pointerId: 7, isPrimary: true,
          pointerType: 'mouse', button: 0, buttons: type === 'pointerdown' ? 1 : 0,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2}));
      }
    });
    await page.waitForFunction(() => document.querySelector('#draw-heading').textContent === 'Draw B');
    await page.$eval('#next', b => b.dispatchEvent(new MouseEvent('click', {bubbles: true, detail: 1})));
    assert.equal(await heading(), 'Draw B', 'late compatibility click cannot double-advance');
    await tap('#next');
    assert.equal(await heading(), 'Draw C', 'fresh tap can advance immediately');

    const from = await center(tile('E'));
    const to = await center(tile('B'));
    await tap('#pad');
    const cdp = await page.createCDPSession();
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [from]});
    for (let i = 1; i <= 8; i++) {
      const x = from.x + (to.x - from.x) * i / 8;
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: from.y}]});
    }
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    assert(await offset() > stride, 'one-finger horizontal drag actually scrolled');
    assert.equal(await heading(), 'Draw C', 'swipe cannot select a tile');
    assert.equal(await page.evaluate(() => scrollY), pageY, 'horizontal input leaves the page still');
    // Exercise the screen's horizontal pixel-wheel stream independently of touch.
    const beforeWheel = await offset();
    await page.mouse.move(from.x, from.y);
    await page.mouse.wheel({deltaX: 2 * stride, deltaY: 0});
    await page.waitForFunction(left => document.querySelector('#upcoming').scrollLeft > left + 10, {}, beforeWheel);
    assert.equal(await heading(), 'Draw C');
    // Let native scrolling settle, then select the tile currently under the
    // middle of the strip on the first tap. The viewport must stay exactly put.
    await page.$eval('#upcoming', strip => new Promise(resolve => {
      let last = strip.scrollLeft, steady = 0;
      function check() {
        steady = last === strip.scrollLeft ? steady + 1 : 0;
        last = strip.scrollLeft;
        if (steady >= 5) resolve();
        else requestAnimationFrame(check);
      }
      requestAnimationFrame(check);
    }));
    const pick = await page.$eval('#upcoming', strip => {
      const r = strip.getBoundingClientRect();
      const x = r.left + r.width * 0.45, y = r.top + r.height / 2;
      const button = [...strip.children].find(b => b.getBoundingClientRect().right >= x);
      const tile = button.getBoundingClientRect();
      return {left: strip.scrollLeft, char: button.dataset.char, x: tile.left + tile.width / 2, y};
    });
    await page.touchscreen.tap(pick.x, pick.y);
    assert.equal(await heading(), 'Draw ' + pick.char);
    assert.equal(await offset(), pick.left);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, {steps: 6});
    await page.mouse.up();
    assert(await offset() > pick.left + stride, 'held-mouse display translation pans the strip');
    assert.equal(await heading(), 'Draw ' + pick.char);
    await page.$eval('#upcoming', strip => { strip.scrollLeft = strip.scrollWidth; });
    const end = await offset();
    await tap('#upcoming button:last-child');
    assert.equal(await offset(), end, 'right edge clamps at the final character');
    assert.deepEqual(errors, []);
    await context.close();
    console.log('Passed drawing handoff, single edge steps and native horizontal swipes at width ' + width);
  }
} finally {
  await browser.close();
}
