/*
 * Turn a song into a PinPlay quiz (JSON you import in PinPlay's builder):
 * gap fills with the line read aloud, word choice, word order, wrong-word
 * hunts and rhyme matching.
 */
import { h, openModal, toast } from './ui.js';
import { compileSong } from './music/score.js';
import { timelineFromCompiled, timelineFromSynced } from './music/timeline.js';
import { pickGaps, distractors, wordPool } from './lyrics/gaps.js';
import { rhymePairs } from './lyrics/rhymes.js';
import { shuffle, seeded } from './ui.js';
import { normWord } from './lyrics/text.js';

export function songTimeline(song) {
  if (!song.source || song.source === 'band') return timelineFromCompiled(compileSong(song), song.bpm || 100);
  return timelineFromSynced(song.synced || [], song.duration || 0);
}

function base(id, type, prompt, extra = {}) {
  return {
    id,
    type,
    prompt,
    points: 1000,
    timeLimit: 0,
    audioEnabled: false,
    audioMode: 'tts',
    audioText: '',
    language: 'en-US-AriaNeural',
    audioData: '',
    ...extra,
  };
}

export function buildPinPlayQuiz(song, { seed = 7 } = {}) {
  const timeline = songTimeline(song);
  const lines = timeline.lines.filter((l) => !l.instrumental && l.words.length >= 3);
  const unique = [];
  const seen = new Set();
  for (const l of lines) {
    const k = l.text.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(l);
  }
  const rnd = seeded(seed);
  const pool = wordPool(timeline);
  const gaps = pickGaps(timeline, { mode: 'easy', seed });
  const questions = [];
  let n = 0;
  const id = (t) => `${song.id}-${t}-${++n}`;

  // 1. Listen and fill the gap (the line is read aloud).
  for (const l of unique.slice(0, 6)) {
    const set = gaps.get(l.index);
    if (!set || !set.size) continue;
    const wi = [...set][0];
    const words = l.words.map((w, i) => (i === wi ? '____' : w.text));
    questions.push(base(id('gap'), 'context_gap', `🎵 ${words.join(' ')}`, {
      gaps: [normWord(l.words[wi].text)],
      audioEnabled: true,
      audioText: l.text,
    }));
  }

  // 2. Choose the word you hear.
  for (const l of shuffle(unique, rnd).slice(0, 4)) {
    const set = gaps.get(l.index);
    if (!set) continue;
    const wi = [...set][0];
    const target = l.words[wi].text.replace(/[^A-Za-z'’-]/g, '');
    const wrong = distractors(target, { pool, count: 3, seed: seed + l.index });
    if (wrong.length < 2) continue;
    const words = l.words.map((w, i) => (i === wi ? '____' : w.text));
    questions.push(base(id('choice'), 'mcq', `Which word do you hear? 🎧 ${words.join(' ')}`, {
      audioEnabled: true,
      audioText: l.text,
      answers: shuffle([{ text: target, correct: true }, ...wrong.map((w) => ({ text: w, correct: false }))], rnd),
    }));
  }

  // 3. Put the words in order.
  for (const l of shuffle(unique.filter((x) => x.words.length >= 4 && x.words.length <= 9), rnd).slice(0, 3)) {
    questions.push(base(id('order'), 'puzzle', 'Put the words of the line in order.', {
      items: l.words.map((w) => w.text.replace(/[,.!?;:]+$/, '')),
      audioEnabled: true,
      audioText: l.text,
    }));
  }

  // 4. One word is wrong.
  for (const l of shuffle(unique.filter((x) => x.words.length >= 4), rnd).slice(0, 2)) {
    const cands = l.words.map((w, i) => i).filter((i) => normWord(l.words[i].text).length > 2);
    if (!cands.length) continue;
    const wi = cands[Math.floor(rnd() * cands.length)];
    const wrong = distractors(l.words[wi].text, { pool, count: 1, seed: seed * 3 + l.index, kind: 'listen' })[0];
    if (!wrong) continue;
    const words = l.words.map((w, i) => (i === wi ? w.text.replace(/[A-Za-z'’-]+/, wrong) : w.text));
    questions.push(base(id('error'), 'error_hunt', words.join(' '), {
      corrected: l.text,
      requiredErrors: 1,
      audioEnabled: true,
      audioText: l.text,
    }));
  }

  // 5. Rhymes.
  const pairs = rhymePairs(timeline).slice(0, 5);
  if (pairs.length >= 3) {
    questions.push(base(id('rhyme'), 'match_pairs', 'Match the words that rhyme.', {
      pairs: pairs.map((p) => ({ left: p.a, right: p.b })),
    }));
  }

  // 6. A word to talk about.
  questions.push(base(id('open'), 'open', `What is the song "${song.title}" about? Write one sentence.`));

  return {
    version: 1,
    title: `${song.emoji || '🎵'} ${song.title} (Singing)`,
    questions,
  };
}

export function exportPinPlayQuiz(song) {
  let quiz;
  try {
    quiz = buildPinPlayQuiz(song);
  } catch (e) {
    toast(`Could not build the quiz: ${e.message}`, 'bad');
    return;
  }
  const json = JSON.stringify(quiz, null, 2);
  const download = () => {
    const blob = new Blob([json], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${song.id}-pinplay.json` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  const types = quiz.questions.reduce((acc, q) => { acc[q.type] = (acc[q.type] || 0) + 1; return acc; }, {});
  openModal([
    h('h2', null, '🎯 Export to PinPlay'),
    h('p', null, `A PinPlay quiz with ${quiz.questions.length} questions made from "${song.title}":`),
    h('ul', { class: 'small' }, Object.entries(types).map(([t, c]) => h('li', null, `${c} × ${t.replace('_', ' ')}`))),
    h('p', { class: 'small' }, 'Most questions read the line aloud with PinPlay\'s voice. In PinPlay\'s builder, use Import and choose this file.'),
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', type: 'button', onclick: async () => { await navigator.clipboard.writeText(json).catch(() => {}); toast('JSON copied'); } }, '📋 Copy JSON'),
      h('button', { class: 'btn primary', type: 'button', onclick: download }, '⬇️ Download quiz'),
    ),
  ]);
}
