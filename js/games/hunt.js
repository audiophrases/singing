/*
 * Grammar hunt: all the lyrics on one screen. Find every past verb (or
 * plural, preposition, animal...). The spotter can be wrong now and then:
 * right-click a word to add it to, or remove it from, the answers.
 */
import { h, clear } from '../ui.js';
import { categoriesInTimeline, CATEGORIES } from '../lyrics/grammar.js';
import { normWord } from '../lyrics/text.js';
import { setupCard, scoreBox, centerOf } from './common.js';
import { lessonOf, huntSets, huntKey, orderSets, pickSet, setLabel } from '../lesson/pack.js';
import { sfx, floatEmoji, confetti } from '../sfx.js';

export async function start(ctx) {
  const { timeline, main, track } = ctx;
  const found = categoriesInTimeline(timeline, 1);
  const sets = orderSets(huntSets(timeline, lessonOf(ctx.song)));
  const first = pickSet(sets, ctx.settings.packLevel);
  const conf = { cat: first ? `pack:${first.id}` : (found[0] || CATEGORIES[0]).id, music: true };
  const sel = h('select', { class: 'setup-select' },
    sets.length ? h('optgroup', { label: '🧠 AI pack' }, sets.map((s) => h('option', { value: `pack:${s.id}`, selected: `pack:${s.id}` === conf.cat }, setLabel(s, '🔎')))) : null,
    found.map((c) => h('option', { value: c.id }, `${c.emoji} ${c.name} (${c.count})`)));
  sel.addEventListener('change', () => { conf.cat = sel.value; });
  const musicBox = h('input', { type: 'checkbox', checked: true });
  musicBox.addEventListener('change', () => { conf.music = musicBox.checked; });
  const card = setupCard({
    emoji: '🔎',
    title: 'Grammar hunt',
    intro: 'All the words of the song are on the screen. Find every word of one kind. Wrong clicks cost a point!',
    body: h('div', null,
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Find'), sel),
      h('div', { class: 'setup-row' }, h('label', { class: 'inline' }, musicBox, '🎵 Play the song while we hunt'))),
    onStart: () => { card.destroy(); begin(); },
  });
  clear(main).append(card);
  ctx.setBottom(false);
  let cleanup = null;
  ctx.addCleanup(() => { card.destroy(); if (cleanup) cleanup(); });

  function begin() {
    // A lesson pack's set judges each word where it stands, not by its spelling.
    const set = sets.find((s) => `pack:${s.id}` === conf.cat);
    const cat = set ? { emoji: set.emoji || '🔎', name: set.name } : CATEGORIES.find((c) => c.id === conf.cat);
    const score = scoreBox();
    // Show each different line once.
    const seen = new Set();
    const lines = timeline.lines.filter((l) => {
      if (l.instrumental) return false;
      const k = l.text.toLowerCase();
      if (seen.has(k) || set?.hidden.has(k)) return false;
      seen.add(k);
      return true;
    });
    const tokens = [];
    const board = h('div', { class: 'hunt-board' });
    for (const l of lines) {
      const row = h('div', { class: 'hunt-line' });
      for (const [wi, w] of l.words.entries()) {
        const norm = normWord(w.text);
        const key = huntKey(l, wi);
        const tk = { norm, answer: set ? set.marks.has(key) : cat.test(norm), why: set?.marks.get(key) || '', state: 'idle' };
        const el = h('button', { class: 'hunt-word', type: 'button' }, w.text);
        tk.el = el;
        el.addEventListener('click', () => clickWord(tk));
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          // Teacher fix: flip whether this word counts (all copies of it, but
          // in a pack's set only this one: the same word can count elsewhere).
          const now = !tk.answer;
          for (const t of set ? [tk] : tokens) if (t.norm === tk.norm) { t.answer = now; if (!now && t.state === 'found') { t.state = 'idle'; t.el.classList.remove('found'); } }
          el.classList.add('fixed');
          updateCount();
        });
        tokens.push(tk);
        row.append(el, ' ');
      }
      board.append(row);
    }
    const counter = h('div', { class: 'hunt-count' });
    const why = h('div', { class: 'gf-why' });
    const updateCount = () => {
      const total = tokens.filter((t) => t.answer).length;
      const got = tokens.filter((t) => t.answer && t.state === 'found').length;
      counter.textContent = `${cat.emoji} ${cat.name}: ${got} / ${total}`;
      if (total && got === total) {
        confetti();
        setTimeout(() => ctx.finish({ score: score.value, max: total * 10, emoji: '🔎', title: 'All found!', text: set ? `${total} words found.` : `${total} ${cat.name.toLowerCase()} found.`, stars: score.value >= total * 9 ? 3 : score.value >= total * 6 ? 2 : 1 }), 900);
      }
    };
    function clickWord(tk) {
      if (tk.state === 'found') return;
      const c = centerOf(tk.el);
      if (tk.answer) {
        tk.state = 'found';
        tk.el.classList.add('found');
        why.textContent = tk.why ? `💡 ${tk.why}` : '';
        score.add(10);
        ctx.award(1);
        floatEmoji('+10', c.x, c.y - 20, { size: 26 });
        sfx('pop', { volume: 0.4 });
        updateCount();
      } else {
        tk.el.classList.add('shake', 'nope');
        setTimeout(() => tk.el.classList.remove('shake', 'nope'), 450);
        score.add(-1, false);
        sfx('wrong', { volume: 0.3 });
      }
    }
    const reveal = () => {
      for (const t of tokens) if (t.answer && t.state !== 'found') t.el.classList.add('revealed');
    };
    clear(main).append(h('div', { class: 'hunt-wrap' },
      h('div', { class: 'gf-top' }, counter, score.el),
      set?.rule ? h('div', { class: 'gf-why' }, set.rule) : null,
      board,
      why,
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        h('button', { class: 'btn', type: 'button', onclick: reveal }, '👀 Show the rest'),
        h('span', { class: 'small' }, 'Right-click a word to fix the answer key.'))));
    updateCount();
    ctx.setBottom(null);
    if (conf.music) { track.seek(0); track.play(); }
    cleanup = () => {};
  }
}
