import {createSoundtrack, loadBrowserSounds} from './audio.js';

const abortError = () => new DOMException('Preview preparation canceled.', 'AbortError');
const clockError = () => Object.assign(new Error('Preview sound could not start. Tap Play to try again.'), {code: 'AUDIO_CLOCK_STALLED'});
async function abortable(promise, signal, timeout) {
  if (signal?.aborted) throw abortError();
  let timer, onAbort;
  const canceled = new Promise((_, reject) => {
    onAbort = () => reject(abortError());
    signal?.addEventListener('abort', onAbort, {once: true});
    if (timeout) timer = setTimeout(() => reject(clockError()), timeout);
  });
  try {return await Promise.race([promise, canceled]);}
  finally {clearTimeout(timer); signal?.removeEventListener('abort', onAbort);}
}

// One continuous soundtrack per explicit Play. Its clock is diagnostic: canvas
// delays must never restart this source or replay a keyboard/click transient.
export class PreviewAudio {
  constructor({onInterrupted, onEnded, createContext, loadSounds = loadBrowserSounds, mixSoundtrack = createSoundtrack,
    wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))} = {}) {
    this.muted = false;
    this.onInterrupted = onInterrupted;
    this.onEnded = onEnded;
    this.createContext = createContext ?? (() => {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new Error('Preview sound is unavailable in this browser.');
      return new Context({sampleRate: 48000});
    });
    this.loadSounds = loadSounds;
    this.mixSoundtrack = mixSoundtrack;
    this.wait = wait;
    this.preparationSerial = 0;
    this.invalidatedContexts = new WeakSet();
    this.position = 0;
  }
  claimPlaybackSession() {
    // iPhone needs playback routing for user-started media. Claim it only for
    // an explicit Play/resume, never while reading or synchronizing a clock.
    try {
      const session = globalThis.navigator?.audioSession;
      if (session && !this.claimedSession) {
        this.previousSessionType = session.type;
        if (session.type !== 'playback') session.type = 'playback';
        this.claimedSession = true;
      }
    } catch { /* Audio Session is optional. */ }
  }
  releasePlaybackSession() {
    try {
      const session = globalThis.navigator?.audioSession;
      if (this.claimedSession && session?.type === 'playback') {
        const previous = this.previousSessionType ?? 'auto';
        if (session.type !== previous) session.type = previous;
      }
    } catch { /* Another media element may have taken ownership. */ }
    this.claimedSession = false;
  }
  isCurrent(context, serial) {return this.context === context && (serial === undefined || serial === this.preparationSerial);}
  assertCurrent(context, signal, serial) {
    if (signal?.aborted || !this.isCurrent(context, serial)) throw abortError();
  }
  async unlock({signal, serial} = {}) {
    if (signal?.aborted) throw abortError();
    this.claimPlaybackSession();
    let context;
    try {
      if (!this.context || this.context.state === 'closed' || this.contextStalled) {
        context = this.createContext();
        this.context = context;
        this.contextStalled = false;
        this.gain = context.createGain();
        this.gain.gain.value = this.muted ? 0 : 1;
        this.gain.connect(context.destination);
        context.addEventListener('statechange', () => {
          if (this.context === context && this.source && context.state !== 'running') {
            this.stop();
            this.onInterrupted?.();
          }
        });
      } else context = this.context;
    } catch (error) {if (serial === undefined || serial === this.preparationSerial) this.releasePlaybackSession(); throw error;}
    // Call resume before any asset fetch, directly in the user's Play gesture.
    try {
      await abortable(context.resume(), signal, 3000);
      this.assertCurrent(context, signal, serial);
      if (context.state !== 'running') throw new Error('Tap Play again to enable preview sound.');
    } catch (error) {if (this.isCurrent(context, serial)) this.releasePlaybackSession(); throw error;}
  }
  async clockAdvances(context, signal, serial) {
    this.assertCurrent(context, signal, serial);
    const before = context.currentTime;
    await abortable(this.wait(120), signal, 500);
    this.assertCurrent(context, signal, serial);
    return context.state === 'running' && Number.isFinite(before) && context.currentTime - before >= .005;
  }
  async verifyClock(context, signal, serial) {
    try {
      if (await this.clockAdvances(context, signal, serial)) return;
      this.assertCurrent(context, signal, serial);
      await abortable(context.suspend(), signal, 500);
      this.assertCurrent(context, signal, serial);
      await abortable(context.resume(), signal, 500);
      if (await this.clockAdvances(context, signal, serial)) return;
      throw clockError();
    } catch (error) {
      // An old or canceled preparation must never close a newer Play's context.
      if (error.name === 'AbortError' || !this.isCurrent(context, serial)) throw abortError();
      this.invalidateClock();
      throw clockError();
    }
  }
  async prepare(timing, {signal} = {}) {
    const serial = ++this.preparationSerial;
    await this.unlock({signal, serial});
    const context = this.context;
    try {
      this.assetPromise ??= this.loadSounds('./audio/').catch(error => {this.assetPromise = null; throw error;});
      const assets = await abortable(this.assetPromise, signal);
      this.assertCurrent(context, signal, serial);
      const signature = JSON.stringify([timing.letters, timing.events, timing.focus, timing.enter, timing.duration]);
      if (signature !== this.signature) {
        const track = this.mixSoundtrack(timing, assets);
        this.buffer = context.createBuffer(track.channels, track.frames, track.sampleRate);
        for (let channel = 0; channel < track.channels; channel++) {
          const data = this.buffer.getChannelData(channel);
          for (let frame = 0; frame < track.frames; frame++) data[frame] = track.pcm[frame * track.channels + channel];
        }
        this.signature = signature;
      }
      // Verify every explicit Play, including reuse of an already mixed buffer.
      await this.verifyClock(context, signal, serial);
    } catch (error) {if (this.isCurrent(context, serial)) this.releasePlaybackSession(); throw error;}
  }
  start(offset = 0) {
    if (!Number.isFinite(offset)) throw new Error('Choose a valid preview position.');
    if (this.contextStalled) throw clockError();
    this.stop(false);
    const duration = this.buffer?.duration ?? 0;
    this.position = Math.min(duration, Math.max(0, offset));
    if (!this.buffer || offset >= duration) {this.releasePlaybackSession(); return false;}
    if (this.context.state !== 'running') {this.releasePlaybackSession(); throw new Error('Tap Play again to enable preview sound.');}
    this.claimPlaybackSession();
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.gain);
    this.anchorTime = this.context.currentTime;
    this.anchorOffset = this.position;
    this.source = source;
    source.onended = () => {
      if (this.source !== source) return;
      this.position = duration;
      this.source = null;
      source.disconnect();
      this.releasePlaybackSession();
      this.onEnded?.();
    };
    try {source.start(this.anchorTime, this.anchorOffset);}
    catch (error) {
      this.source = null; source.onended = null; source.disconnect();
      this.releasePlaybackSession(); throw error;
    }
    return true;
  }
  getTime() {
    if (!this.source || !this.context) return this.position;
    const elapsed = Math.max(0, this.context.currentTime - this.anchorTime);
    if (Number.isFinite(elapsed)) {
      this.position = Math.min(this.buffer.duration, Math.max(this.position, this.anchorOffset + elapsed));
    }
    return this.position;
  }
  sync() {
    // Compatibility for callers transitioning to getTime(). A coarse, frozen or
    // delayed HTMLVideoElement.currentTime is deliberately ignored.
    return this.getTime();
  }
  invalidateClock() {
    // An explicit watchdog failure stops this Play. Recovery waits for the next
    // user gesture; it never starts another sound source from an animation frame.
    const context = this.context;
    this.contextStalled = true;
    this.stop();
    if (context && !this.invalidatedContexts.has(context)) {
      this.invalidatedContexts.add(context);
      try {Promise.resolve(context.close()).catch(() => {});} catch { /* Best-effort hardware release. */ }
    }
    return this.position;
  }
  stop(releaseSession = true) {
    this.position = this.getTime();
    if (this.source) {
      const source = this.source; this.source = null;
      source.onended = null;
      try {source.stop();} catch { /* The buffer may already have ended. */ }
      source.disconnect();
    }
    if (releaseSession) this.releasePlaybackSession();
  }
  setMuted(value) {
    this.muted = value;
    if (this.gain) this.gain.gain.setValueAtTime(value ? 0 : 1, this.context.currentTime);
    return Promise.resolve();
  }
}
