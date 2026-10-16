/*
 * Round: the class splits into groups that start the song one after another
 * (Row, Row, Row Your Boat; Brother John). Each group has its own panel,
 * colour and robot voice, placed left-to-right in the speakers.
 */
import { h, clear } from '../ui.js';
import { SynthTrack } from '../music/player.js';
import { arrange, melodyEvents } from '../music/band.js';
import { timelineFromCompiled } from '../music/timeline.js';
import { lineEl, paintLine } from './karaoke.js';
import { setupCard, choiceRow } from './common.js';
import { currentLineAt } from '../music/timeline.js';
import { applyKnobs } from '../controls.js';

const GROUPS = [
  { name: 'Group 1', emoji: '🔴', hue: 0 },
  { name: 'Group 2', emoji: '🔵', hue: 215 },
  { name: 'Group 3', emoji: '🟢', hue: 130 },
  { name: 'Group 4', emoji: '🟡', hue: 48 },
];

const VOICE_GUIDES = ['robo', 'flute', 'synth', 'bells'];

class RoundTrack extends SynthTrack {
  constructor(song, opts) {
    super(song, { ...opts, guide: 'off' });
    this.roundOpts = opts.round;
    this.base = this.compiled;
    this.buildRound();
  }

  buildRound() {
    const c = this.base;
    const { voices, times, every } = this.roundOpts;
    const bodyStart = c.lines[0].start;
    const last = c.lines[c.lines.length - 1];
    const bodyLen = last.end - bodyStart;
    const intro = c.introBeats;
    const singLen = times * bodyLen + (voices - 1) * every;
    const meter = c.meter;
    const total = intro + Math.ceil(singLen / meter) * meter + meter;
    // Chords: the body's chords, looped to cover everyone.
    const bodyChords = c.chords.filter((ch) => ch.start >= bodyStart - 1e-6 && ch.start < last.end - 1e-6);
    const chords = c.chords.filter((ch) => ch.start < intro - 1e-6).map((ch) => ({ ...ch }));
    for (let off = 0; off < singLen + bodyLen; off += bodyLen) {
      for (const ch of bodyChords) {
        const start = intro + off + (ch.start - bodyStart);
        if (start >= intro + singLen) break;
        chords.push({ ...ch, start, beats: Math.min(ch.beats, intro + singLen - start) });
      }
    }
    const lastChord = chords[chords.length - 1];
    chords.push({ ...lastChord, start: intro + singLen, beats: total - (intro + singLen), outro: true });
    this.virtual = { ...c, chords, totalBeats: total, lines: [], firstLineStart: intro };
    this.voiceOffsets = Array.from({ length: voices }, (_, v) => intro - bodyStart + v * every);
    this.bodyLen = bodyLen;
    this.times = times;
    this.compiled = this.virtual;
    this.rebuild();
    this.timeline = { ...timelineFromCompiled(this.base, this.bpm), duration: total * this.beatSec };
  }

  rebuild() {
    if (!this.roundOpts || !this.virtual) { super.rebuild(); return; }
    const band = this.style === 'none' ? [] : arrange(this.virtual, this.style, { transpose: this.transpose });
    const events = band;
    const voices = this.roundOpts.voices;
    for (let v = 0; v < voices; v += 1) {
      const guide = this.roundOpts.guides ? VOICE_GUIDES[v % VOICE_GUIDES.length] : 'off';
      if (guide === 'off') continue;
      const mel = melodyEvents(this.base, guide, { transpose: this.transpose });
      const pan = voices > 1 ? -0.7 + (1.4 * v) / (voices - 1) : 0;
      for (let r = 0; r < this.times; r += 1) {
        const off = this.voiceOffsets[v] + r * this.bodyLen;
        for (const e of mel) events.push({ ...e, t: e.t + off, pan, vel: (e.vel || 0.8) * 0.8 });
      }
    }
    this.events = events.sort((a, b) => a.t - b.t);
    this.extra = [];
  }

  fire(e, when) {
    if (e.pan !== undefined && e.inst) {
      const dur = e.d * (60 / this.effBpm);
      this.synth.note(e.inst, { midi: e.midi, time: when, dur, vel: e.vel, bus: e.bus, text: e.text, first: e.first, pan: e.pan });
      return;
    }
    super.fire(e, when);
  }

