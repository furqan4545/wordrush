import {
  ALL_FORMATS, AudioSample, AudioSampleSource, BufferTarget, CanvasSink,
  CanvasSource, Input, Mp4OutputFormat, Output, Quality, UrlSource,
  canEncodeAudio, canEncodeVideo,
} from 'mediabunny';
import {registerAacEncoder} from '@mediabunny/aac-encoder';
import {drawOverlay, getSourceTime, getTiming, splitText, SYSTEM_FONT} from '../public/browser-typing/scene.js';
import {createSoundtrack, loadBrowserSounds} from '../public/browser-typing/audio.js';

const WIDTH = 1080, HEIGHT = 1920, FPS = 30;
// Safari 27 can stall indefinitely with High/Main AVC in quality mode.
// Match Mediabunny's Constrained Baseline workaround without dropping frames:
// https://github.com/Vanilagy/mediabunny/issues/541
const VIDEO_CODEC = 'avc1.424028';
const ROOT = new URL('./', import.meta.url);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
let rendering = false, assetsPromise;
let registeredAudio = false;

const abortIfNeeded = signal => {
  if (signal?.aborted) throw new DOMException('Export canceled.', 'AbortError');
};
const unsupported = message => Object.assign(new Error(message), {code: 'UNSUPPORTED_EXPORT'});

export function validateBrowserTypingInput({text, pace = 'natural', delay = 1, speed = 1} = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Enter the website you want to type.');
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(text)) throw new Error('Use a single line of text.');
  if (splitText(text).length > 300) throw new Error('Use an address of 300 characters or fewer.');
  if (!['natural', 'quick', 'slow'].includes(pace)) throw new Error('Choose a typing pace.');
  if (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0 || delay > 5) throw new Error('Choose a delay from 0 to 5 seconds.');
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 1 || speed > 3) throw new Error('Choose a video speed from 1× to 3×.');
  return {text, pace, delay, speed};
}

export async function loadBrowserTypingAssets() {
  assetsPromise ??= Promise.all([
    fetch(new URL('media/tracking.json', ROOT)).then(async response => {
      if (!response.ok) throw new Error('The camera tracking could not load. Please try again.');
      const tracking = await response.json();
      if (tracking.width !== WIDTH || tracking.height !== HEIGHT || tracking.fps !== FPS || !tracking.frames?.length) {
        throw new Error('The camera tracking is incomplete. Please reload the page.');
      }
      return tracking;
    }),
    loadBrowserSounds(new URL('audio/', ROOT).href),
  ]).then(([tracking, sounds]) => ({tracking, sounds})).catch(error => {assetsPromise = null; throw error;});
  return assetsPromise;
}

function surface(alpha) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH; canvas.height = HEIGHT;
  const context = canvas.getContext('2d', {alpha, colorSpace: 'srgb'});
  if (!context) throw unsupported('This browser could not prepare a video canvas. Try current Safari, Chrome, or Edge.');
  return {canvas, context};
}

/**
 * Render entirely on this device. The decoder retains only a small canvas pool;
 * no frame archive, local server, account, or uploaded input is needed.
 */
