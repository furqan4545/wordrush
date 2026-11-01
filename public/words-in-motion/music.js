/** Local Web Audio preview and export selection. Uploaded audio never leaves this tab. */
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_DURATION = 10 * 60;
const MAX_PCM_BYTES = 256 * 1024 * 1024;
const CACHE_BYTES = 32 * 1024 * 1024;
const AUDITION_SECONDS = 10;
const FADE_OUT = 0.15;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const canceled = () => new DOMException('Music loading canceled.', 'AbortError');
const checkAbort = signal => { if (signal?.aborted) throw canceled(); };

function readDuration(blob, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(blob);
    let done = false;
    const finish = (error, duration) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      error ? reject(error) : resolve(duration);
    };
    const onAbort = () => finish(canceled());
    const timer = setTimeout(() => finish(new Error('This audio file could not be read. Try a WAV or MP3 file.')), 15000);
    signal?.addEventListener('abort', onAbort, { once: true });
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      if (!Number.isFinite(duration) || duration <= 0) finish(new Error('Choose an audio file with a readable duration.'));
      else if (duration > MAX_DURATION) finish(new Error('Choose a music clip no longer than 10 minutes.'));
      else finish(null, duration);
    };
    audio.onerror = () => finish(new Error('This file is not readable audio. Try a WAV or MP3 file.'));
    audio.preload = 'metadata';
    audio.src = url;
    audio.load();
  });
}

/**
 * Synchronous factory; loading, auditioning, and resume() return Promises.
 * onChange reads the public getters. onStatus receives (text, {error, kind}).
 */
