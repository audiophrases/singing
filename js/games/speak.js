/*
 * Say it! A line of the song on screen; a student says (or sings) it into
 * the microphone and the browser's speech recognition checks every word.
 *
 * In teams each line is one team's turn (js/views/turnbar.js): the mic
 * suggests right (75% of the words or more) or wrong, the teacher decides
 * (Enter accepts, Y / N), then the next line comes up for the next team. A
 * mic that fails (blocked, heard nothing) costs nobody the turn. A recording
 * and its suggestion belong to their line and their try: ◀ ▶, a steal or
 * ↑/↓ drop them. ◀ ▶ during a steal ends the missed line (no points); the
 * new line is the next team's own turn.
 */
import { h, clear } from '../ui.js';
import { setupCard, choiceRow } from './common.js';
import { normWord } from '../lyrics/text.js';
import { speak, stopSpeaking } from '../tts.js';
import { getSettings } from '../store.js';
import { sfx, confetti } from '../sfx.js';
import { lessonOf, lessonSay } from '../lesson/pack.js';

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
  const everyLine = timeline.lines.filter((l) => {
    if (l.instrumental || l.words.length < 2) return false;
    const k = l.text.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const tips = lessonSay(timeline, lessonOf(ctx.song));
  const packLines = everyLine.filter((l) => tips.has(l.index));
  const conf = { mode: packLines.length ? 'pack' : 'say' };
  const card = setupCard({
    emoji: '🗣️',
    title: 'Say it!',
    intro: SR ? 'Read the line aloud (or sing it!) into the microphone. Every word you say clearly turns green. In teams, each team says a line in turn.' : 'This browser cannot recognise speech. Open Singing in Chrome or Edge to play Say it!',
    body: SR ? h('div', null, h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Practice'),
      choiceRow([...(packLines.length ? [['pack', `🧠 AI pack (${packLines.length} lines)`]] : []), ['say', '🗣️ Say the lines'], ['memory', '🙈 From memory (line hidden)']], conf.mode, (v) => { conf.mode = v; })),
      ctx.turns?.setup()) : null,
    onStart: () => { if (SR) { card.destroy(); begin(); } },
  });
  clear(main).append(card);
  ctx.setBottom(false);
  let cleanup = null;
  ctx.addCleanup(() => { card.destroy(); if (cleanup) cleanup(); });

  function begin() {
    track.pause();
    const lines = conf.mode === 'pack' ? packLines : everyLine;
    let idx = 0;
    let rec = null;
    let shown = false; // from memory: the line is shown after nobody said it
    const results = new Map();
    // Teams: each line is one team's turn (js/views/turnbar.js).
    const T = ctx.turns?.active ? ctx.turns : null;
    const turn = { judge: true, prompt: 'The mic suggests, you decide', onOutcome: (o) => onTurn(o) };
    const lineBox = h('div', { class: 'say-line' });
    const tipBox = h('div', { class: 'say-tips' });
    const heardBox = h('div', { class: 'say-heard' });
    const scoreEl = h('div', { class: 'say-score' });
    const micBtn = h('button', { class: 'btn primary btn-lg say-mic', type: 'button' }, '🎙️ Speak');
    const counter = h('div', { class: 'gf-progress' });
    const draw = (marks = null) => {
      const l = lines[idx];
      counter.textContent = `Line ${idx + 1} of ${lines.length}`;
      clear(lineBox);
      const notes = conf.mode === 'pack' ? tips.get(l.index) || [] : [];
      l.words.forEach((w, i) => {
        const hidden = conf.mode === 'memory' && !marks && !shown;
        const target = notes.some((n) => i >= n.from && i <= n.to);
        lineBox.append(h('span', { class: `say-word${target ? ' target' : ''}${marks ? (marks[i] ? ' ok' : ' miss') : ''}${hidden ? ' hidden-word' : ''}` }, hidden ? '•'.repeat(Math.max(2, normWord(w.text).length)) : w.text), ' ');
      });
      clear(tipBox);
      for (const n of notes) tipBox.append(h('div', { class: 'gf-why' }, n.skill ? h('b', null, `${n.skill}: `) : null, n.tip));
      if (!marks) { clear(heardBox); clear(scoreEl); }
    };
    // Drop the recording in progress: it ends without marking anything.
    const stopMic = () => {
      if (!rec) return;
      const r = rec;
      rec = null;
      r.abort();
      micBtn.textContent = '🎙️ Speak';
      micBtn.classList.remove('listening');
    };
    const listen = () => {
      stopSpeaking();
      stopMic();
      rec = new SR();
      rec.lang = getSettings().speechLang || 'en-US';
      rec.interimResults = true;
      rec.maxAlternatives = 3;
      micBtn.textContent = '👂 Listening…';
      micBtn.classList.add('listening');
      let finalText = '';
      let heard = '';     // what the mic heard so far (interim results too)
      let failed = false; // blocked, nothing heard, stopped: nothing to mark
      const me = rec;
      // A recording belongs to the line on screen and the team trying it: if
      // either changes before it ends, it counts for nothing.
      const line = idx;
      const turnId = T?.turnId;
      const stale = () => idx !== line || (T && T.turnId !== turnId);
      T?.suggest(null); // a new try replaces the last suggestion
      rec.onresult = (e) => {
        if (stale()) return;
        let text = '';
        for (let i = 0; i < e.results.length; i += 1) text += `${e.results[i][0].transcript} `;
        heard = text.trim();
        heardBox.textContent = `"${heard}"`;
        if (e.results[e.results.length - 1].isFinal) finalText = text;
      };
      rec.onerror = (e) => {
        failed = true;
        if (e.error === 'aborted' || stale()) return;
        heardBox.textContent = e.error === 'not-allowed' ? '🚫 The microphone is blocked.' : e.error === 'no-speech' ? 'I did not hear anything. Try again!' : `Error: ${e.error}`;
      };
      rec.onend = () => {
        if (rec !== me) return; // a newer attempt replaced this one
        micBtn.textContent = '🎙️ Speak';
        micBtn.classList.remove('listening');
        rec = null;
        // Only words the mic really heard are marked: an error message is
        // not an answer, and the team can simply try again.
        const said = (finalText || heard).trim();
        if (failed || !said || stale()) return;
        const l = lines[idx];
        const marks = compareWords(l.words.map((w) => w.text), said.split(/\s+/));
        const pct = Math.round((marks.filter(Boolean).length / marks.length) * 100);
        draw(marks);
        heardBox.textContent = `"${said}"`;
        scoreEl.textContent = pct === 100 ? '💯 Perfect!' : pct >= 75 ? `👍 ${pct}%` : T ? `💪 ${pct}%` : `💪 ${pct}% - try again!`;
        const prev = results.get(idx) || 0;
        results.set(idx, Math.max(prev, pct));
        if (T) {
          // The mic only suggests: the teacher accepts it (Enter) or decides (Y / N).
          if (T.isOpen()) T.suggest(pct >= 75 ? 'right' : 'wrong');
        } else if (pct === 100) { sfx('correct', { volume: 0.5 }); confetti({ count: 60 }); } else if (pct < 50) sfx('wrong', { volume: 0.3 });
      };
      rec.start();
    };
    micBtn.addEventListener('click', () => (rec ? rec.stop() : listen()));
    const go = (d) => {
      const next = Math.max(0, Math.min(lines.length - 1, idx + d));
      // At the first or last line there is nowhere to go: no fresh turn on a
      // line that was just scored.
      if (next === idx) return;
      stopMic();
      idx = next;
      shown = false;
      T?.suggest(null); // the mic's guess was about the old line
      draw();
      // Teams: a turn nobody has tried yet comes along to the new line. A
      // steal (or a team that is out) belongs to the line that was missed:
      // that line ends with no points, and the new line is a fresh turn.
      if (T?.started()) T.close();
      if (T && !T.isOpen()) T.open(turn);
    };
    function onTurn(o) {
      const at = idx;
      stopMic(); // the try is over: a recording still going is not for it
      if (!o.done) {
        // The next team tries the same line: a clean line after a moment.
        setTimeout(() => { if (idx === at && T.isOpen()) draw(); }, 1500);
        return;
      }
      const ok = o.outcome === 'right' || o.outcome === 'stolen';
      if (!ok) { shown = true; draw(); speak(lines[idx].text); } // nobody said it: hear it
      if (idx < lines.length - 1) {
        // On to the next line, unless the teacher already moved (◀ ▶ open a turn).
        setTimeout(() => {
          if (idx !== at || T.isOpen() || !lineBox.isConnected) return;
          go(1);
        }, ok ? 1800 : 3500);
      }
    }
    const hearSung = () => {
      const l = lines[idx];
      track.setBarrier(l.singEnd + 0.2);
      track.seek(Math.max(0, l.start - 0.2));
      track.play();
    };
    clear(main).append(h('div', { class: 'say-wrap' },
      h('div', { class: 'gf-top' }, counter, h('div', null)),
      lineBox,
      tipBox,
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
    if (T) T.open(turn);
    ctx.onKey((e) => {
      const k = e.key.toLowerCase();
      if (k === 'm') { micBtn.click(); return true; }
      if (k === 'l') { speak(lines[idx].text); return true; }
      if (k === 'arrowright') { go(1); return true; }
      if (k === 'arrowleft') { go(-1); return true; }
      return false;
    });
    cleanup = () => { stopMic(); stopSpeaking(); };
  }
}
