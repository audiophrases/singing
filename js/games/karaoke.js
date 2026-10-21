/*
 * Karaoke: the current line lights up syllable by syllable (a real karaoke
 * wipe), a ball bounces on the beat, a picture shows what the line means,
 * and an optional microphone meter shows how loud the class is singing.
 */
import { h, clear } from '../ui.js';
import { currentLineAt } from '../music/timeline.js';
import { openMic } from '../mic.js';
import { setSettings } from '../store.js';
import { partHue } from '../views/song.js';
import { confetti, sfx } from '../sfx.js';

// Builds the DOM for one line: words made of syllable spans.
export function lineEl(line, { next = false, gaps = null, render = null } = {}) {
  const el = h('div', { class: `k-line${next ? ' next' : ''}` });
  if (!line) return el;
  if (line.part) {
    el.dataset.part = line.part;
    el.append(h('span', { class: 'k-part-tag', style: { '--part-hue': partHue(line.part) } }, line.part));
  }
  if (line.instrumental) {
    el.append(h('span', { class: 'k-instrumental' }, '♪ ♪ ♪'));
    return el;
  }
  line.words.forEach((w, wi) => {
    if (render) {
      const custom = render(w, wi);
      if (custom) { el.append(custom, ' '); return; }
    }
    const we = h('span', { class: 'w' });
    for (const s of w.syllables) {
      const se = h('span', { class: 'syl' }, s.text);
      se._syl = s;
      we.append(se);
    }
    if (gaps && gaps.has(wi)) we.classList.add('gap');
    el.append(we, ' ');
  });
  return el;
}

// Sweep the highlight across the syllables of a line element.
export function paintLine(el, t) {
  let active = null;
  for (const se of el.querySelectorAll('.syl')) {
    const s = se._syl;
    if (!s) continue;
    let p;
    if (t <= s.start) p = 0;
    else if (t >= s.end) p = 1;
    else p = (t - s.start) / Math.max(0.05, s.end - s.start);
    const prev = se._p;
    if (prev === undefined || Math.abs(prev - p) > 0.004) {
      se.style.setProperty('--p', p.toFixed(3));
      se._p = p;
    }
    const on = t >= s.start && t < s.end;
    if (on !== !!se._on) {
      se.classList.toggle('on', on);
      se._on = on;
    }
    if (on) active = se;
  }
  return active;
}

// The ball cues the next syllable slightly early. All times remain on the
// recording's timeline; rate scales the cue so its real-time lead stays steady.
export const BALL_LEAD = 0.08;
export function ballHop(syllables, t, rate = 1) {
  if (!syllables.length) return null;
  const speed = Math.max(0.1, Number(rate) || 1);
  const lead = BALL_LEAD * speed;
  const next = syllables.findIndex((s) => s.start > t + lead);
  const previous = next < 0 ? syllables.length - 1 : next - 1;
  const hold = () => previous >= 0 && t < syllables[previous].end ? { from: previous, to: previous, progress: 1 } : null;
  if (next < 0) return hold();
  const arrival = syllables[next].start - lead;
  const departure = Math.max(previous >= 0 ? syllables[previous].start - lead : -Infinity, arrival - 0.22 * speed);
  if (t < departure) return hold();
  // After a long rest, bounce above the new syllable instead of flying across.
  const from = previous >= 0 && syllables[next].start - syllables[previous].end <= 0.4 * speed ? previous : next;
  return { from, to: next, progress: Math.max(0, Math.min(1, (t - departure) / Math.max(0.001, arrival - departure))) };
}

