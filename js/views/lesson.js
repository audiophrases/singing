/*
 * AI lesson pack: make a prompt for an external AI, bring its JSON back, check
 * it against the lyrics, review it and save it with the song. The format and
 * the checks are in js/lesson/pack.js, the prompt in js/lesson/prompt.js.
 */
import { h, clear, add, toast, confirmDialog, debounce } from '../ui.js';
import { getSong, saveUserSong, getSettings, setSettings } from '../store.js';
import { songTimeline } from '../pinplay-export.js';
import { LEVELS, applyPack, lessonOf, readPack, removePack, staleCount, POPUP_KINDS } from '../lesson/pack.js';
import { AGES, AMOUNTS, CLASS_DEFAULTS, buildPrompt, hasMelody, repairPrompt } from '../lesson/prompt.js';
import { saveCloudSong } from '../cloud/library.js';
import { teacherAccess } from '../cloud/access.js';
import { GAMES } from '../games/index.js';

const AGE_NAMES = { kids: 'Young learners', teens: 'Teenagers', adults: 'Adults' };

const field = (label, input) => h('div', { class: 'studio-field' }, h('label', null, label), input);
const quote = (item) => `L${item.line}${item.words ? ` “${item.words}”` : ''}`;
const activityName = (id) => ({ worksheet: '🖨️ Worksheet', chant: '✨ Song maker' }[id] || (() => { const g = GAMES.find((x) => x.id === id); return g ? `${g.emoji} ${g.name}` : id; })());

function saveFile(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function copyText(text, box, done) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    box.select();
    document.execCommand('copy');
  }
  toast(done);
}

// The sections of a pack as the teacher reads them. kids: a section of sets.
const REVIEW = [
  { key: 'cautions', title: '⚠️ Content warnings', from: (p) => p.teacher?.cautions, row: (c) => `${c.severity === 'serious' ? '🛑 ' : ''}${c.line ? `${quote(c)}: ` : ''}${c.note}` },
  { key: 'path', title: '🧭 Lesson plan', from: (p) => p.teacher?.path, row: (s) => `${s.stage} · ${activityName(s.activity)}${s.set ? ` (${s.set})` : ''}${s.minutes ? ` · ${s.minutes} min` : ''}${s.do ? `: ${s.do}` : ''}` },
  { key: 'lines', title: '📜 Line by line', row: (l) => `L${l.line} ${l.emoji || ''} ${[l.translation, l.plain].filter(Boolean).join(' · ')}` },
  { key: 'words', title: '🔤 Key words', row: (w) => `${w.emoji || ''} ${w.word}${w.ipa ? ` ${w.ipa}` : ''}: ${w.meaning}${w.translation ? ` (${w.translation})` : ''}` },
  { key: 'popups', title: '💡 Karaoke pop-ups', row: (p) => `${POPUP_KINDS[p.kind] || ''} ${quote(p)}: ${p.text}` },
  { key: 'hunts', title: '🔎 Grammar hunts', kids: 'targets', row: (s) => `${s.emoji || ''} ${s.name}${s.rule ? `: ${s.rule}` : ''}`, kid: (t) => `${quote(t)}${t.why ? `: ${t.why}` : ''}` },
  { key: 'gapSets', title: '⌨️ Gap sets', kids: 'gaps', row: (s) => `${s.emoji || ''} ${s.name} (${s.tier})${s.rule ? `: ${s.rule}` : ''}`, kid: (g) => `${quote(g)}${g.options ? ` (not ${g.options.join(', ')})` : ''}${g.why ? `: ${g.why}` : ''}` },
  { key: 'swaps', title: '🕵️ Wrong words', row: (s) => `${quote(s)} becomes “${s.wrong}”${s.why ? `: ${s.why}` : ''}` },
  { key: 'stops', title: '🛑 Pause and predict', row: (s) => `${quote(s)}: ${s.ask}` },
  { key: 'quiz', title: '❓ Quiz', row: (q) => `${q.when === 'before' ? '🔮 ' : ''}${q.q} ✔ ${q.answer} ✘ ${q.wrong.join(' / ')}` },
  { key: 'cards', title: '🔥 Hot mic cards', row: (c) => `${c.emoji || ''} ${c.title ? `${c.title}: ` : ''}${c.body}` },
  { key: 'pairs', title: '🃏 Memory sets', kids: 'pairs', row: (s) => `${s.emoji || ''} ${s.name}`, kid: (p) => `${p.a} ↔ ${p.b}` },
  { key: 'moves', title: '🕺 Freeze dance moves', row: (m) => `“${m.word}”: ${m.emoji || ''} ${m.text}` },
  { key: 'say', title: '🗣️ Say it!', row: (s) => `${quote(s)}${s.skill ? ` (${s.skill})` : ''}: ${s.tip}` },
  { key: 'echo', title: '🔁 Echo order', row: (s) => `L${s.from}${s.to > s.from ? `–L${s.to}` : ''}${s.why ? `: ${s.why}` : ''}` },
];

