/*
 * Say it! A line of the song on screen; a student says (or sings) it into
 * the microphone and the browser's speech recognition checks every word.
 */
import { h, clear } from '../ui.js';
import { setupCard, choiceRow } from './common.js';
import { normWord } from '../lyrics/text.js';
import { speak, stopSpeaking } from '../tts.js';
import { getSettings, getTeams, addPoints } from '../store.js';
import { sfx, confetti } from '../sfx.js';

// Align what was heard with what was expected (word level LCS).
export function compareWords(expected, heard) {
  const a = expected.map(normWord);
  const b = heard.map(normWord).filter(Boolean);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const same = (x, y) => x === y || (x.length > 3 && y.length > 3 && (x.startsWith(y) || y.startsWith(x)));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = same(a[i], b[j]) ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ok = new Array(n).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (same(a[i], b[j])) { ok[i] = true; i += 1; j += 1; } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1; else j += 1;
  }
  return ok;
}

export async function start(ctx) {
  const { timeline, main, track } = ctx;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const seen = new Set();
  const lines = timeline.lines.filter((l) => {
    if (l.instrumental || l.words.length < 2) return false;
    const k = l.text.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const conf = { mode: 'say' };
  const card = setupCard({
    emoji: '🗣️',
    title: 'Say it!',
    intro: SR ? 'Read the line aloud (or sing it!) into the microphone. Every word you say clearly turns green.' : 'This browser cannot recognise speech. Open Singing in Chrome or Edge to play Say it!',
    body: SR ? h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Practice'),
      choiceRow([['say', '🗣️ Say the lines'], ['memory', '🧠 From memory (line hidden)']], conf.mode, (v) => { conf.mode = v; })) : null,
    onStart: () => { if (SR) { card.destroy(); begin(); } },
  });
  clear(main).append(card);
  ctx.setBottom(false);
  let cleanup = null;
  ctx.addCleanup(() => { card.destroy(); if (cleanup) cleanup(); });

  function begin() {
    track.pause();
    let idx = 0;
    let rec = null;
    const results = new Map();
    const lineBox = h('div', { class: 'say-line' });
    const heardBox = h('div', { class: 'say-heard' });
    const scoreEl = h('div', { class: 'say-score' });
    const micBtn = h('button', { class: 'btn primary btn-lg say-mic', type: 'button' }, '🎙️ Speak');
    const counter = h('div', { class: 'gf-progress' });
    const draw = (marks = null) => {
      const l = lines[idx];
      counter.textContent = `Line ${idx + 1} of ${lines.length}`;
      clear(lineBox);
      l.words.forEach((w, i) => {
        const hidden = conf.mode === 'memory' && !marks;
        lineBox.append(h('span', { class: `say-word${marks ? (marks[i] ? ' ok' : ' miss') : ''}${hidden ? ' hidden-word' : ''}` }, hidden ? '•'.repeat(Math.max(2, normWord(w.text).length)) : w.text), ' ');
      });
      if (!marks) { clear(heardBox); clear(scoreEl); }
    };
    const listen = () => {
      stopSpeaking();
      if (rec) { rec.abort(); rec = null; }
      rec = new SR();
      rec.lang = getSettings().speechLang || 'en-US';
      rec.interimResults = true;
      rec.maxAlternatives = 3;
      micBtn.textContent = '👂 Listening…';
      micBtn.classList.add('listening');
      let finalText = '';
      rec.onresult = (e) => {
        let text = '';
        for (let i = 0; i < e.results.length; i += 1) text += `${e.results[i][0].transcript} `;
        heardBox.textContent = `"${text.trim()}"`;
        if (e.results[e.results.length - 1].isFinal) finalText = text;
      };
      rec.onerror = (e) => {
        heardBox.textContent = e.error === 'not-allowed' ? '🚫 The microphone is blocked.' : e.error === 'no-speech' ? 'I did not hear anything. Try again!' : `Error: ${e.error}`;
      };
      rec.onend = () => {
        micBtn.textContent = '🎙️ Speak';
        micBtn.classList.remove('listening');
        rec = null;
        const said = (finalText || heardBox.textContent.replace(/"/g, '')).trim();
        if (!said) return;
        const l = lines[idx];
        const marks = compareWords(l.words.map((w) => w.text), said.split(/\s+/));
        const pct = Math.round((marks.filter(Boolean).length / marks.length) * 100);
        draw(marks);
        heardBox.textContent = `"${said}"`;
        scoreEl.textContent = pct === 100 ? '💯 Perfect!' : pct >= 75 ? `👍 ${pct}%` : `💪 ${pct}% - try again!`;
        const prev = results.get(idx) || 0;
        results.set(idx, Math.max(prev, pct));
        if (pct === 100) { sfx('correct', { volume: 0.5 }); confetti({ count: 60 }); } else if (pct < 50) sfx('wrong', { volume: 0.3 });
        const t = getTeams();
        if (t.on && pct >= 75 && prev < 75) addPoints(t.list[(t.turn || 0) % t.list.length].id, 1);
      };
      rec.start();
    };
    micBtn.addEventListener('click', () => (rec ? rec.stop() : listen()));
    const go = (d) => {
      idx = Math.max(0, Math.min(lines.length - 1, idx + d));
      draw();
    };
    const hearSung = () => {
      const l = lines[idx];
      track.setBarrier(l.singEnd + 0.2);
      track.seek(Math.max(0, l.start - 0.2));
      track.play();
    };
    clear(main).append(h('div', { class: 'say-wrap' },
      h('div', { class: 'gf-top' }, counter, h('div', null)),
      lineBox,
      heardBox,
      scoreEl,
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        h('button', { class: 'btn btn-lg', type: 'button', onclick: () => go(-1) }, '◀'),
        h('button', { class: 'btn btn-lg', type: 'button', onclick: () => speak(lines[idx].text) }, '🔊 Listen'),
        h('button', { class: 'btn btn-lg', type: 'button', onclick: () => speak(lines[idx].text, { slow: true }) }, '🐢 Slowly'),
        h('button', { class: 'btn btn-lg', type: 'button', onclick: hearSung }, '🎵 Sung'),
        micBtn,
        h('button', { class: 'btn btn-lg', type: 'button', onclick: () => go(1) }, '▶'),
      ),
      h('div', { class: 'small' }, 'Keys: M speak · L listen · ← → lines'),
      h('button', { class: 'btn', type: 'button', onclick: () => {
        const vals = [...results.values()];
        const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
        ctx.finish({ score: avg, max: 100, emoji: '🗣️', title: 'Great speaking!', text: `${vals.length} lines practised, ${avg}% on average.` });
      } }, '🏁 Finish')));
    ctx.setBottom(false);
    draw();
    ctx.onKey((e) => {
      const k = e.key.toLowerCase();
      if (k === 'm') { micBtn.click(); return true; }
      if (k === 'l') { speak(lines[idx].text); return true; }
      if (k === 'arrowright') { go(1); return true; }
      if (k === 'arrowleft') { go(-1); return true; }
      return false;
    });
    cleanup = () => { if (rec) rec.abort(); stopSpeaking(); };
  }
}