  // Song time (seconds of the original) for one voice, or null when not singing.
  voiceTime(v) {
    const beat = this.beatNow() - this.voiceOffsets[v];
    const bodyStart = this.base.lines[0].start;
    const rel = beat - bodyStart;
    if (rel < 0) return { waiting: true, beatsLeft: -rel };
    if (rel >= this.times * this.bodyLen) return { done: true };
    const wrapped = rel % this.bodyLen;
    return { t: (bodyStart + wrapped) * this.beatSec, rep: Math.floor(Math.max(0, rel) / this.bodyLen) };
  }
}

export async function start(ctx) {
  const { song, main } = ctx;
  const r = song.round || { voices: 2, every: 8 };
  const conf = { voices: Math.min(4, r.voices || 2), times: 2, guides: true };

  const card = setupCard({
    emoji: '🌀',
    title: 'Sing a round',
    intro: 'Split the class into groups. Group 1 starts; each group joins when its panel lights up. Keep singing your own part - do not listen to the others!',
    body: h('div', null,
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Groups'),
        choiceRow([[2, '2'], [3, '3'], [4, '4']], conf.voices, (v) => { conf.voices = v; })),
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Times'),
        choiceRow([[1, 'Once'], [2, 'Twice'], [3, '3 times']], conf.times, (v) => { conf.times = v; })),
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Robot voices'),
        choiceRow([[true, '🤖 Help us sing'], [false, '🙊 Off']], conf.guides, (v) => { conf.guides = v; })),
    ),
    onStart: () => { card.destroy(); begin(); },
  });
  clear(main).append(card);
  ctx.setBottom(false);
  let cleanup = null;
  ctx.addCleanup(() => { card.destroy(); if (cleanup) cleanup(); });

  function begin() {
    const track = new RoundTrack(song, { style: ctx.track.style, round: { voices: conf.voices, times: conf.times, every: r.every || 8, guides: conf.guides } });
    applyKnobs(track, song);
    ctx.replaceTrack(track);
    const base = track.timeline;
    const panels = GROUPS.slice(0, conf.voices).map((g, v) => {
      const lineBox = h('div', { class: 'k-lines' });
      const state = h('div', { class: 'k-round-state' });
      const el = h('div', { class: 'k-round waiting', style: { '--part-hue': g.hue } },
        h('div', { class: 'k-round-name' }, `${g.emoji} ${g.name}`), state, lineBox);
      return { el, lineBox, state, idx: -99, lineNode: null, v };
    });
    clear(main).append(h('div', { class: 'karaoke' }, h('div', { class: 'k-rounds', style: { '--voices': conf.voices } }, panels.map((p) => p.el))));
    ctx.setBottom(null);

    let raf = 0;
    const loop = () => {
      for (const p of panels) {
        const vt = track.voiceTime(p.v);
        if (vt.waiting) {
          const secs = (vt.beatsLeft * track.beatSec) / track.rate;
          p.el.classList.add('waiting');
          p.state.textContent = track.playing ? (secs < 4 ? `Get ready… ${Math.ceil(secs)}` : `Starts in ${Math.ceil(secs)}s`) : 'Waiting';
          if (p.idx !== -1) { clear(p.lineBox); p.idx = -1; p.lineNode = null; }
          continue;
        }
        if (vt.done) {
          p.el.classList.add('waiting');
          p.state.textContent = '✅ Done!';
          if (p.idx !== -2) { clear(p.lineBox); p.idx = -2; p.lineNode = null; }
          continue;
        }
        p.el.classList.remove('waiting');
        p.state.textContent = conf.times > 1 ? `Time ${vt.rep + 1} of ${conf.times}` : '';
        const i = currentLineAt(base, vt.t, 0.6);
        if (i !== p.idx) {
          p.idx = i;
          clear(p.lineBox);
          p.lineNode = base.lines[i] ? lineEl(base.lines[i]) : null;
          if (p.lineNode) p.lineBox.append(p.lineNode);
          if (base.lines[i + 1]) p.lineBox.append(lineEl(base.lines[i + 1], { next: true }));
        }
        if (p.lineNode) paintLine(p.lineNode, vt.t);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const offEnd = track.on('end', () => ctx.finish({ emoji: '🌀', title: 'Beautiful round!', text: 'Try it with more groups, or faster!', stars: 3 }));
    track.play();
    cleanup = () => { cancelAnimationFrame(raf); offEnd(); };
  }
}