const listOf = (pack, section) => (section.from ? section.from(pack) : pack[section.key]) || [];

function itemRow(text, onRemove) {
  return h('li', { class: 'lesson-item' },
    h('span', null, text),
    h('button', { class: 'btn btn-sm ghost', type: 'button', title: 'Remove this item', 'aria-label': `Remove: ${text.slice(0, 60)}`, onclick: onRemove }, '✕'));
}

// Open sections stay open through a redraw, so items can be removed one by one.
function sectionBox(key, opened, summary, ...body) {
  const box = h('details', { class: 'lesson-section', open: opened.has(key) }, h('summary', null, summary), ...body);
  box.addEventListener('toggle', () => { if (box.open) opened.add(key); else opened.delete(key); });
  return box;
}

// Every item the AI wrote, each with its own ✕: nothing reaches a class unread.
function reviewList(pack, onChange, opened) {
  const out = h('div', { class: 'lesson-review' });
  const drop = (list, i) => { list.splice(i, 1); onChange(); };
  if (pack.profile) {
    const p = pack.profile;
    out.append(sectionBox('profile', opened, '🎯 Profile',
      h('p', { class: 'small' }, [p.level && `Level ${p.level}`, p.grammar?.join(', '), p.themes?.join(', ')].filter(Boolean).join(' · ')),
      p.summary ? h('p', null, p.summary) : null,
      pack.teacher?.levelWhy ? h('p', { class: 'small' }, pack.teacher.levelWhy) : null,
      pack.teacher?.notes ? h('p', null, pack.teacher.notes) : null));
  }
  for (const section of REVIEW) {
    const list = listOf(pack, section);
    if (!list.length) continue;
    const items = h('ul', { class: 'lesson-items' });
    list.forEach((item, i) => {
      items.append(itemRow(section.row(item), () => drop(list, i)));
      if (!section.kids) return;
      const kids = item[section.kids];
      items.append(h('ul', { class: 'lesson-items sub' }, kids.map((kid, k) => itemRow(section.kid(kid), () => {
        kids.splice(k, 1);
        if (!kids.length) list.splice(i, 1);
        onChange();
      }))));
    });
    const count = section.kids ? list.reduce((n, set) => n + set[section.kids].length, 0) : list.length;
    out.append(sectionBox(section.key, opened, `${section.title} (${count})`, items));
  }
  if (pack.chant) {
    out.append(sectionBox('chant', opened, `✨ Original chant: ${pack.chant.title || 'untitled'}`,
      h('p', { class: 'lesson-chant' }, pack.chant.text),
      pack.chant.teaches ? h('p', { class: 'small' }, pack.chant.teaches) : null,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { delete pack.chant; onChange(); } }, '✕ Remove the chant')));
  }
  return out;
}

