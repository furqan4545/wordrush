// CHROME_PATH=/path/to/Edge node test/fingerfont-styles.browser.mjs [url]
import assert from 'node:assert/strict';
import {parse} from 'opentype.js';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({width: 1200, height: 950});
  await page.goto(process.argv[2] || 'http://127.0.0.1:4354/fingerfont/');
  await page.waitForSelector('#workspace:not([inert])');
  await page.setViewport({width: 1280, height: 720});
  const layout = await page.evaluate(() => {
    const rect = id => document.getElementById(id).getBoundingClientRect();
    return {
      stylesOnLeft: rect('font-styles').right <= rect('editor').left,
      proofOnRight: rect('proof-card').left >= rect('editor').right,
      fitsScreen: document.documentElement.scrollHeight <= innerHeight,
    };
  });
  assert.deepEqual(layout, {stylesOnLeft: true, proofOnRight: true, fitsScreen: true});
  const draw = async () => {
    const pad = await page.$('#pad');
    const {x, y, width, height} = await pad.boundingBox();
    await page.mouse.move(x + width * .35, y + height * .72);
    await page.mouse.down();
    await page.mouse.move(x + width * .51, y + height * .19, {steps: 5});
    await page.mouse.move(x + width * .68, y + height * .72, {steps: 5});
    await page.mouse.up();
  };
  await draw();
  await page.click('#next');
  await draw();
  await page.click('#generate');
  await page.click('#edit-sentence');
  await page.$eval('#sentence', input => {
    input.value = 'Bookkeeper keeps two keys.';
    input.dispatchEvent(new Event('input', {bubbles: true}));
  });
  await page.click('#edit-sentence');
  await page.click('.group-row button:nth-child(2)');
  await page.click('#glyphs [aria-label^="k,"]');
  await page.$eval('#pad', pad => pad.scrollIntoView({block: 'center'}));
  await draw();
  const ink = await page.$eval('#ink', el => el.innerHTML);
  assert.equal(await page.$eval('#heading-subject', el => getComputedStyle(el).position), 'absolute');
  assert.equal(await page.$eval('#draw-heading', h => h.firstChild.textContent), 'Draw');
  await page.waitForFunction(() => {
    const ranges = Array.from(CSS.highlights.get('fingerfont-letter') || []);
    return ranges.length === 4 && ranges.every(r => r.toString() === 'k');
  });
  await page.click('#style-options button:last-child');
  await page.click('#bold');
  await page.click('#italic');
  assert.equal(await page.$eval('#ink', el => el.innerHTML), ink, 'the editor retains the original ink');
  assert.equal(await page.$('#font-styles select'), null);
  await page.click('#next');
  assert.equal(await page.$eval('#bold', b => b.getAttribute('aria-pressed')), 'true');
  assert.equal(await page.$eval('#italic', b => b.getAttribute('aria-pressed')), 'true');
  await page.click('#prev');
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved on this device');
  await page.reload();
  await page.waitForSelector('#workspace:not([inert])');
  assert.equal(await page.$eval('#italic', b => b.getAttribute('aria-pressed')), 'true');
  assert.equal(await page.$eval('#style-options button[aria-pressed=true] strong', el => el.textContent), 'Studio print');
  assert.equal(await page.$eval('#bold', b => b.getAttribute('aria-pressed')), 'true');
  await page.click('#edit-sentence');
  await page.$eval('#sentence', el => { el.value = 'No match.'; el.dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => document.querySelector('.letter-swatch')?.textContent === 'k');
  assert.equal(await page.$eval('#proof', p => p.textContent), 'No match.');
  await page.click('#edit-sentence');
  await page.evaluate(() => {
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { window.testDownload = blob; return make(blob); };
  });
  for (const format of ['ttf', 'otf']) {
    await page.select('#format', format);
    await page.evaluate(() => { window.testDownload = null; });
    await page.click('#font-export');
    await page.waitForFunction(() => Boolean(window.testDownload));
    const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.testDownload.arrayBuffer())));
    const face = parse(Uint8Array.from(bytes).buffer);
    assert.equal(face.names.fontFamily.en, 'My Handwriting Studio print');
    assert.equal(face.names.fontSubfamily.en, 'Bold Italic');
    assert(face.charToGlyph('k').path.commands.length > 0);
  }
  await page.setViewport({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.click('.style-trigger');
  await page.waitForSelector('#font-styles:popover-open');
  await page.click('#style-options button:first-child');
  await page.click('.style-done');
  assert.equal(await page.$eval('#font-styles', s => s.checkVisibility()), false);
  await page.click('#signature-mode');
  assert.equal(await page.$eval('#font-styles', s => s.checkVisibility()), false);
  assert.equal(await page.$eval('#draw-heading', h => h.textContent), 'Draw your signature');
  assert.deepEqual(errors, []);
  console.log('Passed letter highlighting, style selection, draft persistence, both font downloads and mobile layout.');
} finally {
  await browser.close();
}
