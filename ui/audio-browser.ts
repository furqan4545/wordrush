// @ts-expect-error The deterministic timeline is shared with the browser preview.
import {getAudioEvents} from '../public/scene.js';

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;

type PcmClip = {
  samples: Int16Array;
  frames: number;
  attackOffsetSeconds?: number;
};
type PreparedAsset = {file: string; attackOffsetSeconds?: number};
type SoundManifest = {assets: {enter: PreparedAsset; typingKeys: PreparedAsset[]}};

/** Read prepared WAVs without Web Audio, which is unavailable inside a Worker. */
export function readPcmWav(buffer: ArrayBuffer): PcmClip {
  const view = new DataView(buffer);
  const tag = (at: number) => String.fromCharCode(...new Uint8Array(buffer, at, 4));
  if (buffer.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('A prepared sound is not a WAV file.');
  }
  let pcmStart = -1, pcmBytes = 0, formatValid = false;
  for (let at = 12; at + 8 <= buffer.byteLength;) {
    const name = tag(at), size = view.getUint32(at + 4, true), start = at + 8;
    if (start + size > buffer.byteLength) throw new Error('A prepared WAV is incomplete.');
    if (name === 'fmt ' && size >= 16) {
      formatValid = view.getUint16(start, true) === 1 &&
        view.getUint16(start + 2, true) === CHANNELS &&
        view.getUint32(start + 4, true) === SAMPLE_RATE &&
        view.getUint16(start + 14, true) === 16;
    }
    if (name === 'data') {pcmStart = start; pcmBytes = size;}
    at = start + size + (size % 2);
  }
  if (!formatValid || pcmStart < 0 || pcmBytes % 4) {
    throw new Error('Prepared sounds must be stereo 48 kHz signed 16-bit PCM.');
  }
  const samples = new Int16Array(pcmBytes / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(pcmStart + i * 2, true);
  return {samples, frames: samples.length / CHANNELS};
}

const prepared = new Map<string, Promise<{click: PcmClip; enter: PcmClip; keys: PcmClip[]; transition: PcmClip}>>();

async function loadPreparedSounds(baseUrl: string) {
  const base = new URL(baseUrl);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const key = base.href;
  if (!prepared.has(key)) prepared.set(key, (async () => {
    const assetRoot = new URL('audio/user-sfx-v1/', base);
    const fetchChecked = async (url: URL) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`A prepared sound could not load (${response.status}).`);
      return response;
    };
    const manifest = await (await fetchChecked(new URL('manifest.json', assetRoot))).json() as SoundManifest;
    const load = async (asset: PreparedAsset): Promise<PcmClip> => ({
      ...readPcmWav(await (await fetchChecked(new URL(asset.file, assetRoot))).arrayBuffer()),
      attackOffsetSeconds: asset.attackOffsetSeconds,
    });
    const [click, enter, keys, transition] = await Promise.all([
      load({file: 'click.wav'}),
      load(manifest.assets.enter),
      Promise.all(manifest.assets.typingKeys.map(load)),
      fetchChecked(new URL('audio/transition-sax-v1/transition.wav', base))
        .then(response => response.arrayBuffer()).then(readPcmWav),
    ]);
    if (!keys.length || transition.frames !== SAMPLE_RATE * 5) {
      throw new Error('The approved typing sounds or five-second transition are incomplete.');
    }
    return {click, enter, keys, transition};
  })().catch(error => {prepared.delete(key); throw error;}));
  return prepared.get(key)!;
}

/** Match video/audio.mjs sample-for-sample before the final AAC encoding. */
export async function createBrowserAudio(query: string, baseUrl: string) {
  const schedule = getAudioEvents(query);
  const montageStartFrame = Math.round(schedule.intro * SAMPLE_RATE);
  const intro = new Float32Array(montageStartFrame * CHANNELS);
  const clips = await loadPreparedSounds(baseUrl);
  const clickFrames = Math.min(montageStartFrame, Math.floor(.48 * SAMPLE_RATE), clips.click.frames);
  for (let frame = 0; frame < clickFrames; frame++) {
    for (let channel = 0; channel < CHANNELS; channel++) {
      intro[frame * CHANNELS + channel] = clips.click.samples[frame * CHANNELS + channel] / 32767;
    }
  }
  const mix = (clip: PcmClip, when: number) => {
    const visibleFrameTime = Math.ceil(when * 30 - 1e-7) / 30;
    const start = Math.round((visibleFrameTime - (clip.attackOffsetSeconds || 0)) * SAMPLE_RATE);
    for (let i = 0; i < clip.frames; i++) {
      const frame = start + i;
      if (frame < 0 || frame >= montageStartFrame) continue;
      for (let channel = 0; channel < CHANNELS; channel++) {
        intro[frame * CHANNELS + channel] += clipsample(clip, i, channel) / 32767;
      }
    }
  };
  schedule.typing.forEach((when: number, index: number) => mix(clips.keys[(index * 3) % clips.keys.length], when));
  mix(clips.enter, schedule.enter);

  const frames = montageStartFrame + clips.transition.frames;
  const pcm = new Float32Array(frames * CHANNELS);
  for (let i = 0; i < intro.length; i++) {
    const integer = Math.round(Math.max(-.891, Math.min(.891, intro[i])) * 32767);
    pcm[i] = integer / 32768;
  }
  for (let i = 0; i < clips.transition.samples.length; i++) {
    pcm[intro.length + i] = clips.transition.samples[i] / 32768;
  }
  return {pcm, frames, sampleRate: SAMPLE_RATE, numberOfChannels: CHANNELS,
    duration: schedule.duration, montageStartFrame};
}

function clipsample(clip: PcmClip, frame: number, channel: number) {
  return clip.samples[frame * CHANNELS + channel];
}
