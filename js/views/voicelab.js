/*
 * Voice lab: the robot singers side by side, on the very same notes.
 *
 *   A  the original robot singer (as it was before the clarity work)
 *   B  the robot singer now
 *   C  Clear English (pronunciation before singing realism; same melody and
 *      rhythm, but in a speaking voice's range, so often an octave lower)
 *
 * Compare: each lyric clip is rendered once per voice (music/render.js), with
 * identical lyrics, melody, tempo and timing, then all versions play together
 * and only one is heard, so switching is instant. Every version is matched to
 * the same loudness (BS.1770), with and without the band. Click a word to loop
 * just that word.
 *
 * Blind test: each sentence is sung by one voice picked at random (balanced),
 * the teacher types what they hear, and the lab counts the words heard right
 * per voice. Unfamiliar sentences are the fairest: nobody can guess them.
 */
import { h, clear, toast, shuffle, seeded, typingTarget } from '../ui.js';
import { allSongs } from '../store.js';
import { compileSong } from '../music/score.js';
import { composeSong } from '../music/composer.js';
import { renderSong } from '../music/render.js';
import { audioContext, unlockAudio } from '../music/synth.js';
import { loudness, peak, matchGains } from '../media/loudness.js';
import { wordsHeard } from '../lyrics/text.js';

const VOICES = [
  { key: 'A', guide: 'roboclassic', name: 'Original', desc: 'the robot singer before the clarity work' },
  { key: 'B', guide: 'robo', name: 'Improved', desc: 'the robot singer now' },
  { key: 'C', guide: 'roboclear', name: 'Clear English', desc: 'words before singing realism, in a speaking voice’s range (often an octave lower)' },
];
const LEAD = 0.3; // seconds of render before the clip's first beat (render.js)
const RESULTS_KEY = 'singing.voicelab.v1';

// ----------------------------------------------------------------- clips

// A song's sung lines, `per` at a time, from a beat before the first word.
function clipsOf(compiled, per) {
  const lines = compiled.lines.filter((l) => !l.instrumental);
  const out = [];
  for (let i = 0; i < lines.length; i += per) {
    const group = lines.slice(i, i + per);
    out.push({
      from: Math.max(group[0].start, group[0].singStart - 1),
      to: group[group.length - 1].singEnd + 0.5,
      lines: group,
      text: group.map((l) => l.text).join(' / '),
    });
  }
  return out;
}

// Every voice, alone and with the band, matched in loudness.
async function renderClip(song, compiled, clip, { rate, onStep, voices = VOICES }) {
  const bufs = {};
  const jobs = voices.flatMap((v) => [false, true].map((band) => ({ v, band })));
  let done = 0;
  for (const { v, band } of jobs) {
    bufs[`${v.key}-${band ? 'mix' : 'voice'}`] = await renderSong(song, { compiled, from: clip.from, to: clip.to, guide: v.guide, band, rate, lead: LEAD, tail: 0.8 });
    if (onStep) onStep(++done, jobs.length);
  }
  const levels = {};
  const gains = {};
  for (const kind of ['voice', 'mix']) {
    const keys = voices.map((v) => `${v.key}-${kind}`);
    const m = keys.map((k) => {
      const ch = [bufs[k].getChannelData(0), bufs[k].getChannelData(1)];
      return { lufs: loudness(ch, bufs[k].sampleRate), peak: peak(ch) };
    });
    matchGains(m).forEach((g, i) => { gains[keys[i]] = g; levels[keys[i]] = m[i].lufs; });
  }
  return { bufs, gains, levels, beatSec: 60 / ((song.bpm || 100) * rate), duration: bufs[`${voices[0].key}-voice`].duration };
}

/*
 * The deck: every version starts together and loops together; gains pick
 * the one heard. select() moves between them in a few milliseconds.
 */
class Deck {
  constructor() {
    this.ctx = audioContext();
    this.out = this.ctx.createGain();
    this.out.connect(this.ctx.destination);
    this.srcs = [];
    this.playing = false;
    this.onEnd = null;
  }

  load(clip) { this.stop(); this.clip = clip; }

