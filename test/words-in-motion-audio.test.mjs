import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareMusicPcm} from '../public/words-in-motion/audio-pcm.js';

const OUTPUT_RATE = 48_000;

function audioBuffer(channels, sampleRate = OUTPUT_RATE) {
  const planes = channels.map(values => Float32Array.from(values));
  assert.ok(planes.every(plane => plane.length === planes[0].length));
  return {
    sampleRate,
    numberOfChannels: planes.length,
    length: planes[0].length,
    duration: planes[0].length / sampleRate,
    getChannelData: channel => planes[channel],
  };
}

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`);
}

test('export samples the chosen stereo interval at the selected volume, independently of playback', async () => {
  const left = new Float32Array(2048).fill(.8, 0, 1024).fill(-.5, 1024);
  const right = new Float32Array(2048).fill(-.6, 0, 1024).fill(.25, 1024);
  const result = await prepareMusicPcm({
    buffer: audioBuffer([left, right]),
    startTime: 1024 / OUTPUT_RATE,
    volume: .6,
    loop: false,
    fadeOut: 0,
  }, 512 / OUTPUT_RATE);

  assert.ok(result.pcm instanceof Float32Array);
  assert.equal(result.frames, 512);
  assert.equal(result.pcm.length, 1024);
  assert.equal(result.sampleRate, OUTPUT_RATE);
  assert.equal(result.numberOfChannels, 2);
  for (let frame = 0; frame < result.frames; frame++) {
    near(result.pcm[frame * 2], -.3);
    near(result.pcm[frame * 2 + 1], .15);
  }
  near(result.peak, .3);
  near(result.rms, Math.sqrt((.3 ** 2 + .15 ** 2) / 2));
});

test('the music fades only at the end of the exact video duration', async () => {
  const duration = .1;
  const buffer = audioBuffer([new Float32Array(9600).fill(.8)]);
  const result = await prepareMusicPcm({
    buffer, startTime: .05, volume: .5, loop: false, fadeOut: .05,
  }, duration);

  assert.equal(result.frames, 4800);
  assert.equal(result.pcm.length, result.frames * 2);
  near(result.pcm[0], .4);
  near(result.pcm[2399 * 2], .4);
  near(result.pcm[3600 * 2], .2, 1e-4);
  assert.ok(result.pcm.at(-2) >= 0 && result.pcm.at(-2) < .001);
  for (let frame = 2401; frame < result.frames; frame++) {
    assert.ok(result.pcm[frame * 2] <= result.pcm[(frame - 1) * 2]);
    near(result.pcm[frame * 2], result.pcm[frame * 2 + 1]);
  }
});

test('mono 44.1 kHz uploads become stereo 48 kHz with a fractional music offset', async () => {
  const sourceRate = 44_100;
  const result = await prepareMusicPcm({
    buffer: audioBuffer([[.1, .2, .3, .4]], sourceRate),
    startTime: .5 / sourceRate,
    volume: 1,
    loop: false,
    fadeOut: 0,
  }, 3 / OUTPUT_RATE);

  assert.equal(result.frames, 3);
  assert.equal(result.sampleRate, OUTPUT_RATE);
  assert.equal(result.numberOfChannels, 2);
  for (const [frame, expected] of [.15, .241875, .33375].entries()) {
    near(result.pcm[frame * 2], expected);
    near(result.pcm[frame * 2 + 1], expected);
  }
});

test('short music loops from its selected start without losing the channel order', async () => {
  const result = await prepareMusicPcm({
    buffer: audioBuffer([[.1, -.2], [.3, .4]]),
    startTime: 1 / OUTPUT_RATE,
    volume: 1,
    loop: true,
    fadeOut: 0,
  }, 5 / OUTPUT_RATE);

  const expected = [-.2, .4, .1, .3, -.2, .4, .1, .3, -.2, .4];
  assert.equal(result.pcm.length, expected.length);
  expected.forEach((value, index) => near(result.pcm[index], value));
});

test('quad uploads retain front and rear speakers in the stereo export', async () => {
  // One impulse per speaker isolates its contribution and catches lost rear audio.
  const result = await prepareMusicPcm({
    buffer: audioBuffer([
      [.8, 0, 0, 0],
      [0, .8, 0, 0],
      [0, 0, .8, 0],
      [0, 0, 0, .8],
    ]),
    startTime: 0, volume: .5, loop: false, fadeOut: 0,
  }, 4 / OUTPUT_RATE);

  const expected = [.2, 0, 0, .2, .2, 0, 0, .2];
  assert.equal(result.pcm.length, expected.length);
  expected.forEach((value, index) => near(result.pcm[index], value));
});

test('5.1 exports preserve center and surround audio while omitting LFE, as in preview', async () => {
  // Web Audio speaker order is L, R, C, LFE, SL, SR.
  const result = await prepareMusicPcm({
    buffer: audioBuffer(Array.from({length: 6}, (_, speaker) =>
      Array.from({length: 6}, (_, frame) => frame === speaker ? .6 : 0))),
    startTime: 0, volume: 1, loop: false, fadeOut: 0,
  }, 6 / OUTPUT_RATE);

  const rear = .6 / Math.sqrt(2);
  const expected = [.6, 0, 0, .6, rear, rear, 0, 0, rear, 0, 0, rear];
  assert.equal(result.pcm.length, expected.length);
  expected.forEach((value, index) => near(result.pcm[index], value));
});

test('an already canceled export does not prepare a soundtrack', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(prepareMusicPcm({
    buffer: audioBuffer([[.2, .3]]), volume: 1, loop: true, fadeOut: 0,
  }, .1, {signal: controller.signal}), {name: 'AbortError'});
});

test('canceling during soundtrack preparation stops the export', async () => {
  const controller = new AbortController();
  let progressSeen = false;
  await assert.rejects(prepareMusicPcm({
    buffer: audioBuffer([new Float32Array(OUTPUT_RATE).fill(.2)]),
    volume: 1, loop: true, fadeOut: 0,
  }, 2, {
    signal: controller.signal,
    onProgress() {
      progressSeen = true;
      controller.abort();
    },
  }), {name: 'AbortError'});
  assert.equal(progressSeen, true);
});

test('an audible track cannot silently export a selected window containing only silence', async () => {
  const samples = new Float32Array(4800).fill(.5, 0, 2400);
  await assert.rejects(prepareMusicPcm({
    buffer: audioBuffer([samples]),
    startTime: .07,
    volume: .6,
    loop: false,
    fadeOut: 0,
  }, .01), error => error.code === 'AUDIO_CLIP_SILENT');
});
