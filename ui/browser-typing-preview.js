import {ALL_FORMATS, CanvasSink, Input, UrlSource} from 'mediabunny';
import {drawOverlay, getSourceTime} from '../public/browser-typing/scene.js';

const ROOT = new URL('./', import.meta.url);
const PREVIEW_WIDTH = 540, PREVIEW_HEIGHT = 960, QUEUE_SIZE = 3;
const aborted = () => new DOMException('Preview canceled.', 'AbortError');
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * A bounded decoded-frame transport. It has no playback clock or audio source:
 * the caller provides the single output clock to render(). Camera and text are
 * composited synchronously into one canvas, so native video paint/seek timing
 * cannot move the caret away from the filmed address bar.
 */
export function createBrowserTypingPreview({canvas, tracking}) {
  if (!canvas?.getContext || !tracking?.frames?.length) throw new Error('The preview canvas or camera tracking is unavailable.');
  const context = canvas.getContext('2d', {alpha: false, colorSpace: 'srgb'});
  if (!context) throw new Error('This browser could not prepare the preview canvas.');
  let active = null, lastRun = null, generation = 0;
  const layer = document.createElement('canvas');
  const outputFrameAt = (time, timing) => clamp(Math.floor(time * tracking.fps), 0,
    Math.round(timing.duration * tracking.fps) - 1);

  function releaseBitmap(frame) {frame?.bitmap?.close();}
  function notifySpace(run) {run.resolveSpace?.(); run.resolveSpace = null;}
  function stop(run, reason = aborted()) {
    if (!run || run.disposed) return;
    run.disposed = true;
    clearTimeout(run.timer);
    run.signal?.removeEventListener('abort', run.onAbort);
    notifySpace(run);
    run.rejectReady(reason);
    run.input?.dispose();
    void run.iterator?.return().catch(() => {});
    for (const frame of run.queue) releaseBitmap(frame);
    run.queue.length = 0;
    releaseBitmap(run.current); run.current = null;
  }

  function dispose() {
    generation++;
    stop(active); active = null;
    layer.width = 0; layer.height = 0;
  }

  async function prepare({timing, startTime = 0, signal, timeout = 20000}) {
    dispose();
    if (signal?.aborted) throw aborted();
    if (!timing || !Number.isFinite(timing.duration) || timing.duration <= 0) throw new Error('The preview timing is unavailable.');
    if (!Number.isFinite(startTime)) throw new Error('The preview position is unavailable.');
    const id = ++generation;
    let resolveReady, rejectReady;
    const ready = new Promise((resolve, reject) => {resolveReady = resolve; rejectReady = reject;});
    const run = {
      id, timing, signal, resolveReady, rejectReady, queue: [], current: null,
      disposed: false, ended: false, decodedCount: 0, error: null,
      selectedOutputTime: null, targetFrame: null, ready: false,
      lastPaintedOutputFrame: null, lastPaintedCameraFrame: null,
    };
    active = run; lastRun = run;
    const isCurrent = () => active === run && generation === id && !run.disposed;
    run.onAbort = () => stop(run);
    signal?.addEventListener('abort', run.onAbort, {once: true});
    run.timer = setTimeout(() => {
      if (!isCurrent() || run.ready) return;
      const error = new Error('The preview took too long to load. Check your connection and tap Play again.');
      run.error = error; stop(run, error);
    }, clamp(timeout, 1000, 60000));

    const bufferReady = () => {
      if (!run.ready && (run.queue.length >= QUEUE_SIZE || (run.ended && run.queue.length))) {
        run.ready = true; clearTimeout(run.timer); resolveReady();
      }
    };
    const pump = async () => {
      if (typeof VideoDecoder === 'undefined' || typeof createImageBitmap === 'undefined') {
        throw new Error('Video preview needs a current version of Safari, Chrome, or Edge.');
      }
      run.input = new Input({formats: ALL_FORMATS, source: new UrlSource(new URL('media/clean-base.mp4', ROOT), {
        maxCacheSize: 16 * 1024 * 1024, parallelism: 1,
        getRetryDelay: attempts => attempts > 2 ? null : .25 * attempts,
      })});
      const track = await run.input.getPrimaryVideoTrack();
      if (!isCurrent()) return;
      if (!track || !await track.canDecode()) throw new Error('This browser could not read the preview video.');
      if (!isCurrent()) return;
      const sink = new CanvasSink(track, {width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, fit: 'fill', alpha: false, poolSize: 1});
      function* timestamps() {
        let previousSourceFrame = -1;
        const firstFrame = outputFrameAt(startTime, timing);
        const lastFrame = outputFrameAt(timing.duration, timing);
        for (let frame = firstFrame; frame <= lastFrame; frame++) {
          const sourceFrame = Math.round(getSourceTime(frame / tracking.fps, timing) * tracking.fps);
          if (sourceFrame === previousSourceFrame) continue;
          previousSourceFrame = sourceFrame;
          // Match export's nearest tracked camera frame. Request only frames
          // needed by the output clock, so three queued frames still provide
          // useful lookahead at 3× without extra bitmap copies or an archive.
          yield Math.min(tracking.duration - .000001, sourceFrame / tracking.fps + .000001);
        }
      }
      run.iterator = sink.canvasesAtTimestamps(timestamps());
      while (isCurrent()) {
        while (run.queue.length >= QUEUE_SIZE && isCurrent()) {
          await new Promise(resolve => {run.resolveSpace = resolve;});
        }
        if (!isCurrent()) break;
        const result = await run.iterator.next();
        if (!isCurrent()) break;
        if (result.done) {
          run.ended = true; bufferReady();
          if (!run.ready) throw new Error('The preview video did not return a camera frame.');
          break;
        }
        const decoded = result.value;
        if (!decoded) continue;
        // CanvasSink owns a single reused canvas. Snapshot only the next few
        // frames; closing discarded ImageBitmaps releases their backing memory.
        const bitmap = await createImageBitmap(decoded.canvas);
        if (!isCurrent()) {bitmap.close(); break;}
        run.queue.push({bitmap, sourcePTS: decoded.timestamp,
          frameIndex: Math.round(decoded.timestamp * tracking.fps)});
        run.decodedCount++;
        bufferReady();
      }
    };
    void pump().catch(error => {
      if (!isCurrent()) return;
      run.error = error;
      if (!run.ready) stop(run, error);
    });
    try {
      await ready;
      if (!isCurrent()) throw aborted();
      if (canvas.width !== tracking.width) canvas.width = tracking.width;
      if (canvas.height !== tracking.height) canvas.height = tracking.height;
      layer.width = tracking.width; layer.height = tracking.height;
      return api;
    } catch (error) {stop(run, error); throw error;}
  }

  function render(outputTime, settings) {
    const run = active;
    if (!run || run.disposed || !run.ready) return null;
    if (run.error) throw run.error;
    if (!Number.isFinite(outputTime)) throw new Error('The preview could not keep time. Tap Play again.');
    const outputFrame = outputFrameAt(outputTime, run.timing);
    const time = outputFrame / tracking.fps;
    const targetFrame = Math.round(getSourceTime(time, run.timing) * tracking.fps);
    run.selectedOutputTime = time; run.targetFrame = targetFrame;
    // Never paint a future decoded frame. If a slow phone is still decoding,
    // retain the last camera frame and bind geometry to that same frame's PTS.
    while (run.queue.length && run.queue[0].frameIndex <= targetFrame) {
      releaseBitmap(run.current);
      run.current = run.queue.shift(); notifySpace(run);
    }
    if (!run.current) return null;
    const presented = {time, sourcePTS: run.current.sourcePTS, frameIndex: run.current.frameIndex, targetFrame};
    // Render at export's 30 fps, even on a 120 Hz phone. Queue selection happens
    // first so a newly decoded camera frame can still catch up within a tick.
    if (run.lastPaintedOutputFrame === outputFrame && run.lastPaintedCameraFrame === run.current.frameIndex) {
      return {...presented, painted: false};
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1; context.filter = 'none'; context.globalCompositeOperation = 'source-over';
    context.drawImage(run.current.bitmap, 0, 0, tracking.width, tracking.height);
    const overlayContext = layer.getContext('2d', {colorSpace: 'srgb'});
    drawOverlay(overlayContext, {...settings, time, tracking, timing: run.timing, cameraTime: run.current.sourcePTS});
    context.drawImage(layer, 0, 0);
    run.lastPaintedOutputFrame = outputFrame; run.lastPaintedCameraFrame = run.current.frameIndex;
    return {...presented, painted: true};
  }

  function getDiagnostics() {
    const run = active ?? lastRun;
    return run ? {
      presentedFrame: run.current?.frameIndex ?? null, sourcePTS: run.current?.sourcePTS ?? null,
      selectedOutputTime: run.selectedOutputTime, targetFrame: run.targetFrame,
      queueLength: run.queue.length, decodedCount: run.decodedCount,
      disposed: run.disposed, ended: run.ended, error: run.error?.message ?? null,
    } : {presentedFrame: null, sourcePTS: null, selectedOutputTime: null, targetFrame: null,
      queueLength: 0, decodedCount: 0, disposed: true, ended: false, error: null};
  }
  const api = {prepare, render, dispose, getDiagnostics};
  return api;
}
