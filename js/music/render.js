/*
 * Offline rendering: a stretch of a built-in song, played by the band into an
 * AudioBuffer instead of the speakers (and faster than real time). The voice
 * lab uses it to play the very same lines with different robot singers.
 *
 *   const buf = await renderSong(song, { from: 8, to: 16, guide: 'robo', band: false });
 *
 * from / to are in beats (a line's start and end, see score.js). The notes are
 * the ones the player would play, scheduled through the same fireEvent().
 */
import { compileSong } from './score.js';
import { arrange, melodyEvents, GUIDES } from './band.js';
import { Synth } from './synth.js';
import { fireEvent } from './player.js';

export async function renderSong(song, opts = {}) {
  const compiled = opts.compiled || compileSong(song);
  const { from = 0, to = compiled.totalBeats, guide = 'robo', band = true, transpose = 0, rate = 1 } = opts;
  const style = opts.style || song.style || 'pop';
  const events = [
    ...(band && style !== 'none' ? arrange(compiled, style, { transpose }) : []),
    ...melodyEvents(compiled, guide, { transpose }),
  ];
  return renderEvents(events, { ...opts, from, to, beatSec: 60 / ((song.bpm || 100) * rate), room: GUIDES[guide]?.room || 0 });
}

// Arranged events (band.js) from beat `from` to `to`, into a stereo buffer
// with `lead` seconds before and `tail` after. onSynth(synth) can adjust the
// synth first (the evaluation tool does).
export async function renderEvents(events, { from = 0, to, beatSec, room = 0, sampleRate = 44100, lead = 0.3, tail = 1, onSynth = null }) {
  const seconds = lead + (to - from) * beatSec + tail;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const synth = new Synth(ctx);
  synth.setVoiceRoom(room);
  if (onSynth) onSynth(synth);
  const due = [];
  for (const e of events) {
    if (e.t >= to - 1e-6) continue;
    let ev = e;
    if (e.t < from - 1e-6) {
      // Band notes still sounding when the stretch starts come in for what is
      // left of them, as they do when the player resumes.
      if (!e.inst || e.bus === 'lead' || e.t + e.d <= from + 0.05) continue;
      ev = { ...e, t: from, d: e.t + e.d - from, first: false };
    }
    // The band stops with the stretch; the singer finishes the last note.
    if (ev.inst && ev.bus !== 'lead' && ev.t + ev.d > to) ev = { ...ev, d: Math.max(0.05, to - ev.t) };
    due.push([lead + (ev.t - from) * beatSec, ev]);
  }
  due.sort((a, b) => a[0] - b[0]);
  // Notes are made a little ahead of time, as the player makes them: a whole
  // song's notes made at once would all be computed for the whole song.
  let next = 0;
  const scheduleUntil = (t) => {
    while (next < due.length && due[next][0] < t) {
      const [when, ev] = due[next++];
      fireEvent(synth, ev, when, beatSec);
    }
  };
  // Browsers without OfflineAudioContext.suspend() get every note at once
  // (fine for a few lines).
  const STEP = 1;
  const all = () => scheduleUntil(Infinity);
  scheduleUntil(STEP + 0.5);
  try {
    for (let t = STEP; t < seconds - 0.1; t += STEP) {
      ctx.suspend(t).then(() => { scheduleUntil(t + STEP + 0.5); ctx.resume(); }, all);
    }
  } catch {
    all();
  }
  const buf = await ctx.startRendering();
  fadeOut(buf, Math.min(0.4, tail));
  return buf;
}

function fadeOut(buf, sec) {
  const n = Math.floor(sec * buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch += 1) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i += 1) d[d.length - 1 - i] *= i / n;
  }
}

// A 16-bit WAV file of an AudioBuffer (for the evaluation tool and downloads).
export function wavBytes(buf) {
  const chs = buf.numberOfChannels;
  const n = buf.length;
  const out = new DataView(new ArrayBuffer(44 + n * chs * 2));
  const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); out.setUint32(4, 36 + n * chs * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, chs, true);
  out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * chs * 2, true);
  out.setUint16(32, chs * 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, n * chs * 2, true);
  const data = [...Array(chs)].map((_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < chs; c += 1) {
      out.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 32767, true);
      o += 2;
    }
  }
  return new Uint8Array(out.buffer);
}
