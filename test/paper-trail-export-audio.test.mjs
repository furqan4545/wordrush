import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {BufferTarget, EncodedAudioPacketSource, Mp4OutputFormat, Output} from 'mediabunny';

// Exercise the actual export helper and installed software AAC encoder. Only the browser-only relative modules
// are redirected; the production encoder, packet cloning, and MP4 muxer are used unchanged.
const sourceUrl = new URL('../ui/paper-trail-export.js', import.meta.url);
const source = (await readFile(sourceUrl, 'utf8'))
  .replace("from 'mediabunny'", `from ${JSON.stringify(import.meta.resolve('mediabunny'))}`)
  .replace("from '@mediabunny/aac-encoder'", `from ${JSON.stringify(import.meta.resolve('@mediabunny/aac-encoder'))}`)
  .replace("from './engine.js'", `from ${JSON.stringify(new URL('../public/paper-trail/engine.js', import.meta.url).href)}`)
  .replace("from './audio.js'", `from ${JSON.stringify(new URL('../public/paper-trail/audio.js', import.meta.url).href)}`);
const {encodeAacForTimeline} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const sampleRate = 48_000;
function fixture(duration = .24) {
  const frames = Math.round(duration * sampleRate), pcm = new Float32Array(frames * 2);
  for (let frame = 0; frame < frames; frame++) {
    const t = frame / sampleRate;
    for (const [start, length, frequency] of [[.003,.027,630],[.077,.036,1777],[.17,.04,2593]]) {
      const u = t - start;
      if (u < 0 || u >= length) continue;
      const envelope = Math.sin(Math.PI * u / length) ** 2;
      pcm[frame * 2] += .65 * envelope * Math.sin(2 * Math.PI * (frequency * u + 4500 * u * u));
      pcm[frame * 2 + 1] += .4 * envelope * Math.sin(2 * Math.PI * ((frequency + 211) * u + 3300 * u * u));
    }
  }
  return {pcm, frames, sampleRate, numberOfChannels: 2};
}
const audio = fixture(), original = audio.pcm.slice();
const encodedPromise = encodeAacForTimeline(audio);

test('software AAC retains decoder priming before zero and presents unchanged PCM through the exact ending', async () => {
  const encoded = await encodedPromise;
  assert.deepEqual(audio.pcm, original, 'timing compensation must never delete the PCM beginning');
  assert.equal(encoded.primingSamples, 1024);
  assert.equal(encoded.packets[0].packet.timestamp, -1024 / sampleRate);
  assert.equal(encoded.packets[0].packet.timestamp + encoded.packets[0].packet.duration, 0);
  assert.equal(encoded.packets[1].packet.timestamp, 0);
  const last = encoded.packets.at(-1).packet;
  assert.ok(Math.abs(last.timestamp + last.duration - audio.frames / sampleRate) < 1 / sampleRate);
  assert.equal(encoded.end, audio.frames / sampleRate);
  const config = encoded.packets[0].metadata.decoderConfig;
  assert.equal(config.codec, 'mp4a.40.2');
  assert.equal(config.sampleRate, sampleRate); assert.equal(config.numberOfChannels, 2);
  assert.ok(config.description.byteLength >= 2, 'Safari gets a valid AAC AudioSpecificConfig');
});

let ffmpegAvailable = true;
try {execFileSync('ffmpeg', ['-version'], {stdio: 'ignore'}); execFileSync('ffprobe', ['-version'], {stdio: 'ignore'});} catch {ffmpegAvailable = false;}
function correlation(reference, decoded, lag) {
  let xy = 0, xx = 0, yy = 0;
  for (let i = Math.max(0, -lag); i < Math.min(reference.length / 2, decoded.length / 2 - lag); i++) {
    const x = reference[i * 2], y = decoded[(i + lag) * 2];
    xy += x * y; xx += x * x; yy += y * y;
  }
  return xy / Math.sqrt(xx * yy);
}

test('actual MP4 edit list removes AAC delay and decoded events match the PCM timeline', {skip: !ffmpegAvailable}, async () => {
  const encoded = await encodedPromise, target = new BufferTarget();
  const output = new Output({format: new Mp4OutputFormat({fastStart: 'in-memory'}), target});
  const packets = new EncodedAudioPacketSource('aac'); output.addAudioTrack(packets); await output.start();
  for (const {packet, metadata} of encoded.packets) await packets.add(packet, metadata);
  packets.close(); await output.finalize();
  const dir = await mkdtemp(path.join(tmpdir(), 'paper-trail-aac-'));
  try {
    const mp4 = path.join(dir, 'sync.mp4'), pcm = path.join(dir, 'decoded.f32');
    await writeFile(mp4, new Uint8Array(target.buffer));
    const probe = JSON.parse(execFileSync('ffprobe', ['-v','error','-select_streams','a:0','-show_packets','-show_entries','stream=start_time,duration,sample_rate','-of','json',mp4], {encoding:'utf8'}));
    assert.equal(probe.packets[0].pts, -1024);
    assert.equal(probe.packets[0].side_data_list[0].skip_samples, 1024, 'priming is declared in the standard MP4 edit list');
    assert.equal(Number(probe.streams[0].start_time), 0);
    assert.ok(Math.abs(Number(probe.streams[0].duration) - audio.frames / sampleRate) < 1 / sampleRate);
    execFileSync('ffmpeg', ['-v','error','-y','-i',mp4,'-f','f32le','-acodec','pcm_f32le',pcm]);
    const bytes = await readFile(pcm), decoded = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    const scores = [-1024,-3,-2,-1,0,1,2,3,1024].map(lag => ({lag, correlation: correlation(original, decoded, lag)}));
    scores.sort((a,b) => b.correlation - a.correlation);
    assert.equal(scores[0].lag, 0, JSON.stringify(scores));
    assert.ok(scores[0].correlation > .99, `decoded PCM correlation ${scores[0].correlation}`);
  } finally {await rm(dir, {recursive:true,force:true});}
});

test('AAC prepass honors cancellation and can encode again afterward', async () => {
  const canceled = new AbortController(); canceled.abort();
  await assert.rejects(encodeAacForTimeline(fixture(), {signal:canceled.signal}), {name:'AbortError'});
  const active = new AbortController(), timer = setTimeout(() => active.abort(), 10);
  try {await assert.rejects(encodeAacForTimeline(fixture(1), {signal:active.signal}), {name:'AbortError'});}
  finally {clearTimeout(timer);}
  const recovered = await encodeAacForTimeline(fixture(.03));
  assert.equal(recovered.end, .03); assert.ok(recovered.bytes > 0);
});
