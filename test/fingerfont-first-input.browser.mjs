// Run with CHROME_PATH set to a Chromium executable and a FingerFont URL as argv[2].
// All input and draft changes are isolated to a fresh, temporary browser profile.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://127.0.0.1:4348/fingerfont/';
const browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH});
try {
  const page = await browser.newPage();
  await page.setViewport({width: 1100, height: 850});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const cdp = await page.createCDPSession();
  // Puppeteer's page.evaluate runs with userGesture=true. Keep the cold path
  // entirely free of synthesized activation, including coordinate reads.
  async function read(expression) {
    const {result, exceptionDetails} = await cdp.send('Runtime.evaluate', {
      expression, returnByValue: true, userGesture: false, awaitPromise: true,
    });
    assert(!exceptionDetails, exceptionDetails?.text);
    return result.value;
  }
  async function waitUntil(expression) {
    const deadline = Date.now() + 5000;
    while (!(await read(expression))) {
      if (Date.now() >= deadline) assert.fail('Timed out waiting for ' + expression);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  const ready = () => waitUntil("Boolean(document.querySelector('#workspace:not([inert]) #pad'))");
  async function quickSwipe() {
    const {x, y} = await read(`(() => {
      const r = document.querySelector('#pad').getBoundingClientRect();
      return {x: r.left + r.width / 2, y: r.top + r.height / 2};
    })()`);
    // The display may report only pixel-wheel movement, with no pointerdown,
    // mousemove, user activation, or change in the reported contact position.
    await cdp.send('Input.dispatchMouseEvent', {type: 'mouseWheel', x, y, deltaX: -9, deltaY: -12});
  }
  const count = () => page.$$eval('#ink path', paths => paths.length);
  const waitForCount = n => waitUntil(`document.querySelectorAll('#ink path').length === ${n}`);

  await page.goto(url);
  await ready();
  assert.equal(await read('navigator.userActivation.hasBeenActive'), false);
  const top = await read('scrollY');
  await quickSwipe();
  await waitForCount(1);
  assert.equal(await read('navigator.userActivation.hasBeenActive'), false);
  assert.equal(await read('scrollY'), top);
  assert(await page.$eval('#ink path', path => path.getBBox().height > 8));

  // The previous version wrote a false default into the session whenever
  // somebody changed characters, even if they never touched the checkbox.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('wordrush-fingerfont', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('draft', 'readwrite');
      tx.objectStore('draft').put({studio: 'font', char: 'B', guides: false, swipeInk: false}, 'session');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => reject(tx.error);
    };
  }));
  await page.reload();
  await ready();
  assert.equal(await page.$eval('#pad', pad => pad.getAttribute('aria-label')), 'Drawing pad for B');
  assert.equal(await page.$eval('#guides', guides => guides.checked), false);
  await quickSwipe();
  await waitForCount(1);
  await page.click('#prev');
  assert.equal(await count(), 1, 'existing handwritten A should survive migration');

  await page.click('#swipe-ink');
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved on this device');
  await page.reload();
  await ready();
  assert.equal(await page.$eval('#swipe-ink', el => el.checked), false);
  await quickSwipe();
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(await count(), 1, 'an explicit opt-out should survive reload');
  assert.deepEqual(errors, []);
  console.log('Passed first swipe without activation, legacy draft migration, and explicit opt-out.');
} finally {
  await browser.close();
}