  play({ from = 0, loop = false, loopStart = 0, loopEnd = 0, key }) {
    this.stop();
    if (!this.clip) return;
    const t0 = this.ctx.currentTime + 0.04;
    this.key = key;
    this.srcs = Object.entries(this.clip.bufs).map(([k, buf]) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      if (loop) {
        src.loop = true;
        src.loopStart = loopStart;
        src.loopEnd = loopEnd || buf.duration;
      }
      const g = this.ctx.createGain();
      g.gain.value = k === key ? this.clip.gains[k] : 0;
      src.connect(g);
      g.connect(this.out);
      src.start(t0, from);
      return { k, src, g };
    });
    const first = this.srcs[0].src;
    this.first = first;
    first.onended = () => {
      if (this.first !== first) return; // stopped, or playing again
      this.playing = false;
      this.srcs = [];
      if (this.onEnd) this.onEnd();
    };
    this.t0 = t0;
    this.from = from;
    this.loop = loop ? { start: loopStart, end: loopEnd || this.clip.duration } : null;
    this.playing = true;
  }

  select(key) {
    this.key = key;
    const now = this.ctx.currentTime;
    for (const s of this.srcs) s.g.gain.setTargetAtTime(s.k === key ? this.clip.gains[s.k] : 0, now, 0.004);
  }

  // Seconds into the clip's buffers.
  position() {
    if (!this.playing) return -1;
    let t = this.from + Math.max(0, this.ctx.currentTime - this.t0);
    if (this.loop && t > this.loop.end) t = this.loop.start + ((t - this.loop.start) % (this.loop.end - this.loop.start));
    return t;
  }

  stop() {
    this.first = null;
    for (const s of this.srcs) { try { s.src.stop(); } catch { /* not started */ } s.src.disconnect(); }
    this.srcs = [];
    this.playing = false;
  }
}

// ----------------------------------------------------------- blind test

const NOUNS = 'table river chair window garden pencil rabbit kitchen mountain letter doctor bottle cloud horse ticket bridge carpet lemon rocket pocket button monkey castle candle jacket teacher dinner basket blanket finger island'.split(' ');
const ADJS = 'green quiet heavy funny empty dirty soft cold tall brave sleepy round sweet yellow busy'.split(' ');
const VERBS = 'eats paints kicks builds catches follows washes carries finds pushes opens sells keeps drops visits'.split(' ');
const IMPS = 'take wash find paint open follow carry catch push sell'.split(' ');

// "The heavy rabbit paints the window." Grammatical, but nobody can guess it.
function unpredictable(rnd, i) {
  const p = (list) => list[Math.floor(rnd() * list.length)];
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  if (i % 3 === 0) return `The ${p(ADJS)} ${p(NOUNS)} ${p(VERBS)} the ${p(NOUNS)}.`;
  if (i % 3 === 1) return `${cap(p(IMPS))} the ${p(NOUNS)} and the ${p(ADJS)} ${p(NOUNS)}.`;
  return `Why does the ${p(NOUNS)} ${p(IMPS)} the ${p(ADJS)} ${p(NOUNS)}?`;
}

function readResults() {
  try { return JSON.parse(localStorage.getItem(RESULTS_KEY) || '[]'); } catch { return []; }
}
function writeResults(list) {
  try { localStorage.setItem(RESULTS_KEY, JSON.stringify(list)); } catch { /* private window: results last this visit */ }
}

// ----------------------------------------------------------------- view

