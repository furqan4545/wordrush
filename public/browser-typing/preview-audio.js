import {createSoundtrack, loadBrowserSounds} from './audio.js';

// Play the same PCM mix used by the MP4 renderer. Starting and seeking always
// use the video's output clock, rather than individual HTML audio elements.
export class PreviewAudio {
  constructor() {this.muted = false;}
  async prepare(timing) {
    if (!this.context) {
      this.context = new AudioContext({sampleRate: 48000});
      this.gain = this.context.createGain();
      this.gain.gain.value = this.muted ? 0 : 1;
      this.gain.connect(this.context.destination);
    }
    await this.context.resume();
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
    this.stop();
    if (!this.buffer || offset >= this.buffer.duration) return;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.gain);
    this.anchorTime = this.context.currentTime;
    this.anchorOffset = Math.max(0, offset);
    this.source = source;
    source.onended = () => {if (this.source === source) this.source = null;};
    source.start(this.anchorTime, this.anchorOffset);
  }
  sync(time) {
    if (!this.buffer) return;
    const expected = this.anchorOffset + this.context.currentTime - this.anchorTime;
    if (!this.source || Math.abs(expected - time) > .07) this.start(time);
  }
  stop() {
    if (!this.source) return;
    const source = this.source; this.source = null;
    source.onended = null;
    try {source.stop();} catch { /* The buffer may already have ended. */ }
    source.disconnect();
  }
  setMuted(value) {
    this.muted = value;
    if (this.gain) this.gain.gain.setValueAtTime(value ? 0 : 1, this.context.currentTime);
  }
}
