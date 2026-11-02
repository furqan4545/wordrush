import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as scene from '../public/browser-typing/scene.js';

const appSource = await readFile(new URL('../public/browser-typing/app.js', import.meta.url), 'utf8');
const clockFailure = () => Object.assign(new Error('Audio clock did not advance.'), {code: 'AUDIO_CLOCK_STALLED'});
const permissionFailure = () => new DOMException('Audio playback was blocked.', 'NotAllowedError');
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};
let fixtureId = 0;

// Run the actual app and real scene timing. The fixture supplies browser
// surfaces and controllable sound/decoder boundaries, rather than a second
// implementation of the app's playback or fallback decisions.
async function fixture(t, {prepareError = null, startError = null, startResult = true} = {}) {
  let now = 0, nextRaf = 0, audio;
  const frames = new Map(), transports = [];
  class Element {
    constructor() {
      this.value = ''; this.hidden = false; this.disabled = false;
      this.dataset = {}; this.style = {}; this.listeners = new Map();
      this.complete = true; this.naturalWidth = 1080;
      this.classList = {toggle() {}};
    }
    get valueAsNumber() {return Number(this.value);}
    getContext() {return {drawImage() {}};}
    addEventListener(name, callback) {
      const listeners = this.listeners.get(name) ?? [];
      listeners.push(callback); this.listeners.set(name, listeners);
    }
    async emit(name, event = {}) {
      for (const callback of this.listeners.get(name) ?? []) await callback({preventDefault() {}, ...event});
    }
    setAttribute(name, value) {this[name] = value;}
    querySelector() {return new Element();}
    append() {} pause() {} focus() {} async decode() {}
  }
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  el('website').value = 'https://loveyou.com';
  el('finished-video').hidden = true;
  const paceButtons = ['natural', 'quick', 'slow'].map(pace => {
    const button = new Element(); button.dataset.pace = pace; return button;
  });
  const browserWindow = new Element();
  class FakeAudio {
    constructor() {
      audio = this; this.muted = false; this.position = 0; this.active = false;
      this.starts = []; this.startAttempts = []; this.invalidations = 0; this.preparations = [];
      this.prepareError = prepareError; this.startError = startError; this.startResult = startResult;
    }
    async prepare(timing, {signal} = {}) {
      this.preparations.push({timing, signal});
      this.duration = timing.duration;
      const error = this.prepareError, gate = this.prepareGate;
      if (gate) await gate.promise;
      if (error) throw error;
    }
    start(position) {
      this.startAttempts.push(position);
      if (this.startError) throw this.startError;
      if (!this.startResult) return false;
      this.starts.push(position); this.position = position; this.origin = now;
      this.active = true; this.frozen = false;
      return true;
    }
    getTime() {
      return this.active && !this.frozen ? Math.min(this.duration, this.position + (now - this.origin) / 1000) : this.position;
    }
    freeze() {this.position = this.getTime(); this.frozen = true;}
    stop() {this.position = this.getTime(); this.active = false;}
    invalidateClock() {this.invalidations++; this.stop();}
    async setMuted(value) {this.muted = value;}
  }
  const previewModule = {createBrowserTypingPreview() {
    const transport = {
      rendered: [], disposed: false,
      async prepare(options) {this.preparation = options;},
      render(time, settings) {this.rendered.push({time, text: settings.text});},
      getDiagnostics() {return {presentedFrame: 1, targetFrame: 1, queueLength: 3};},
      dispose() {this.disposed = true;},
    };
    transports.push(transport); return transport;
  }};
  const replacements = {
    performance: {now: () => now},
    requestAnimationFrame: callback => {frames.set(++nextRaf, callback); return nextRaf;},
    cancelAnimationFrame: id => frames.delete(id),
    document: {
      getElementById: el, createElement: () => new Element(), querySelectorAll: () => paceButtons,
      addEventListener() {}, body: new Element(), hidden: false,
    },
    location: {hostname: 'wordrush.test'},
    localStorage: {getItem() {return null;}, setItem() {}},
    matchMedia: () => ({matches: false, addEventListener() {}}),
    window: browserWindow,
    fetch: async () => ({ok: true, json: async () => ({width: 1080, height: 1920, fps: 30,
      duration: scene.SOURCE_DURATION, frames: Array.from({length: 236}, () => ({}))})}),
  };
  const descriptors = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, {configurable: true, value});
  const key = `__browserTypingAppTest${fixtureId++}`;
  globalThis[key] = {scene: {...scene, drawOverlay() {}}, PreviewAudio: FakeAudio,
    previewModule, track() {}, trackError() {}, textMetrics() {return {};}};
  t.after(async () => {
    await browserWindow.emit('pagehide', {persisted: false});
    delete globalThis[key];
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const registry = `globalThis[${JSON.stringify(key)}]`;
  const loaded = appSource
    .replace("import {drawOverlay, getTiming, splitText, DEFAULT_DELAY} from './scene.js';",
      `const {drawOverlay, getTiming, splitText, DEFAULT_DELAY} = ${registry}.scene;`)
    .replace("import {PreviewAudio} from './preview-audio.js';", `const {PreviewAudio} = ${registry};`)
    .replace("import {track, trackError, textMetrics} from '../analytics.js';", `const {track, trackError, textMetrics} = ${registry};`)
    .replace("import('./preview.js')", `Promise.resolve(${registry}.previewModule)`);
  await import(`data:text/javascript;base64,${Buffer.from(loaded).toString('base64')}`);
  return {
    el, audio, transports,
    setTime(value) {now = value;},
    tick(value) {
      now = value;
      const pending = [...frames.values()]; frames.clear();
      for (const callback of pending) callback(now);
    },
    lastRendered() {return transports.at(-1)?.rendered.at(-1)?.time;},
  };
}

function assertMutedPlaying({el}) {
  assert.equal(el('shot').dataset.previewState, 'playing');
  assert.match(el('preview-state').textContent, /muted/);
  assert.equal(el('preview-sound')['aria-label'], 'Retry preview sound');
  assert.match(el('error').textContent, /MP4 export will include the sound effects/);
}

test('failed audio preflight keeps the picture moving and pause/resume retains visual position', async t => {
  const app = await fixture(t, {prepareError: clockFailure()});
  await app.el('play').emit('click'); assertMutedPlaying(app);
  app.tick(1000); assert.equal(app.lastRendered(), 1);
  app.tick(5000); assert.equal(app.lastRendered(), 5);
  app.setTime(5500); await app.el('play').emit('click');
  assert.equal(app.el('shot').dataset.previewState, 'paused');
  app.setTime(6000); await app.el('play').emit('click');
  assert.equal(app.lastRendered(), 5.5);
  app.tick(6500); assert.equal(app.lastRendered(), 6);
  assert.equal(app.audio.starts.length, 0);
});

test('a frozen sound clock is invalidated once while picture playback continues and finishes', async t => {
  const app = await fixture(t);
  await app.el('play').emit('click');
  app.tick(1000); app.audio.freeze();
  app.tick(1500); assert.equal(app.lastRendered(), 1.5);
  app.tick(2201); assertMutedPlaying(app);
  assert.equal(app.audio.invalidations, 1);
  app.tick(5000); assert.equal(app.lastRendered(), 5);
  assert.equal(app.audio.invalidations, 1);
  assert.deepEqual(app.audio.starts, [0]);
  const duration = app.audio.duration;
  app.tick(duration * 1000 + 100);
  assert.equal(app.lastRendered(), duration);
  assert.equal(app.el('shot').dataset.previewState, 'paused');
  assert.deepEqual(app.audio.starts, [0]);
});

test('an explicit sound retry starts one source at the current picture position', async t => {
  const app = await fixture(t, {prepareError: clockFailure()});
  await app.el('play').emit('click'); app.tick(2400);
  app.audio.prepareError = null; app.setTime(2600);
  await app.el('preview-sound').emit('click');
  assert.deepEqual(app.audio.starts, [2.6]);
  assert.equal(app.el('preview-sound')['aria-label'], 'Mute preview sound');
  assert.equal(app.el('error').hidden, true);
  app.tick(2700); assert.equal(app.lastRendered(), 2.7);
  app.tick(4000); assert.equal(app.lastRendered(), 4);
  assert.deepEqual(app.audio.starts, [2.6]);
});

test('editing during an asynchronous sound retry discards its stale completion', async t => {
  const app = await fixture(t, {prepareError: clockFailure()});
  await app.el('play').emit('click'); app.tick(1000);
  const gate = deferred();
  app.audio.prepareError = null; app.audio.prepareGate = gate;
  const retry = app.el('preview-sound').emit('click');
  app.el('website').value = 'https://new-address.test';
  await app.el('website').emit('input');
  gate.resolve(); await retry;
  assert.equal(app.el('shot').dataset.previewState, 'paused');
  assert.equal(app.el('website').value, 'https://new-address.test');
  assert.equal(app.audio.starts.length, 0);
  assert.ok(app.transports.every(transport => transport.disposed));
});

test('playing after a successful seek releases the paused decoder before replacing it', async t => {
  const app = await fixture(t);
  app.el('scrubber').value = '2.25';
  await app.el('scrubber').emit('input');
  const paused = app.transports.at(-1);
  assert.equal(paused.disposed, false);
  assert.equal(paused.preparation.signal.aborted, false);
  assert.equal(app.lastRendered(), 2.25);
  await app.el('play').emit('click');
  assert.equal(paused.disposed, true);
  assert.equal(paused.preparation.signal.aborted, true);
  assert.equal(app.transports.filter(transport => !transport.disposed).length, 1);
  assert.equal(app.lastRendered(), 2.25);
  assert.deepEqual(app.audio.starts, [2.25]);
  app.tick(500); assert.equal(app.lastRendered(), 2.75);
});

test('a sound-start permission race falls back to a moving muted preview', async t => {
  const app = await fixture(t, {startError: permissionFailure()});
  await app.el('play').emit('click'); assertMutedPlaying(app);
  app.tick(1200); assert.equal(app.lastRendered(), 1.2);
  assert.equal(app.audio.startAttempts.length, 1);
  assert.equal(app.audio.starts.length, 0);
});

test('a failed retry keeps the current picture moving and leaves the retry action available', async t => {
  const app = await fixture(t, {prepareError: clockFailure()});
  await app.el('play').emit('click'); app.tick(2500);
  app.audio.prepareError = null; app.audio.startError = permissionFailure(); app.setTime(2700);
  await app.el('preview-sound').emit('click'); assertMutedPlaying(app);
  app.tick(2900); assert.equal(app.lastRendered(), 2.9);
  assert.equal(app.audio.startAttempts.length, 1);
  assert.equal(app.audio.starts.length, 0);
});

test('a sound source that cannot start does not prevent canvas playback', async t => {
  const app = await fixture(t, {startResult: false});
  await app.el('play').emit('click'); assertMutedPlaying(app);
  app.tick(1300); assert.equal(app.lastRendered(), 1.3);
  assert.equal(app.audio.starts.length, 0);
  assert.equal(app.el('shot').dataset.audioStarts, '0');
});
