import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getTiming,getTextState,getSourceTime,getOutputTime,DEFAULT_DELAY} from '../public/browser-typing/scene.js';
import {createSoundtrack,decodeWav} from '../public/browser-typing/audio.js';

test('Browser Typing keeps its one-second focus pause and exact address', () => {
  assert.equal(DEFAULT_DELAY,1);
  const text = 'https://Example.com/Path?q=One+Two#Part';
  const t = getTiming(text);
  assert.equal(t.firstKey-t.focus,1);
  assert.equal(getTextState(t.firstKey-.001,t).text,'');
  assert.equal(getTextState(t.firstKey,t).text,'h');
  assert.equal(getTextState(t.duration,t).text,text);
  assert.ok(t.enter > t.events.at(-1));
});

test('custom 2.3× speed advances picture, letters and pause on one clock', () => {
  const t = getTiming('macrofactor.com','natural',undefined,1,2.3);
  assert.ok(Math.abs(t.firstKey-t.focus-1/2.3)<1e-8);
  for (const time of [.2,t.focus,t.firstKey,t.enter]) {
    assert.ok(Math.abs(getOutputTime(getSourceTime(time,t),t)-time)<1e-8);
  }
  assert.equal(getTextState(t.duration,t).text,'macrofactor.com');
});

test('public sounds have no local paths and the complete mix follows visible events', async () => {
  const directory = new URL('../public/browser-typing/audio/',import.meta.url);
  const raw = await readFile(new URL('manifest.json',directory),'utf8');
  assert.ok(!raw.includes('/Users/'));
  const manifest = JSON.parse(raw);
  const load = async asset => ({...decodeWav(await readFile(new URL(asset.file,directory))),...asset});
  const assets = {click:await load(manifest.assets.click),enter:await load(manifest.assets.enter),keys:await Promise.all(manifest.assets.keys.map(load))};
  const timing = getTiming('https://example.com/','natural',undefined,1,2.3);
  const track = createSoundtrack(timing,assets);
  assert.equal(track.events.filter(e => e.type === 'click').length,1);
  assert.equal(track.events.filter(e => e.type === 'typing').length,timing.letters.length);
  assert.equal(track.events.filter(e => e.type === 'enter').length,1);
  assert.equal(track.events.at(-1).at,timing.enter);
  assert.ok(track.events.at(-1).start+track.events.at(-1).duration < timing.duration);
  assert.ok(track.peak > .1 && track.peak < 1);
});
