/*
 * Pitch Pal: the melody scrolls past as bars; sing into the microphone and
 * your voice draws a line. Hit the bars to score. Any octave counts, so
 * children, teens and teachers can all play the same song.
 *
 * The notes come from the built-in band, or for a recording from the
 * UltraStar file imported in the Studio (the singer on the record guides,
 * or its karaoke version plays for "I know it").
 */
import { h, clear } from '../ui.js';
import { openMic } from '../mic.js';
import { setupCard, choiceRow, scoreBox, stars } from './common.js';
import { lineEl, paintLine } from './karaoke.js';
import { currentLineAt } from '../music/timeline.js';
import { midiToName } from '../music/notes.js';
import { sfx, floatEmoji } from '../sfx.js';

export async function start(ctx) {
  const { track, main } = ctx;
  const band = track.kind === 'synth';
  const kar = !band && !!track.hasKaraoke;
  if (kar) track.setSinger(true);
  const recorded =band ? [] : track.timeline.lines.flatMap((l) => l.notes.map((n) => ({ ...n, hit: 0, total: 0, line: l.index })));
  if (!band && !recorded.length) {
    clear(main).append(h('div', { class: 'setup-card' }, h('h2', null, 'Pitch Pal needs the notes of the song: a built-in song, or a song imported from an UltraStar file in the Studio.')));
    return null;
  }
  const conf = { tol: 0.8, guide: true };
  const card = setupCard({
    emoji: '🎯',
    title: 'Pitch Pal',
    intro: 'Sing into the microphone! The bars are the notes of the song; your voice is the glowing line. Stay on the bars to score. High or low voice - any octave counts.',
    body: h('div', null,
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Level'),
        choiceRow([[1.2, '🌱 Easy'], [0.8, '🎤 Normal'], [0.45, '🏆 Pro']], conf.tol, (v) => { conf.tol = v; })),
      band ? h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Melody'),
        choiceRow([[true, '🤖 Help me'], [false, '🙊 I know it']], conf.guide, (v) => { conf.guide = v; })) : null,
      kar ? h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Music'),
        choiceRow([[true, '🎤 With the singer'], [false, '🙊 Karaoke version']], conf.guide, (v) => { conf.guide = v; })) : null),
    startLabel: '🎙️ Start (allow the microphone)',
    onStart: async () => {
      try {
        mic = await openMic();
      } catch (e) {
        alert(`No microphone: ${e.message}`);
        return;
      }
      card.destroy();
      begin();
    },
  });
  let mic = null;
  clear(main).append(card);
  ctx.setBottom(false);
  let cleanup = null;
  ctx.addCleanup(() => { card.destroy(); if (cleanup) cleanup(); });

  function bandNotes() {
    const compiled = track.compiled;
    const bs = track.beatSec;
    return compiled.melody.filter((m) => m.midi !== null).map((m) => {
      const line = compiled.lines[m.line];
      const syl = line && m.syl >= 0 ? line.syllables[m.syl] : null;
      return {
        start: m.start * bs,
        end: (m.start + m.beats) * bs,
        midi: m.midi,
        text: syl && syl.notes[0] === m ? syl.text : '',
        golden: m.beats >= 2,
        hit: 0,
        total: 0,
        line: m.line,
      };
    });
  }

  function begin() {
    if ((band || kar) && !conf.guide) track.setMute('lead', true);
    const notes = band ? bandNotes() : recorded;
    const lo = Math.min(...notes.map((n) => n.midi)) - 3;
    const hi = Math.max(...notes.map((n) => n.midi)) + 3;
    const score = scoreBox();
    const canvas = h('canvas', { class: 'pp-canvas' });
    const lyric = h('div', { class: 'pp-lyric' });
    const rating = h('div', { class: 'pp-rating' });
    const noteName = h('div', { class: 'pp-note' });
    clear(main).append(h('div', { class: 'pp-wrap' }, h('div', { class: 'gf-top' }, noteName, rating, score.el), canvas, lyric));
    ctx.setBottom(null);

    const g = canvas.getContext('2d');
    let W = 0;
    let H = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => { W = canvas.width = canvas.clientWidth * dpr; H = canvas.height = canvas.clientHeight * dpr; };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const trail = [];
    let lastT = null;
    let frame = 0;
    let lastPitch = null;
    let lineIdx = -1;
    let lineEls = null;
    const lineStats = new Map();
    let total = 0;

    const yOf = (midi) => H - ((midi - lo) / (hi - lo)) * H * 0.86 - H * 0.07;
    const PAST = 1.6;
    const FUTURE = 4.4;
    const xOf = (t, now) => ((t - (now - PAST)) / (PAST + FUTURE)) * W;

    let raf = 0;
    const loop = () => {
      const now = track.time();
      const transpose = track.transpose || 0;
      frame += 1;
      // Pitch, 30 times a second.
      if (frame % 2 === 0 && track.playing) {
        const p = mic.pitch();
        lastPitch = p && p.clarity > 0.75 && p.freq > 70 && p.freq < 1100 ? 69 + 12 * Math.log2(p.freq / 440) : null;
      }
      const dt = lastT === null ? 0 : Math.max(0, Math.min(0.1, now - lastT));
      lastT = now;
      const cur = notes.find((n) => now >= n.start && now < n.end);
      let folded = null;
      if (lastPitch !== null) {
        const ref = cur ? cur.midi + transpose : (lo + hi) / 2 + transpose;
        folded = lastPitch + 12 * Math.round((ref - lastPitch) / 12);
      }
      if (cur && track.playing && dt) {
        cur.total += dt;
        total += dt * (cur.golden ? 2 : 1);
        const st = lineStats.get(cur.line) || { hit: 0, total: 0 };
        st.total += dt;
        if (folded !== null && Math.abs(folded - (cur.midi + transpose)) <= conf.tol) {
          cur.hit += dt;
          st.hit += dt;
          score.add(Math.round(dt * 100 * (cur.golden ? 2 : 1)), true);
        }
        lineStats.set(cur.line, st);
      }
      noteName.textContent = folded !== null ? `🎤 ${midiToName(folded)}` : '🎤 …';
      if (track.playing) trail.push({ t: now, m: folded !== null ? folded - transpose : null, on: !!(cur && folded !== null && Math.abs(folded - (cur.midi + transpose)) <= conf.tol) });
      while (trail.length && trail[0].t < now - PAST) trail.shift();

      // Draw.
      g.clearRect(0, 0, W, H);
      for (let m = Math.ceil(lo); m <= hi; m += 1) {
        g.fillStyle = m % 12 === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.035)';
        g.fillRect(0, yOf(m), W, 1 * dpr);
      }
      const px = xOf(now, now);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(px - dpr, 0, 2 * dpr, H);
      const barH = Math.max(10 * dpr, (H * 0.86) / (hi - lo) * 0.8);
      g.font = `${600} ${13 * dpr}px Fredoka, Inter, sans-serif`;
      for (const n of notes) {
        if (n.end < now - PAST || n.start > now + FUTURE) continue;
        const x1 = xOf(n.start, now);
        const x2 = xOf(n.end, now);
        const y = yOf(n.midi) - barH / 2;
        const w = Math.max(4, x2 - x1 - 2 * dpr);
        roundRect(g, x1, y, w, barH, barH / 2);
        g.fillStyle = n.golden ? 'rgba(250, 204, 21, 0.28)' : 'rgba(255,255,255,0.16)';
        g.fill();
        g.strokeStyle = n.golden ? 'rgba(250, 204, 21, 0.9)' : 'rgba(255,255,255,0.5)';
        g.lineWidth = 1.5 * dpr;
        g.stroke();
        if (n.total > 0) {
          const ratio = n.hit / Math.max(0.01, n.end - n.start);
          g.save();
          roundRect(g, x1, y, w, barH, barH / 2);
          g.clip();
          g.fillStyle = n.golden ? '#facc15' : '#4ade80';
          g.fillRect(x1, y, w * Math.min(1, ratio), barH);
          g.restore();
        }
        if (n.text && x1 > -50) {
          g.fillStyle = 'rgba(255,255,255,0.85)';
          g.fillText(n.text, x1 + 4 * dpr, y - 5 * dpr);
        }
      }
      // Voice trail.
      g.lineWidth = 5 * dpr;
      g.lineCap = 'round';
      for (let i = 1; i < trail.length; i += 1) {
        const a = trail[i - 1];
        const b = trail[i];
        if (a.m === null || b.m === null || Math.abs(a.m - b.m) > 3) continue;
        g.strokeStyle = b.on ? '#fde047' : 'rgba(125, 211, 252, 0.9)';
        g.shadowColor = b.on ? '#facc15' : '#38bdf8';
        g.shadowBlur = 12 * dpr;
        g.beginPath();
        g.moveTo(xOf(a.t, now), yOf(a.m));
        g.lineTo(xOf(b.t, now), yOf(b.m));
        g.stroke();
      }
      g.shadowBlur = 0;

      // Lyrics and a verdict at the end of each line.
      const li = currentLineAt(track.timeline, now);
      if (li !== lineIdx) {
        const prevStats = lineStats.get(lineIdx);
        if (prevStats && prevStats.total > 0.5) {
          const r = prevStats.hit / prevStats.total;
          const label = r > 0.8 ? '🌟 Perfect!' : r > 0.6 ? '😃 Great!' : r > 0.35 ? '🙂 Good' : r > 0.1 ? '😐 OK' : '🙈 Sing louder!';
          rating.textContent = label;
          rating.classList.remove('pop');
          void rating.offsetWidth;
          rating.classList.add('pop');
          if (r > 0.8) sfx('pop', { volume: 0.4 });
          if (r > 0.6) floatEmoji('⭐', innerWidth / 2, innerHeight / 2, { size: 60 });
        }
        lineIdx = li;
        clear(lyric);
        const L = track.timeline.lines;
        lineEls = L[li] ? lineEl(L[li]) : null;
        if (lineEls) lyric.append(lineEls);
        if (L[li + 1]) lyric.append(lineEl(L[li + 1], { next: true }));
      }
      if (lineEls) paintLine(lineEls, now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const offEnd = track.on('end', () => {
      const ratio = total ? score.value / (total * 100) : 0;
      ctx.finish({ score: score.value, max: 0, emoji: ratio > 0.7 ? '🌟' : '🎤', title: ratio > 0.7 ? 'Superstar!' : ratio > 0.4 ? 'Great singing!' : 'Keep practising!', text: `${score.value} points · ${Math.round(ratio * 100)}% of the notes hit.`, stars: stars(ratio * 1.15) });
    });
    track.seek(0);
    track.play();
    cleanup = () => { cancelAnimationFrame(raf); ro.disconnect(); offEnd(); track.setMute('lead', false); };
  }
}

function roundRect(g, x, y, w, h2, r) {
  const rr = Math.min(r, w / 2, h2 / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h2, rr);
  g.arcTo(x + w, y + h2, x, y + h2, rr);
  g.arcTo(x, y + h2, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
