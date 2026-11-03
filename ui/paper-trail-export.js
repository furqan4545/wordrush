import {AudioSample, AudioSampleSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeAudio, canEncodeVideo} from 'mediabunny';
import {registerAacEncoder} from '@mediabunny/aac-encoder';
// The animation engine is shared by the live preview and the finished video.
// The build keeps this relative import external beside public/paper-trail/export.js.
import {normalizeSettings, getDuration, createScene, renderFrame} from './engine.js';
import {normalizeAudioSettings, prepareAudio} from './audio.js';

const CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.420028'];
const CODECS_60 = ['avc1.64002a', 'avc1.4d002a', 'avc1.42002a'];
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
let exporting = false, registeredAudio = false;

export function getExportDimensions(aspect = '9:16', quality = '1080') {
  const edge = String(quality) === '720' ? 720 : 1080;
  if (aspect === '1:1') return {width: edge, height: edge};
  if (aspect === '16:9') return {width: edge / 9 * 16, height: edge};
  return {width: edge, height: edge / 9 * 16};
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new DOMException('Export canceled.', 'AbortError');
}

function unsupported(message) {
  return Object.assign(new Error(message), {code: 'EXPORT_UNSUPPORTED'});
}

async function selectCodec(width, height, bitrate, fps) {
  for (const fullCodecString of fps===60?CODECS_60:CODECS) {
    try {
      if (await canEncodeVideo('avc', {
        width, height, frameRate: fps, quality: new Quality({bitrate}),
        fullCodecString, latencyMode: 'quality',
      })) return fullCodecString;
    } catch { /* A browser can reject one profile while supporting another. */ }
  }
  return null;
}

/** Check the exact dimensions without allocating an output or changing settings. */
export async function getExportSupport(settings = {}, {quality = '1080'} = {}) {
  const normalized = normalizeSettings(settings);
  const fps=normalized.frameRate===30?30:60;
  const {width, height} = getExportDimensions(normalized.aspect, quality);
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return {supported: false, width, height, reason: 'MP4 export needs a current version of Chrome, Edge, or Safari. Open this editor there and try again.'};
  }
  const bitrate = (String(quality) === '720' ? 6_000_000 : 12_000_000)*(fps===60?1.5:1);
  const codec = await selectCodec(width, height, bitrate, fps);
  return codec
    ? {supported: true, width, height, codec, bitrate, fps}
    : {supported: false, width, height, reason: fps===60
      ? 'This browser could not export at 60 fps. Choose 30 fps in Paper & export, or try 720p.'
      : String(quality) === '720'
        ? 'This browser could not start the MP4 encoder. Try the latest Chrome, Edge, or Safari.'
        : 'This browser could not export at 1080p. Choose 720p, or try the latest Chrome, Edge, or Safari.'};
}

/**
 * Render every 30/60fps frame at a deterministic timestamp, then mux H.264 video with optional synchronized AAC effects.
 * Progress callbacks receive {progress: 0..1, stage, frame?, totalFrames?}.
 * An AbortSignal cancels between frames and rejects with AbortError.
 */
