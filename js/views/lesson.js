/*
 * AI song pack: make a prompt for an external AI, bring its JSON back batch by
 * batch, check it against the lyrics, review it and save it with the song. The
 * format and the checks are in js/lesson/pack.js, the prompt in js/lesson/prompt.js.
 * Until it is saved the pack waits in this browser, so batches survive a reload.
 */
import { h, clear, add, toast, confirmDialog, debounce, openModal } from '../ui.js';
import { getSong, saveUserSong, getSettings, setSettings, getLessonDraft, setLessonDraft } from '../store.js';
import { songTimeline } from '../pinplay-export.js';
import { LEVELS, PACK_FORMAT, PACK_VERSION, addCleanWord, applyPack, mergePacks, readPack, removePack, staleCount, POPUP_KINDS } from '../lesson/pack.js';
import { AGES, AI_KINDS, BATCH_SIZE, CLASS_DEFAULTS, buildPrompt, hasMelody, morePrompt, nextBatchPrompt, planBatches, repairPrompt } from '../lesson/prompt.js';
import { saveCloudSong } from '../cloud/library.js';
import { teacherAccess } from '../cloud/access.js';

const AGE_NAMES = { kids: 'Young learners', teens: 'Teenagers', adults: 'Adults' };

const field = (label, input) => h('div', { class: 'studio-field' }, h('label', null, label), input);
const quote = (item) => `L${item.line}${item.words ? ` “${item.words}”` : ''}`;
const levelTag = (item) => (item.level ? `[${item.level}] ` : '');

function saveFile(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function copyText(text, done) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const box = h('textarea', { value: text });
    document.body.append(box);
    box.select();
    document.execCommand('copy');
    box.remove();
  }
  toast(done);
}

