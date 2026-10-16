/*
 * Pieces several games share: stopping the music at chosen moments, the
 * set-up card shown before a game starts, the line display, scores.
 */
import { h, clear } from '../ui.js';
import { lineEl, paintLine } from './karaoke.js';
import { currentLineAt } from '../music/timeline.js';

/*
 * Stop the music at each stop.at (seconds) and wait for onStop(stop) to
 * resolve, then carry on. Seeking re-arms the right stop. pass(i) drops a
 * stop the class already dealt with before the music got there.
 */
export function lineStops(track, stops, onStop) {
  let i = 0;
  let dead = false;
  let waiting = false;
  const done = new Set();
  const nextIndex = (sec) => {
    const k = stops.findIndex((s, idx) => s.at > sec + 0.02 && !done.has(idx));
    return k < 0 ? stops.length : k;
  };
  const arm = () => {
    while (i < stops.length && done.has(i)) i += 1;
    track.setBarrier(i < stops.length ? stops[i].at : null);
  };
  const offBarrier = track.on('barrier', async () => {
    if (dead || i >= stops.length) return;
    const idx = i;
    waiting = true;
    await onStop(stops[idx], idx);
    waiting = false;
    if (dead) return;
    done.add(idx);
    i = idx + 1;
    arm();
    track.play();
  });
  const offSeek = track.on('seek', (sec) => {
    if (dead || waiting) return;
    i = nextIndex(Number(sec) || 0);
    arm();
  });
  arm();
  return {
    pass(idx) {
      done.add(idx);
      if (idx === i && !waiting) { i += 1; arm(); }
    },
    get waiting() { return waiting; },
    get current() { return i; },
    destroy() {
      dead = true;
      offBarrier();
      offSeek();
      track.setBarrier(null);
    },
  };
}

// The card shown before a game: title, a few settings, a big start button.
export function setupCard({ emoji, title, intro, body, startLabel = '▶ Start', onStart }) {
  const btn = h('button', { class: 'btn primary btn-lg', type: 'button' }, startLabel);
  const card = h('div', { class: 'setup-card' },
    h('div', { class: 'setup-emoji' }, emoji),
    h('h2', null, title),
    intro ? h('p', { class: 'setup-intro' }, intro) : null,
    body || null,
    h('div', { class: 'setup-actions' }, btn));
  btn.addEventListener('click', () => onStart());
  const onKey = (e) => {
    if (e.key === 'Enter' && card.isConnected && document.activeElement && document.activeElement.tagName !== 'SELECT') {
      e.preventDefault();
      onStart();
    }
  };
  document.addEventListener('keydown', onKey);
  card.destroy = () => document.removeEventListener('keydown', onKey);
  return card;
}

// A row of choice buttons (pressed one highlighted).
export function choiceRow(options, value, onChange) {
  const row = h('div', { class: 'choice-row' });
  const buttons = options.map(([v, label, title]) => {
    const b = h('button', { class: 'btn', type: 'button', title: title || '', 'aria-pressed': String(v === value) }, label);
    b.addEventListener('click', () => {
      buttons.forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      onChange(v);
    });
    row.append(b);
    return b;
  });
  return row;
}

// Score + combo display in the stage's corner.
export function scoreBox() {
  const score = h('span', { class: 'sb-score' }, '0');
  const combo = h('span', { class: 'sb-combo' });
  const el = h('div', { class: 'score-box' }, h('span', { class: 'sb-label' }, 'Score'), score, combo);
  let value = 0;
  let streak = 0;
  return {
    el,
    get value() { return value; },
    get streak() { return streak; },
    add(n, keepStreak = true) {
      value += n;
      score.textContent = String(value);
      score.classList.remove('bump');
      void score.offsetWidth;
      score.classList.add('bump');
      if (keepStreak && n > 0) streak += 1; else streak = 0;
      combo.textContent = streak >= 3 ? `🔥 ×${streak}` : '';
    },
    breakStreak() { streak = 0; combo.textContent = ''; },
  };
}

/*
 * A karaoke-style display of previous / current / next line that games can
 * decorate (gap boxes etc.) via render(word, wordIndex, line).
 */
export function lyricView(ctx, { render, lead = 0.9, showPrev = true } = {}) {
  const { track, timeline } = ctx;
  const prev = h('div', { class: 'lv-prev' });
  const curBox = h('div', { class: 'lv-cur' });
  const next = h('div', { class: 'lv-next' });
  const pic = h('div', { class: 'k-pic lv-pic' });
  const el = h('div', { class: 'lyric-view' }, pic, showPrev ? prev : null, curBox, next);
  let idx = -99;
  let curEl = null;
  let forced = null;
  const build = (i) => {
    const L = timeline.lines;
    clear(prev); clear(curBox); clear(next);
    if (showPrev && L[i - 1]) prev.append(lineEl(L[i - 1], { render: render ? (w, wi) => render(w, wi, L[i - 1], 'prev') : null }));
    curEl = L[i] ? lineEl(L[i], { render: render ? (w, wi) => render(w, wi, L[i], 'cur') : null }) : null;
    if (curEl) curBox.append(curEl);
    if (L[i + 1]) next.append(lineEl(L[i + 1], { next: true, render: render ? (w, wi) => render(w, wi, L[i + 1], 'next') : null }));
    const p = L[i] && L[i].pic && ctx.settings.showPics !== false ? L[i].pic : '';
    if (pic.textContent !== p) pic.textContent = p;
  };
  return {
    el,
    get index() { return idx; },
    refresh() { build(idx); },
    // Pin the display to one line (while the music waits there).
    hold(i) { forced = i; },
    release() { forced = null; },
    tick() {
      const t = track.time();
      const i = forced !== null ? forced : currentLineAt(timeline, t, lead);
      if (i !== idx) {
        idx = i;
        build(i);
      }
      if (curEl) paintLine(curEl, t);
      return idx;
    },
  };
}

export function stars(ratio) {
  return ratio >= 0.9 ? 3 : ratio >= 0.6 ? 2 : ratio > 0.2 ? 1 : 0;
}

export function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