export async function exportVideo(rawSettings, {quality = '1080', onProgress, signal} = {}) {
  if (exporting) throw new Error('A video is already exporting. Wait for it to finish or cancel it first.');
  exporting = true;
  let output, source, audioSource, canvas, scene;
  let lastProgress = 0;
  const progress = (value, stage, extra = {}) => {
    lastProgress = Math.max(lastProgress, value);
    onProgress?.({progress: lastProgress, stage, ...extra});
  };
  try {
    abortIfNeeded(signal);
    // Copy before waiting so changes made in the editor never alter an in-flight export.
    const snapshot = JSON.parse(JSON.stringify(rawSettings));
    const settings = {...normalizeSettings(snapshot), ...normalizeAudioSettings(snapshot)};
    progress(0, 'Checking your browser');
    const support = await getExportSupport(settings, {quality});
    abortIfNeeded(signal);
    if (!support.supported) throw unsupported(support.reason);
    const fps=support.fps;

    if (typeof document !== 'undefined' && document.fonts) await document.fonts.ready;
    abortIfNeeded(signal);
    const duration = getDuration(settings);
    if (!(duration > 0) || !Number.isFinite(duration)) throw new Error('Add a text line before exporting.');
    const frameCount = Math.ceil(duration * fps);
    // The exported length lands on an exact frame boundary; no last frame is dropped.
    const exportedDuration = frameCount / fps;
    progress(.01, 'Preparing sound effects');
    const audio = await prepareAudio(settings, {duration: exportedDuration, signal});
    abortIfNeeded(signal);
    const audioQuality = new Quality({bitrate: 160_000});
    if (audio) {
      // Match Wordrush's software AAC path; WebKit native AAC may emit invalid descriptions.
      if (!registeredAudio) {registerAacEncoder(); registeredAudio = true;}
      if (!await canEncodeAudio('aac', {sampleRate: audio.sampleRate, numberOfChannels: audio.numberOfChannels, quality: audioQuality})) {
        throw unsupported('The sound encoder could not start. Turn off Sound effects or try a current browser.');
      }
    }
    abortIfNeeded(signal);
    const {width, height} = support;
    canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), {width, height});
    const context = canvas.getContext('2d', {alpha: false});
    if (!context) throw new Error('The video canvas could not start. Reload the editor and try again.');
    scene = createScene(settings, {width, height});
    const target = new BufferTarget();
    output = new Output({format: new Mp4OutputFormat({fastStart: 'in-memory'}), target});
    source = new CanvasSource(canvas, {
      codec: 'avc', quality: new Quality({bitrate: support.bitrate}),
      fullCodecString: support.codec, latencyMode: 'quality',
      keyFrameInterval: 2, alpha: 'discard',
    });
    output.addVideoTrack(source, {frameRate: fps});
    let audioFrame = 0, audioPackets = 0, audioBytes = 0, audioPacketEnd = 0, audioConfig;
    if (audio) {
      audioSource = new AudioSampleSource({codec: 'aac', quality: audioQuality,
        onEncodedPacket: (packet, metadata) => {
          audioPackets++; audioBytes += packet.data.byteLength;
          audioPacketEnd = Math.max(audioPacketEnd, packet.timestamp + packet.duration);
          if (metadata?.decoderConfig) audioConfig = metadata.decoderConfig;
        },
      });
      output.addAudioTrack(audioSource);
    }
    output.setMetadataTags({title: 'Paper Trail', comment: 'Created with Wordrush Paper Trail.'});
    await output.start();
    progress(0.03, 'Making your video', {frame: 0, totalFrames: frameCount});
    for (let frame = 0; frame < frameCount; frame++) {
      abortIfNeeded(signal);
      renderFrame(context, scene, frame / fps);
      await source.add(frame / fps, 1 / fps);
      if (audio) {
        const end = Math.min(audio.frames, Math.round((frame + 1) / fps * audio.sampleRate));
        if (end > audioFrame) {
          const sample = new AudioSample({
            // Chunks own their buffers to avoid the Mediabunny1.61.3 offset bridge bug.
            data: audio.pcm.slice(audioFrame * audio.numberOfChannels, end * audio.numberOfChannels),
            format: 'f32', sampleRate: audio.sampleRate, numberOfChannels: audio.numberOfChannels,
            timestamp: audioFrame / audio.sampleRate,
          });
          try {await audioSource.add(sample);} finally {sample.close();}
          audioFrame = end;
        }
      }
      if (frame % 2 === 0 || frame === frameCount - 1) {
        progress(0.03 + 0.92 * (frame + 1) / frameCount, 'Making your video', {frame: frame + 1, totalFrames: frameCount});
        // Let input, progress paint, and cancellation run while encoding offline.
        await tick();
      }
    }
    abortIfNeeded(signal);
    source.close(); audioSource?.close();
    progress(0.97, 'Finishing your MP4');
    await output.finalize();
    abortIfNeeded(signal);
    if (audio && !(audioFrame >= audio.frames - 1 && audioPackets > 0 && audioBytes > 0
      && audioPacketEnd >= exportedDuration - .05
      && audioConfig?.numberOfChannels === audio.numberOfChannels
      && audioConfig?.sampleRate === audio.sampleRate && audioConfig?.description?.byteLength > 0)) {
      throw Object.assign(new Error('Sound effects could not be included. Please export again.'), {code:'AUDIO_ENCODING_FAILED'});
    }
    if (!target.buffer?.byteLength) throw new Error('The MP4 could not be finished. Please try exporting again.');
    const blob = new Blob([target.buffer], {type: 'video/mp4'});
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const mode = String(settings.mode).replace(/[^a-z0-9-]/g, '') || 'paper';
    progress(1, 'Your video is ready', {frame: frameCount, totalFrames: frameCount});
    return {blob, filename: `paper-trail-${mode}-${stamp}.mp4`, width, height, duration: exportedDuration, fps, hasAudio: Boolean(audio),
      audio: audio ? {codec: 'aac', sampleRate: audio.sampleRate, channels: audio.numberOfChannels, peak: audio.peak, packets: audioPackets, bytes: audioBytes, end: audioPacketEnd} : null};
  } catch (error) {
    if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {});
    abortIfNeeded(signal);
    if (error?.name === 'NotSupportedError') throw unsupported('The MP4 encoder could not start. Choose 720p or try the latest Chrome, Edge, or Safari.');
    throw error;
  } finally {
    try { source?.close(); } catch { /* Already closed or canceled. */ }
    try { audioSource?.close(); } catch { /* Already closed or canceled. */ }
    scene?.dispose?.();
    if (canvas) {canvas.width = 1; canvas.height = 1;}
    exporting = false;
  }
}
