/*
 * Shared behaviour for players that follow a clock they do not schedule
 * themselves (video, audio files, the lyrics-only clock): polling for the
 * barrier and the end, and the timeline from synced lyrics.
 */
import { Emitter } from '../music/player.js';
import { timelineFromSynced } from '../music/timeline.js';

export function autoTime(lines, { pace = 0.34, gap = 1.2, start = 2 } = {}) {
  let t = start;
  return lines.map((l) => {
    const words = String(l.text || '').trim().split(/\s+/).filter(Boolean);
    const syl = words.reduce((a, w) => a + Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) || []).length), 0);
    const len = Math.max(1.5, syl * pace);
    const out = { ...l, start: t, end: t + len };
    t += len + gap;
    return out;
  });
}

export class PolledTrack extends Emitter {
  constructor(song) {
    super();
    this.song = song;
    this.rate = 1;
    this.barrier = null;
    this.playing = false;
    const synced = Array.isArray(song.synced) ? song.synced : [];
    const timed = synced.every((l) => Number.isFinite(l.start)) && synced.length ? synced : autoTime(synced);
    this.timeline = timelineFromSynced(timed, song.duration || 0);
    this.pollTimer = null;
  }

  get duration() { return this.timeline.duration; }

  startPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.poll(), 30);
  }

  stopPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  poll() {
    if (!this.playing) return;
    const t = this.time();
    if (this.barrier !== null && t >= this.barrier - 0.02) {
      const b = this.barrier;
      this.barrier = null;
      this.rawPause();
      this.playing = false;
      this.rawSeek(b);
      this.emit('barrier', b);
      return;
    }
    if (t >= this.duration - 0.05) {
      this.rawPause();
      this.playing = false;
      this.emit('end');
    }
  }

  setBarrier(sec) {
    this.barrier = sec === null || sec === undefined ? null : sec;
  }

  // Subclasses provide rawPlay, rawPause, rawSeek, time.
  async play() {
    if (this.playing) return;
    if (this.time() >= this.duration - 0.1) this.rawSeek(0);
    this.playing = true;
    await this.rawPlay();
    this.startPolling();
    this.emit('play');
  }

  pause() {
    if (!this.playing) return;
    this.rawPause();
    this.playing = false;
    this.emit('pause');
  }

  stop() {
    this.pause();
    this.rawSeek(0);
  }

  seek(sec) {
    this.rawSeek(Math.max(0, sec));
    this.emit('seek', sec);
  }

  setRate(r) {
    const want = Math.max(0.5, Math.min(1.5, Number(r) || 1));
    const eff = this.rawRate(want);
    this.rate = eff === undefined ? want : eff;
    this.emit('change', { rate: this.rate });
  }

  setMute() {}

  destroy() {
    this.stopPolling();
    try { this.rawPause(); } catch { /* gone */ }
    this.handlers = {};
  }
}
