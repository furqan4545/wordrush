import { prepareMusicPcm } from './audio-pcm.js';

/**
 * PRESSCUT — deterministic article-camera renderer.
 * All surrounding article copy comes from the credited source's genuine OCR.
 * The input sentence joins that same paragraph; the scan supplies its masthead.
 */
const IMAGE_CACHE = new Map();
const PAGE_WIDTH = 1600;
const PAGE_HEIGHT = 2100;
const FPS = 30;
const INK = '#101011';
const HIGHLIGHT = '#fff000';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function surface(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function loadImage(url) {
  if (!IMAGE_CACHE.has(url)) {
    IMAGE_CACHE.set(url, new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => {
        IMAGE_CACHE.delete(url);
        reject(new Error('The article image could not load. Please try another source.'));
      };
      image.src = url;
    }));
  }
  return IMAGE_CACHE.get(url);
}

function seeded(index, salt = 0) {
  const x = Math.sin(index * 71.71 + salt * 18.23 + 4.26) * 43758.5453;
  return x - Math.floor(x);
}

function makeScene(words, asset, image, sceneIndex) {
  const page = surface(PAGE_WIDTH, PAGE_HEIGHT);
  const context = page.getContext('2d', { alpha: false });
  const paper = '#e7e6e9';
  context.fillStyle = paper;
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

  // Retain the actual scanned masthead. Everything below it is the source's
  // real OCR copy, re-typeset as one continuous newspaper article.
  const mastheadHeight = Math.min(image.naturalHeight, image.naturalWidth * 0.14);
  context.filter = 'grayscale(1) brightness(1.035) contrast(0.89)';
  context.drawImage(image, 0, 0, image.naturalWidth, mastheadHeight, 0, 0, PAGE_WIDTH, PAGE_WIDTH * 0.14);
  context.filter = 'none';
  context.strokeStyle = '#777679';
  context.lineWidth = 1;
  context.beginPath(); context.moveTo(45, 245); context.lineTo(PAGE_WIDTH - 45, 245); context.stroke();

  const originalText = String(asset.articleText || '').replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' ').trim();
  if (!originalText) throw new Error('The original article text could not load. Please choose another newspaper.');
  const articleWords = originalText.split(' ').filter(Boolean);
  const bodyFontSize = Number(asset.bodyFontSize) || 28;
  const fontSize = bodyFontSize / 0.84;
  const family = asset.bodyFont || '"DM Sans", Arial, Helvetica, sans-serif';
  const bodyFont = String(asset.bodyWeight || 500) + ' ' + bodyFontSize + 'px ' + family;
  const font = '900 ' + fontSize + 'px ' + family;
  // Every input word is laid out and drawn in exactly this font, whether it is
  // highlighted or not. The yellow marker never changes glyph size or spacing.
  const lineHeight = fontSize * 1.25;
  const margin = 48;
  const gutter = 40;
  const columns = 3;
  const columnWidth = (PAGE_WIDTH - margin * 2 - gutter * (columns - 1)) / columns;
  const bodyTop = 290;
  const bodyBottom = PAGE_HEIGHT - 65;
  const insertionRow = 20;
  context.font = bodyFont;
  context.textBaseline = 'alphabetic';
  context.fillStyle = INK;
  const bodySpace = context.measureText(' ').width;
  context.font = font;
  const inputSpace = context.measureText(' ').width;
  context.font = bodyFont;
  const placed = [];
  let sourceIndex = sceneIndex * 850;
  let inputIndex = 0;
  let inserting = false;
  let inserted = false;

  for (let column = 0; column < columns; column++) {
    const left = margin + column * (columnWidth + gutter);
    let x = left;
    let baseline = bodyTop;
    let row = 0;
    if (column > 0) {
      context.save(); context.strokeStyle = '#b2b1b4';
      context.beginPath(); context.moveTo(left - gutter / 2, bodyTop - fontSize); context.lineTo(left - gutter / 2, bodyBottom); context.stroke(); context.restore();
    }
    while (baseline < bodyBottom) {
      if (column === 1 && row >= insertionRow && !inserted) { inserting = true; inserted = true; }
      const inputWord = inserting ? words[inputIndex] : null;
      const text = inputWord ? inputWord.text : articleWords[sourceIndex % articleWords.length];
      context.font = inputWord ? font : bodyFont;
      const width = context.measureText(text).width;
      if (x > left && x + width > left + columnWidth) {
        x = left; baseline += lineHeight; row++;
        if (baseline >= bodyBottom) break;
        continue;
      }
      context.fillText(text, x, baseline);
      if (inputWord) {
        const highlight = { x: x - 3.5, y: baseline - fontSize * 0.88, width: width + 7, height: fontSize * 1.12 };
        placed.push({ ...inputWord, x, y: baseline, width, fontSize, fontWeight: 900, space: inputSpace, sceneIndex, highlight });
        inputIndex++;
        if (inputIndex >= words.length) inserting = false;
      } else sourceIndex++;
      x += width + (inputWord ? inputSpace : bodySpace);
    }
  }
  if (placed.length !== words.length) throw new Error('This sentence does not fit the article. Please use fewer words.');
  return { page, words: placed, font, bodyFont, fontSize, bodyFontSize, inputSpace, lineHeight, asset, paper };
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

