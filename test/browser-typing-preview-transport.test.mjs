import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getTiming, getSourceTime} from '../public/browser-typing/scene.js';

const moduleUrl = new URL('../ui/browser-typing-preview.js', import.meta.url);
const source = await readFile(moduleUrl, 'utf8');
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};
let fixtureId = 0;

// Keep the production transport intact while replacing browser decoding and
// drawing at its import boundary. The real scene timing remains under test.
async function fixture(t, options = {}) {
  const bitmaps = [], inputs = [], iterators = [], composites = [], draws = [];
  const tracking = {width: 1080, height: 1920, fps: 30, duration: 236 / 30,
    frames: Array.from({length: 236}, () => ({}))};
  const makeCanvas = () => {
    const canvas = {width: 0, height: 0};
    const context = {setTransform() {}, drawImage(image) {
      if (image?.closed) throw new Error('A closed bitmap was painted.');
      draws.push(image);
    }};
    canvas.getContext = () => context;
    return canvas;
  };
  class Input {
    constructor() {this.disposed = false; inputs.push(this);}
    async getPrimaryVideoTrack() {return {canDecode: async () => true};}
    dispose() {this.disposed = true;}
  }
  class CanvasSink {
    canvasesAtTimestamps(timestamps) {
      const canvas = makeCanvas();
      // CanvasSink selects the last frame whose PTS is <= the requested time.
      // Rounded PTS values match ffprobe's clean-base.mp4 timestamps.
      const sourcePTS = Array.from({length: 236}, (_, i) => Number((i / 30).toFixed(6)));
      const requests = timestamps[Symbol.asyncIterator]?.() ?? timestamps[Symbol.iterator]();
      const iterator = {
        requests: [], returned: false,
        async next() {
          const request = await requests.next();
          if (request.done) return {done: true};
          iterator.requests.push(request.value);
          const timestamp = sourcePTS.findLast(value => value <= request.value);
          if (timestamp === undefined) return {done: false, value: null};
          canvas.timestamp = timestamp;
          return {done: false, value: {canvas, timestamp, duration: 1 / 30}};
        },
        async return() {iterator.returned = true; await requests.return?.(); return {done: true};},
      };
      iterators.push(iterator);
      return iterator;
    }
  }
  const replacements = {
    document: {createElement: makeCanvas},
    VideoDecoder: class {},
    createImageBitmap: async canvas => {
      const bitmap = {timestamp: canvas.timestamp, closed: false, closes: 0,
        close() {this.closed = true; this.closes++;}};
      bitmaps.push(bitmap);
      if (options.holdBitmap?.(bitmap)) await options.bitmapGate.promise;
      return bitmap;
    },
  };
  const descriptors = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, {configurable: true, value});
  const key = `__browserTypingTransportTest${fixtureId++}`;
  globalThis[key] = {
    media: {ALL_FORMATS: [], Input, CanvasSink, UrlSource: class {}},
    scene: {getSourceTime, drawOverlay(context, settings) {composites.push(settings);}},
  };
  const loaded = source
    .replace("import {ALL_FORMATS, CanvasSink, Input, UrlSource} from 'mediabunny';",
      `const {ALL_FORMATS, CanvasSink, Input, UrlSource} = globalThis[${JSON.stringify(key)}].media;`)
    .replace("import {drawOverlay, getSourceTime} from '../public/browser-typing/scene.js';",
      `const {drawOverlay, getSourceTime} = globalThis[${JSON.stringify(key)}].scene;`)
    .replaceAll('import.meta.url', JSON.stringify(moduleUrl.href));
  const {createBrowserTypingPreview} = await import(`data:text/javascript;base64,${Buffer.from(loaded).toString('base64')}`);
  const canvas = makeCanvas();
  const preview = createBrowserTypingPreview({canvas, tracking});
  t.after(async () => {
    preview.dispose();
    options.bitmapGate?.resolve();
    await turn();
    delete globalThis[key];
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return {preview, tracking, bitmaps, inputs, iterators, composites, draws};
}

test('3× playback keeps camera pixels and overlay geometry on the same decoded PTS', async t => {
  const {preview, composites, draws, bitmaps} = await fixture(t);
  const timing = getTiming('https://loveyou.com', 'natural', undefined, 1, 3);
  await preview.prepare({timing});
  assert.deepEqual(bitmaps.map(bitmap => Math.round(bitmap.timestamp * 30)), [0, 3, 6],
    'three snapshots must look ahead through three output frames, skipping unused source frames');
  for (let frame = 0; frame < 145; frame++) {
    const outputTime = frame / 60;
    const result = preview.render(outputTime, {text: 'https://loveyou.com'});
    const exportFrameTime = Math.floor(outputTime * 30) / 30;
    const target = Math.round(getSourceTime(exportFrameTime, timing) * 30);
    assert.equal(result.frameIndex, target);
    assert.equal(result.targetFrame, target);
    assert.equal(composites.at(-1).cameraTime, result.sourcePTS);
    assert.equal(draws.at(-2).timestamp, result.sourcePTS);
    await turn();
  }
});

test('slow camera holds reuse one snapshot while only distinct future source frames are requested', async t => {
  const {preview, bitmaps, iterators} = await fixture(t);
  const text = 'a'.repeat(300), timing = getTiming(text);
  await preview.prepare({timing});
  for (let frame = 0; frame < 180; frame++) {
    const result = preview.render(frame / 30, {text});
    assert.equal(result.frameIndex, result.targetFrame);
    await turn();
  }
  const snapshottedFrames = bitmaps.map(bitmap => Math.round(bitmap.timestamp * 30));
  assert.equal(new Set(snapshottedFrames).size, snapshottedFrames.length);
  assert.ok(snapshottedFrames.length < 150, 'held camera frames must not generate one bitmap per output frame');
  const requests = iterators[0].requests;
  assert.ok(requests.every((time, i) => i === 0 || time > requests[i - 1]));
});

test('paused transport does not advance, and a resumed or backward seek prepares its exact first frame', async t => {
  const {preview, iterators} = await fixture(t);
  for (const speed of [1, 2.3, 3]) {
    const timing = getTiming('wordrush.ing', 'natural', undefined, 1, speed);
    for (const outputTime of [0, timing.focus - .013, timing.focus + .321, 1.251, timing.duration - 1 / 30]) {
      await preview.prepare({timing, startTime: outputTime});
      const result = preview.render(outputTime, {text: 'wordrush.ing'});
      assert.ok(result, `${speed}× seek ${outputTime} must have a usable first frame`);
      assert.ok(result.time <= outputTime && outputTime - result.time < 1 / 30 + 1e-8);
      assert.equal(result.frameIndex, Math.round(getSourceTime(result.time, timing) * 30));
      const presented = preview.getDiagnostics().presentedFrame;
      await turn(); await turn();
      assert.equal(preview.getDiagnostics().presentedFrame, presented);
      preview.dispose();
      assert.equal(iterators.at(-1).returned, true);
    }
  }
});

test('decoder queue stays bounded and disposal closes every retained bitmap once', async t => {
  const {preview, bitmaps, inputs} = await fixture(t);
  const timing = getTiming('wordrush.ing');
  await preview.prepare({timing});
  await turn();
  const initiallyDecoded = bitmaps.length;
  await turn(); await turn();
  assert.equal(bitmaps.length, initiallyDecoded, 'a paused full queue must backpressure decoding');
  for (let frame = 0; frame < 100; frame++) {
    preview.render(frame / 30, {text: 'wordrush.ing'});
    await turn();
    assert.ok(preview.getDiagnostics().queueLength <= 3);
    assert.ok(bitmaps.filter(bitmap => !bitmap.closed).length <= 4, 'only current plus three future bitmaps stay alive');
  }
  preview.dispose();
  await turn();
  assert.ok(inputs.every(input => input.disposed));
  assert.ok(bitmaps.every(bitmap => bitmap.closes === 1));
  assert.equal(preview.render(0, {}), null);
});

test('late bitmap completion from an aborted generation cannot paint or replace a newer seek', async t => {
  const bitmapGate = deferred(); let held = false;
  const {preview, bitmaps, inputs, draws} = await fixture(t, {
    bitmapGate, holdBitmap() {if (held) return false; held = true; return true;},
  });
  const timing = getTiming('wordrush.ing');
  const controller = new AbortController();
  const obsolete = preview.prepare({timing, signal: controller.signal});
  const rejection = assert.rejects(obsolete, {name: 'AbortError'});
  await turn();
  controller.abort();
  await rejection;
  assert.equal(inputs[0].disposed, true);
  await preview.prepare({timing, startTime: 4.7});
  const replacement = preview.render(4.7, {text: 'wordrush.ing'});
  bitmapGate.resolve(); await turn();
  assert.equal(bitmaps[0].closes, 1);
  assert.equal(draws.includes(bitmaps[0]), false);
  assert.equal(preview.getDiagnostics().presentedFrame, replacement.frameIndex);
  assert.equal(preview.getDiagnostics().disposed, false);
});

test('a delayed decoder holds its last camera frame and keeps overlay geometry bound to that picture', async t => {
  const {preview, composites} = await fixture(t);
  const timing = getTiming('wordrush.ing');
  await preview.prepare({timing});
  const initial = preview.render(0, {text: 'wordrush.ing'});
  // Deliberately do not let decoder microtasks run while the output clock jumps.
  const stalled = preview.render(6, {text: 'wordrush.ing'});
  assert.ok(stalled.frameIndex >= initial.frameIndex);
  assert.ok(stalled.frameIndex < stalled.targetFrame);
  assert.equal(composites.at(-1).time, 6);
  assert.equal(composites.at(-1).cameraTime, stalled.sourcePTS);
  assert.equal(preview.getDiagnostics().selectedOutputTime, 6);
});
