/*
 * AudioTrack: an audio file the teacher added (kept in this browser), or a
 * URL. Played through the band's mixer so the visualizer sees it.
 */
import { PolledTrack } from './base.js';
import { getMedia } from './store.js';
import { getSynth, unlockAudio } from '../music/synth.js';

export class AudioTrack extends PolledTrack {
  constructor(song) {
    super(song);
    this.kind = 'audio';
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.preservesPitch = true;
    this.ready = this.load();
  }

  async load() {
    const a = this.song.audio || {};
    let src = a.url || '';
    if (a.mediaId) {
      const blob = await getMedia(a.mediaId).catch(() => null);
      if (!blob) throw new Error('The audio file is not on this computer. Open the song in the Studio and add the file again.');
      src = URL.createObjectURL(blob);
      this.objectUrl = src;
    }
    if (!src) throw new Error('This song has no audio file yet.');
    this.audio.src = src;
    await new Promise((resolve, reject) => {
      const ok = () => { cleanup(); resolve(); };
      const bad = () => { cleanup(); reject(new Error('This audio file cannot be played.')); };
      const cleanup = () => { this.audio.removeEventListener('loadedmetadata', ok); this.audio.removeEventListener('error', bad); };
      this.audio.addEventListener('loadedmetadata', ok);
      this.audio.addEventListener('error', bad);
    });
    if (Number.isFinite(this.audio.duration)) this.timeline.duration = Math.max(this.timeline.duration, this.audio.duration);
    this.audio.addEventListener('ended', () => {
      if (this.playing) { this.playing = false; this.emit('end'); }
    });
    try {
      const sy = getSynth();
      this.node = sy.ctx.createMediaElementSource(this.audio);
      this.node.connect(sy.master);
    } catch { /* plays without the visualizer */ }
  }

  get duration() { return this.timeline.duration; }

  time() { return this.audio.currentTime || 0; }

  async rawPlay() {
    await unlockAudio();
    try { await this.audio.play(); } catch (e) { this.playing = false; throw e; }
  }

  rawPause() { this.audio.pause(); }

  rawSeek(sec) { this.audio.currentTime = sec; }

  rawRate(r) { this.audio.playbackRate = r; return r; }

  destroy() {
    super.destroy();
    if (this.node) try { this.node.disconnect(); } catch { /* ignore */ }
    this.audio.removeAttribute('src');
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
  }
}