export function createMusicController({ onChange, onStatus } = {}) {
  let context;
  let selected = null;
  let selectedStartTime = 0;
  let volume = 0.35;
  let main = null;
  let audition = null;
  let auditionId = null;
  let disposed = false;
  let blockedReported = false;
  let selectionSerial = 0;
  let auditionSerial = 0;
  let customSerial = 0;
  let selectionAbort;
  let auditionAbort;
  let lastSync = { time: 0, playing: false, duration: 0 };
  const cache = new Map();
  const customCache = new Map();

  const change = () => { if (!disposed) onChange?.(); };
  const status = (text, options = {}) => { if (!disposed) onStatus?.(text, options); };
  const metadata = entry => entry ? { ...entry.meta, volume, startTime: getStartTime(), waveform: [...entry.waveform] } : null;

  function selectedWindow() {
    if (!selected) return { startTime: 0, loop: false };
    const duration = selected.buffer.duration;
    const loop = lastSync.duration > duration;
    const maximum = lastSync.duration > 0 ? Math.max(0, duration - lastSync.duration) : duration;
    return { startTime: loop ? 0 : clamp(selectedStartTime, 0, maximum), loop };
  }

  function waveformFor(buffer, supplied) {
    if (Array.isArray(supplied) && supplied.length >= 32 && supplied.every(value => Number.isFinite(Number(value)))) {
      return supplied.map(value => clamp(Number(value), 0, 1));
    }
    const bins = buffer.duration > 30 ? 4096 : 256;
    const samplesPerBin = buffer.duration > 30 ? 64 : 256;
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
    const values = Array.from({ length: bins }, (_, bin) => {
      const start = Math.floor(bin * buffer.length / bins);
      const end = Math.max(start + 1, Math.floor((bin + 1) * buffer.length / bins));
      const stride = Math.max(1, Math.floor((end - start) / samplesPerBin));
      let peak = 0;
      for (let sample = start; sample < end; sample += stride) {
        for (const channel of channels) peak = Math.max(peak, Math.abs(channel[sample] || 0));
      }
      return peak;
    });
    const maximum = Math.max(...values);
    return maximum > 0 ? values.map(value => value / maximum) : values;
  }

  function stopMain() {
    if (!main) return;
    const previous = main;
    main = null;
    previous.source.onended = null;
    try { previous.source.stop(); } catch {}
    previous.source.disconnect();
    previous.gain.disconnect();
  }

  function clearAudition() {
    auditionSerial++;
    auditionAbort?.abort();
    auditionAbort = undefined;
    const previous = audition;
    audition = null;
    auditionId = null;
    if (previous) {
      previous.source.onended = null;
      try { previous.source.stop(); } catch {}
      previous.source.disconnect();
      previous.gain.disconnect();
    }
  }

  function ensureContext() {
    if (disposed) throw new Error('The music player has been closed. Reload the studio.');
    if (!context) {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) throw new Error('This browser cannot play music. Open the studio in Edge or Chrome.');
      try { context = new AudioContextClass({ sampleRate: 48000 }); }
      catch { context = new AudioContextClass(); }
      context.addEventListener('statechange', () => {
        if (disposed) return;
        if (context.state === 'running') { blockedReported = false; sync(lastSync); }
        else stopMain();
      });
    }
    return context;
  }

  async function resume() {
    const audioContext = ensureContext();
    if (audioContext.state === 'running') return true;
    // Init restoration must not await this: browsers can leave a disallowed
    // resume pending. Explicit Play / Use / Audition gestures invoke it early.
    let timer;
    try {
      const resumed = await Promise.race([
        audioContext.resume().then(() => audioContext.state === 'running'),
        new Promise(resolve => { timer = setTimeout(() => resolve(false), 2000); }),
      ]);
      if (!resumed) {
        if (!blockedReported) status('Tap Play to enable music.', { kind: 'autoplay', error: false });
        blockedReported = true;
      } else {
        blockedReported = false;
        sync(lastSync);
      }
      return resumed;
    } catch {
      if (!blockedReported) status('Tap Play to enable music.', { kind: 'autoplay', error: false });
      blockedReported = true;
      return false;
    } finally { clearTimeout(timer); }
  }

  function resumeIfGesture() {
    if (globalThis.navigator?.userActivation?.isActive) void resume().catch(() => {});
  }

  function remember(key, entry) {
    const bytes = entry.buffer.length * entry.buffer.numberOfChannels * 4;
    if (bytes > CACHE_BYTES) return;
    cache.delete(key);
    cache.set(key, entry);
    let total = [...cache.values()].reduce((sum, value) => sum + value.buffer.length * value.buffer.numberOfChannels * 4, 0);
    for (const [oldKey, oldEntry] of cache) {
      if (total <= CACHE_BYTES && cache.size <= 4) break;
      cache.delete(oldKey);
      total -= oldEntry.buffer.length * oldEntry.buffer.numberOfChannels * 4;
    }
  }

  async function decode(blob, signal) {
    checkAbort(signal);
    if (!blob.size) throw new Error('This audio file is empty. Choose another WAV or MP3 file.');
    if (blob.size > MAX_FILE_BYTES) throw new Error('Choose a music file smaller than 40 MB.');
    await readDuration(blob, signal);
    checkAbort(signal);
    const bytes = await blob.arrayBuffer();
    checkAbort(signal);
    let buffer;
    try { buffer = await ensureContext().decodeAudioData(bytes); }
    catch (error) {
      checkAbort(signal);
      throw new Error('This audio could not be decoded. Try a WAV or MP3 file.');
    }
    checkAbort(signal);
    if (!buffer.length || !buffer.duration || buffer.duration > MAX_DURATION + 0.1) {
      throw new Error('Choose a readable music clip no longer than 10 minutes.');
    }
    if (buffer.length * buffer.numberOfChannels * 4 > MAX_PCM_BYTES) {
      throw new Error('This audio needs too much memory. Choose a shorter stereo WAV or MP3 clip.');
    }
    return buffer;
  }

  async function trackEntry(track, signal) {
    checkAbort(signal);
    if (!track || typeof track !== 'object') throw new Error('Choose a music track.');
    const id = String(track.id || track.url || track.src || '');
    if (selected?.meta.id === id) return selected;
    if (customCache.has(id)) return customCache.get(id);
    if (track.isCustom) throw new Error('This imported music is no longer in this tab. Import the file again.');
    const path = track.url || track.src;
    if (!path || typeof path !== 'string') throw new Error('This music track could not be found. Choose another track.');
    const key = new URL(path, import.meta.url).href;
    if (cache.has(key)) return cache.get(key);
    const response = await fetch(key, { signal });
    if (!response.ok) throw new Error('This music track could not load. Please try another track.');
    const declaredSize = Number(response.headers.get('content-length'));
    if (declaredSize > MAX_FILE_BYTES) throw new Error('Choose a music file smaller than 40 MB.');
    let buffer = await decode(await response.blob(), signal);
    // Bundled original compositions carry their exact musical loop length.
    // Remove only their documented encoder padding, never uploaded audio.
    const loopDuration = Number(track.loopDuration);
    if (Number.isFinite(loopDuration) && loopDuration > 0 && loopDuration < buffer.duration && buffer.duration - loopDuration < 0.2) {
      const frames = Math.round(loopDuration * buffer.sampleRate);
      const trimmed = ensureContext().createBuffer(buffer.numberOfChannels, frames, buffer.sampleRate);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) trimmed.copyToChannel(buffer.getChannelData(channel).subarray(0, frames), channel);
      buffer = trimmed;
    }
    const entry = { buffer, waveform: waveformFor(buffer, track.waveform), meta: { ...track, id, title: String(track.title || 'Music track'), duration: buffer.duration, isCustom: false } };
    remember(key, entry);
    return entry;
  }

  async function loadTrack(track) {
    if (!track || track.id === 'none') { selectNone(); return null; }
    resumeIfGesture();
    const ticket = ++selectionSerial;
    selectionAbort?.abort();
    const controller = new AbortController();
    selectionAbort = controller;
    try {
      const entry = await trackEntry(track, controller.signal);
      if (disposed || ticket !== selectionSerial) throw canceled();
      clearAudition();
      stopMain();
      if (selected?.meta.id !== entry.meta.id) selectedStartTime = 0;
      selected = entry;
      change();
      return getSelection();
    } catch (error) {
      if (error.name !== 'AbortError' && ticket === selectionSerial) status(error.message || 'This music could not load.', { error: true, kind: 'load' });
      throw error;
    } finally { if (selectionAbort === controller) selectionAbort = undefined; }
  }

  async function loadFile(file) {
    if (!(file instanceof Blob)) throw new Error('Choose a WAV or MP3 music file.');
    const name = String(file.name || 'Your music');
    const type = String(file.type || '').toLowerCase();
    const audioMime = /^audio\//.test(type) || ['application/ogg', 'video/mp4'].includes(type);
    const knownExtension = /\.(mp3|wav|wave|m4a|aac|ogg|oga|flac|aif|aiff|webm|mp4)$/i.test(name);
    if (!audioMime && !knownExtension) throw new Error('Choose a WAV, MP3, or another supported audio file.');
    resumeIfGesture();
    const ticket = ++selectionSerial;
    selectionAbort?.abort();
    const controller = new AbortController();
    selectionAbort = controller;
    try {
      const buffer = await decode(file, controller.signal);
      if (disposed || ticket !== selectionSerial) throw canceled();
      const entry = { buffer, waveform: waveformFor(buffer), meta: { id: `custom-${++customSerial}`, title: name.replace(/\.[^.]+$/, ''), fileName: name, duration: buffer.duration, isCustom: true } };
      clearAudition();
      stopMain();
      customCache.clear();
      customCache.set(entry.meta.id, entry);
      selectedStartTime = 0;
      selected = entry;
      change();
      return getSelection();
    } catch (error) {
      if (error.name !== 'AbortError' && ticket === selectionSerial) status(error.message || 'This music file could not load.', { error: true, kind: 'load' });
      throw error;
    } finally { if (selectionAbort === controller) selectionAbort = undefined; }
  }

  function selectNone() {
    selectionSerial++;
    selectionAbort?.abort();
    selectionAbort = undefined;
    clearAudition();
    stopMain();
    selected = null;
    selectedStartTime = 0;
    change();
  }

  function getSelection() { return metadata(selected); }
  function getStartTime() { return selectedWindow().startTime; }
  function getWaveform() { return selected ? [...selected.waveform] : []; }
  function getExportAudio() {
    if (!selected || volume === 0) return null;
    const window = selectedWindow();
    return { buffer: selected.buffer, volume, loop: window.loop, fadeOut: FADE_OUT, startTime: window.startTime };
  }

  function sync({ time = 0, playing = false, duration = 0 } = {}) {
    if (disposed) return;
    const t = Number(time);
    const d = Number(duration);
    const previousDuration = lastSync.duration;
    lastSync = { time: Number.isFinite(t) ? Math.max(0, t) : 0, playing: !!playing, duration: Number.isFinite(d) ? Math.max(0, d) : 0 };
    if (selected && lastSync.duration > 0 && lastSync.duration !== previousDuration) {
      // Commit the visible clamp once when the cut changes. Retaining an older,
      // now hidden offset would otherwise make it reappear on a shorter cut.
      selectedStartTime = selectedWindow().startTime;
    }
    if (selected && audition && auditionId === selected.meta.id && context?.state === 'running') {
      const next = auditionWindow(selected, selected.meta.id);
      if (audition.startTime !== next.startTime || audition.duration !== next.duration || audition.loop !== next.loop) {
        clearAudition();
        const ticket = ++auditionSerial;
        auditionId = selected.meta.id;
        beginAudition(selected, selected.meta.id, ticket);
      }
    }
    if (!selected || volume === 0 || auditionId !== null || !lastSync.playing || (lastSync.duration > 0 && lastSync.time >= lastSync.duration)) { stopMain(); return; }
    if (!context || context.state !== 'running') {
      stopMain();
      if (!blockedReported) { status('Tap Play to enable music.', { kind: 'autoplay', error: false }); blockedReported = true; }
      return;
    }
    const now = context.currentTime;
    const window = selectedWindow();
    const expected = main ? main.filmStart + now - main.clockStart : 0;
    if (main && (Math.abs(lastSync.time - expected) > 0.15 || lastSync.time + 0.04 < main.lastTime || main.startTime !== window.startTime || main.loop !== window.loop)) stopMain();
    if (!main) {
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = selected.buffer;
      source.loop = window.loop;
      gain.gain.value = 0;
      source.connect(gain).connect(context.destination);
      const offset = window.startTime + lastSync.time;
      source.start(now, window.loop ? offset % selected.buffer.duration : Math.min(offset, selected.buffer.duration));
      main = { source, gain, filmStart: lastSync.time, clockStart: now, lastTime: lastSync.time, startTime: window.startTime, loop: window.loop };
    }
    main.lastTime = lastSync.time;
    const remaining = lastSync.duration > 0 ? lastSync.duration - lastSync.time : Infinity;
    const targetGain = volume * clamp(remaining / FADE_OUT, 0, 1);
    main.gain.gain.setTargetAtTime(targetGain, now, 0.008);
  }

  function auditionWindow(entry, id) {
    const isSelected = selected?.meta.id === id;
    const window = isSelected ? selectedWindow() : { startTime: 0, loop: false };
    const offset = window.loop ? window.startTime % entry.buffer.duration : window.startTime;
    const clipDuration = isSelected && lastSync.duration > 0 ? lastSync.duration : AUDITION_SECONDS;
    const duration = Math.min(clipDuration, window.loop ? Infinity : entry.buffer.duration - offset);
    return { startTime: offset, duration, loop: window.loop };
  }

  function beginAudition(entry, id, ticket) {
    const window = auditionWindow(entry, id);
    const { startTime: offset, duration } = window;
    if (duration <= 0) {
      audition = null; auditionId = null;
      status('Move the music window earlier to preview this track.', { error: false, kind: 'audition' });
      return false;
    }
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = entry.buffer;
    source.loop = window.loop;
    gain.gain.value = volume;
    source.connect(gain).connect(context.destination);
    audition = { source, gain, startTime: offset, duration, loop: window.loop };
    source.onended = () => {
      if (ticket !== auditionSerial || disposed) return;
      source.disconnect(); gain.disconnect();
      audition = null; auditionId = null; auditionAbort = undefined;
      change();
    };
    source.start(0, offset, duration);
    return true;
  }

  function setStartTime(seconds) {
    if (!selected) return 0;
    const parsed = Number(seconds);
    if (!Number.isFinite(parsed)) return getStartTime();
    const maximum = lastSync.duration > 0 ? Math.max(0, selected.buffer.duration - lastSync.duration) : selected.buffer.duration;
    const next = clamp(parsed, 0, maximum);
    if (next === selectedStartTime) return getStartTime();
    const restartAudition = !!audition && auditionId === selected.meta.id;
    selectedStartTime = next;
    stopMain();
    if (restartAudition && context?.state === 'running') {
      clearAudition();
      const ticket = ++auditionSerial;
      auditionId = selected.meta.id;
      beginAudition(selected, selected.meta.id, ticket);
    }
    sync(lastSync);
    change();
    return getStartTime();
  }

  async function previewTrack(track) {
    if (!track) { stopAudition(); return false; }
    const id = String(track.id || track.url || track.src || '');
    if (auditionId === id) { stopAudition(); return false; }
    clearAudition();
    stopMain();
    const ticket = ++auditionSerial;
    const controller = new AbortController();
    auditionAbort = controller;
    auditionId = id;
    change();
    const resumePromise = resume().catch(() => false);
    try {
      const entry = await trackEntry(track, controller.signal);
      const enabled = await resumePromise;
      if (disposed || ticket !== auditionSerial || controller.signal.aborted) throw canceled();
      if (!enabled || context.state !== 'running') { clearAudition(); change(); return false; }
      const playing = beginAudition(entry, id, ticket);
      change();
      return playing;
    } catch (error) {
      if (ticket === auditionSerial) { clearAudition(); change(); if (error.name !== 'AbortError') status(error.message || 'This track could not be previewed.', { error: true, kind: 'audition' }); }
      if (error.name === 'AbortError') return false;
      throw error;
    } finally { if (auditionAbort === controller) auditionAbort = undefined; }
  }

  function stopAudition() { clearAudition(); change(); }
  function setVolume(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return volume;
    const next = clamp(parsed, 0, 1);
    if (next === volume) return volume;
    volume = next;
    if (audition && context) audition.gain.gain.setTargetAtTime(volume, context.currentTime, 0.008);
    if (volume === 0) stopMain();
    else sync(lastSync);
    change();
    return volume;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    selectionSerial++;
    selectionAbort?.abort();
    clearAudition(); stopMain();
    selected = null; selectedStartTime = 0; cache.clear(); customCache.clear();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }

  return { loadTrack, loadFile, selectNone, getSelection, getExportAudio, setStartTime, getStartTime, getWaveform, sync, previewTrack, stopAudition, setVolume, getVolume: () => volume, getAuditionId: () => auditionId, resume, dispose };
}
