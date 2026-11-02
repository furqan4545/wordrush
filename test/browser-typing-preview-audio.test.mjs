import test from 'node:test';
import assert from 'node:assert/strict';
import {PreviewAudio} from '../public/browser-typing/preview-audio.js';

class FakeBuffer {
  constructor(channels = 2, frames = 480000, sampleRate = 48000) {
    this.duration = frames / sampleRate;
    this.channels = Array.from({length: channels}, () => new Float32Array(frames));
    this.attacks = [];
  }
  getChannelData(channel) {return this.channels[channel];}
}
class FakeSource {
  constructor(context) {this.context = context; this.starts = 0; this.stops = 0; this.disconnects = 0;}
  connect() {}
  disconnect() {this.disconnects++;}
  start(when, offset) {this.when = when; this.offset = offset; this.starts++; this.active = true;}
  stop() {this.stops++; this.active = false;}
  tick(from, until) {
    if (!this.active) return;
    for (const attack of this.buffer.attacks) {
      const at = this.when + attack.at - this.offset;
      if (attack.at >= this.offset && from < at && at <= until) this.context.attacks.push(attack.name);
    }
    if (until >= this.when + this.buffer.duration - this.offset) {
      this.active = false; this.onended?.();
    }
  }
}
class FakeContext {
  constructor() {
    this.state = 'suspended'; this.currentTime = 0; this.destination = {};
    this.sources = []; this.attacks = []; this.listeners = []; this.order = []; this.gains = [];
    this.resumes = 0; this.suspends = 0; this.closes = 0;
  }
  createGain() {
    const node = {gain: {value: 1, setValueAtTime(value) {this.value = value;}}, connect() {}};
    this.gains.push(node); return node;
  }
  addEventListener(name, listener) {if (name === 'statechange') this.listeners.push(listener);}
  async resume() {this.resumes++; this.order.push('resume'); this.state = 'running'; this.dispatch();}
  async suspend() {this.suspends++; this.state = 'suspended'; this.dispatch();}
  async close() {this.closes++; this.state = 'closed'; this.dispatch();}
  dispatch() {for (const listener of this.listeners) listener();}
  createBufferSource() {const source = new FakeSource(this); this.sources.push(source); return source;}
  createBuffer(channels, frames, sampleRate) {return new FakeBuffer(channels, frames, sampleRate);}
  advance(seconds) {
    if (this.state !== 'running') return;
    const before = this.currentTime; this.currentTime += seconds;
    for (const source of this.sources) source.tick(before, this.currentTime);
  }
  interrupt() {this.state = 'interrupted'; this.dispatch();}
}
function sessionFixture(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const assignments = []; let type = 'auto';
  const session = {get type() {return type;}, set type(value) {type = value; assignments.push(value);}};
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {audioSession: session}});
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  });
  return {session, assignments};
}
async function playerFixture(t, callbacks = {}) {
  const routing = sessionFixture(t), context = new FakeContext();
  const player = new PreviewAudio({...callbacks, createContext: () => context});
  await player.unlock(); player.buffer = new FakeBuffer();
  player.buffer.attacks = [{at: 4.05, name: 'click'}, {at: 5.05, name: 'key'}, {at: 8.56, name: 'enter'}];
  t.after(() => player.stop());
  return {player, context, ...routing};
}

test('coarse or frozen video clocks never restart audio or retrigger sound effects', async t => {
  const {player, context, assignments} = await playerFixture(t);
  player.start(0);
  const initialRoutingChanges = [...assignments];
  for (let frame = 0; frame < 1800; frame++) {
    context.advance(.005);
    const staleVideoTime = frame % 3 === 0 ? 0 : Math.floor(context.currentTime * 4) / 4;
    const actual = player.sync(staleVideoTime);
    assert.ok(Math.abs(actual - context.currentTime) < 1e-8);
  }
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].starts, 1);
  assert.equal(context.sources[0].stops, 0);
  assert.deepEqual(context.attacks, ['click', 'key', 'enter']);
  assert.deepEqual(assignments, initialRoutingChanges);
});

test('pause freezes the master clock; replay and explicit seek each create one source', async t => {
  let ended = 0;
  const {player, context} = await playerFixture(t, {onEnded: () => ended++});
  player.start(0); context.advance(5.25);
  assert.equal(player.getTime(), 5.25);
  const staleEnd = context.sources[0].onended;
  player.stop(); context.advance(2);
  assert.equal(player.getTime(), 5.25);
  assert.equal(context.sources[0].stops, 1);
  player.start(player.getTime()); context.advance(.5);
  assert.equal(player.getTime(), 5.75);
  player.start(1.25);
  assert.equal(player.getTime(), 1.25);
  staleEnd();
  assert.equal(ended, 0);
  assert.equal(context.sources.length, 3);
  assert.deepEqual(context.sources.map(source => source.offset), [0, 5.25, 1.25]);
  assert.equal(context.sources[1].stops, 1);
});