/**
 * @param {{canvas:HTMLCanvasElement,text:string,width?:number,height?:number,
 * secondsPerWord?:number,motion?:number,motionBlur?:number,textSize?:number,
 * pushPull?:number,wordZoom?:number,sourceMode?:string,assets:Array,
 * onWord?:Function,onTime?:Function,onEnd?:Function}} options
 */
export async function createFilm(options) {
  const {
    canvas, text, assets, onWord, onTime, onEnd,
    width = 1280, height = 720, secondsPerWord = 0.38,
    motionBlur = 0.30, textSize = 200, pushPull, wordZoom, sourceMode = 'paper',
  } = options;
  if (!canvas?.getContext) throw new Error('A video canvas is required.');
  const tokens = String(text || '').trim().split(/\s+/u).filter(Boolean);
  if (!tokens.length) throw new Error('Type a sentence to make your video.');
  if (tokens.length > 60) throw new Error('Please keep this clip to 60 words or fewer.');
  if (!assets?.length) throw new Error('No article images are available. Please reload the page.');
  const isWeb = (asset) => /web|article|website/.test(asset.type || '');
  const filtered = assets.filter((asset) => sourceMode === 'web' ? isWeb(asset) : !isWeb(asset));
  const sources = filtered.length ? filtered : assets;
  const selected = sources.slice(0, 3);
  const loaded = await Promise.all(selected.map(async (asset) => {
    let articleText = asset.articleText;
    if (!articleText && asset.articleTextUrl) {
      const response = await fetch(asset.articleTextUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error('The source article text could not load.');
      articleText = await response.text();
    }
    return { asset: { ...asset, articleText }, image: asset.image || await loadImage(asset.url) };
  }));
  await document.fonts.ready;
  // Load both real faces explicitly before measuring canvas text; a font
  // fallback here would otherwise change line wraps when the faces arrive.
  await Promise.all(loaded.flatMap(({ asset }) => {
    const family = asset.bodyFont || '"DM Sans", Arial, Helvetica, sans-serif';
    const bodySize = Number(asset.bodyFontSize) || 28;
    return [
      document.fonts.load(String(asset.bodyWeight || 500) + ' ' + bodySize + 'px ' + family),
      document.fonts.load('900 ' + (bodySize / 0.84) + 'px ' + family),
    ];
  }));
  const pace = clamp(Number(secondsPerWord) || 0.38, 0.16, 1.5);
  const parsedBlur = Number(motionBlur ?? 0.30);
  const blurStrength = clamp(Number.isFinite(parsedBlur) ? parsedBlur : 0.30, 0, 1);
  const parsedTextSize = Number(textSize ?? 200);
  const fixedTextSize = clamp(Number.isFinite(parsedTextSize) ? parsedTextSize : 200, 60, 280);
  // wordZoom is accepted only as a legacy name for the motion ratio. It never
  // divides the base framing or changes the independently chosen text size.
  const parsedPushPull = Number(pushPull ?? wordZoom ?? 1);
  const pushPullRatio = clamp(Number.isFinite(parsedPushPull) ? parsedPushPull : 1, 1, 2);
  let cursor = 0;
  const timedWords = tokens.map((word, index) => {
    const punctuation = /[.!?][”"']?$/.test(word) ? 1.24 : /[,;:][”"']?$/.test(word) ? 1.1 : 1;
    const wordDuration = pace * punctuation;
    const result = { text: word, index, start: cursor, end: cursor + wordDuration };
    cursor += wordDuration;
    return result;
  });
  const scenes = [];
  for (let start = 0; start < timedWords.length; start += 60) {
    const source = loaded[scenes.length % loaded.length];
    scenes.push(makeScene(timedWords.slice(start, start + 60), source.asset, source.image, scenes.length));
  }
  const words = scenes.flatMap((scene) => scene.words);
  const duration = cursor + Math.min(0.28, pace * 0.55);
  const outputWidth = Math.max(240, Math.round(width / 2) * 2);
  const outputHeight = Math.max(240, Math.round(height / 2) * 2);
  // A single page scale serves every word, including long words and line wraps.
  // textSize is the input font's output size at a 720px short edge. No word-width
  // autofit or saved zoom value is allowed to change this framing.
  const basePaperScale = fixedTextSize * (Math.min(outputWidth, outputHeight) / 720) / scenes[0].fontSize;
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext('2d', { alpha: false });
  const sampleCanvas = surface(outputWidth, outputHeight);
  const sampleContext = sampleCanvas.getContext('2d', { alpha: false });
  // Lens defocus lives in viewport pixels, after the paper's world transform.
  // The same cached mask is used for every frame and all four viewport edges.
  const resolutionScale = Math.min(outputWidth, outputHeight) / 720;
  const edgeDefocus = 6 * resolutionScale;
  const centerDefocus = 0.45 * resolutionScale;
  const lensPadding = Math.ceil(edgeDefocus * 3) + 1;
  const lensSource = surface(outputWidth + lensPadding * 2, outputHeight + lensPadding * 2);
  const lensSourceContext = lensSource.getContext('2d', { alpha: false });
  const lensLayer = surface(outputWidth, outputHeight);
  const lensContext = lensLayer.getContext('2d');
  const lensMask = surface(outputWidth, outputHeight);
  const maskContext = lensMask.getContext('2d');
  maskContext.save();
  maskContext.translate(outputWidth / 2, outputHeight / 2);
  maskContext.scale(outputWidth / 2, outputHeight / 2);
  const edgeMask = maskContext.createRadialGradient(0, 0, 0, 0, 0, 1);
  edgeMask.addColorStop(0, 'rgba(255,255,255,0)');
  edgeMask.addColorStop(0.26, 'rgba(255,255,255,0)');
  edgeMask.addColorStop(0.52, 'rgba(255,255,255,0.12)');
  edgeMask.addColorStop(0.78, 'rgba(255,255,255,0.62)');
  edgeMask.addColorStop(1, 'rgba(255,255,255,1)');
  maskContext.fillStyle = edgeMask;
  maskContext.fillRect(-1, -1, 2, 2);
  maskContext.restore();
  let currentTime = 0;
  let playing = false;
  let disposed = false;
  let raf = 0;
  let playOrigin = 0;
  let lastNotifiedWord = -1;

  function indexAt(time) {
    for (let index = 0; index < words.length; index++) {
      if (time < words[index].end) return index;
    }
    return words.length - 1;
  }

  function focusFor(word, atTime) {
    const local = clamp((atTime - word.start) / (word.end - word.start), 0, 1);
    const excursion = Math.sin(Math.PI * local) ** 2;
    return {
      x: word.highlight.x + word.highlight.width / 2,
      y: word.highlight.y + word.highlight.height / 2,
      // Exactly 1 means translation only, at every instant. Larger ratios make
      // a smooth base→base*ratio→base excursion, continuous at word boundaries.
      scale: pushPullRatio === 1 ? basePaperScale : basePaperScale * (1 + (pushPullRatio - 1) * excursion),
      angle: 0,
    };
  }

  function cameraAt(time) {
    const bounded = clamp(time, 0, duration);
    const index = indexAt(bounded);
    const word = words[index];
    const target = focusFor(word, bounded);
    const local = (bounded - word.start) / (word.end - word.start);
    if (index === 0) {
      return { ...target, word, scene: scenes[word.sceneIndex], transition: false };
    }
    const previous = words[index - 1];
    const samePage = previous.sceneIndex === word.sceneIndex;
    const transitionLength = 0.25;
    if (local < transitionLength && samePage) {
      const previousFocus = focusFor(previous, previous.end);
      const amount = smooth(local / transitionLength);
      return {
        x: mix(previousFocus.x, target.x, amount),
        y: mix(previousFocus.y, target.y, amount),
        scale: pushPullRatio === 1 ? basePaperScale : mix(previousFocus.scale, target.scale, amount),
        angle: mix(previousFocus.angle, target.angle, amount),
        word, scene: scenes[word.sceneIndex], transition: true,
      };
    }
    return { ...target, word, scene: scenes[word.sceneIndex], transition: false };
  }

  function drawSample(time, targetContext) {
    const camera = cameraAt(time);
    const { scene } = camera;
    targetContext.save();
    targetContext.setTransform(1, 0, 0, 1, 0, 0);
    targetContext.filter = 'none';
    targetContext.fillStyle = scene.paper;
    targetContext.fillRect(0, 0, outputWidth, outputHeight);
    targetContext.translate(outputWidth * 0.5, outputHeight * 0.5);
    targetContext.rotate(camera.angle);
    targetContext.scale(camera.scale, camera.scale);
    targetContext.translate(-camera.x, -camera.y);
    targetContext.drawImage(scene.page, 0, 0);
    targetContext.restore();
  }

  function applyLensBlur() {
    const p = lensPadding;
    const w = outputWidth;
    const h = outputHeight;
    // Clamp the viewport's edge pixels into a padded source. Gaussian sampling
    // then has real paper outside the crop and never adds dark/transparent rims.
    lensSourceContext.drawImage(canvas, p, p);
    lensSourceContext.drawImage(canvas, 0, 0, 1, h, 0, p, p, h);
    lensSourceContext.drawImage(canvas, w - 1, 0, 1, h, p + w, p, p, h);
    lensSourceContext.drawImage(canvas, 0, 0, w, 1, p, 0, w, p);
    lensSourceContext.drawImage(canvas, 0, h - 1, w, 1, p, p + h, w, p);
    lensSourceContext.drawImage(canvas, 0, 0, 1, 1, 0, 0, p, p);
    lensSourceContext.drawImage(canvas, w - 1, 0, 1, 1, p + w, 0, p, p);
    lensSourceContext.drawImage(canvas, 0, h - 1, 1, 1, 0, p + h, p, p);
    lensSourceContext.drawImage(canvas, w - 1, h - 1, 1, 1, p + w, p + h, p, p);

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.filter = 'blur(' + centerDefocus + 'px)';
    context.drawImage(lensSource, -p, -p);
    context.restore();

    lensContext.save();
    lensContext.setTransform(1, 0, 0, 1, 0, 0);
    lensContext.clearRect(0, 0, w, h);
    lensContext.globalCompositeOperation = 'source-over';
    lensContext.filter = 'blur(' + edgeDefocus + 'px)';
    lensContext.drawImage(lensSource, -p, -p);
    lensContext.filter = 'none';
    lensContext.globalCompositeOperation = 'destination-in';
    lensContext.drawImage(lensMask, 0, 0);
    lensContext.restore();

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.filter = 'none';
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.drawImage(lensLayer, 0, 0);
    context.restore();
  }

  function drawFocusedWord(camera) {
    if (camera.transition) return;
    const { word, scene } = camera;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.filter = 'none';
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.translate(outputWidth * 0.5, outputHeight * 0.5);
    context.rotate(camera.angle);
    context.scale(camera.scale, camera.scale);
    context.translate(-camera.x, -camera.y);
    context.fillStyle = HIGHLIGHT;
    context.fillRect(word.highlight.x, word.highlight.y, word.highlight.width, word.highlight.height);
    // Identical font, size, baseline and x as the unhighlighted paragraph glyph.
    // Only the yellow marker and the lens focus change when this word is active.
    context.font = scene.font;
    context.textBaseline = 'alphabetic';
    context.fillStyle = INK;
    context.fillText(word.text, word.x, word.y);
    context.restore();
  }

  function render(time = currentTime, notify = true) {
    if (disposed) return;
    currentTime = clamp(Number(time) || 0, 0, duration);
    const camera = cameraAt(currentTime);
    // Shutter is independent from push/pull intensity. Zero keeps the page
    // tracking between words but entirely removes temporal motion smear.
    const shutter = Math.min(0.065, pace * 0.19) * blurStrength;
    const moving = camera.transition && blurStrength > 0;
    let samples = 1;
    let sampleSoftness = 0;
    if (moving) {
      const shutterStart = cameraAt(clamp(currentTime - shutter / 2, 0, duration));
      const shutterEnd = cameraAt(clamp(currentTime + shutter / 2, 0, duration));
      const averageScale = (shutterStart.scale + shutterEnd.scale) / 2;
      const travel = Math.hypot(
        (shutterEnd.x - shutterStart.x) * averageScale,
        (shutterEnd.y - shutterStart.y) * averageScale,
      ) + Math.abs(shutterEnd.scale - shutterStart.scale) * Math.max(outputWidth, outputHeight) * 0.4;
      samples = clamp(Math.ceil(travel / 8) + 1, 3, 27);
      // A narrow reconstruction softness bridges the distance between temporal
      // samples. Without it, a fast pan shows discrete duplicate glyphs instead
      // of the continuous photographic streak visible in the reference.
      sampleSoftness = clamp(travel / Math.max(1, samples - 1) * 0.32 * blurStrength, 0, 8 * blurStrength);
    }
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.filter = sampleSoftness ? 'blur(' + sampleSoftness + 'px)' : 'none';
    for (let sample = 0; sample < samples; sample++) {
      const sampleTime = samples === 1
        ? currentTime
        : currentTime + ((sample / (samples - 1)) - 0.5) * shutter;
      drawSample(clamp(sampleTime, 0, duration), sampleContext);
      // Running weighted average of opaque camera samples gives true temporal
      // motion blur with no retained frames, trails, or playback-rate dependency.
      context.globalAlpha = 1 / (sample + 1);
      context.drawImage(sampleCanvas, 0, 0);
    }
    context.globalAlpha = 1;
    context.restore();
    applyLensBlur();
    drawFocusedWord(camera);
    if (notify) {
      const settledIndex = camera.transition ? Math.max(0, camera.word.index - 1) : camera.word.index;
      if (settledIndex !== lastNotifiedWord) {
        lastNotifiedWord = settledIndex;
        onWord?.(words[settledIndex], settledIndex);
      }
      onTime?.(currentTime, duration);
    }
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(raf);
  }

  function loop(now) {
    if (!playing || disposed) return;
    const next = (now - playOrigin) / 1000;
    render(next);
    if (next >= duration) {
      pause();
      onEnd?.();
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  function play() {
    if (disposed || playing) return;
    if (currentTime >= duration - 0.01) currentTime = 0;
    playing = true;
    playOrigin = performance.now() - currentTime * 1000;
    raf = requestAnimationFrame(loop);
  }

  function seek(time) {
    render(time);
    if (playing) playOrigin = performance.now() - currentTime * 1000;
  }

  function dispose() {
    pause();
    disposed = true;
    for (const scene of scenes) { scene.page.width = 1; scene.page.height = 1; }
    sampleCanvas.width = 1;
    sampleCanvas.height = 1;
    for (const buffer of [lensSource, lensLayer, lensMask]) { buffer.width = 1; buffer.height = 1; }
  }

  const film = {
    canvas, width: outputWidth, height: outputHeight, fps: FPS,
    duration, words, sources: selected, motionBlur: blurStrength,
    textSize: fixedTextSize, pushPull: pushPullRatio, wordZoom: pushPullRatio,
    render, play, pause, seek, dispose,
    getTime: () => currentTime,
    getCameraScale: (time = currentTime) => cameraAt(clamp(Number(time) || 0, 0, duration)).scale,
    isPlaying: () => playing,
    isDisposed: () => disposed,
  };
  render(0);
  return film;
}

const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_CHANNELS = 2;

function audioError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

/** Checks codec support without downloading or decoding the selected music. */
export async function getAudioExportSupport(format = 'mp4') {
  if (format === 'webm') {
    const supported = typeof window !== 'undefined'
      && !!(window.AudioContext || window.webkitAudioContext)
      && 'MediaRecorder' in window
      && ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .some((type) => MediaRecorder.isTypeSupported(type));
    return supported
      ? { supported: true, codec: 'opus', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: AUDIO_CHANNELS }
      : { supported: false, code: 'WEBM_AUDIO_UNAVAILABLE', message: 'This browser cannot export a WebM video with music.' };
  }
  // Music encoding does not depend on native AudioEncoder/AudioData. Some
  // iPhone WebKit versions return invalid AAC metadata despite reporting support.
  return typeof WebAssembly !== 'undefined' && typeof Worker !== 'undefined'
    ? { supported: true, codec: 'mp4a.40.2', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: AUDIO_CHANNELS }
    : { supported: false, code: 'AUDIO_ENCODER_UNAVAILABLE', message: 'This browser cannot prepare music for MP4 export.' };
}

function normalizeExportAudio(audio) {
  if (!audio) return null;
  const parsedVolume = Number(audio.volume ?? 1);
  const volume = clamp(Number.isFinite(parsedVolume) ? parsedVolume : 1, 0, 1);
  if (volume === 0) return null;
  const buffer = audio.buffer;
  if (!buffer || typeof buffer.getChannelData !== 'function' || !(buffer.length > 0) || !(buffer.duration > 0) || !(buffer.numberOfChannels > 0)) {
    throw audioError('AUDIO_BUFFER_INVALID', 'The selected music could not be decoded. Choose the track again.');
  }
  const parsedFade = Number(audio.fadeOut ?? 0.15);
  const loop = audio.loop !== false;
  const parsedStart = Number(audio.startTime ?? audio.offset ?? 0);
  const requestedStart = Math.max(0, Number.isFinite(parsedStart) ? parsedStart : 0);
  const startTime = loop ? requestedStart % buffer.duration : Math.min(requestedStart, buffer.duration);
  return { buffer, volume, loop, startTime, fadeOut: Number.isFinite(parsedFade) ? Math.max(0, parsedFade) : 0.15 };
}

function scheduleMusic(context, destination, audio, start, duration) {
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = audio.buffer;
  source.loop = audio.loop;
  source.loopStart = 0;
  source.loopEnd = audio.buffer.duration;
  gain.gain.setValueAtTime(audio.volume, start);
  const fade = Math.min(duration, audio.fadeOut);
  if (fade > 0) {
    gain.gain.setValueAtTime(audio.volume, start + duration - fade);
    gain.gain.linearRampToValueAtTime(0, start + duration);
  }
  source.connect(gain);
  gain.connect(destination);
  // Offset is expressed in the decoded buffer's native seconds. Web Audio
  // applies it before resampling, identically for offline AAC and live WebM.
  source.start(start, audio.startTime);
  source.stop(start + duration);
  return { source, gain };
}

async function encodeAac(audio, duration, muxer, onProgress, signal) {
  const { encodeMusicAac } = await import('./vendor/music-aac.js');
  let firstTimestamp = null;
  let chunksAdded = 0;
  const endTimestamp = Math.round(duration * 1000000);
  try {
    await encodeMusicAac(audio, (packet, metadata) => {
      if (firstTimestamp === null) firstTimestamp = packet.timestamp;
      const timestamp = Math.max(0, Math.round((packet.timestamp - firstTimestamp) * 1000000));
      if (timestamp >= endTimestamp) return;
      const chunkDuration = Math.min(Math.round(packet.duration * 1000000), endTimestamp - timestamp);
      muxer.addAudioChunkRaw(packet.data, packet.type, timestamp, chunkDuration, metadata);
      chunksAdded++;
    }, onProgress, signal);
    if (!chunksAdded) throw new Error('The music encoder returned no audio.');
  } catch (cause) {
    if (cause.name === 'AbortError') throw cause;
    throw audioError('AUDIO_ENCODING_FAILED', 'The selected music could not be added to this MP4. Please try again.', cause);
  }
}

async function exportMp4(film, onProgress, signal, audio) {
  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) {
    throw new Error('MP4 export is unavailable in this browser. Use Chrome or Edge, or choose WebM.');
  }
  const config = {
    codec: 'avc1.420028',
    width: film.width,
    height: film.height,
    bitrate: Math.max(2_000_000, Math.min(16_000_000, film.width * film.height * 8)),
    framerate: FPS,
    latencyMode: 'quality',
    avc: { format: 'avc' },
  };
  const supported = await VideoEncoder.isConfigSupported(config);
  if (!supported.supported) {
    throw new Error('This browser cannot encode MP4 at this size. Choose WebM or a smaller frame.');
  }
  const count = Math.ceil(film.duration * FPS);
  const duration = count / FPS;
  let renderedAudio = null;
  onProgress?.(0);
  if (audio) {
    const support = await getAudioExportSupport('mp4');
    if (!support.supported) throw audioError(support.code, support.message);
    onProgress?.(0.02);
    renderedAudio = await prepareMusicPcm(audio, duration, { signal });
    abortIfNeeded(signal);
    onProgress?.(0.08);
  }
  const { Muxer, ArrayBufferTarget } = await import('./vendor/mp4-muxer.mjs');
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: film.width, height: film.height, frameRate: FPS },
    ...(audio ? { audio: { codec: 'aac', numberOfChannels: AUDIO_CHANNELS, sampleRate: AUDIO_SAMPLE_RATE } } : {}),
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let encoderError = null;
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
    error: (error) => { encoderError = error; },
  });
  encoder.configure(config);
  const videoStart = audio ? 0.08 : 0;
  const videoWeight = audio ? 0.80 : 0.98;
  try {
    for (let index = 0; index < count; index++) {
      abortIfNeeded(signal);
      if (encoderError) throw encoderError;
      film.render(index / FPS, false);
      const frame = new VideoFrame(film.canvas, {
        timestamp: Math.round(index * 1000000 / FPS),
        duration: Math.round(1000000 / FPS),
      });
      encoder.encode(frame, { keyFrame: index % (FPS * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 5) {
        abortIfNeeded(signal);
        if (encoderError) throw encoderError;
        await tick();
      }
      if (index % 4 === 0) {
        onProgress?.(videoStart + videoWeight * (index + 1) / count);
        await tick();
      }
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
    abortIfNeeded(signal);
    if (renderedAudio) {
      onProgress?.(0.88);
      await encodeAac(renderedAudio, duration, muxer, (progress) => onProgress?.(0.88 + 0.11 * progress), signal);
    }
    abortIfNeeded(signal);
    muxer.finalize();
    onProgress?.(1);
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), extension: 'mp4', mimeType: 'video/mp4', duration };
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
}

async function exportWebm(film, onProgress, signal, audio) {
  if (!film.canvas.captureStream || !('MediaRecorder' in window)) {
    throw new Error('Video export is unavailable in this browser. Please open the app in Edge or Chrome.');
  }
  const mimeType = (audio
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'])
    .find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error('WebM export is unavailable in this browser.');
  const canvasStream = film.canvas.captureStream(FPS);
  const count = Math.ceil(film.duration * FPS);
  const duration = count / FPS;
  let combinedStream = canvasStream;
  let audioContext = null;
  let destination = null;
  let musicNodes = null;
  let recorder = null;
  let done = null;
  let recorderError = null;
  const chunks = [];
  try {
    if (audio) {
      const support = await getAudioExportSupport('webm');
      if (!support.supported) throw audioError(support.code, support.message);
      const Context = window.AudioContext || window.webkitAudioContext;
      audioContext = new Context({ sampleRate: AUDIO_SAMPLE_RATE });
      await audioContext.resume();
      if (audioContext.state !== 'running') throw audioError('AUDIO_CONTEXT_UNAVAILABLE', 'The browser could not start music export. Click Download again.');
      destination = audioContext.createMediaStreamDestination();
      combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
    }
    recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: Math.max(2_000_000, film.width * film.height * 8),
      ...(audio ? { audioBitsPerSecond: 160000 } : {}),
    });
    done = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = resolve;
      recorder.onerror = () => { recorderError = new Error('The browser could not record this video.'); reject(recorderError); };
    });
    done.catch(() => {});
    film.render(0, false);
    abortIfNeeded(signal);
    recorder.start();
    const origin = performance.now();
    if (audio) musicNodes = scheduleMusic(audioContext, destination, audio, audioContext.currentTime, duration);
    let previousFrame = 0;
    while (true) {
      abortIfNeeded(signal);
      if (recorderError) throw recorderError;
      const elapsed = (performance.now() - origin) / 1000;
      if (elapsed >= duration) break;
      const index = Math.min(count - 1, Math.floor(elapsed * FPS));
      if (index !== previousFrame) {
        film.render(index / FPS, false);
        previousFrame = index;
      }
      onProgress?.(Math.min(0.98, elapsed / duration * 0.98));
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.min(12, ((index + 1) / FPS - elapsed) * 1000))));
    }
    recorder.stop();
    await done;
    abortIfNeeded(signal);
    onProgress?.(1);
    return { blob: new Blob(chunks, { type: 'video/webm' }), extension: 'webm', mimeType, duration };
  } finally {
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      await done?.catch(() => {});
    }
    if (musicNodes) {
      try { musicNodes.source.stop(); } catch {}
      musicNodes.source.disconnect();
      musicNodes.gain.disconnect();
    }
    const tracks = new Set([
      ...canvasStream.getTracks(), ...combinedStream.getTracks(), ...(destination?.stream.getTracks() || []),
    ]);
    tracks.forEach((track) => track.stop());
    if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
  }
}

/** Export returns the video Blob; downloading is deliberately owned by the UI.
 * Optional audio: {buffer: AudioBuffer, volume: 0..1, loop: true,
 * startTime: 0, fadeOut: 0.15}. offset is accepted as a startTime alias.
 * Omit audio (or set volume to zero) to retain the original silent-video export.
 */
export async function exportFilm({ film, format = 'mp4', onProgress, signal, audio }) {
  if (!film || film.isDisposed()) throw new Error('Make a preview before exporting.');
  abortIfNeeded(signal);
  const selectedAudio = normalizeExportAudio(audio);
  const previousTime = film.getTime();
  const wasPlaying = film.isPlaying();
  film.pause();
  try {
    return format === 'webm'
      ? await exportWebm(film, onProgress, signal, selectedAudio)
      : await exportMp4(film, onProgress, signal, selectedAudio);
  } finally {
    if (!film.isDisposed()) {
      film.seek(previousTime);
      if (wasPlaying) film.play();
    }
  }
}

export const exportCapabilities = {
  mp4: () => typeof window !== 'undefined' && 'VideoEncoder' in window,
  webm: () => typeof window !== 'undefined' && 'MediaRecorder' in window,
  audio: getAudioExportSupport,
};