// The sections of a pack as the teacher reads them. kids: a section of sets.
const REVIEW = [
  { key: 'cautions', title: '⚠️ Content warnings', from: (p) => p.teacher?.cautions, row: (c) => `${c.severity === 'serious' ? '🛑 ' : ''}${c.line ? `${quote(c)}: ` : ''}${c.note}`, more: false },
  { key: 'lines', title: '📜 Line by line', row: (l) => `L${l.line} ${l.emoji || ''} ${[l.translation, l.plain].filter(Boolean).join(' · ')}`, more: false },
  { key: 'words', title: '🔤 Key words', row: (w) => `${w.emoji || ''} ${w.word}${w.ipa ? ` ${w.ipa}` : ''}: ${w.meaning}${w.translation ? ` (${w.translation})` : ''}` },
  { key: 'popups', title: '💡 Karaoke pop-ups', row: (p) => `${POPUP_KINDS[p.kind] || ''} ${quote(p)}: ${p.text}` },
  { key: 'gapSets', title: '⌨️ Gap sets', kids: 'gaps', row: (s) => `${levelTag(s)}${s.emoji || ''} ${s.name}${s.rule ? `: ${s.rule}` : ''}`, kid: (g) => `${quote(g)}${g.options ? ` (not ${g.options.join(', ')})` : ''}${g.why ? `: ${g.why}` : ''}` },
  { key: 'swaps', title: '🕵️ Wrong words', row: (s) => `${quote(s)} becomes “${s.wrong}”${s.why ? `: ${s.why}` : ''}` },
  { key: 'stops', title: '🛑 Pause and predict', row: (s) => `${quote(s)}: ${s.ask}` },
  { key: 'hunts', title: '🔎 Grammar hunts', kids: 'targets', row: (s) => `${levelTag(s)}${s.emoji || ''} ${s.name}${s.rule ? `: ${s.rule}` : ''}`, kid: (t) => `${quote(t)}${t.why ? `: ${t.why}` : ''}` },
  { key: 'quiz', title: '❓ Quiz', row: (q) => `${levelTag(q)}${q.when === 'before' ? '🔮 ' : ''}${q.q} ✔ ${q.answer} ✘ ${q.wrong.join(' / ')}` },
  { key: 'cards', title: '🔥 Hot mic cards', row: (c) => `${levelTag(c)}${c.emoji || ''} ${c.title ? `${c.title}: ` : ''}${c.body}` },
  { key: 'pairs', title: '🃏 Memory sets', kids: 'pairs', row: (s) => `${levelTag(s)}${s.emoji || ''} ${s.name}`, kid: (p) => `${p.a} ↔ ${p.b}` },
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

const askMore = (key) => h('button', { class: 'btn btn-sm', type: 'button', onclick: () => copyText(morePrompt(key), 'Message copied: paste it into the AI chat') }, '📋 Ask the AI for more');

// Every item the AI wrote, each with its own ✕: nothing reaches a class unread.
function reviewList(pack, onChange, opened) {
  const out = h('div', { class: 'lesson-review' });
  const drop = (list, i) => { list.splice(i, 1); onChange(); };
  if (pack.profile || pack.teacher?.notes) {
    const p = pack.profile || {};
    out.append(sectionBox('profile', opened, '🎯 What the AI found',
      h('p', { class: 'small' }, [p.level && `Song level ${p.level}`, p.grammar?.join(', '), p.themes?.join(', ')].filter(Boolean).join(' · ')),
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
    out.append(sectionBox(section.key, opened, `${section.title} (${count})`, items, section.more === false ? null : askMore(section.key)));
  }
  if (pack.chant) {
    out.append(sectionBox('chant', opened, `✨ Original chant: ${pack.chant.title || 'untitled'}`,
      h('p', { class: 'lesson-chant' }, pack.chant.text),
      pack.chant.teaches ? h('p', { class: 'small' }, pack.chant.teaches) : null,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { delete pack.chant; onChange(); } }, '✕ Remove the chant')));
  }
  return out;
}

// Resolves with 'add', 'replace' or null.
function addOrReplace() {
  return new Promise((resolve) => {
    let picked = null;
    const pick = (value) => { picked = value; modal.close(); };
    const modal = openModal([
      h('h2', null, 'This song already has a pack'),
      h('p', null, 'This reply starts a new pack. Add it to the pack you have, or replace that pack?'),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => pick('replace') }, 'Replace the pack'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => pick('add') }, 'Add to the pack')),
    ], { onClose: () => resolve(picked) });
  });
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
    el.append(back, h('section', { class: 'card' }, h('h1', { class: 'page-title' }, '🧠 AI song pack'), h('p', null, 'Packs are saved with your own songs. Open the song and choose Copy and edit first.')));
    return null;
  }
  // The AI has to read the lyrics as they are, to say which words need cleaning.
  const timeline = songTimeline(song, { raw: true });
  const melody = hasMelody(timeline);
  const recording = !!song.source && song.source !== 'band';
  const klass = { ...CLASS_DEFAULTS, language: 'Catalan', ...getSettings().lessonClass, focus: '' };
  delete klass.minutes;
  delete klass.amount;
  if (!AI_KINDS[klass.ai]) klass.ai = CLASS_DEFAULTS.ai;

  // ---- 3. the replies (declared first: the class form redraws the batch list)
  const reply = h('textarea', { class: 'studio-json', rows: 7, 'aria-label': 'The AI reply', spellcheck: false, placeholder: 'Paste each reply from the AI here. Each batch is added to the pack.' });
  const fileIn = h('input', { type: 'file', multiple: true, accept: '.json,.txt,application/json,text/plain', class: 'hidden', 'aria-label': 'Open reply files' });
  const problemList = h('div', { role: 'status' });
  const batches = h('div', { class: 'lesson-batches' });
  const draft = getLessonDraft(song.id);
  let working = draft || (song.lesson ? JSON.parse(JSON.stringify(song.lesson)) : null);
  let edited = !!draft;
  const opened = new Set(['profile', 'cautions']);
  const downloadBtn = h('button', { class: 'btn', type: 'button', onclick: () => saveFile(`${song.id}-pack.json`, JSON.stringify(working, null, 2), 'application/json') }, '⬇️ Download this pack');
  const plan = () => planBatches(klass);

  // ---- 1. the class
  const promptBox = h('textarea', { class: 'studio-json lesson-prompt', rows: 10, readonly: true, 'aria-label': 'The prompt', onclick: (e) => e.target.select() });
  const promptSize = h('span', { class: 'small' });
  const batchNote = h('p', { class: 'small' });
  const prompt = () => buildPrompt(song, timeline, { ...klass, melody: melody && klass.melody });

  // Which batches came, and the message that asks for the next one.
  function drawBatches() {
    clear(batches);
    const steps = plan();
    const done = working?.progress?.done || [];
    if (!done.length || klass.ai === 'agent') return;
    const next = steps.findIndex((_, i) => !done.includes(i + 1)) + 1;
    add(batches,
      h('div', { class: 'row' }, steps.map((_, i) => h('span', { class: `badge${done.includes(i + 1) ? ' lesson-done' : ''}` }, `${done.includes(i + 1) ? '✅ ' : ''}${i + 1}`))),
      next
        ? h('div', { class: 'row top-space' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => copyText(nextBatchPrompt(steps, next), `Message copied: paste it into the AI chat for batch ${next}`) }, `📋 Copy the message for batch ${next}`),
          h('span', { class: 'small' }, steps[next - 1].parts.join(', ')))
        : h('p', { class: 'lesson-ok' }, `✅ All ${steps.length} batches are here. Read through them below, then save.`));
  }

  const redraw = () => {
    const { focus: typed, ...kept } = klass;
    setSettings({ lessonClass: kept });
    promptBox.value = prompt();
    promptSize.textContent = `${promptBox.value.length.toLocaleString()} characters`;
    const agent = klass.ai === 'agent';
    batchField.hidden = agent;
    batchNote.textContent = agent
      ? 'An agent does the whole job in one run, goes deeper and checks its own work. Give it the prompt, then open the file it leaves.'
      : `The AI will send this pack in ${plan().length} replies, one family of games at a time: batch 1 now, then each next one when you ask. Set 60 for the fewest replies; smaller batches mean more pastes but more careful work.`;
    drawBatches();
  };
  const redrawSoon = debounce(redraw, 200);
  const select = (key, options) => {
    const box = h('select', { 'aria-label': key }, options.map(([value, label]) => h('option', { value, selected: String(klass[key]) === String(value) }, label)));
    box.addEventListener('change', () => { klass[key] = box.value; redraw(); });
    return box;
  };
  const language = h('input', { type: 'text', value: klass.language, maxlength: 40, placeholder: 'e.g. Catalan' });
  language.addEventListener('input', () => { klass.language = language.value.trim(); redrawSoon(); });
  const batchSize = h('input', { type: 'number', value: klass.batchSize, min: BATCH_SIZE.least, max: BATCH_SIZE.most, 'aria-label': 'Create in batches of' });
  batchSize.addEventListener('input', () => { klass.batchSize = Number(batchSize.value) || BATCH_SIZE.usual; redrawSoon(); });
  const batchField = field('Create in batches of', batchSize);
  const focus = h('textarea', { rows: 2, maxlength: 400, placeholder: 'Optional. e.g. "the present perfect", "job interview language", "linking sounds", "they keep confusing since and for"' });
  focus.addEventListener('input', () => { klass.focus = focus.value.trim(); redrawSoon(); });
  const melodyBox = h('input', { type: 'checkbox', checked: klass.melody, disabled: !melody });
  melodyBox.addEventListener('change', () => { klass.melody = melodyBox.checked; redraw(); });

  const changed = () => { edited = true; setLessonDraft(song.id, working); drawBatches(); drawClean(); drawReview(); };

  // The words the singer drops out on.
  const cleanArea = h('div');
  const saveBtn = h('button', { class: 'btn primary btn-lg', type: 'button', onclick: () => save() }, '💾 Save with the song');
  function drawClean() {
    clear(cleanArea);
    if (!recording) return;
    const words = working?.clean || [];
    const on = h('input', { type: 'checkbox', checked: !working?.cleanOff });
    on.addEventListener('change', () => {
      if (on.checked) delete working.cleanOff; else working.cleanOff = true;
      changed();
    });
    const newWord = h('input', { type: 'text', maxlength: 60, placeholder: 'A word from the lyrics', 'aria-label': 'Add a word to clean' });
    const addWord = () => {
      const text = newWord.value.trim();
      if (!text) return;
      const pack = working || { format: PACK_FORMAT, version: PACK_VERSION };
      const times = addCleanWord(pack, timeline, text);
      if (!times) { toast(`“${text}” is not in the lyrics.`, 'bad'); return; }
      working = pack;
      toast(`“${text}” is sung ${times === 1 ? 'once' : `${times} times`}`);
      changed();
    };
    newWord.addEventListener('keydown', (e) => { if (e.key === 'Enter') addWord(); });
    const stems = !!song.karaoke || !!song.audio?.stems;
    const note = song.source !== 'audio'
      ? 'Words are masked on screen. A video or a song without audio cannot drop the singer.'
      : !stems ? 'This song has no karaoke version, so all the sound drops out for these words. Add a karaoke version and only the singer does.'
        : melody ? 'The singer drops out on these words and the music keeps playing. They are masked on screen too, for everyone who plays the song.'
          : 'The singer drops out on these words and the music keeps playing, but this song only has line timing, so word times are estimates. Listen to check them; an UltraStar file makes them exact.';
    add(cleanArea,
      h('h3', { class: 'section-title' }, '🧼 Clean version'),
      h('p', { class: 'small' }, note),
      h('ul', { class: 'lesson-items' }, words.map((word, i) => itemRow(`${word.words}${word.why ? `: ${word.why}` : ''}`, () => { words.splice(i, 1); changed(); }))),
      words.length ? h('label', { class: 'inline' }, on, ' Play the clean version') : null,
      h('div', { class: 'row top-space' }, newWord, h('button', { class: 'btn btn-sm', type: 'button', onclick: addWord }, '➕ Add a word')));
  }

  const review = h('div');
  const pictures = h('input', { type: 'checkbox', checked: true });
  const translations = h('input', { type: 'checkbox', checked: true });
  const profile = h('input', { type: 'checkbox', checked: true });
  const removeBtn = h('button', { class: 'btn', type: 'button', onclick: () => remove() }, '🗑️ Remove the pack');

  const store = async (next) => {
    delete next.mine;
    // The song itself was confirmed when it was saved.
    return next.cloud ? saveCloudSong(next, { rightsConfirmed: true }) : saveUserSong(next);
  };
  const save = async () => {
    saveBtn.disabled = true;
    try {
      const next = applyPack(getSong(song.id) || song, working, timeline, { profile: profile.checked, pictures: pictures.checked, translations: translations.checked });
      delete next.lesson.progress; // the next prompt on this song is a new run of batches
      await store(next);
      setLessonDraft(song.id, null);
      toast('Pack saved with the song ⭐', 'ok');
      location.hash = `#/song/${encodeURIComponent(song.id)}`;
    } catch (e) { toast(e.message, 'bad', 5000); }
    finally { saveBtn.disabled = false; }
  };
  const remove = async () => {
    if (!(await confirmDialog('Remove this pack from the song? Pictures, translations and tags already added to the song stay.', { ok: 'Remove', danger: true }))) return;
    try {
      await store(removePack(getSong(song.id) || song));
      setLessonDraft(song.id, null);
      toast('Pack removed');
      location.hash = `#/song/${encodeURIComponent(song.id)}`;
    } catch (e) { toast(e.message, 'bad', 5000); }
  };

  function drawReview() {
    clear(review);
    downloadBtn.hidden = !working;
    if (!working) return;
    const lost = staleCount(timeline, working);
    add(review,
      h('h3', { class: 'section-title' }, edited ? '🧐 Step 4: review and save' : '🧠 The saved pack'),
      edited ? h('p', { class: 'small' }, 'Not saved yet: this pack waits in this browser until you save it.') : null,
      lost ? h('p', { class: 'lesson-warn' }, `${lost} item${lost === 1 ? '' : 's'} no longer match the lyrics, so the games skip them.`) : null,
      reviewList(working, changed, opened),
      edited ? h('div', { class: 'lesson-apply' },
        h('label', { class: 'inline' }, profile, ' Update the song’s level, grammar, themes and key words'),
        working.lines?.some((l) => l.emoji) ? h('label', { class: 'inline' }, pictures, ' Add pictures to lines that have none') : null,
        working.lines?.some((l) => l.translation) ? h('label', { class: 'inline' }, translations, ' Add the translations') : null) : null,
      h('div', { class: 'row top-space' }, edited ? saveBtn : null, song.lesson ? removeBtn : null),
      h('p', { class: 'small' }, 'Teacher notes and content warnings stay with you: students and the public page never receive them.'));
  }

  // One reply: read it, join it to the pack, and clear the box for the next.
  // label: the file it came from, so a report on many files says which is which.
  let busy = false;
  const takeReply = async (text, label = '') => {
    if (!text.trim()) return;
    const tag = label ? `${label}: ` : '';
    const res = readPack(text, timeline, { title: song.title });
    const fix = () => h('div', { class: 'row top-space' },
      h('button', { class: 'btn', type: 'button', onclick: () => copyText(repairPrompt(res), 'Message copied: paste it into the AI chat') }, `📋 Copy a message that asks the AI to fix ${label || 'this'}`));
    if (res.fatal) {
      problemList.append(h('p', { class: 'lesson-bad' }, `❌ ${tag}${res.fatal}`));
      if (res.problems.length) problemList.append(h('ul', { class: 'small' }, res.problems.slice(0, 30).map((p) => h('li', null, p))));
      problemList.append(fix());
      return;
    }
    {
      const done = working?.progress?.done || [];
      const number = res.batch || plan().findIndex((_, i) => !done.includes(i + 1)) + 1 || done.length + 1;
      // A first batch on a pack that did not come from this run of batches.
      const startsAgain = number === 1 && !!working && !done.includes(1);
      const mode = startsAgain ? await addOrReplace() : 'add';
      if (!mode) return;
      const base = mode === 'add' ? working : null;
      const pack = base ? readPack(JSON.stringify(mergePacks(base, res.pack)), timeline).pack || res.pack : res.pack;
      pack.progress = { done: [...new Set([...(base?.progress?.done || []), number])].sort((a, b) => a - b) };
      working = pack;
      reply.value = '';
      const name = klass.ai === 'agent' && !res.batch ? 'The pack' : `Batch ${number}`;
      problemList.append(h('p', { class: 'lesson-ok' }, `✅ ${tag}${name} added.${res.moved ? ` ${res.moved} line number${res.moved === 1 ? ' was' : 's were'} wrong and corrected from the quoted words.` : ''}${res.problems.length ? ` ${res.problems.length} item${res.problems.length === 1 ? '' : 's'} left out:` : ''}`));
      if (res.problems.length) {
        problemList.append(h('ul', { class: 'small lesson-problems' }, res.problems.slice(0, 30).map((p) => h('li', null, p))),
          res.problems.length > 30 ? h('p', { class: 'small' }, `...and ${res.problems.length - 30} more.`) : null, fix());
      }
      changed();
    }
  };
  // One report for everything brought in at once: a problem in one file stays
  // on the page when the next file loads.
  const bringIn = async (replies) => {
    if (busy) return;
    busy = true;
    clear(problemList);
    try {
      for (const [text, label] of replies) await takeReply(await text(), label);
    } finally { busy = false; }
  };
  reply.addEventListener('input', debounce(() => bringIn([[() => reply.value, '']]), 300));
  fileIn.addEventListener('change', () => {
    const files = [...fileIn.files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    fileIn.value = '';
    return bringIn(files.map((file) => [() => file.text().catch((e) => { toast(`Could not read ${file.name}: ${e.message}`, 'bad'); return ''; }), file.name]));
  });

  el.append(back,
    h('section', { class: 'card studio-card' },
      h('h1', { class: 'page-title' }, `🧠 AI song pack: ${song.title}`),
      h('p', { class: 'muted' }, 'An AI studies the lyrics and writes content for Singing’s games: gap sets, hunts, wrong words, quiz questions, cards and pop-ups, at the song’s level and the levels next to it. Copy the prompt into a chatbot like ChatGPT, Claude or Gemini, or hand it to an AI agent, and bring the results back here.'),
      h('h3', { class: 'section-title' }, '🏫 Step 1: your class'),
      h('div', { class: 'studio-grid' },
        field('Level', select('level', [['', 'Let the AI decide'], ...LEVELS.map((l) => [l, l])])),
        field('Age', select('age', Object.keys(AGES).map((a) => [a, AGE_NAMES[a]]))),
        field('Students’ first language', language),
        field('Who writes it', select('ai', Object.entries(AI_KINDS))),
        batchField),
      batchNote,
      field('What do you want to work on?', focus),
      h('label', { class: 'inline' }, melodyBox, melody ? ` Include the melody from the ${recording ? 'UltraStar file' : 'score'}` : ' Include the melody (this song has no notes)'),
      h('p', { class: 'small' }, melody
        ? 'Lets the AI plan vowel work on long notes, warn about fast lines and stress the melody bends, and choose the order to teach the song in. Singing sends what it measured (seconds, notes, rests), not the raw file.'
        : 'Import an UltraStar file in the Studio and the AI can plan singing and pronunciation work from the melody.'),
      h('h3', { class: 'section-title' }, '📋 Step 2: copy the prompt'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => copyText(promptBox.value, 'Prompt copied: paste it into your AI') }, '📋 Copy the prompt'),
        h('button', { class: 'btn', type: 'button', onclick: () => saveFile(`${song.id}-prompt.txt`, promptBox.value, 'text/plain') }, '⬇️ Download'),
        promptSize),
      h('p', { class: 'small' }, 'The prompt contains the lyrics, and they leave Singing when you paste them, so use an AI your school allows.'),
      h('details', null, h('summary', { class: 'small' }, 'Read the prompt'), promptBox),
      h('h3', { class: 'section-title' }, '📥 Step 3: bring back each reply'),
      reply,
      h('div', { class: 'row top-space' },
        h('button', { class: 'btn', type: 'button', title: 'Choose all the .json or .txt files at once', onclick: () => fileIn.click() }, '📂 Open files'), fileIn,
        downloadBtn),
      problemList,
      batches,
      cleanArea,
      review));

  redraw();
  drawClean();
  drawReview();
  return null;
}