export async function render(el, { id }) {
  if (!teacherAccess()) return null;
  const song = getSong(id);
  if (!song) {
    el.append(h('div', { class: 'empty' }, 'Song not found. ', h('a', { href: '#/' }, 'Back to the songs')));
    return null;
  }
  const back = h('div', { class: 'row', style: { marginBottom: '.6rem' } }, h('a', { class: 'btn btn-sm ghost', href: `#/song/${encodeURIComponent(song.id)}` }, `← ${song.title}`));
  if (!song.mine) {
    el.append(back, h('section', { class: 'card' }, h('h1', { class: 'page-title' }, '🧠 AI lesson pack'), h('p', null, 'Packs are saved with your own songs. Open the song and choose Copy and edit first.')));
    return null;
  }
  const timeline = songTimeline(song);
  const melody = hasMelody(timeline);
  const klass = { ...CLASS_DEFAULTS, language: 'Catalan', ...getSettings().lessonClass, focus: '' };
  if (!AMOUNTS[klass.amount]) klass.amount = CLASS_DEFAULTS.amount;

  // ---- 1. the class
  const promptBox = h('textarea', { class: 'studio-json lesson-prompt', rows: 10, readonly: true, 'aria-label': 'The prompt', onclick: (e) => e.target.select() });
  const promptSize = h('span', { class: 'small' });
  const prompt = () => buildPrompt(song, timeline, { ...klass, melody: melody && klass.melody });
  const redraw = () => {
    const { focus, ...kept } = klass;
    setSettings({ lessonClass: kept });
    promptBox.value = prompt();
    promptSize.textContent = `${promptBox.value.length.toLocaleString()} characters`;
  };
  const redrawSoon = debounce(redraw, 200);
  const select = (key, options) => {
    const box = h('select', { 'aria-label': key }, options.map(([value, label]) => h('option', { value, selected: String(klass[key]) === String(value) }, label)));
    box.addEventListener('change', () => { klass[key] = key === 'minutes' ? Number(box.value) : box.value; redraw(); });
    return box;
  };
  const language = h('input', { type: 'text', value: klass.language, maxlength: 40, placeholder: 'e.g. Catalan' });
  language.addEventListener('input', () => { klass.language = language.value.trim(); redrawSoon(); });
  const focus = h('textarea', { rows: 2, maxlength: 400, placeholder: 'Optional. e.g. "the present perfect", "job interview language", "linking sounds", "they keep confusing since and for"' });
  focus.addEventListener('input', () => { klass.focus = focus.value.trim(); redrawSoon(); });
  const melodyBox = h('input', { type: 'checkbox', checked: klass.melody, disabled: !melody });
  melodyBox.addEventListener('change', () => { klass.melody = melodyBox.checked; redraw(); });
  const usesUltraStar = song.source && song.source !== 'band';

  // ---- 3. the reply
  const reply = h('textarea', { class: 'studio-json', rows: 8, 'aria-label': 'The AI reply', spellcheck: false, placeholder: 'Paste the whole reply from the AI here.' });
  const fileIn = h('input', { type: 'file', accept: '.json,.txt,application/json,text/plain', class: 'hidden', 'aria-label': 'Open a reply file' });
  const status = h('div', { role: 'status' });
  const problemList = h('div');
  let working = song.lesson ? JSON.parse(JSON.stringify(song.lesson)) : null;
  let edited = false;
  const opened = new Set(['profile', 'cautions', 'path']);
  const downloadBtn = h('button', { class: 'btn', type: 'button', onclick: () => saveFile(`${song.id}-lesson.json`, JSON.stringify(working, null, 2), 'application/json') }, '⬇️ Download this pack');

  const review = h('div');
  const pictures = h('input', { type: 'checkbox', checked: true });
  const translations = h('input', { type: 'checkbox', checked: true });
  const profile = h('input', { type: 'checkbox', checked: true });
  const saveBtn = h('button', { class: 'btn primary btn-lg', type: 'button', onclick: () => save() }, '💾 Save with the song');
  const removeBtn = h('button', { class: 'btn', type: 'button', onclick: () => remove() }, '🗑️ Remove the pack');

  const store = async (next) => {
    delete next.mine;
    // The song itself was confirmed when it was saved.
    return next.cloud ? saveCloudSong(next, { rightsConfirmed: true }) : saveUserSong(next);
  };
  const save = async () => {
    saveBtn.disabled = true;
    try {
      const current = getSong(song.id) || song;
      await store(applyPack(current, working, timeline, { profile: profile.checked, pictures: pictures.checked, translations: translations.checked }));
      toast('Lesson pack saved with the song ⭐', 'ok');
      location.hash = `#/song/${encodeURIComponent(song.id)}`;
    } catch (e) { toast(e.message, 'bad', 5000); }
    finally { saveBtn.disabled = false; }
  };
  const remove = async () => {
    if (!(await confirmDialog('Remove this lesson pack from the song? Pictures, translations and tags already added to the song stay.', { ok: 'Remove', danger: true }))) return;
    try {
      await store(removePack(getSong(song.id) || song));
      toast('Lesson pack removed');
      location.hash = `#/song/${encodeURIComponent(song.id)}`;
    } catch (e) { toast(e.message, 'bad', 5000); }
  };

  const drawReview = () => {
    clear(review);
    downloadBtn.hidden = !working;
    if (!working) return;
    const lost = staleCount(timeline, working);
    add(review,
      h('h3', { class: 'section-title' }, edited ? '🧐 Step 4: review and save' : '🧠 The saved pack'),
      lost ? h('p', { class: 'lesson-warn' }, `${lost} item${lost === 1 ? '' : 's'} no longer match the lyrics, so the games skip them.`) : null,
      reviewList(working, () => { edited = true; drawReview(); }, opened),
      edited ? h('div', { class: 'lesson-apply' },
        h('label', { class: 'inline' }, profile, ' Update the song’s level, grammar, themes and key words'),
        working.lines?.some((l) => l.emoji) ? h('label', { class: 'inline' }, pictures, ' Add pictures to lines that have none') : null,
        working.lines?.some((l) => l.translation) ? h('label', { class: 'inline' }, translations, ' Add the translations') : null) : null,
      h('div', { class: 'row top-space' }, edited ? saveBtn : null, song.lesson ? removeBtn : null),
      h('p', { class: 'small' }, 'Teacher notes, the plan and the content warnings stay with you: students and the public page never receive them.'));
  };

  const check = () => {
    clear(status);
    clear(problemList);
    if (!reply.value.trim()) return;
    const res = readPack(reply.value, timeline, { title: song.title });
    const fix = () => {
      const text = repairPrompt(res);
      return h('div', { class: 'row top-space' },
        h('button', { class: 'btn', type: 'button', onclick: () => copyText(text, reply, 'Message copied: paste it into the AI chat') }, '📋 Copy a message that asks the AI to fix this'));
    };
    if (res.fatal) {
      status.append(h('p', { class: 'lesson-bad' }, `❌ ${res.fatal}`));
      if (res.problems.length) problemList.append(h('ul', { class: 'small' }, res.problems.slice(0, 30).map((p) => h('li', null, p))));
      problemList.append(fix());
      return;
    }
    working = res.pack;
    edited = true;
    status.append(h('p', { class: 'lesson-ok' }, `✅ Pack read.${res.moved ? ` ${res.moved} line number${res.moved === 1 ? ' was' : 's were'} wrong and corrected from the quoted words.` : ''}${res.problems.length ? ` ${res.problems.length} item${res.problems.length === 1 ? '' : 's'} left out:` : ''}`));
    if (res.problems.length) {
      problemList.append(h('ul', { class: 'small lesson-problems' }, res.problems.slice(0, 30).map((p) => h('li', null, p))),
        res.problems.length > 30 ? h('p', { class: 'small' }, `...and ${res.problems.length - 30} more.`) : null, fix());
    }
    drawReview();
  };
  const checkSoon = debounce(check, 300);
  reply.addEventListener('input', checkSoon);
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files[0];
    fileIn.value = '';
    if (!file) return;
    try { reply.value = await file.text(); check(); }
    catch (e) { toast(`Could not read ${file.name}: ${e.message}`, 'bad'); }
  });

  el.append(back,
    h('section', { class: 'card studio-card' },
      h('h1', { class: 'page-title' }, `🧠 AI lesson pack: ${song.title}`),
      h('p', { class: 'muted' }, 'An AI reads the lyrics and decides what this song is good for, for your class. Copy the prompt into ChatGPT, Claude, Gemini or any other AI, and bring its reply back here. The reply becomes gap sets, hunts, quizzes, cards and pop-ups inside the games.'),
      h('h3', { class: 'section-title' }, '🏫 Step 1: your class'),
      h('div', { class: 'studio-grid' },
        field('Level', select('level', [['', 'Let the AI decide'], ...LEVELS.map((l) => [l, l])])),
        field('Age', select('age', Object.keys(AGES).map((a) => [a, AGE_NAMES[a]]))),
        field('Students’ first language', language),
        field('Time', select('minutes', [20, 30, 45, 60, 90].map((m) => [m, `${m} minutes`]))),
        field('Pack size', select('amount', Object.entries(AMOUNTS).map(([k, a]) => [k, a.label])))),
      field('What do you want to work on?', focus),
      h('label', { class: 'inline' }, melodyBox, melody ? ` Include the melody from the ${usesUltraStar ? 'UltraStar file' : 'score'}` : ' Include the melody (this song has no notes)'),
      h('p', { class: 'small' }, melody
        ? 'Lets the AI plan vowel work on long notes, warn about fast lines and stress the melody bends, and choose the order to teach the song in. Singing sends what it measured (seconds, notes, rests), not the raw file.'
        : 'Import an UltraStar file in the Studio and the AI can plan singing and pronunciation work from the melody.'),
      h('h3', { class: 'section-title' }, '📋 Step 2: copy the prompt'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => copyText(promptBox.value, promptBox, 'Prompt copied: paste it into your AI') }, '📋 Copy the prompt'),
        h('button', { class: 'btn', type: 'button', onclick: () => saveFile(`${song.id}-lesson-prompt.txt`, promptBox.value, 'text/plain') }, '⬇️ Download'),
        promptSize),
      h('p', { class: 'small' }, 'The prompt contains the lyrics, and they leave Singing when you paste them, so use an AI your school allows.'),
      h('details', null, h('summary', { class: 'small' }, 'Read the prompt'), promptBox),
      h('h3', { class: 'section-title' }, '📥 Step 3: bring back the reply'),
      reply,
      h('div', { class: 'row top-space' },
        h('button', { class: 'btn', type: 'button', onclick: () => fileIn.click() }, '📂 Open a file'), fileIn,
        downloadBtn),
      status,
      problemList,
      review));

  redraw();
  drawReview();
  return null;
}
