import { AudioSample, AudioSampleSource, Output, AdtsOutputFormat, NullTarget, Quality } from 'mediabunny';
import { registerAacEncoder } from '@mediabunny/aac-encoder';

// WebKit versions can emit invalid AAC decoder descriptions even when native
// encoding reports success (WebKit 302253). Use the same software AAC as Fast cuts.
registerAacEncoder();

type PreparedMusic = { pcm: Float32Array; frames: number; sampleRate: number; numberOfChannels: number };

export async function encodeMusicAac(
  audio: PreparedMusic,
  onPacket: (packet: { data: Uint8Array; type: 'key' | 'delta'; timestamp: number; duration: number }, metadata: unknown) => void,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
) {
  const checkAbort = () => { if (signal?.aborted) throw new DOMException('Export canceled.', 'AbortError'); };
  checkAbort();
  // The output drives the encoder lifecycle; packets go directly to the movie
  // muxer, so no second audio file is retained in memory.
  const output = new Output({ format: new AdtsOutputFormat(), target: new NullTarget() });
  let packets = 0;
  const source = new AudioSampleSource({ codec: 'aac', quality: new Quality({ bitrate: 160000 }),
    onEncodedPacket: (packet, metadata) => { checkAbort(); onPacket(packet, metadata); packets++; },
  });
  output.addAudioTrack(source);
  const abort = () => { void output.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await output.start();
    for (let offset = 0; offset < audio.frames; offset += 8192) {
      checkAbort();
      const end = Math.min(audio.frames, offset + 8192);
      const sample = new AudioSample({
        data: audio.pcm.slice(offset * audio.numberOfChannels, end * audio.numberOfChannels),
        format: 'f32', sampleRate: audio.sampleRate, numberOfChannels: audio.numberOfChannels,
        timestamp: offset / audio.sampleRate,
      });
      try { await source.add(sample); } finally { sample.close(); }
      onProgress?.(Math.min(.98, end / audio.frames));
    }
    source.close();
    await output.finalize();
    checkAbort();
    if (!packets) throw new Error('The music encoder returned no audio. Please try again.');
    onProgress?.(1);
    return packets;
  } catch (error) {
    await output.cancel().catch(() => {});
    checkAbort();
    throw error;
  } finally { signal?.removeEventListener('abort', abort); }
}
