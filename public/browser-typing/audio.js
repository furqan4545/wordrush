// The browser preview and Node export use these same PCM samples and event times.
// Events are already in final output seconds; sample pitch never changes with speed.
export const SAMPLE_RATE = 48000;
export const CHANNELS = 2;

export function decodeWav(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('A sound file is not a WAV recording.');
  let format, channels, sampleRate, bits, blockAlign, dataOffset, dataLength;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true), body = offset + 8;
    if (body + size > bytes.length) throw new Error('A sound file is incomplete.');
    if (tag(offset) === 'fmt ') {
      if (size < 16) throw new Error('A sound file has an invalid format.');
      format = view.getUint16(body, true); channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true); blockAlign = view.getUint16(body + 12, true);
      bits = view.getUint16(body + 14, true);
    } else if (tag(offset) === 'data') {dataOffset = body; dataLength = size;}
    offset = body + size + size % 2;
  }
  if (channels !== CHANNELS || sampleRate !== SAMPLE_RATE || !blockAlign || dataOffset === undefined ||
      !((format === 1 && [16, 24, 32].includes(bits)) || (format === 3 && bits === 32))) {
    throw new Error('Sound effects must be stereo 48 kHz PCM WAV recordings.');
  }
  if (dataLength % blockAlign) throw new Error('A sound file ends partway through a sample.');
  const frames = dataLength / blockAlign, pcm = new Float32Array(frames * channels), sampleBytes = bits / 8;
  for (let i = 0; i < pcm.length; i++) {
    const at = dataOffset + i * sampleBytes;
    let value;
    if (format === 3) value = view.getFloat32(at, true);
    else if (bits === 16) value = view.getInt16(at, true) / 32768;
    else if (bits === 24) {
      let integer = bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16;
      if (integer & 0x800000) integer -= 0x1000000;
      value = integer / 8388608;
    } else value = view.getInt32(at, true) / 2147483648;
    if (!Number.isFinite(value)) throw new Error('A sound file contains invalid samples.');
    pcm[i] = value;
  }
  return {pcm, channels, sampleRate, frames, duration: frames / sampleRate};
}

export async function loadBrowserSounds(baseUrl = './audio/') {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`, globalThis.location?.href);
  const response = await fetch(new URL('manifest.json', base));
  if (!response.ok) throw new Error('The sound effects could not load.');
  const manifest = await response.json();
  const load = async entry => {
    const response = await fetch(new URL(entry.file, base));
    if (!response.ok) throw new Error('A sound effect could not load.');
    return {...decodeWav(await response.arrayBuffer()), ...entry};
  };
  const [click, enter, keys] = await Promise.all([
    load(manifest.assets.click), load(manifest.assets.enter), Promise.all(manifest.assets.keys.map(load)),
  ]);
  return {click, enter, keys, manifest};
}

export function createSoundtrack(timing, assets) {
  if (!timing || !Number.isFinite(timing.duration) || timing.duration <= 0 || timing.duration > 600 ||
      !Array.isArray(timing.events) || !assets?.click || !assets?.enter || !assets?.keys?.length) {
    throw new Error('The sound timing or recordings are unavailable.');
  }
  const frames = Math.ceil(timing.duration * SAMPLE_RATE), pcm = new Float32Array(frames * CHANNELS), events = [];
  const add = (type, at, asset, keyIndex) => {
    if (!Number.isFinite(at) || at < 0 || at >= timing.duration) throw new Error('A sound event is outside the video.');
    if (asset.sampleRate !== SAMPLE_RATE || asset.channels !== CHANNELS || !(asset.pcm instanceof Float32Array)) {
      throw new Error('A sound recording has the wrong sample format.');
    }
    const attack = asset.attackOffsetSeconds ?? 0, gain = asset.gain ?? 1;
    if (!Number.isFinite(attack) || attack < 0 || !Number.isFinite(gain) || gain < 0) throw new Error('A sound recording has invalid timing.');
    const startFrame = Math.round((at - attack) * SAMPLE_RATE);
    const from = Math.max(0, -startFrame), end = Math.min(asset.frames, frames - startFrame);
    for (let i = from; i < end; i++) {
      const destination = (startFrame + i) * CHANNELS, source = i * CHANNELS;
      pcm[destination] += asset.pcm[source] * gain;
      pcm[destination + 1] += asset.pcm[source + 1] * gain;
    }
    events.push({type, at, start: startFrame / SAMPLE_RATE, duration: asset.duration,
      asset: asset.file ?? type, gain, ...(keyIndex !== undefined ? {keyIndex} : {})});
  };
  add('click', timing.focus, assets.click);
  timing.events.forEach((at, index) => {
    // A repeatable, non-adjacent variation pattern avoids a machine-gun repeated key.
    const keyIndex = (index * 5 + Math.floor(index / assets.keys.length) * 3) % assets.keys.length;
    add('typing', at, assets.keys[keyIndex], keyIndex);
  });
  add('enter', timing.enter, assets.enter);
  let rawPeak = 0;
  for (const value of pcm) rawPeak = Math.max(rawPeak, Math.abs(value));
  const headroom = 10 ** (-1 / 20), normalizationGain = rawPeak > headroom ? headroom / rawPeak : 1;
  if (normalizationGain < 1) for (let i = 0; i < pcm.length; i++) pcm[i] *= normalizationGain;
  return {pcm, channels: CHANNELS, sampleRate: SAMPLE_RATE, frames, duration: frames / SAMPLE_RATE,
    events, peak: rawPeak * normalizationGain, rawPeak, normalizationGain};
}

export function encodeWav(track) {
  if (track.sampleRate !== SAMPLE_RATE || track.channels !== CHANNELS || !(track.pcm instanceof Float32Array) ||
      track.pcm.length !== track.frames * CHANNELS) throw new Error('The soundtrack could not be encoded.');
  const dataBytes = track.pcm.length * 2, bytes = new Uint8Array(44 + dataBytes), view = new DataView(bytes.buffer);
  const tag = (offset, value) => {for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);};
  tag(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); tag(8, 'WAVE');
  tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true); view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * CHANNELS * 2, true); view.setUint16(32, CHANNELS * 2, true);
  view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, dataBytes, true);
  for (let i = 0; i < track.pcm.length; i++) {
    const value = Math.max(-1, Math.min(1, track.pcm[i]));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
