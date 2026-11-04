// The AI song pack from end to end, called by browser-smoke.cjs against the
// isolated local cloud fixture: the prompt, messy AI replies, batches, review,
// every game that reads a pack, the clean version measured on real audio, a
// homework gap set, and what students and the public receive.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { stubGoogle } = require('./browser-access.cjs');

const fixture = readFileSync(path.join(__dirname, '../tests/fixtures/lesson-what-did-you-do.json'), 'utf8');
const whole = JSON.parse(fixture);
const part = (batch, ...keys) => JSON.stringify({ format: whole.format, version: whole.version, batch, ...Object.fromEntries(keys.map((key) => [key, whole[key]])) });
const BATCHES = [
  part(1, 'song', 'profile', 'teacher', 'lines'),
  part(2, 'words', 'popups'),
  part(3, 'gapSets', 'swaps', 'stops'),
  part(4, 'hunts', 'quiz'),
  part(5, 'cards', 'pairs', 'moves', 'say', 'echo', 'chant'),
];

module.exports = async (browser, base) => {
  const createBase = `${base}create/`;
  const errors = [];
  const ok = (name) => console.log(`AI song pack: ${name}`);
  const watch = (page, who) => {
    page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|qrserver/.test(m.text())) errors.push(`${who} console: ${m.text()}`); });
  };
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const teacher = await context.newPage();
  watch(teacher, 'teacher');
  await stubGoogle(teacher, 'teacher');
  await teacher.goto(createBase);
  await teacher.getByLabel('Teacher password', { exact: true }).fill('teacher');
  await teacher.getByRole('button', { name: 'Teacher sign in', exact: true }).click();
  await teacher.getByRole('heading', { name: 'Songs from a folder', exact: false }).waitFor();

  // The starter songs arrive in the background.
  const findSong = (start) => teacher.evaluate(async (title) => {
    const { allSongs } = await import('/js/store.js');
    return allSongs().find((s) => s.title.startsWith(title))?.id || null;
  }, start);
  let id = null;
  for (let i = 0; i < 60 && !id; i += 1) {
    id = await findSong('What Did You Do');
    if (!id) await teacher.waitForTimeout(500);
  }
  assert.ok(id, 'the starter songs arrived');
  const go = (hash) => teacher.evaluate((h) => { location.hash = h; }, hash);
  const clipboard = () => teacher.evaluate(() => navigator.clipboard.readText());

  // ------------------------------------------------------------ the prompt
  await go(`#/song/${id}`);
  await teacher.getByRole('link', { name: /AI song pack/ }).click();
  await teacher.getByRole('heading', { name: /AI song pack/ }).waitFor();
  assert.equal(await teacher.locator('.studio-field', { hasText: 'first language' }).locator('input').inputValue(), 'Catalan');
  assert.equal(await teacher.getByLabel('level').inputValue(), '', 'left empty, the AI decides');
  await teacher.getByLabel('Create in batches of').fill('60');
  await teacher.getByText('in 5 replies').waitFor();
  await teacher.locator('.studio-field', { hasText: 'want to work on' }).locator('textarea').fill('irregular past verbs');
  await teacher.waitForTimeout(350);
  await teacher.getByRole('button', { name: 'Copy the prompt' }).click();
  const prompt = await clipboard();
  assert.match(prompt, /how abstract its meaning is/);
  assert.match(prompt, /Catalan is not Spanish/);
  assert.match(prompt, /What to work on: "irregular past verbs"/);
  assert.match(prompt, /L1 Yesterday I woke up late,/);
  assert.match(prompt, /# The melody/);
  assert.match(prompt, /comes in 5 batches/);
  assert.match(prompt, /Send batch 1 now and stop\.$/);
  assert.match(prompt, /"format": "singing-lesson-pack"/);
  ok(`prompt built and copied (${prompt.length} characters)`);
  const saved = await teacher.evaluate(async () => (await import('/js/store.js')).getSettings().lessonClass);
  assert.equal(saved.batchSize, 60);
  assert.equal(saved.focus, undefined);
  ok('class remembered for the next song');

  const reply = teacher.getByLabel('The AI reply');
  const download = teacher.getByRole('button', { name: 'Download this pack' });
  assert.equal(await download.isVisible(), false);

  // ---------------------------------------------------- replies that fail
  await reply.fill('Sorry, I cannot do that.');
  await teacher.getByText('There is no JSON in this reply').waitFor();
  await reply.fill(fixture.slice(0, 3000));
  await teacher.getByText('it was cut off').waitFor();
  await teacher.getByRole('button', { name: /asks the AI to fix this/ }).click();
  assert.match(await clipboard(), /cut off before the end/);
  ok('no JSON and a cut-off reply explain themselves; a fix-up message is copied');

  // ------------------------------------------- a messy reply, as AIs write
  const messy = JSON.parse(fixture);
  messy.popups[0].line = 2;                    // off by one: corrected
  messy.popups[2].words = 'half past nine';    // invented
  messy.swaps[1].words = 'lost my pen';        // more than one word
  delete messy.quiz[0].wrong;                  // incomplete
  messy.chatter = 'an unknown section';
  await reply.fill(`Here is your song pack!\n\n\`\`\`json\n${JSON.stringify(messy, null, 1)}\n\`\`\`\n\nLet me know if you want changes.`);
  await teacher.locator('.lesson-ok').first().waitFor();
  const report = await teacher.locator('.lesson-problems').innerText();
  assert.match(report, /"half past nine" is not in L2/);
  assert.match(report, /use one word, not "lost my pen"/);
  assert.match(report, /quiz 1: it needs wrong answers/);
  assert.match(report, /chatter/);
  assert.match(await teacher.locator('.lesson-ok').first().innerText(), /1 line number was wrong and corrected/);
  await teacher.getByRole('button', { name: /asks the AI to fix this/ }).click();
  const fix = await clipboard();
  assert.match(fix, /half past nine/);
  assert.match(fix, /send only them again/);
  ok('messy reply imported: fence and prose removed, bad items listed, a wrong line number corrected');
  await teacher.evaluate(async (songId) => (await import('/js/store.js')).setLessonDraft(songId, null), id);
  await teacher.reload();
  await teacher.getByLabel('The AI reply').waitFor();

  // ----------------------------------------------- batch by batch, appended
  await reply.fill(BATCHES[0]);
  await teacher.getByText('Batch 1 added.').waitFor();
  assert.equal(await reply.inputValue(), '', 'the box is clear for the next reply');
  assert.equal(await download.isVisible(), true);
  await teacher.getByRole('button', { name: 'Copy the message for batch 2' }).click();
  const next = await clipboard();
  assert.match(next, /Send batch 2 of 5 now/);
  assert.match(next, /"batch": 2/);
  await teacher.reload();
  await teacher.getByRole('button', { name: 'Copy the message for batch 2' }).waitFor();
  await teacher.getByText('Not saved yet').waitFor();
  ok('a batch survives a reload before saving, and the next message is ready');
  await reply.fill(BATCHES[0]);
  await teacher.getByText('Batch 1 added.').waitFor();
  assert.equal(await teacher.locator('.modal').count(), 0, 'pasting a batch again asks nothing');
  await teacher.locator('summary', { hasText: 'Line by line (22)' }).waitFor();
  for (const [i, batch] of BATCHES.entries()) {
    if (!i) continue;
    await reply.fill(batch);
    await teacher.getByText(`Batch ${i + 1} added.`).waitFor();
  }
  await teacher.getByText('All 5 batches are here').waitFor();
  assert.equal(await teacher.locator('.lesson-done').count(), 5);
  ok('five batches join into one pack, and pasting one twice doubles nothing');

  await teacher.getByRole('heading', { name: 'Step 4: review and save' }).waitFor();
  await teacher.locator('summary', { hasText: 'Hot mic cards (14)' }).click();
  await teacher.getByRole('button', { name: /^Remove: \[A2\] 🎶 Question and answer/ }).click();
  await teacher.locator('summary', { hasText: 'Hot mic cards (13)' }).waitFor();
  assert.equal(await teacher.getByRole('button', { name: /^Remove: \[B1\] 📞/ }).isVisible(), true, 'the section stays open after a removal');
  await teacher.locator('.lesson-section', { hasText: 'Hot mic cards' }).getByRole('button', { name: 'Ask the AI for more' }).click();
  assert.match(await clipboard(), /Write more for "cards"/);
  ok('review list: an item can be removed, and any section can ask for more');

  await teacher.getByRole('button', { name: 'Save with the song' }).click();
  await teacher.waitForURL(/#\/song\//);
  await teacher.locator('.lesson-warnings').waitFor();

  // ------------------------------------------------------------ song page
  assert.match(await teacher.locator('.lesson-warnings').innerText(), /Eating alone can be a sensitive topic/);
  assert.equal(await teacher.getByText('Lesson plan').count(), 0);
  assert.match(await teacher.locator('.activity', { hasText: 'Hot mic' }).locator('.act-pack').innerText(), /13/);
  assert.match(await teacher.locator('.activity', { hasText: 'Wrong word' }).locator('.act-pack').innerText(), /8/);
  assert.equal(await teacher.locator('.word-card').count(), 10);
  assert.equal(await teacher.locator('.lp-tr').first().innerText(), 'Ahir em vaig despertar tard,');
  assert.equal(await teacher.locator('.lp-plain').first().isVisible(), false);
  await teacher.getByRole('button', { name: 'In simple English' }).click();
  assert.equal(await teacher.locator('.lp-plain').first().isVisible(), true);
  ok('song page: warning, 🧠 counts on the tiles, translations, word cards and simple English');

  await teacher.reload();
  await teacher.locator('.lesson-warnings').waitFor();
  ok('pack persists across a reload');

  // ---------------------------------------------------------- the games
  const stage = teacher.locator('.stage');
  const open = async (game) => { await go(`#/song/${id}`); await teacher.locator('.lesson-warnings').waitFor(); await go(`#/play/${id}/${game}`); await stage.locator('.setup-card, .k-start').first().waitFor(); };
  const start = () => stage.locator('.setup-card').getByRole('button', { name: /Start|Play the song/ }).click();

  await open('hunt');
  assert.equal(await stage.locator('select.setup-select').inputValue(), 'pack:irregular-past', 'the easiest set comes first');
  await stage.locator('select.setup-select').selectOption('pack:after-did');
  await start();
  await stage.locator('.hunt-board').waitFor();
  assert.match(await stage.locator('.hunt-count').innerText(), /After did: the base form: 0 \/ 5/, 'only the words in context, not every "do" or "go"');
  await stage.locator('.hunt-line').filter({ hasText: 'Did you go?' }).getByRole('button', { name: 'go?' }).click();
  await stage.getByText('Did you go? Not: Did you went?').waitFor();
  ok('Grammar hunt: judged in context, explains each find');

  await open('gapfill');
  assert.equal(await stage.getByLabel('Word focus').inputValue(), 'pack:chorus-verbs');
  assert.match(await stage.getByLabel('Word focus').innerText(), /A2: Verbs in the chorus/);
  await stage.locator('.setup-card').getByRole('button', { name: /Tapping words/ }).click();
  await start();
  await stage.locator('.gf-progress').waitFor();
  assert.match(await stage.locator('.gf-progress').innerText(), /0 \/ 14 words/);
  ok('Fill the gaps: the gap set is the default, on every repeat of the chorus');

  await open('choose');
  await stage.getByLabel('Word focus').selectOption('pack:story-verbs');
  await start();
  await teacher.waitForFunction(() => document.querySelectorAll('.bank-word').length >= 3, null, { timeout: 15000 });
  const options = await stage.locator('.bank-word').allInnerTexts();
  assert.ok(options.some((o) => /waked/i.test(o)) && options.some((o) => /woke/i.test(o)), `AI wrong answers shown: ${options}`);
  await stage.locator('.bank-word', { hasText: /woke/i }).first().click();
  await stage.getByText('wake → woke').first().waitFor();
  ok('Choose the word: the AI\'s wrong answers, and an explanation after answering');

  await open('wrongword');
  assert.match(await stage.locator('.setup-card').innerText(), /AI pack \(8 lines\)/);
  await start();
  await teacher.waitForFunction(() => [...document.querySelectorAll('.ww-word')].some((b) => /^let$/i.test(b.textContent.replace(/\W/g, ''))), null, { timeout: 15000 });
  ok('Wrong word: the AI\'s swap is on screen');

  await open('quiz');
  const setup = await stage.locator('.setup-card').innerText();
  assert.match(setup, /AI pack \(10\)/);
  for (const level of ['A1', 'A2', 'B1']) assert.ok(setup.includes(level), `level ${level} offered`);
  await stage.locator('.setup-card').getByRole('button', { name: 'Before listening' }).click();
  await start();
  await stage.locator('.quiz-opt').first().waitFor();
  assert.match(await stage.locator('.quiz-text').innerText(), /What is it about/);
  await stage.locator('.quiz-opt', { hasText: 'The things someone did' }).click();
  await stage.locator('.quiz-explain').waitFor();
  ok('Song quiz: levels, before-listening questions, and an explanation');

  await open('quiz');
  await stage.locator('.setup-card').getByRole('button', { name: 'After listening' }).click();
  await stage.locator('.setup-card').getByRole('button', { name: 'B1', exact: true }).click();
  await start();
  await stage.locator('.quiz-opt').first().waitFor();
  assert.match(await stage.locator('.gf-progress').innerText(), /Question 1 \/ 2/, 'the two B1 questions');
  await stage.getByRole('button', { name: 'Listen' }).waitFor();
  await teacher.evaluate(async () => (await import('/js/store.js')).setSettings({ packLevel: '' }));
  ok('Song quiz: one level at a time, and a question can replay its line');

  await open('hotmic');
  assert.equal(await stage.getByRole('checkbox', { name: /AI pack \(13\)/ }).isChecked(), true);
  assert.equal(await stage.getByRole('checkbox', { name: /Rhymes/ }).isChecked(), false);
  await start();
  await stage.locator('.hm-pass').waitFor();
  await teacher.keyboard.press('Enter');
  await stage.locator('.hm-card').waitFor();
  const body = await stage.locator('.hm-card-body').innerText();
  assert.ok(whole.cards.map((c) => c.body).includes(body), `a pack card: ${body}`);
  ok('Hot mic: plenty of pack cards play on their own');

  await open('rhyme');
  assert.match(await stage.locator('.setup-card').innerText(), /A2: Base and past/);
  await stage.locator('.setup-card').getByRole('button', { name: /English and Catalan/ }).click();
  await start();
  await stage.locator('.rm-card').first().waitFor();
  assert.equal(await stage.locator('.rm-card').count(), 12);
  const fronts = await stage.locator('.rm-front').allInnerTexts();
  const pairing = whole.pairs[1].pairs.find((p) => fronts.includes(p.a) && fronts.includes(p.b));
  await stage.locator('.rm-card', { hasText: pairing.a }).first().click();
  await stage.locator('.rm-card', { hasText: pairing.b }).first().click();
  await teacher.waitForFunction(() => document.querySelectorAll('.rm-card.done').length === 2);
  ok('Memory: a pack set, matching by pair');

  await open('echo');
  assert.match(await stage.locator('.setup-card').innerText(), /AI order \(5 steps\)/);
  await start();
  await stage.locator('.echo-count').waitFor();
  await teacher.waitForFunction(() => /Step 1 of 5: The hook/.test(document.querySelector('.echo-count')?.textContent || ''));
  assert.match(await stage.locator('.k-lines').innerText(), /Yesterday/);
  ok('Echo: teaches the hook first');

  await open('speak');
  if (await stage.locator('.setup-card').getByText('AI pack').count()) {
    await start();
    await stage.locator('.say-tips').waitFor();
    assert.match(await stage.locator('.gf-progress').innerText(), /of 5/);
    assert.match(await stage.locator('.say-tips').innerText(), /s \+ consonant: Start with the s/);
    assert.equal(await stage.locator('.say-word.target').count(), 2);
    ok('Say it!: the pack\'s lines, with the words marked and a tip');
  } else console.log('AI song pack: Say it! skipped, no speech recognition in this browser');

  await open('finish');
  assert.match(await stage.locator('.setup-card').innerText(), /AI pack \(6\)/);
  await start();
  await stage.getByText('You woke up late. What did you do next?').waitFor({ timeout: 25000 });
  const hidden = await stage.locator('.lv-cur .gap-box').count();
  assert.ok(hidden >= 6, `the line is hidden from the stop on (${hidden} boxes)`);
  ok('Finish the line: stops before the word and asks the AI\'s question');

  await go(`#/song/${id}`);
  await teacher.locator('.lesson-warnings').waitFor();
  await go(`#/play/${id}/karaoke`);
  await stage.locator('.k-start').waitFor();
  await stage.getByRole('button', { name: /Sing!/ }).click();
  await stage.locator('.k-popup').first().waitFor({ timeout: 25000 });
  assert.match(await stage.locator('.k-popups').innerText(), /wake → woke/);
  assert.ok((await stage.locator('.w.noted').count()) >= 2);
  assert.match(await stage.locator('.k-tr').innerText(), /Ahir em vaig despertar tard/);
  await stage.getByRole('button', { name: 'Game settings' }).click();
  await teacher.getByRole('checkbox', { name: /Language pop-ups/ }).uncheck();
  await teacher.keyboard.press('Escape');
  await teacher.waitForFunction(() => !document.querySelector('.k-popup'));
  await teacher.evaluate(async () => (await import('/js/store.js')).setSettings({ popups: true }));
  ok('Karaoke: pop-ups, highlighted words and translations, and they switch off');

  await go(`#/song/${id}`);
  await teacher.locator('.lesson-warnings').waitFor();
  await go(`#/play/${id}/freeze`);
  await stage.locator('.setup-card').waitFor();
  await start();
  await stage.getByText('Stretch and yawn!').waitFor({ timeout: 25000 });
  ok('Freeze dance: the gesture appears as the word is sung');

  // ----------------------------------------------- worksheet and chant
  await go(`#/song/${id}`);
  await teacher.locator('.lesson-warnings').waitFor();
  await go(`#/print/${id}/lesson`);
  await teacher.locator('.sheet-words').waitFor();
  assert.equal(await teacher.locator('.sheet-words tr').count(), 10);
  assert.ok((await teacher.locator('.sheet-gap').count()) >= 9);
  const sheet = await teacher.locator('.sheet').innerText();
  assert.match(sheet, /Why did the singer run to school/, 'the gap set\'s level');
  assert.doesNotMatch(sheet, /Which question is correct/, 'not the other levels');
  assert.match(sheet, /Talk about it/);
  ok('Worksheet: one level on a sheet: words, gaps, questions, talking points');

  await go(`#/song/${id}`);
  await teacher.locator('.activity', { hasText: 'AI chant' }).click();
  await teacher.getByRole('button', { name: 'Make my song' }).waitFor();
  assert.equal(await teacher.getByPlaceholder('Song title').inputValue(), 'Tell Me, Tell Me');
  assert.match(await teacher.locator('.maker-text').inputValue(), /Did you sleep\? Yes, I slept!/);
  await teacher.locator('.maker-status.ok, .maker-status.warn').waitFor();
  ok('Song maker: opens with the original chant and composes it');

  // ------------------------------------- the clean version, on real audio
  const recording = await findSong('Cloud browser song');
  assert.ok(recording, 'the smoke test uploaded a recording with a karaoke version');
  await go(`#/lesson/${recording}`);
  await teacher.getByRole('heading', { name: 'Clean version' }).waitFor();
  await teacher.getByLabel('Add a word to clean').fill('zebra');
  await teacher.getByRole('button', { name: 'Add a word' }).click();
  await teacher.getByText('“zebra” is not in the lyrics.').waitFor();
  await teacher.getByLabel('Add a word to clean').fill('world');
  await teacher.getByRole('button', { name: 'Add a word' }).click();
  await teacher.getByRole('checkbox', { name: 'Play the clean version' }).waitFor();
  await teacher.getByRole('button', { name: 'Save with the song' }).click();
  await teacher.waitForURL(/#\/song\//);
  const heard = await teacher.evaluate(async (songId) => {
    const { getSong } = await import('/js/store.js');
    const { makeTrack } = await import('/js/track.js');
    const track = await makeTrack(getSong(songId));
    try {
      const [from, to] = track.cleanSpans[0];
      const samples = [];
      track.seek(0);
      await track.play();
      const began = performance.now();
      while (track.time() < to + 0.4 && performance.now() - began < 5000) {
        samples.push({ t: track.time(), song: track.main.gain.gain.value, karaoke: track.karNode.gain.gain.value });
        await new Promise((resolve) => { setTimeout(resolve, 12); });
      }
      track.pause();
      return { from, to, samples, text: track.timeline.lines[0].text };
    } finally { track.destroy(); }
  }, recording);
  assert.equal(heard.text, 'Hello w****');
  const during = heard.samples.filter((s) => s.t > heard.from + 0.03 && s.t < heard.to - 0.02);
  const before = heard.samples.filter((s) => s.t > 0.1 && s.t < heard.from - 0.2); // gains settle once the audio clock starts
  const after = heard.samples.filter((s) => s.t > heard.to + 0.15);
  assert.ok(during.length >= 5 && before.length >= 5 && after.length >= 3, `samples: ${during.length} ${before.length} ${after.length}`);
  assert.ok(before.every((s) => s.song > 0.95 && s.karaoke < 0.05), 'the song plays before the word');
  assert.ok(during.every((s) => s.song < 0.1 && s.karaoke > 0.9), `the singer is gone on the word: ${JSON.stringify(during.slice(0, 4))}`);
  assert.ok(after.every((s) => s.song > 0.9 && s.karaoke < 0.1), 'and comes back after it');
  await go(`#/play/${recording}/karaoke`);
  await stage.locator('.k-start').waitFor();
  await go(`#/lesson/${recording}`);
  await teacher.getByRole('button', { name: 'Copy the prompt' }).click();
  assert.match(await clipboard(), /L1 Hello world/, 'the AI still reads the real lyrics');
  ok('Clean version: masked on screen, and on real audio the karaoke track takes over for exactly that word');

  // ---------------------------------------- an assignment on a gap set
  await go('#/assignments');
  await teacher.getByRole('button', { name: 'Create assignment' }).click();
  await teacher.getByLabel('Assignment song').selectOption(id);
  await teacher.getByLabel('Assignment title').fill('Irregular verbs homework');
  await teacher.getByLabel('Gap set').selectOption('pack:story-verbs');
  await teacher.getByRole('checkbox', { name: 'Choose the word', exact: true }).check();
  await teacher.getByRole('checkbox', { name: 'Class A', exact: true }).check();
  await teacher.getByRole('checkbox', { name: /permission/ }).check().catch(() => {});
  await teacher.locator('.modal').getByRole('button', { name: 'Create assignment' }).click();
  await teacher.waitForURL(/#\/assignment\//);
  const link = await teacher.locator('input[readonly]').inputValue();
  ok('Assignment created on a gap set');

  const studentContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const student = await studentContext.newPage();
  watch(student, 'student');
  await stubGoogle(student, 'student');
  await student.goto(link);
  await student.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await student.getByRole('button', { name: 'Start activity' }).click();
  await student.locator('.stage .setup-card').getByRole('button', { name: /Start/ }).click();
  await student.waitForFunction(() => document.querySelectorAll('.bank-word').length >= 3, null, { timeout: 15000 });
  const studentOptions = await student.locator('.bank-word').allInnerTexts();
  assert.ok(studentOptions.some((o) => /waked/i.test(o)), `the student plays the set: ${studentOptions}`);
  const seen = await student.evaluate(async () => {
    const { api } = await import('/js/cloud/session.js');
    return api(`/api/attempts/${new URLSearchParams(location.hash.split('?')[1]).get('attempt')}`);
  });
  assert.equal(seen.song.lesson.teacher, undefined);
  assert.equal(JSON.stringify(seen).includes('Eating alone'), false);
  assert.equal(JSON.stringify(seen).includes('Catalan speakers often'), false);
  ok('Student plays the assigned set, and never receives teacher notes');

  // ---------------------------------------------------- the public player
  const publicContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const visitor = await publicContext.newPage();
  watch(visitor, 'public');
  await stubGoogle(visitor, 'outsider');
  await visitor.goto(`${base}#/song/${id}`);
  await visitor.locator('.word-card').first().waitFor();
  assert.equal(await visitor.locator('.lesson-warnings').count(), 0);
  assert.equal(await visitor.locator('.act-pack').count(), 0);
  assert.equal(await visitor.getByRole('link', { name: /AI song pack/ }).count(), 0);
  assert.equal((await visitor.locator('#app').innerText()).includes('Eating alone'), false);
  const leak = await visitor.evaluate(async (songId) => JSON.stringify((await import('/js/store.js')).getSong(songId).lesson.teacher ?? null), id);
  assert.equal(leak, 'null');
  await visitor.goto(`${base}#/lesson/${id}`);
  await visitor.waitForURL(/create\//);
  ok('Public page: pack games and word cards, no notes, no pack page');

  // --------------------------------------------- many files at once, an agent
  await go(`#/lesson/${id}`);
  await teacher.getByRole('heading', { name: 'The saved pack' }).waitFor();
  const asFile = (name, text) => ({ name, mimeType: name.endsWith('.txt') ? 'text/plain' : 'application/json', buffer: Buffer.from(text) });
  const opener = teacher.locator('input[type=file][multiple]');
  // Out of order, a broken one in the middle, a .txt, and part10 after part2.
  await opener.setInputFiles([
    asFile('pack-part5.json', BATCHES[4]), asFile('pack-part1.txt', BATCHES[0]), asFile('pack-part3.json', BATCHES[2]),
    asFile('pack-part2.json', BATCHES[1]), asFile('pack-part4.json', BATCHES[3]), asFile('pack-part10.json', BATCHES[0].slice(0, 200)),
  ]);
  await teacher.getByRole('button', { name: 'Replace the pack' }).click();
  await teacher.getByText('pack-part10.json: The reply stops before the JSON ends', { exact: false }).waitFor();
  const shown = await teacher.locator('.lesson-ok').allInnerTexts();
  assert.deepEqual(shown.filter((text) => /added/.test(text)).map((text) => /pack-part\d+/.exec(text)[0]), ['pack-part1', 'pack-part2', 'pack-part3', 'pack-part4', 'pack-part5'], 'in order, and every report stays');
  assert.equal(await teacher.getByRole('button', { name: /fix pack-part10\.json/ }).count(), 1);
  await teacher.locator('summary', { hasText: 'Hot mic cards (14)' }).waitFor();
  await teacher.locator('summary', { hasText: 'Quiz (10)' }).waitFor();
  ok('Open files: many .json and .txt files at once, in order, and a bad file is reported by name');

  await teacher.getByLabel('ai', { exact: true }).selectOption('agent');
  await teacher.getByText('does the whole job in one run').waitFor();
  assert.equal(await teacher.getByLabel('Create in batches of').isVisible(), false);
  await teacher.getByRole('button', { name: 'Copy the prompt' }).click();
  assert.match(await clipboard(), /autonomous agent/);
  await teacher.getByRole('button', { name: 'Remove: ', exact: false }).first().waitFor();
  await teacher.evaluate(async (songId) => (await import('/js/store.js')).setLessonDraft(songId, null), id);
  await teacher.reload();
  await teacher.getByRole('heading', { name: 'The saved pack' }).waitFor();
  await opener.setInputFiles([asFile('the-song-pack.json', fixture)]);
  await teacher.getByRole('button', { name: 'Replace the pack' }).click();
  await teacher.getByText('the-song-pack.json: The pack added.').waitFor();
  assert.equal(await teacher.getByRole('button', { name: /Copy the message for batch/ }).count(), 0, 'an agent has no next batch');
  await teacher.locator('summary', { hasText: 'Hot mic cards (14)' }).waitFor();
  await teacher.getByLabel('ai', { exact: true }).selectOption('chatbot');
  await teacher.evaluate(async (songId) => (await import('/js/store.js')).setLessonDraft(songId, null), id);
  await teacher.reload();
  await teacher.getByRole('heading', { name: 'The saved pack' }).waitFor();
  ok('Agent: a prompt for one run, and one file with the whole pack');

  // --------------------------------------------- a new run, then removal
  await go(`#/lesson/${id}`);
  await teacher.getByRole('heading', { name: 'The saved pack' }).waitFor();
  await reply.fill(part(1, 'song', 'profile', 'teacher'));
  await teacher.getByRole('button', { name: 'Replace the pack' }).click();
  await teacher.getByText('Batch 1 added.').waitFor();
  assert.equal(await teacher.locator('summary', { hasText: 'Quiz' }).count(), 0, 'the old pack is gone from the draft');
  await teacher.evaluate(async (songId) => (await import('/js/store.js')).setLessonDraft(songId, null), id);
  await teacher.reload();
  await teacher.getByRole('heading', { name: 'The saved pack' }).waitFor();
  await teacher.getByRole('button', { name: 'Remove the pack' }).click();
  await teacher.locator('.modal').getByRole('button', { name: 'Remove' }).click();
  await teacher.waitForURL(/#\/song\//);
  await teacher.getByRole('link', { name: /AI song pack/ }).waitFor();
  assert.equal(await teacher.locator('.lesson-warnings').count(), 0);
  assert.equal(await teacher.locator('.lp-tr').first().innerText(), 'Ahir em vaig despertar tard,', 'translations stay with the song');
  ok('A new run asks before replacing, and removing the pack keeps what it added to the song');

  assert.deepEqual(errors, [], 'no page errors');
  ok('no page errors in any session');
  await context.close();
  await studentContext.close();
  await publicContext.close();
};