export async function start(ctx) {
  const { track, timeline, main, settings } = ctx;
  const opts = {
    ball: settings.ball !== false,
    pics: settings.showPics !== false,
    tr: settings.translations !== false,
    meter: false,
    scale: settings.lyricScale || 1,
  };

  const section = h('div', { class: 'k-section' });
  const pic = h('div', { class: 'k-pic' });
  const ball = h('div', { class: 'k-ball' });
  const lines = h('div', { class: 'k-lines' });
  const tr = h('div', { class: 'k-tr' });
  const banner = h('div', { class: 'k-banner' });
  const wrap = h('div', { class: 'karaoke', style: { '--k-scale': opts.scale } }, section, pic, lines, tr, banner);
  clear(main).append(wrap);

  let meter = null;
  let mic = null;
  const meterEl = h('div', { class: 'loud-meter hidden' }, h('div', { class: 'lm-fill' }), h('div', { class: 'lm-peak' }));
  const meterLabel = h('div', { class: 'loud-label hidden' });
  ctx.root.append(meterEl, meterLabel);
  ctx.addCleanup(() => { meterEl.remove(); meterLabel.remove(); });

  async function setMeter(on) {
    opts.meter = on;
    meterEl.classList.toggle('hidden', !on);
    meterLabel.classList.toggle('hidden', !on);
    if (on && !mic) {
      try {
        mic = await openMic();
      } catch (e) {
        opts.meter = false;
        meterEl.classList.add('hidden');
        meterLabel.classList.add('hidden');
        alert(`No microphone: ${e.message}`);
      }
    }
  }

  // A recording with a karaoke version: the class is the singer.
  if (track.hasKaraoke) track.setSinger(false);

  ctx.options(() => h('div', null,
    track.hasVocalGuide
      ? h('p', { class: 'small' }, 'Vocal help starts muted. Raise the slider at the bottom to hear a little of the singer while you practise.')
      : track.hasKaraoke ? toggle('🎤 The singer on the recording', track.singer, (v) => track.setSinger(v)) : null,
    toggle('🟡 Bouncing ball', opts.ball, (v) => { opts.ball = v; setSettings({ ball: v }); }),
    toggle('🖼️ Pictures', opts.pics, (v) => { opts.pics = v; setSettings({ showPics: v }); lastIdx = -99; }),
    toggle('🌍 Translations (when the song has them)', opts.tr, (v) => { opts.tr = v; setSettings({ translations: v }); lastIdx = -99; }),
    toggle('📣 Loudness meter (microphone)', opts.meter, (v) => setMeter(v)),
    h('label', null, 'Lyrics size'),
    h('input', { type: 'range', min: 0.6, max: 1.6, step: 0.1, value: opts.scale, oninput: (e) => { opts.scale = Number(e.target.value); wrap.style.setProperty('--k-scale', opts.scale); setSettings({ lyricScale: opts.scale }); } }),
  ));

  let lastIdx = -99;
  let cur = null;
  let syllableElements = [];
  let syllables = [];
  let peak = 0;
  let loudSum = 0;
  let loudN = 0;

  const draw = (idx) => {
    clear(lines);
    const L = timeline.lines;
    const line = idx >= 0 ? L[idx] : null;
    const nextLine = L[idx + 1] || null;
    if (line) {
      cur = lineEl(line);
      lines.append(cur);
    } else {
      cur = null;
      lines.append(h('div', { class: 'k-line' }, h('span', { class: 'k-instrumental' }, track.playing ? '♪ ♪ ♪' : '')));
    }
    lines.append(lineEl(nextLine, { next: true }), ball);
    const shown = line || nextLine;
    section.textContent = shown && shown.section ? shown.section : '';
    const p = opts.pics && line && line.pic ? line.pic : '';
    if (pic.textContent !== p) {
      pic.textContent = p;
      pic.classList.remove('pop');
      void pic.offsetWidth;
      if (p) pic.classList.add('pop');
    }
    tr.textContent = opts.tr && line && line.translation ? line.translation : '';
    syllableElements = cur ? [...cur.querySelectorAll('.syl')] : [];
    syllables = syllableElements.map((el) => el._syl);
  };

  const countdown = (t) => {
    const first = timeline.lines.find((l) => !l.instrumental);
    if (!first || !track.playing) return '';
    const left = first.singStart - t;
    const beat = timeline.beat || 0.6;
    if (left > 0 && left <= beat * 3.05) return String(Math.ceil(left / beat - 0.05));
    return '';
  };

  let raf = 0;
  let lastCount = '';
  const loop = () => {
    const t = track.time();
    const idx = currentLineAt(timeline, t + (track.playing ? BALL_LEAD * track.rate : 0));
    if (idx !== lastIdx) {
      draw(idx);
      lastIdx = idx;
    }
    const c = countdown(t);
    if (c !== lastCount) {
      lastCount = c;
      clear(banner);
      if (c) banner.append(h('div', { class: 'k-count' }, c));
    }
    if (cur) paintLine(cur, t);
    const hop = opts.ball && track.playing ? ballHop(syllables, t, track.rate) : null;
    if (hop) {
      const from = center(syllableElements[hop.from], lines);
      const to = center(syllableElements[hop.to], lines);
      const u = hop.progress;
      const x = from.x + (to.x - from.x) * easeOut(u);
      const height = Math.min(60, Math.abs(to.x - from.x) * 0.35 + 18);
      const y = from.y + (to.y - from.y) * easeOut(u) - Math.sin(Math.PI * u) * height;
      ball.style.left = `${x}px`;
      ball.style.top = `${y}px`;
      ball.classList.add('show');
    } else ball.classList.remove('show');
    if (opts.meter && mic) {
      const lv = mic.level();
      if (track.playing) { loudSum += lv; loudN += 1; }
      peak = Math.max(lv, peak - 0.004);
      meterEl.firstChild.style.height = `${lv * 100}%`;
      meterEl.children[1].style.bottom = `${peak * 100}%`;
      meterLabel.textContent = lv > 0.85 ? '🔥 WOW!' : lv > 0.65 ? '🎸 ROCK!' : lv > 0.4 ? '🙂 Good' : lv > 0.15 ? '🤫 Louder!' : '😴';
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  // A start card so the class is ready before the music begins.
  const startCard = h('div', { class: 'k-start' },
    h('div', { class: 'k-start-emoji' }, ctx.song.emoji || '🎤'),
    h('div', { class: 'k-start-title' }, ctx.song.title),
    h('button', { class: 'btn primary btn-lg', type: 'button', onclick: () => { startCard.remove(); track.play(); } }, '▶ Sing!'),
    h('div', { class: 'small' }, 'Space: play/pause · ←/→: lines · F: full screen'));
  wrap.append(startCard);
  const offPlay = track.on('play', () => startCard.remove());

  const offEnd = track.on('end', () => {
    sfx('correct', { volume: 0.6 });
    confetti({ count: 200 });
    const avg = loudN ? loudSum / loudN : 0;
    ctx.finish({
      emoji: '👏',
      title: 'What a performance!',
      text: opts.meter && loudN ? `Average volume: ${Math.round(avg * 100)}%. ${avg > 0.6 ? 'A real rock concert!' : avg > 0.35 ? 'Nice singing!' : 'Next time even louder!'}` : 'Sing it again faster, slower, or in another style!',
      stars: opts.meter && loudN ? (avg > 0.6 ? 3 : avg > 0.35 ? 2 : 1) : 3,
    });
  });

  return () => {
    cancelAnimationFrame(raf);
    offEnd();
    offPlay();
  };
}

function center(el, container) {
  const r = el.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  return { x: r.left - c.left + r.width / 2, y: r.top - c.top };
}

function easeOut(u) {
  return 1 - (1 - u) * (1 - u);
}

export function toggle(label, value, onChange) {
  const input = h('input', { type: 'checkbox', checked: value });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'inline', style: { margin: '.35rem 0' } }, input, label);
}
