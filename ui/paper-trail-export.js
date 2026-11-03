import {AudioSample, AudioSampleSource, BufferTarget, CanvasSource, EncodedAudioPacketSource, Mp4OutputFormat, NullTarget, Output, Quality, canEncodeAudio, canEncodeVideo} from 'mediabunny';
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

// This installed software encoder wraps FFmpeg's AAC-LC encoder, whose initial_padding is 1024 samples:
// https://www.ffmpeg.org/doxygen/8.1/aacenc_8c_source.html
// aac-encoder 1.61.3 discards the worker's negative pts and starts packet timestamps at zero.
// Preserve every encoded priming packet, then let the MP4 edit list exclude its negative presentation interval.
const AAC_PRIMING_SAMPLES = 1024;

/** Encode the unchanged PCM once and retain its decoder warmup outside the visible video timeline. */
export async function encodeAacForTimeline(audio, {signal} = {}) {
  abortIfNeeded(signal);
  if (!registeredAudio) {registerAacEncoder(); registeredAudio = true;}
  const quality = new Quality({bitrate: 160_000});
  if (!await canEncodeAudio('aac', {sampleRate: audio.sampleRate, numberOfChannels: audio.numberOfChannels, quality})) {
    throw unsupported('The sound encoder could not start. Turn off Sound effects or try a current browser.');
  }
  abortIfNeeded(signal);
  const packets = [];
  let inputFrames = 0, bytes = 0, endFrame = 0, decoderConfig, encoderOutput, source;
  try {
    // NullTarget is Mediabunny's public encoder-events path. Only AAC bytes are retained, never a second movie.
    encoderOutput = new Output({format: new Mp4OutputFormat({fastStart: false}), target: new NullTarget()});
    source = new AudioSampleSource({codec: 'aac', quality, onEncodedPacket: (packet, metadata) => {
      const packetFrames = Math.round(packet.duration * audio.sampleRate);
      if (packetFrames !== AAC_PRIMING_SAMPLES) {
        throw Object.assign(new Error('The sound encoder returned an unexpected frame size.'), {code: 'AUDIO_ENCODING_FAILED'});
      }
      const startFrame = Math.round(packet.timestamp * audio.sampleRate) - AAC_PRIMING_SAMPLES;
      if (startFrame >= audio.frames) return; // Extra flush padding has no presentation interval.
      const frames = Math.min(packetFrames, audio.frames - startFrame);
      const aligned = packet.clone({timestamp: startFrame / audio.sampleRate, duration: frames / audio.sampleRate});
      packets.push({packet: aligned, metadata});
      bytes += aligned.data.byteLength;
      endFrame = Math.max(endFrame, startFrame + frames);
      if (metadata?.decoderConfig) decoderConfig = metadata.decoderConfig;
    }});
    encoderOutput.addAudioTrack(source);
    await encoderOutput.start();
    for (let start = 0; start < audio.frames; start += 4096) {
      abortIfNeeded(signal);
      const end = Math.min(start + 4096, audio.frames);
      const sample = new AudioSample({
        // Own each chunk buffer: avoids the 1.61.3 PCM offset bridge bug without removing samples.
        data: audio.pcm.slice(start * audio.numberOfChannels, end * audio.numberOfChannels),
        format: 'f32', sampleRate: audio.sampleRate, numberOfChannels: audio.numberOfChannels,
        timestamp: start / audio.sampleRate,
      });
      try {await source.add(sample);} finally {sample.close();}
      inputFrames = end;
    }
    abortIfNeeded(signal);
    source.close();
    await encoderOutput.finalize();
    abortIfNeeded(signal);
    if (!(inputFrames === audio.frames && packets.length > 1 && bytes > 0 && endFrame === audio.frames
      && decoderConfig?.numberOfChannels === audio.numberOfChannels
      && decoderConfig?.sampleRate === audio.sampleRate && decoderConfig?.description?.byteLength > 0)) {
      throw Object.assign(new Error('Sound effects could not be included. Please export again.'), {code: 'AUDIO_ENCODING_FAILED'});
    }
    return {packets, bytes, end: endFrame / audio.sampleRate, primingSamples: AAC_PRIMING_SAMPLES};
  } catch (error) {
    if (encoderOutput && encoderOutput.state !== 'finalized' && encoderOutput.state !== 'canceled') await encoderOutput.cancel().catch(() => {});
    abortIfNeeded(signal);
    throw error;
  } finally {
    try {source?.close();} catch { /* Already finalized or canceled. */ }
  }
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
    // Keep the software AAC description valid on Safari, and account for its encoder priming in the container.
    const encodedAudio = audio ? await encodeAacForTimeline(audio, {signal}) : null;
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
    let audioPacketIndex = 0;
    if (encodedAudio) {
      audioSource = new EncodedAudioPacketSource('aac');
      output.addAudioTrack(audioSource);
    }
    output.setMetadataTags({title: 'Paper Trail', comment: 'Created with Wordrush Paper Trail.'});
    await output.start();
    progress(0.03, 'Making your video', {frame: 0, totalFrames: frameCount});
    for (let frame = 0; frame < frameCount; frame++) {
      abortIfNeeded(signal);
      renderFrame(context, scene, frame / fps);
      await source.add(frame / fps, 1 / fps);
      if (encodedAudio) {
        const frameEnd = (frame + 1) / fps;
        while (audioPacketIndex < encodedAudio.packets.length
          && encodedAudio.packets[audioPacketIndex].packet.timestamp < frameEnd) {
          const {packet, metadata} = encodedAudio.packets[audioPacketIndex++];
          await audioSource.add(packet, metadata);
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
    if (encodedAudio && audioPacketIndex !== encodedAudio.packets.length) {
      throw Object.assign(new Error('Sound effects could not be included. Please export again.'), {code: 'AUDIO_ENCODING_FAILED'});
    }
    if (!target.buffer?.byteLength) throw new Error('The MP4 could not be finished. Please try exporting again.');
    const blob = new Blob([target.buffer], {type: 'video/mp4'});
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const mode = String(settings.mode).replace(/[^a-z0-9-]/g, '') || 'paper';
    progress(1, 'Your video is ready', {frame: frameCount, totalFrames: frameCount});
    return {blob, filename: `paper-trail-${mode}-${stamp}.mp4`, width, height, duration: exportedDuration, fps, hasAudio: Boolean(audio),
      audio: audio ? {codec: 'aac', sampleRate: audio.sampleRate, channels: audio.numberOfChannels, peak: audio.peak, packets: encodedAudio.packets.length, bytes: encodedAudio.bytes, end: encodedAudio.end, primingSamples: encodedAudio.primingSamples} : null};
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
