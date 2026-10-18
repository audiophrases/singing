/*
 * SynthTrack: plays a song with the built-in band.
 *
 * Every track (this one, YouTube, audio files) offers the same handful of
 * calls so games never care where the music comes from:
 *   play(), pause(), seek(sec), time(), duration, playing
 *   setRate(0.5..1.5), setBarrier(sec|null)  -> 'barrier' event, auto-pause
 *   on('play'|'pause'|'end'|'barrier'|'change', fn)
 * Built-in songs add setStyle, setTranspose, setGuide, setMute.
 */
import { compileSong } from './score.js';
import { arrange, melodyEvents, clickEvents } from './band.js';
import { getSynth, unlockAudio } from './synth.js';
import { timelineFromCompiled } from './timeline.js';

export class Emitter {
  constructor() { this.handlers = {}; }
  on(name, fn) {
    (this.handlers[name] = this.handlers[name] || []).push(fn);
    return () => this.off(name, fn);
  }
  off(name, fn) {
    const list = this.handlers[name];
    if (list) this.handlers[name] = list.filter((f) => f !== fn);
  }
  emit(name, data) {
    for (const fn of (this.handlers[name] || []).slice()) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  }
}

const LOOKAHEAD = 0.18;
const TICK_MS = 25;

export class SynthTrack extends Emitter {
  constructor(song, opts = {}) {
    super();
    this.kind = 'synth';
    this.song = song;
    this.compiled = compileSong(song);
    this.bpm = song.bpm || 100;
    this.rate = opts.rate || 1;
    this.transpose = opts.transpose || 0;
    this.style = opts.style || song.style || 'pop';
    this.guide = opts.guide !== undefined ? opts.guide : 'robo';
    this.guideOctave = opts.guideOctave || 0;
    this.timeline = timelineFromCompiled(this.compiled, this.bpm);
    this.synth = getSynth();
    this.pos = 0;
    this.playing = false;
    this.barrier = null;
    this.timer = null;
    this.rebuild();
  }

  get ready() { return Promise.resolve(); }
  get duration() { return this.timeline.duration; }
  get beatSec() { return 60 / this.bpm; }
  get effBpm() { return this.bpm * this.rate; }

  rebuild() {
    const band = this.style === 'none' ? [] : arrange(this.compiled, this.style, { transpose: this.transpose });
    const melody = melodyEvents(this.compiled, this.guide, { transpose: this.transpose, octave: this.guideOctave });
    this.events = band.concat(melody).sort((a, b) => a.t - b.t);
    this.extra = [];
  }

