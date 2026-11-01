const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('Export canceled.', 'AbortError');
}

function stereoMix(numberOfChannels) {
  // Match Web Audio's "speakers" downmix, used by the music preview.
  // https://www.w3.org/TR/webaudio/#down-mix
  if (numberOfChannels === 1) return [[[0, 1]], [[0, 1]]];
  if (numberOfChannels === 4) return [[[0, .5], [2, .5]], [[1, .5], [3, .5]]];
  if (numberOfChannels === 6) {
    // Web Audio order: L, R, C, LFE, SL, SR. LFE is omitted in stereo.
    return [[[0, 1], [2, Math.SQRT1_2], [4, Math.SQRT1_2]],
      [[1, 1], [2, Math.SQRT1_2], [5, Math.SQRT1_2]]];
  }
  // Other layouts use Web Audio's discrete fallback: retain the first pair.
  return [[[0, 1]], [[1, 1]]];
}

/** Prepare just the selected window without starting a live/offline audio context. */
export async function prepareMusicPcm(audio, duration, { signal, onProgress } = {}) {
  checkAbort(signal);
  const buffer = audio.buffer;
  const frames = Math.round(duration * SAMPLE_RATE);
  if (!(frames > 0) || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0) {
    throw new Error('The selected music could not be prepared. Choose the track again.');
  }
  const pcm = new Float32Array(frames * CHANNELS);
  const mix = stereoMix(buffer.numberOfChannels);
  const sourceChannels = buffer.numberOfChannels === 4 || buffer.numberOfChannels === 6 ? buffer.numberOfChannels : Math.min(CHANNELS, buffer.numberOfChannels);
  const channels = Array.from({ length: sourceChannels }, (_, i) => buffer.getChannelData(i));
  const start = audio.startTime * buffer.sampleRate;
  const step = buffer.sampleRate / SAMPLE_RATE;
  const fadeFrames = Math.min(frames, Math.max(0, audio.fadeOut * SAMPLE_RATE));
  let peak = 0, energy = 0;
  for (let block = 0; block < frames; block += 8192) {
    checkAbort(signal);
    const end = Math.min(frames, block + 8192);
    for (let frame = block; frame < end; frame++) {
      const position = start + frame * step;
      if (!audio.loop && position >= buffer.length) continue;
      const wrapped = audio.loop ? position % buffer.length : position;
      const index = Math.floor(wrapped), fraction = wrapped - index;
      const next = index + 1 < buffer.length ? index + 1 : audio.loop ? 0 : index;
      const gain = audio.volume * (fadeFrames ? Math.min(1, (frames - frame) / fadeFrames) : 1);
      for (let channel = 0; channel < CHANNELS; channel++) {
        let mixed = 0;
        for (const [sourceChannel, weight] of mix[channel]) {
          const source = channels[sourceChannel];
          mixed += (source[index] + (source[next] - source[index]) * fraction) * weight;
        }
        const value = mixed * gain;
        pcm[frame * CHANNELS + channel] = value;
        peak = Math.max(peak, Math.abs(value));
        energy += value * value;
      }
    }
    onProgress?.(end / frames);
    await tick();
  }
  checkAbort(signal);
  if (!Number.isFinite(peak) || peak < 1e-8) {
    const error = new Error('This music section is silent. Move the music slider or choose another track.');
    error.code = 'AUDIO_CLIP_SILENT';
    throw error;
  }
  return { pcm, frames, sampleRate: SAMPLE_RATE, numberOfChannels: CHANNELS, peak, rms: Math.sqrt(energy / pcm.length) };
}
