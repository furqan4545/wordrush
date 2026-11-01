import {createSoundtrack, loadBrowserSounds} from './audio.js';

// Play the same PCM mix used by the MP4 renderer. Starting and seeking always
// use the video's output clock, rather than individual HTML audio elements.
export class PreviewAudio {
  constructor({onInterrupted} = {}) {this.muted = false; this.onInterrupted = onInterrupted;}
  claimPlaybackSession() {
    // Web Audio is ambient by default on iPhone. A user-started video preview
    // should use media playback routing, like the exported MP4's audio track.
    try {
      const session = navigator.audioSession;
      if (session && !this.claimedSession) {
        this.previousSessionType = session.type;
        session.type = 'playback'; this.claimedSession = true;
      }
    } catch { /* Audio Session is optional; the ordinary context still works. */ }
  }
  releasePlaybackSession() {
    try {
      if (this.claimedSession && navigator.audioSession?.type === 'playback') {
        navigator.audioSession.type = this.previousSessionType ?? 'auto';
      }
    } catch { /* Another media element may have taken ownership. */ }
    this.claimedSession = false;
  }
  async unlock() {
    this.claimPlaybackSession();
    try {
      if (!this.context) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) throw new Error('Preview sound is unavailable in this browser.');
        this.context = new Context({sampleRate: 48000});
        this.gain = this.context.createGain();
        this.gain.gain.value = this.muted ? 0 : 1;
        this.gain.connect(this.context.destination);
        this.context.addEventListener('statechange', () => {
          if (this.source && this.context.state !== 'running') {
            this.stop(); this.onInterrupted?.();
          }
        });
      }
    } catch (error) {this.releasePlaybackSession(); throw error;}
    // resume() is called before any network await, directly from the Play tap.
    let timer;
    try {
      await Promise.race([
        this.context.resume(),
        new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('Tap Play again to enable preview sound.')), 3000);}),
      ]);
      if (this.context.state !== 'running') throw new Error('Tap Play again to enable preview sound.');
    } catch (error) {this.releasePlaybackSession(); throw error;}
    finally {clearTimeout(timer);}
  }
  async prepare(timing) {
    await this.unlock();
    this.assetPromise ??= loadBrowserSounds('./audio/').catch(error => {this.assetPromise = null; throw error;});
    const assets = await this.assetPromise;
    const signature = JSON.stringify([timing.letters, timing.events, timing.focus, timing.enter, timing.duration]);
    if (signature === this.signature) return;
    const track = createSoundtrack(timing, assets);
    this.buffer = this.context.createBuffer(track.channels, track.frames, track.sampleRate);
    for (let channel = 0; channel < track.channels; channel++) {
      const data = this.buffer.getChannelData(channel);
      for (let frame = 0; frame < track.frames; frame++) data[frame] = track.pcm[frame * track.channels + channel];
    }
    this.signature = signature;
  }
  start(offset) {
    // Resync the buffer without bouncing iPhone's hardware audio route from
    // playback to ambient and back, which can interrupt the context itself.
    this.stop(false);
    if (!this.buffer || offset >= this.buffer.duration) {this.releasePlaybackSession(); return;}
    if (this.context.state !== 'running') {this.releasePlaybackSession(); throw new Error('Tap Play again to enable preview sound.');}
    this.claimPlaybackSession();
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.gain);
    this.anchorTime = this.context.currentTime;
    this.anchorOffset = Math.max(0, offset);
    this.source = source;
    source.onended = () => {if (this.source === source) {this.source = null; this.releasePlaybackSession();}};
    source.start(this.anchorTime, this.anchorOffset);
  }
  sync(time) {
    if (!this.buffer) return;
    if (this.context.state !== 'running') {this.stop(); this.onInterrupted?.(); return;}
    const expected = this.anchorOffset + this.context.currentTime - this.anchorTime;
    if (!this.source || Math.abs(expected - time) > .07) this.start(time);
  }
  stop(releaseSession = true) {
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
    if (!value && this.source && this.context.state !== 'running') return this.unlock();
    return Promise.resolve();
  }
}
