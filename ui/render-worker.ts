import {
  AudioSample, AudioSampleSource, BufferTarget, CanvasSource, Mp4OutputFormat,
  Output, Quality, canEncodeAudio, canEncodeVideo,
} from 'mediabunny';
import {registerAacEncoder} from '@mediabunny/aac-encoder';
// @ts-expect-error Shared deterministic Canvas renderer, also used by the preview.
import {drawScene, getTiming, loadAssets, getCutAt, sourceIndexForCut} from '../public/scene.js';
import {createBrowserAudio} from './audio-browser';

type RenderRequest = {
  type: 'render'; word: string; query?: string; baseUrl: string; sources: unknown[]; intensity?: number;
};
const scope = self as unknown as DedicatedWorkerGlobalScope;
let busy = false;
let lastProgress = 0;
const progress = (value: number, stage: string) => {
  lastProgress = Math.max(lastProgress, Math.min(1, value));
  scope.postMessage({type: 'progress', progress: lastProgress, stage});
};
class UnsupportedError extends Error {}

scope.addEventListener('message', async (event: MessageEvent<RenderRequest>) => {
  if (event.data?.type !== 'render') return;
  if (busy) {
    scope.postMessage({type: 'error', code: 'busy', error: 'A video is already being made.', message: 'A video is already being made.'});
    return;
  }
  busy = true;
  lastProgress = 0;
  let output: Output<Mp4OutputFormat, BufferTarget> | undefined;
  let assets: any;
  try {
    const {word, query = word, baseUrl, sources, intensity = .75} = event.data;
    if (typeof word !== 'string' || !word.trim() || !Array.isArray(sources) || sources.length < 50) {
      throw new Error('Enter a phrase and prepare all 50 website frames.');
    }
    progress(.01, 'Checking your browser');
    if (typeof OffscreenCanvas === 'undefined' || typeof VideoEncoder === 'undefined') {
      throw new UnsupportedError('This browser cannot export video here. Try a current version of Chrome, Edge, or Safari.');
    }
    const videoQuality = new Quality({bitrate: 8_000_000});
    const audioQuality = new Quality({bitrate: 192_000});
    if (!(await canEncodeVideo('avc', {width: 1080, height: 1920, frameRate: 30, quality: videoQuality}))) {
      throw new UnsupportedError('This browser cannot encode a 1080p MP4. Try a current version of Chrome, Edge, or Safari.');
    }
    const audioOptions = {sampleRate: 48_000, numberOfChannels: 2, quality: audioQuality};
    const nativeAac = await canEncodeAudio('aac', audioOptions);
    // Use the same official AAC encoder on every browser for consistent output.
    registerAacEncoder();
    if (!(await canEncodeAudio('aac', audioOptions))) {
      throw new UnsupportedError('The MP4 audio encoder could not start in this browser.');
    }

    progress(.03, 'Loading your frames and sounds');
    const [loadedAssets, audio] = await Promise.all([
      loadAssets(baseUrl, sources, word, {lazyTemplates:true}).then((value: unknown) => {progress(.09, 'Website frames ready'); return value;}),
      createBrowserAudio(query, baseUrl).then(value => {progress(.12, 'Soundtrack ready'); return value;}),
    ]);
    assets = loadedAssets;
    let pcmPeak = 0, pcmEnergy = 0, nonZeroSamples = 0;
    for (const value of audio.pcm) {
      pcmPeak = Math.max(pcmPeak, Math.abs(value));
      pcmEnergy += value * value;
      if (value !== 0) nonZeroSamples++;
    }
    if (pcmPeak === 0) throw new Error('The soundtrack contains no audible samples. Please try again.');
    const audioDiagnostics = {encoder: 'wasm-aac', nativeAacAvailable: nativeAac,
      peak: pcmPeak, rms: Math.sqrt(pcmEnergy / audio.pcm.length), nonZeroSamples,
      sampleFrames: audio.frames, sampleRate: audio.sampleRate, channels: audio.numberOfChannels,
      chunkOwnBuffers: true};
    scope.postMessage({type: 'diagnostic', audio: audioDiagnostics});
    const timing = getTiming(query), frameCount = Math.round(timing.duration * 30);
    const canvas = new OffscreenCanvas(1080, 1920), context = canvas.getContext('2d');
    if (!context) throw new UnsupportedError('The video canvas could not start in this browser.');
    const target = new BufferTarget();
    output = new Output({format: new Mp4OutputFormat({fastStart: 'in-memory'}), target});
    const videoSource = new CanvasSource(canvas, {codec: 'avc', quality: videoQuality, keyFrameInterval: 2});
    let audioPackets = 0, audioPacketBytes = 0;
    const audioSource = new AudioSampleSource({codec: 'aac', quality: audioQuality,
      onEncodedPacket: packet => {audioPackets++; audioPacketBytes += packet.data.byteLength;}});
    output.addVideoTrack(videoSource, {frameRate: 30});
    output.addAudioTrack(audioSource);
    await output.start();

    let audioFrame = 0;
    for (let frame = 0; frame < frameCount; frame++) {
      if(frame/30>=timing.intro){const cut=getCutAt(frame/30-timing.intro);await assets.loadSite(sourceIndexForCut(cut.index,assets.sites.length));}
      drawScene(context, {time: frame / 30, word, query, width: 1080, height: 1920, assets, intensity});
      await videoSource.add(frame / 30, 1 / 30);
      const audioEnd = Math.min(audio.frames, Math.round((frame + 1) / 30 * audio.sampleRate));
      if (audioEnd > audioFrame) {
        const sample = new AudioSample({
          // Mediabunny1.61.3 toAudioData reads the backing buffer without a view's
          // byteOffset. Give every chunk its own buffer, or native AAC repeats
          // the soundtrack's silent opening instead of reading later samples.
          data: audio.pcm.slice(audioFrame * audio.numberOfChannels, audioEnd * audio.numberOfChannels),
          format: 'f32', numberOfChannels: audio.numberOfChannels,
          sampleRate: audio.sampleRate, timestamp: audioFrame / audio.sampleRate,
        });
        try {await audioSource.add(sample);} finally {sample.close();}
        audioFrame = audioEnd;
      }
      if (frame % 3 === 0 || frame + 1 === frameCount) {
        progress(.15 + .79 * (frame + 1) / frameCount, `Rendering frame ${frame + 1} of ${frameCount}`);
      }
    }
    videoSource.close();
    audioSource.close();
    progress(.97, 'Finishing your MP4');
    await output.finalize();
    const buffer = target.buffer;
    if (!buffer) throw new Error('The MP4 could not be finalized.');
    progress(1, 'Your video is ready');
    scope.postMessage({type: 'complete', buffer, duration: timing.duration,
      audio: {...audioDiagnostics, encodedPackets: audioPackets, encodedBytes: audioPacketBytes}}, [buffer]);
  } catch (cause) {
    if (output) {try {await output.cancel();} catch { /* Already finalized or canceled. */ }}
    const message = cause instanceof Error ? cause.message : 'The video could not be made. Please try again.';
    scope.postMessage({type: 'error', code: cause instanceof UnsupportedError ? 'unsupported' : 'render-failed', error: message, message});
  } finally {
    for (const site of assets?.sites || []) site.img?.close?.();
    assets?.chromePhoto?.close?.();
    busy = false;
  }
});