test('the running clock is monotonic and clamped, with a backward seek only when explicit', async t => {
  const {player, context} = await playerFixture(t);
  player.start(3); context.advance(.75);
  assert.equal(player.getTime(), 3.75);
  context.currentTime -= .1;
  assert.equal(player.getTime(), 3.75);
  context.currentTime += 50;
  assert.equal(player.getTime(), 10);
  player.start(-2);
  assert.equal(player.getTime(), 0);
  assert.throws(() => player.start(NaN), /valid preview position/);
});

test('natural completion signals once and repeated sync calls cannot restart the finished buffer', async t => {
  let ended = 0;
  const {player, context, assignments} = await playerFixture(t, {onEnded: () => ended++});
  player.start(9.5);
  const naturalEnd = context.sources[0].onended;
  context.advance(.75);
  assert.equal(ended, 1);
  assert.equal(player.getTime(), 10);
  assert.equal(player.source, null);
  naturalEnd();
  const completedRouting = [...assignments];
  for (let i = 0; i < 200; i++) player.sync(0);
  assert.equal(ended, 1);
  assert.equal(context.sources.length, 1);
  assert.deepEqual(assignments, completedRouting);
  assert.equal(player.start(10), false);
  assert.equal(context.sources.length, 1);
});

test('an interruption stops once and resumes only through an explicit Play', async t => {
  let interrupted = 0, ended = 0;
  const {player, context, assignments} = await playerFixture(t, {onInterrupted: () => interrupted++, onEnded: () => ended++});
  player.start(0); context.advance(4.5); context.interrupt();
  assert.equal(player.getTime(), 4.5);
  assert.equal(interrupted, 1);
  assert.equal(ended, 0);
  assert.equal(context.sources[0].stops, 1);
  const interruptedRouting = [...assignments];
  context.dispatch();
  for (let i = 0; i < 200; i++) player.sync(0);
  assert.equal(interrupted, 1);
  assert.equal(context.sources.length, 1);
  assert.deepEqual(assignments, interruptedRouting);
  await player.unlock(); player.start(player.getTime()); context.advance(4.5);
  assert.equal(context.sources.length, 2);
  assert.equal(context.sources[1].offset, 4.5);
  assert.deepEqual(context.attacks, ['click', 'key', 'enter']);
});

test('gesture unlock precedes asset loading and stereo PCM preparation preserves mute and cached samples', async t => {
  sessionFixture(t);
  const context = new FakeContext(); let releaseAssets, mixes = 0, loads = 0;
  const assetWait = new Promise(resolve => {releaseAssets = resolve;});
  const pcm = new Float32Array([.1, -.1, .2, -.2, .3, -.3]);
  const player = new PreviewAudio({
    createContext: () => context,
    wait: async milliseconds => context.advance(milliseconds / 1000),
    loadSounds: () => {context.order.push('load'); loads++; return assetWait;},
    mixSoundtrack: () => {mixes++; return {pcm, channels: 2, frames: 3, sampleRate: 48000};},
  });
  t.after(() => player.stop());
  await player.setMuted(true);
  const timing = {letters: ['x'], events: [1], focus: .1, enter: 1.2, duration: 2};
  const preparing = player.prepare(timing);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(context.order, ['resume', 'load']);
  assert.equal(mixes, 0);
  releaseAssets({}); await preparing;
  assert.deepEqual(Array.from(player.buffer.getChannelData(0)), Array.from(new Float32Array([.1, .2, .3])));
  assert.deepEqual(Array.from(player.buffer.getChannelData(1)), Array.from(new Float32Array([-.1, -.2, -.3])));
  assert.equal(context.gains[0].gain.value, 0);
  await player.setMuted(false);
  assert.equal(context.gains[0].gain.value, 1);
  await player.prepare(timing);
  assert.equal(loads, 1); assert.equal(mixes, 1); assert.equal(context.gains.length, 1);
});

const clockTiming = {letters: ['x'], events: [1], focus: .1, enter: 1.2, duration: 2};
const clockMix = () => ({pcm: new Float32Array(960), channels: 2, frames: 480, sampleRate: 48000});

test('a working clock passes preflight on every Play, including a cached PCM mix', async t => {
  sessionFixture(t);
  const context = new FakeContext(); let waits = 0;
  const player = new PreviewAudio({createContext: () => context, loadSounds: async () => ({}), mixSoundtrack: clockMix,
    wait: async milliseconds => {waits++; context.advance(milliseconds / 1000);}});
  t.after(() => player.stop());
  await player.prepare(clockTiming);
  assert.equal(waits, 1); assert.equal(context.suspends, 0); assert.equal(context.closes, 0);
  assert.equal(context.sources.length, 0);
  player.start(); player.stop();
  await player.prepare(clockTiming);
  assert.equal(waits, 2); assert.equal(context.resumes, 2);
  assert.equal(context.sources.length, 1);
});