export async function renderBrowserTyping(options = {}) {
  const settings = validateBrowserTypingInput(options);
  if (rendering) throw new Error('A video is already being made.');
  rendering = true;
  const {onProgress, signal} = options;
  let input, output, iterator, picture, overlay, lastProgress = 0;
  const progress = (value, stage) => {
    lastProgress = Math.max(lastProgress, Math.min(1, value));
    onProgress?.({progress: lastProgress, stage});
  };
  const abort = () => {input?.dispose(); void output?.cancel().catch(() => {});};
  signal?.addEventListener('abort', abort, {once: true});
  try {
    abortIfNeeded(signal);
    progress(.01, 'Checking your browser');
    if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
      throw unsupported('Video export needs a current version of Safari, Chrome, or Edge.');
    }
    const videoQuality = new Quality({bitrate: 9_000_000});
    const audioQuality = new Quality({bitrate: 192_000});
    if (!await canEncodeVideo('avc', {width: WIDTH, height: HEIGHT, frameRate: FPS, quality: videoQuality, fullCodecString: VIDEO_CODEC})) {
      throw unsupported('This browser cannot create a 1080p MP4. Try current Safari, Chrome, or Edge.');
    }
    // WebKit can report native AAC support while producing unusable decoder
    // descriptions. Wordrush's bundled software AAC keeps every browser equal.
    if (!registeredAudio) {registerAacEncoder(); registeredAudio = true;}
    if (!await canEncodeAudio('aac', {sampleRate: 48000, numberOfChannels: 2, quality: audioQuality})) {
      throw unsupported('The sound encoder could not start. Please try a current browser.');
    }
    abortIfNeeded(signal);
    progress(.04, 'Preparing your shot and sounds');
    const {tracking, sounds} = await loadBrowserTypingAssets();
    abortIfNeeded(signal);
    await document.fonts.ready;
    await document.fonts.load(`400 13px ${SYSTEM_FONT}`);
    const timing = getTiming(settings.text, settings.pace, tracking.duration, settings.delay, settings.speed);
    const audio = createSoundtrack(timing, sounds);
    if (!(audio.peak > 0)) throw new Error('The sound effects did not load correctly. Please try again.');
    input = new Input({
      formats: ALL_FORMATS,
      source: new UrlSource(new URL('media/clean-base.mp4', ROOT), {
        maxCacheSize: 16 * 1024 * 1024, parallelism: 1,
        getRetryDelay: previousAttempts => previousAttempts > 2 ? null : .25 * previousAttempts,
      }),
    });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !await track.canDecode()) throw unsupported('This browser cannot read the video template. Try current Safari, Chrome, or Edge.');
    abortIfNeeded(signal);
    const sink = new CanvasSink(track, {width: WIDTH, height: HEIGHT, fit: 'fill', alpha: false, poolSize: 1});
    picture = surface(false); overlay = surface(true);
    const target = new BufferTarget();
    output = new Output({format: new Mp4OutputFormat({fastStart: 'in-memory'}), target});
    const video = new CanvasSource(picture.canvas, {codec: 'avc', quality: videoQuality, keyFrameInterval: 2, latencyMode: 'quality', fullCodecString: VIDEO_CODEC});
    const audioSource = new AudioSampleSource({codec: 'aac', quality: audioQuality});
    output.addVideoTrack(video, {frameRate: FPS}); output.addAudioTrack(audioSource);
    await output.start();
    const frameCount = Math.round(timing.duration * FPS);
    // Monotonic access decodes each packet at most once, even when slower
    // typing reuses a source frame. A single canvas is safely reused after add().
    function* timestamps() {
      for (let frame = 0; frame < frameCount; frame++) {
        const sourceTime = getSourceTime(frame / FPS, timing);
        // The approved tracking selects the nearest 30fps camera frame. The
        // decoder's timestamp API selects the previous frame, so quantize it
        // to the same frame and cross the exact timestamp by one microsecond.
        const sourceFrame = Math.round(sourceTime * tracking.fps);
        yield Math.min(tracking.duration - .000001, sourceFrame / tracking.fps + .000001);
      }
    }
    iterator = sink.canvasesAtTimestamps(timestamps());
    let frame = 0, audioFrame = 0;
    progress(.1, 'Making your video');
    for await (const decoded of iterator) {
      abortIfNeeded(signal);
      if (!decoded) throw new Error('A frame of the video could not be decoded. Please try again.');
      picture.context.drawImage(decoded.canvas, 0, 0, WIDTH, HEIGHT);
      drawOverlay(overlay.context, {...settings, time: frame / FPS, tracking});
      picture.context.drawImage(overlay.canvas, 0, 0);
      await video.add(frame / FPS, 1 / FPS);
      const audioEnd = Math.min(audio.frames, Math.round((frame + 1) / FPS * audio.sampleRate));
      if (audioEnd > audioFrame) {
        const sample = new AudioSample({
          // Each chunk owns its buffer. Subarray byte offsets are unsafe in
          // Mediabunny1.61.3's AudioData bridge and can repeat the silent intro.
          data: audio.pcm.slice(audioFrame * audio.channels, audioEnd * audio.channels),
          format: 'f32', numberOfChannels: audio.channels, sampleRate: audio.sampleRate,
          timestamp: audioFrame / audio.sampleRate,
        });
        try {await audioSource.add(sample);} finally {sample.close();}
        audioFrame = audioEnd;
      }
      frame++;
      if (frame % 3 === 0 || frame === frameCount) {
        progress(.1 + .83 * frame / frameCount, 'Making your video');
        await tick();
      }
    }
    if (frame !== frameCount) throw new Error('The template ended before the video was complete. Please try again.');
    abortIfNeeded(signal);
    video.close(); audioSource.close();
    progress(.96, 'Finishing your MP4');
    await output.finalize();
    abortIfNeeded(signal);
    if (!target.buffer?.byteLength) throw new Error('The MP4 could not be finished. Please try again.');
    const blob = new Blob([target.buffer], {type: 'video/mp4'});
    progress(1, 'Your video is ready');
    return {blob, duration: timing.duration, width: WIDTH, height: HEIGHT, hasAudio: true};
  } catch (error) {
    if (output) await output.cancel().catch(() => {});
    abortIfNeeded(signal);
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    try {await iterator?.return();} catch { /* Decoder already stopped on abort. */ }
    input?.dispose();
    if (picture) {picture.canvas.width = 0; picture.canvas.height = 0;}
    if (overlay) {overlay.canvas.width = 0; overlay.canvas.height = 0;}
    rendering = false;
  }
}