  latency() {
    const ctx = this.synth.ctx;
    return (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  }

  beatNow() {
    if (!this.playing) return this.pos;
    const ctx = this.synth.ctx;
    const b = this.anchorBeat + (ctx.currentTime - this.latency() - this.anchorCtx) * (this.effBpm / 60);
    return Math.max(this.startBeat, b);
  }

  time() { return this.beatNow() * this.beatSec; }

  beatToCtx(b) { return this.anchorCtx + (b - this.anchorBeat) * (60 / this.effBpm); }

  async play(opts = {}) {
    if (this.playing) return;
    await unlockAudio();
    if (this.pos >= this.compiled.totalBeats - 1e-6) this.pos = 0;
    const ctx = this.synth.ctx;
    this.extra = [];
    let from = this.pos;
    if (opts.preroll) from = Math.max(0, from - opts.preroll);
    let clockFrom = from;
    if (opts.countIn) {
      // A bar of woodblock clicks before the music starts.
      const n = this.compiled.meter;
      clockFrom = from - n;
      this.extra = clickEvents(clockFrom, n, n);
    }
    this.startBeat = clockFrom;
    this.anchorBeat = clockFrom;
    this.anchorCtx = ctx.currentTime + 0.08;
    this.playing = true;
    this.idx = lowerBound(this.events, from - 1e-6);
    this.extraIdx = 0;
    this.resumeHeld(from);
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.emit('play');
  }

  // Notes already sounding at the resume point come back for what is left of them.
  resumeHeld(from) {
    for (let i = 0; i < this.idx; i += 1) {
      const e = this.events[i];
      if (!e.inst || e.t + e.d <= from + 0.05) continue;
      if (e.t < from - 16) continue;
      const left = e.t + e.d - from;
      if (left < 0.2) continue;
      this.fire({ ...e, t: from, d: left, first: false }, this.beatToCtx(from));
    }
  }

  fire(e, when) {
    const dur = e.d ? e.d * (60 / this.effBpm) : 0;
    if (e.drum) this.synth.drum(e.drum, when, e.vel, e.bus === 'lead' ? 'lead' : e.bus === 'fx' ? 'fx' : 'drums');
    else this.synth.note(e.inst, { midi: e.midi, time: when, dur, vel: e.vel, bus: e.bus, text: e.text, first: e.first, last: e.last, ph: e.ph });
  }

  tick() {
    if (!this.playing) return;
    const ctx = this.synth.ctx;
    const horizon = ctx.currentTime + LOOKAHEAD;
    const stopBeat = this.barrier !== null ? this.barrier / this.beatSec : Infinity;
    while (this.extraIdx < this.extra.length && this.beatToCtx(this.extra[this.extraIdx].t) < horizon) {
      const e = this.extra[this.extraIdx++];
      this.fire(e, this.beatToCtx(e.t));
    }
    while (this.idx < this.events.length) {
      const e = this.events[this.idx];
      if (e.t >= stopBeat - 1e-6) break;
      const when = this.beatToCtx(e.t);
      if (when >= horizon) break;
      this.idx += 1;
      if (when < ctx.currentTime - 0.05) continue; // fell behind (tab was asleep)
      this.fire(e, when);
    }
    const now = this.beatNow();
    if (now >= stopBeat - 1e-4) {
      this.halt(stopBeat);
      this.barrier = null;
      this.emit('barrier', stopBeat * this.beatSec);
      return;
    }
    if (now >= this.compiled.totalBeats) {
      this.halt(this.compiled.totalBeats);
      this.emit('end');
    }
  }

  halt(atBeat) {
    clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
    this.pos = atBeat;
    this.synth.stopAll();
  }

  pause() {
    if (!this.playing) return;
    this.halt(this.beatNow());
    this.emit('pause');
  }

  stop() {
    this.halt(0);
    this.emit('pause');
  }

  seek(sec) {
    const was = this.playing;
    if (was) this.halt(this.beatNow());
    this.pos = Math.max(0, Math.min(this.compiled.totalBeats, sec / this.beatSec));
    this.emit('seek', sec);
    if (was) this.play();
  }

  // Restart scheduling from where we are (after a change of style, key...).
  respawn() {
    if (!this.playing) return;
    const b = this.beatNow();
    this.halt(b);
    this.play();
  }

  setRate(r) {
    const rate = Math.max(0.4, Math.min(1.6, Number(r) || 1));
    if (this.playing) {
      const b = this.beatNow();
      this.halt(b);
      this.rate = rate;
      this.play();
    } else {
      this.rate = rate;
    }
    this.emit('change', { rate });
  }

  setStyle(id) {
    this.style = id;
    this.rebuild();
    this.respawn();
    this.emit('change', { style: id });
  }

  setTranspose(n) {
    this.transpose = Math.max(-12, Math.min(12, Math.round(n)));
    this.rebuild();
    this.respawn();
    this.emit('change', { transpose: this.transpose });
  }

  setGuide(mode) {
    this.guide = mode;
    this.rebuild();
    this.respawn();
    this.emit('change', { guide: mode });
  }

  setMute(bus, muted) {
    const base = { lead: 0.9, comp: 0.55, pad: 0.35, bass: 0.75, drums: 0.7 }[bus] || 0.7;
    this.synth.setBusVolume(bus, muted ? 0 : base);
  }

  setBarrier(sec) {
    this.barrier = sec === null || sec === undefined ? null : sec;
  }

  destroy() {
    this.halt(this.pos);
    this.handlers = {};
  }
}

function lowerBound(arr, t) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}