test('a running but frozen clock receives one suspend/resume recovery before any sound starts', async t => {
  sessionFixture(t);
  const context = new FakeContext(); let waits = 0;
  const player = new PreviewAudio({createContext: () => context, loadSounds: async () => ({}), mixSoundtrack: clockMix,
    wait: async milliseconds => {
      waits++;
      if (context.resumes >= 2) context.advance(milliseconds / 1000);
    }});
  t.after(() => player.stop());
  await player.prepare(clockTiming);
  assert.equal(waits, 2); assert.equal(context.suspends, 1); assert.equal(context.resumes, 2);
  assert.equal(context.closes, 0); assert.equal(context.sources.length, 0);
  player.start(); assert.equal(context.sources.length, 1);
});

test('persistent clock freeze rejects without sound, then an explicit retry creates a fresh context', async t => {
  sessionFixture(t);
  const oldContext = new FakeContext(), freshContext = new FakeContext(); let creates = 0, waits = 0;
  const player = new PreviewAudio({createContext: () => creates++ === 0 ? oldContext : freshContext,
    loadSounds: async () => ({}), mixSoundtrack: clockMix,
    wait: async milliseconds => {
      waits++;
      if (player.context === freshContext) freshContext.advance(milliseconds / 1000);
    }});
  t.after(() => player.stop());
  await assert.rejects(player.prepare(clockTiming), {code: 'AUDIO_CLOCK_STALLED'});
  assert.equal(waits, 2); assert.equal(oldContext.suspends, 1); assert.equal(oldContext.resumes, 2);
  assert.equal(oldContext.closes, 1); assert.equal(oldContext.sources.length, 0);
  assert.equal(player.contextStalled, true);
  assert.throws(() => player.start(), {code: 'AUDIO_CLOCK_STALLED'});
  await player.prepare(clockTiming);
  assert.equal(creates, 2); assert.equal(freshContext.closes, 0); assert.equal(player.contextStalled, false);
  player.start(); assert.equal(freshContext.sources.length, 1); assert.equal(oldContext.sources.length, 0);
});

test('canceling a pending recovery never resumes or closes a newer Play context', async t => {
  sessionFixture(t);
  const oldContext = new FakeContext(), freshContext = new FakeContext(); let creates = 0, finishSuspend;
  oldContext.suspend = () => {
    oldContext.suspends++; oldContext.state = 'suspended';
    return new Promise(resolve => {finishSuspend = resolve;});
  };
  const player = new PreviewAudio({createContext: () => creates++ === 0 ? oldContext : freshContext,
    loadSounds: async () => ({}), mixSoundtrack: clockMix,
    wait: async milliseconds => {if (player.context === freshContext) freshContext.advance(milliseconds / 1000);}});
  t.after(() => player.stop());
  const controller = new AbortController();
  const first = player.prepare(clockTiming, {signal: controller.signal});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(oldContext.suspends, 1);
  controller.abort(); await assert.rejects(first, {name: 'AbortError'});
  oldContext.state = 'closed';
  await player.prepare(clockTiming); player.start();
  finishSuspend(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(oldContext.resumes, 1);
  assert.equal(freshContext.closes, 0); assert.equal(player.context, freshContext);
  assert.equal(freshContext.sources.length, 1);
});

test('mid-play clock invalidation closes once, preserves position, and never restarts sound without a new Play', async t => {
  sessionFixture(t);
  const oldContext = new FakeContext(), freshContext = new FakeContext();
  let creates = 0, ended = 0, interrupted = 0;
  const player = new PreviewAudio({
    createContext: () => creates++ === 0 ? oldContext : freshContext,
    loadSounds: async () => ({}),
    mixSoundtrack: () => ({pcm: new Float32Array(960000), channels: 2, frames: 480000, sampleRate: 48000}),
    wait: async milliseconds => player.context.advance(milliseconds / 1000),
    onEnded: () => ended++, onInterrupted: () => interrupted++,
  });
  t.after(() => player.stop());
  const timing = {...clockTiming, duration: 10};
  await player.prepare(timing);
  player.buffer.attacks = [{at: 4.05, name: 'click'}, {at: 5.05, name: 'key'}, {at: 8.56, name: 'enter'}];
  player.start(0); oldContext.advance(4.5);
  assert.equal(player.getTime(), 4.5);
  // WebKit can report running while its clock remains frozen.
  assert.equal(oldContext.state, 'running');
  for (let i = 0; i < 100; i++) assert.equal(player.getTime(), 4.5);
  assert.equal(player.invalidateClock(), 4.5);
  player.invalidateClock(); player.sync(0);
  assert.equal(oldContext.closes, 1); assert.equal(oldContext.sources.length, 1);
  assert.equal(oldContext.sources[0].stops, 1); assert.equal(player.getTime(), 4.5);
  assert.equal(ended, 0); assert.equal(interrupted, 0);
  assert.throws(() => player.start(4.5), {code: 'AUDIO_CLOCK_STALLED'});
  await player.prepare(timing); player.start(4.5); freshContext.advance(4.5);
  assert.equal(creates, 2); assert.equal(freshContext.sources.length, 1);
  assert.equal(freshContext.sources[0].offset, 4.5);
  assert.deepEqual(oldContext.attacks, ['click']);
  assert.deepEqual(freshContext.attacks, ['key', 'enter']);
  assert.equal(ended, 0);
});