export async function render(el, params = {}) {
  const songs = allSongs().filter((s) => !s.source || s.source === 'band');
  if (!songs.length) { el.append(h('div', { class: 'empty' }, 'No songs played by the band yet.')); return null; }
  const state = {
    song: songs.find((s) => s.id === params.song) || songs.find((s) => s.id === 'twinkle') || songs[0],
    per: 1, clip: 0, rate: 1, band: false, voice: 'A', loop: true, word: -1,
  };
  const deck = new Deck();
  const cache = new Map();
  let compiled = null;
  let clips = [];
  let current = null; // the rendered clip
  let raf = 0;
  let job = 0;

  const status = h('div', { class: 'small lab-status', role: 'status', 'aria-live': 'polite' });
  const announce = h('div', { class: 'sr-only', 'aria-live': 'assertive' });

  // ---- controls
  const songSel = h('select', { 'aria-label': 'Song' }, songs.map((s) => h('option', { value: s.id, selected: s === state.song }, `${s.emoji || '🎵'} ${s.title}`)));
  songSel.addEventListener('change', () => { state.song = songs.find((s) => s.id === songSel.value); state.clip = 0; loadSong(); });
  const perRow = h('div', { class: 'style-strip', role: 'group', 'aria-label': 'Lines per clip' });
  const rateRow = h('div', { class: 'style-strip', role: 'group', 'aria-label': 'Speed' });
  const chips = (row, list, get, set) => {
    clear(row);
    for (const [v, label] of list) row.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(get() === v), onclick: () => { set(v); chips(row, list, get, set); } }, label));
  };
  const drawPer = () => chips(perRow, [[1, '1 line'], [2, '2 lines']], () => state.per, (v) => { state.per = v; state.clip = 0; loadClips(); });
  const drawRate = () => chips(rateRow, [[1, '100%'], [0.85, '85%'], [0.7, '70%']], () => state.rate, (v) => { state.rate = v; loadClip(); });
  drawPer();
  drawRate();

  const clipList = h('ol', { class: 'lab-clips' });
  const prevBtn = h('button', { class: 'btn btn-sm', type: 'button', title: 'Previous clip (←)', onclick: () => go(-1) }, '← Previous clip');
  const nextBtn = h('button', { class: 'btn btn-sm', type: 'button', title: 'Next clip (→)', onclick: () => go(1) }, 'Next clip →');

  const voiceBtns = VOICES.map((v, i) => h('button', {
    class: 'btn lab-voice', type: 'button', 'aria-pressed': String(state.voice === v.key), title: `${v.name}: ${v.desc} (${v.key} or ${i + 1})`,
    onclick: () => pick(v.key),
  }, h('span', { class: 'lab-key' }, v.key), h('span', null, v.name), h('span', { class: 'lab-level small' })));
  const playBtn = h('button', { class: 'btn primary btn-lg lab-play', type: 'button', disabled: true, onclick: () => toggle() }, '▶ Play');
  const loopBtn = h('button', { class: 'btn', type: 'button', 'aria-pressed': String(state.loop), title: 'Repeat the clip (L)', onclick: () => { state.loop = !state.loop; loopBtn.setAttribute('aria-pressed', String(state.loop)); if (deck.playing) start(); } }, '🔁 Repeat');
  const bandBtn = h('button', { class: 'btn', type: 'button', 'aria-pressed': String(state.band), title: 'With or without the band (M)', onclick: () => setBand(!state.band) }, '🎸 With the band');
  const wholeBtn = h('button', { class: 'btn btn-sm hidden', type: 'button', onclick: () => { state.word = -1; drawWords(); if (deck.playing) start(); } }, '↔ Whole clip');
  const words = h('p', { class: 'lab-words', 'aria-label': 'Lyrics: click a word to repeat just that word' });
  const levelNote = h('p', { class: 'small' });

  function pick(key) {
    state.voice = key;
    voiceBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(VOICES[i].key === key)));
    deck.select(`${key}-${state.band ? 'mix' : 'voice'}`);
    const v = VOICES.find((x) => x.key === key);
    announce.textContent = `${v.key}: ${v.name}`;
  }

  function setBand(on) {
    state.band = on;
    bandBtn.setAttribute('aria-pressed', String(on));
    deck.select(`${state.voice}-${on ? 'mix' : 'voice'}`);
    drawLevels();
  }

  function drawLevels() {
    if (!current) return;
    const kind = state.band ? 'mix' : 'voice';
    voiceBtns.forEach((b, i) => {
      const lufs = current.levels[`${VOICES[i].key}-${kind}`];
      b.querySelector('.lab-level').textContent = Number.isFinite(lufs) ? `${lufs.toFixed(1)} LUFS` : '';
    });
    const vals = VOICES.map((v) => current.levels[`${v.key}-${kind}`]).filter(Number.isFinite);
    const spread = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
    levelNote.textContent = `Volume matched: as made, the versions differ by up to ${spread.toFixed(1)} dB (each button shows its own loudness), so each is turned up or down to the same loudness before you hear it. A louder voice can't win just by being louder.`;
  }

  // Word times in the clip's buffers (seconds).
  const wordTimes = () => clips[state.clip].lines.flatMap((l) => l.words.map((w) => ({
    text: w.text, start: LEAD + (w.start - clips[state.clip].from) * current.beatSec, end: LEAD + (w.end - clips[state.clip].from) * current.beatSec,
  })));

  function drawWords() {
    clear(words);
    if (!current) return;
    wordTimes().forEach((w, i) => {
      words.append(h('button', { class: `lab-word${state.word === i ? ' looped' : ''}`, type: 'button', title: 'Repeat just this word', onclick: () => { state.word = state.word === i ? -1 : i; drawWords(); start(); } }, w.text), ' ');
    });
    wholeBtn.classList.toggle('hidden', state.word < 0);
  }

  function start() {
    if (!current) return;
    unlockAudio();
    const key = `${state.voice}-${state.band ? 'mix' : 'voice'}`;
    if (state.word >= 0) {
      const w = wordTimes()[state.word];
      const ls = Math.max(0, w.start - 0.2);
      deck.play({ from: ls, loop: true, loopStart: ls, loopEnd: Math.min(current.duration, w.end + 0.15), key });
    } else {
      deck.play({ from: 0, loop: state.loop, loopStart: 0, loopEnd: current.duration, key });
    }
    playBtn.textContent = '⏸ Pause';
    cancelAnimationFrame(raf);
    const tick = () => {
      if (!current) return;
      const t = deck.position();
      const ws = words.querySelectorAll('.lab-word');
      wordTimes().forEach((w, i) => ws[i] && ws[i].classList.toggle('now', t >= w.start - 0.05 && t < w.end));
      if (deck.playing) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function toggle() {
    if (deck.playing) { deck.stop(); playBtn.textContent = '▶ Play'; return; }
    start();
  }
  deck.onEnd = () => { playBtn.textContent = '▶ Play'; };

  function go(d) {
    const n = state.clip + d;
    if (n < 0 || n >= clips.length) return;
    state.clip = n;
    loadClip();
  }

  function loadSong() {
    compiled = compileSong(state.song);
    loadClips();
  }

  function loadClips() {
    clips = clipsOf(compiled, state.per);
    loadClip();
  }

  function drawClips() {
    clear(clipList);
    clips.forEach((c, i) => clipList.append(h('li', null, h('button', {
      class: `lab-clip${i === state.clip ? ' active' : ''}`, type: 'button', 'aria-current': i === state.clip ? 'true' : null,
      onclick: () => { state.clip = i; loadClip(); },
    }, c.text))));
    prevBtn.disabled = state.clip <= 0;
    nextBtn.disabled = state.clip >= clips.length - 1;
  }

  async function loadClip() {
    const was = deck.playing;
    deck.stop();
    cancelAnimationFrame(raf);
    state.word = -1;
    drawClips();
    current = null;
    playBtn.disabled = true;
    playBtn.textContent = '▶ Play';
    clear(words);
    const key = `${state.song.id}|${state.per}|${state.clip}|${state.rate}`;
    const my = ++job;
    try {
      if (!cache.has(key)) {
        const clip = clips[state.clip];
        cache.set(key, renderClip(state.song, compiled, clip, { rate: state.rate, onStep: (n, of) => { if (my === job) status.textContent = `Preparing the voices… ${n}/${of}`; } }));
      }
      const res = await cache.get(key);
      if (my !== job) return;
      current = res;
      deck.load(res);
      status.textContent = `Ready: ${clips.length > 1 ? `clip ${state.clip + 1} of ${clips.length}` : 'one clip'}. Switch voices while it plays.`;
      playBtn.disabled = false;
      drawLevels();
      drawWords();
      if (was) start();
    } catch (e) {
      cache.delete(key);
      if (my === job) status.textContent = `Could not prepare this clip: ${e.message}`;
    }
  }

  // ---- blind test
  const blind = { items: [], at: -1, deck: new Deck() };
  let results = readResults();
  const blindBox = h('div');
  const tally = h('div', { class: 'lab-tally' });
  const blindSize = h('select', { 'aria-label': 'Sentences in the test', style: { width: 'auto' } }, [6, 9, 12, 18].map((n) => h('option', { value: n, selected: n === 9 }, `${n} sentences`)));
  const blindSource = h('select', { 'aria-label': 'Material', style: { width: 'auto' } },
    h('option', { value: 'sus' }, 'Unfamiliar sentences (fairest)'), h('option', { value: 'song' }, 'Lines of the song above'));

  function drawTally() {
    clear(tally);
    const rows = VOICES.map((v) => {
      const mine = results.filter((r) => r.voice === v.key);
      const right = mine.reduce((a, r) => a + r.right, 0);
      const of = mine.reduce((a, r) => a + r.of, 0);
      return h('tr', null, h('th', { scope: 'row' }, `${v.key} · ${v.name}`), h('td', null, String(mine.length)),
        h('td', null, of ? `${right} / ${of}` : '—'),
        h('td', null, of ? h('span', { class: 'lab-bar', style: { '--pct': `${Math.round((100 * right) / of)}%` } }, `${Math.round((100 * right) / of)}%`) : '—'));
    });
    tally.append(h('table', { class: 'lab-table' },
      h('thead', null, h('tr', null, h('th', null, 'Voice'), h('th', null, 'Sentences'), h('th', null, 'Words heard right'), h('th', null, 'Score'))),
      h('tbody', null, rows)),
    h('div', { class: 'row top-space' },
      h('button', { class: 'btn btn-sm', type: 'button', disabled: !results.length, onclick: copyResults }, '📋 Copy results'),
      h('button', { class: 'btn btn-sm', type: 'button', disabled: !results.length, onclick: () => { results = []; writeResults(results); drawTally(); } }, '🗑 Clear results')));
  }

  function copyResults() {
    const lines = ['voice\tbands\tmaterial\twords right\twords\tsung\ttyped'];
    for (const r of results) lines.push([r.voice, r.band ? 'with band' : 'alone', r.source, r.right, r.of, r.text, r.typed].join('\t'));
    navigator.clipboard.writeText(lines.join('\n')).then(() => toast('Results copied (paste them into a spreadsheet)', 'ok'), () => toast('Could not copy', 'bad'));
  }

  async function startBlind() {
    const n = Number(blindSize.value);
    const order = shuffle([...Array(n)].map((_, i) => VOICES[i % VOICES.length].key));
    const rnd = seeded(Math.floor(Math.random() * 1e9));
    let material;
    if (blindSource.value === 'sus') {
      material = order.map((_, i) => {
        const text = unpredictable(rnd, i);
        const song = { ...composeSong(text, { mood: 'pop', seed: 1 + Math.floor(rnd() * 1e6) }), id: `lab-${i}` };
        const c = compileSong(song);
        return { song, compiled: c, clip: clipsOf(c, 1)[0], text };
      });
    } else {
      const c = compileSong(state.song);
      const pool = shuffle(clipsOf(c, 1));
      material = order.map((_, i) => ({ song: state.song, compiled: c, clip: pool[i % pool.length], text: pool[i % pool.length].text }));
    }
    blind.items = material.map((m, i) => ({ ...m, voice: order[i], source: blindSource.value }));
    blind.at = 0;
    drawBlind();
  }

  async function playBlind() {
    const it = blind.items[blind.at];
    unlockAudio();
    if (!it.render) {
      const v = VOICES.find((x) => x.key === it.voice);
      it.render = renderClip(it.song, it.compiled, it.clip, { rate: state.rate, voices: [v] });
    }
    const res = await it.render;
    blind.deck.load(res);
    blind.deck.play({ key: `${it.voice}-${state.band ? 'mix' : 'voice'}` });
  }

  function drawBlind() {
    clear(blindBox);
    if (blind.at < 0) return;
    if (blind.at >= blind.items.length) {
      blindBox.append(h('p', null, '✅ Test finished. The scores below include every test you have run in this browser.'),
        h('button', { class: 'btn', type: 'button', onclick: () => { blind.at = -1; drawBlind(); } }, 'Close'));
      return;
    }
    const it = blind.items[blind.at];
    const typed = h('input', { type: 'text', placeholder: 'Type what you hear…', 'aria-label': 'What you heard', autocomplete: 'off', spellcheck: 'false' });
    const reveal = h('div', { 'aria-live': 'polite' });
    const check = () => {
      if (it.done) return;
      it.done = true;
      blind.deck.stop();
      const score = wordsHeard(typed.value, it.text);
      results.push({ voice: it.voice, right: score.right, of: score.of, text: it.text, typed: typed.value.trim(), band: state.band, source: it.source, at: Date.now() });
      writeResults(results);
      drawTally();
      const v = VOICES.find((x) => x.key === it.voice);
      clear(reveal).append(
        h('p', null, h('b', null, 'Sung: '), it.text),
        h('p', null, `That was ${v.key} · ${v.name}. You heard ${score.right} of ${score.of} words.`),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { blind.at += 1; drawBlind(); } }, blind.at + 1 < blind.items.length ? 'Next sentence →' : 'Finish'));
      checkBtn.disabled = true;
    };
    const checkBtn = h('button', { class: 'btn', type: 'button', onclick: check }, '✔ Check');
    typed.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    blindBox.append(
      h('p', { class: 'lab-blind-head' }, `Sentence ${blind.at + 1} of ${blind.items.length}: which voice is singing is hidden.`),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: playBlind }, '▶ Play (again)'), typed, checkBtn),
      reveal);
    typed.focus();
  }

  // ---- keys
  const onKey = (e) => {
    if (typingTarget(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const i = ['a', 'b', 'c'].indexOf(k) >= 0 ? ['a', 'b', 'c'].indexOf(k) : ['1', '2', '3'].indexOf(k);
    if (i >= 0 && current) { e.preventDefault(); pick(VOICES[i].key); return; }
    if (k === ' ' && current) { e.preventDefault(); toggle(); }
    else if (k === 'arrowright') go(1);
    else if (k === 'arrowleft') go(-1);
    else if (k === 'l') loopBtn.click();
    else if (k === 'm') setBand(!state.band);
  };
  document.addEventListener('keydown', onKey);

  el.append(
    h('section', { class: 'card' },
      h('h1', { class: 'page-title' }, '🔬 Voice lab'),
      h('p', { class: 'muted' }, 'Compare the robot singers on the very same notes: identical lyrics, melody, tempo and timing, at the same loudness. Only the voice changes (and Clear English may sing it an octave lower). Listen for the words: can you make out each one?'),
      h('div', { class: 'lab-legend' }, VOICES.map((v) => h('div', null, h('b', null, `${v.key} · ${v.name}`), ` — ${v.desc}`))),
      h('div', { class: 'studio-grid top-space' },
        h('div', { class: 'studio-field' }, h('label', null, 'Song'), songSel),
        h('div', { class: 'studio-field' }, h('label', null, 'Clip length'), perRow),
        h('div', { class: 'studio-field' }, h('label', null, 'Speed (same for all voices)'), rateRow)),
      h('h3', { class: 'section-title' }, '🎧 Compare'),
      h('div', { class: 'lab-voices', role: 'group', 'aria-label': 'Voice' }, voiceBtns),
      h('div', { class: 'row top-space' }, playBtn, loopBtn, bandBtn, prevBtn, nextBtn, wholeBtn),
      status, announce,
      words,
      levelNote,
      h('p', { class: 'small' }, h('kbd', null, 'A'), ' ', h('kbd', null, 'B'), ' ', h('kbd', null, 'C'), ' (or 1 2 3) switch voices without stopping · ', h('kbd', null, 'Space'), ' play/pause · ', h('kbd', null, 'L'), ' repeat · ', h('kbd', null, 'M'), ' band on/off · ', h('kbd', null, '←'), ' ', h('kbd', null, '→'), ' clips · click a word to repeat just that word'),
      h('details', { class: 'top-space' }, h('summary', null, 'All clips of this song'), clipList)),
    h('section', { class: 'card' },
      h('h3', { class: 'section-title', style: { marginTop: 0 } }, '🙈 Blind test: which voice is easier to understand?'),
      h('p', { class: 'small' }, 'Each sentence is sung by one of the voices, chosen at random and hidden. Type what you hear, then check: the lab counts the words you heard right for each voice. Each sentence is new, so hearing one voice never helps you with another. The band and speed settings above apply.'),
      h('div', { class: 'row' }, blindSource, blindSize, h('button', { class: 'btn primary', type: 'button', onclick: startBlind }, '▶ Start a blind test')),
      blindBox,
      tally),
  );
  drawTally();
  loadSong();

  return () => {
    job += 1;
    cancelAnimationFrame(raf);
    deck.stop();
    blind.deck.stop();
    document.removeEventListener('keydown', onKey);
  };
}
