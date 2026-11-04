// The AI lesson pack from end to end, called by browser-smoke.cjs against the
// isolated local cloud fixture: the prompt, messy AI replies, review, every game
// that reads a pack, a homework gap set, and what students and the public receive.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { stubGoogle } = require('./browser-access.cjs');

const fixture = readFileSync(path.join(__dirname, '../tests/fixtures/lesson-what-did-you-do.json'), 'utf8');

module.exports = async (browser, base) => {
  const createBase = `${base}create/`;
  const errors = [];
  const ok = (name) => console.log(`AI lesson pack: ${name}`);
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
  let id = null;
  for (let i = 0; i < 60 && !id; i += 1) {
    id = await teacher.evaluate(async () => {
      const { allSongs } = await import('/js/store.js');
      return allSongs().find((s) => s.title.startsWith('What Did You Do'))?.id || null;
    });
    if (!id) await teacher.waitForTimeout(500);
  }
  assert.ok(id, 'the starter songs arrived');
  const go = (hash) => teacher.evaluate((h) => { location.hash = h; }, hash);

  // ------------------------------------------------------------ the prompt
  await go(`#/song/${id}`);
  await teacher.getByRole('link', { name: /AI lesson pack/ }).click();
  await teacher.getByRole('heading', { name: /AI lesson pack/ }).waitFor();
  await teacher.getByLabel('level').selectOption('A2');
  await teacher.locator('.studio-field', { hasText: 'first language' }).locator('input').fill('Spanish');
  await teacher.locator('.studio-field', { hasText: 'want to work on' }).locator('textarea').fill('irregular past verbs');
  await teacher.waitForTimeout(350);
  await teacher.getByRole('button', { name: 'Copy the prompt' }).click();
  const prompt = await teacher.evaluate(() => navigator.clipboard.readText());
  assert.match(prompt, /Level: A2 \(CEFR\)/);
  assert.match(prompt, /typical Spanish-speaker mistakes/);
  assert.match(prompt, /irregular past verbs/);
  assert.match(prompt, /L1 Yesterday I woke up late,/);
  assert.match(prompt, /# The melody/);
  assert.match(prompt, /"format": "singing-lesson-pack"/);
  ok(`prompt built and copied (${prompt.length} characters)`);

  // The class is remembered, the focus is not.
  const saved = await teacher.evaluate(async () => (await import('/js/store.js')).getSettings().lessonClass);
  assert.equal(saved.language, 'Spanish');
  assert.equal(saved.focus, undefined);
  ok('class remembered for the next song');

  const reply = teacher.getByLabel('The AI reply');
  assert.equal(await teacher.getByRole('button', { name: 'Download this pack' }).isVisible(), false);

  // ---------------------------------------------------- replies that fail
  await reply.fill('Sorry, I cannot do that.');
  await teacher.getByText('There is no JSON in this reply').waitFor();
  await reply.fill(fixture.slice(0, 3000));
  await teacher.getByText('it was cut off').waitFor();
  await teacher.getByRole('button', { name: /asks the AI to fix this/ }).click();
  assert.match(await teacher.evaluate(() => navigator.clipboard.readText()), /cut off before the end/);
  ok('no JSON and a cut-off reply explain themselves; a fix-up message is copied');

  // ------------------------------------------- a messy reply, as AIs write
  const messy = JSON.parse(fixture);
  messy.popups[0].line = 2;                    // off by one: corrected
  messy.popups[1].line = 7;                    // "ran" is in L2 and L7: a real line, so it is simply true
  messy.popups[2].words = 'half past nine';    // invented
  messy.swaps[1].words = 'lost my pen';        // more than one word
  delete messy.quiz[0].wrong;                  // incomplete
  messy.chatter = 'an unknown section';
  await reply.fill(`Here is your lesson pack!\n\n\`\`\`json\n${JSON.stringify(messy, null, 1)}\n\`\`\`\n\nLet me know if you want changes.`);
  await teacher.locator('.lesson-ok').waitFor();
  const report = await teacher.locator('.lesson-problems').innerText();
  assert.match(report, /"half past nine" is not in L2/);
  assert.match(report, /use one word, not "lost my pen"/);
  assert.match(report, /quiz 1: it needs wrong answers/);
  assert.match(report, /chatter/);
  assert.match(await teacher.locator('.lesson-ok').innerText(), /1 line number was wrong and corrected/);
  await teacher.getByRole('button', { name: /asks the AI to fix this/ }).click();
  const fix = await teacher.evaluate(() => navigator.clipboard.readText());
  assert.match(fix, /half past nine/);
  assert.match(fix, /send the complete JSON object again/);
  ok('messy reply imported: fence and prose removed, bad items listed, a wrong line number corrected');

  // ----------------------------------------------------- the clean import
  await reply.fill(fixture);
  await teacher.locator('.lesson-ok').waitFor();
  await teacher.locator('.lesson-problems').waitFor({ state: 'detached' });
  await teacher.getByRole('heading', { name: 'Step 4: review and save' }).waitFor();
  assert.equal(await teacher.getByRole('button', { name: 'Download this pack' }).isVisible(), true);
  await teacher.locator('summary', { hasText: 'Hot mic cards (14)' }).click();
  await teacher.getByRole('button', { name: /^Remove: 🎶 Question and answer/ }).click();
  await teacher.locator('summary', { hasText: 'Hot mic cards (13)' }).waitFor();
  assert.equal(await teacher.getByRole('button', { name: /^Remove: 📞/ }).isVisible(), true, 'the section stays open after a removal');
  ok('review list: an item can be removed before saving');

  await teacher.getByRole('button', { name: 'Save with the song' }).click();
  await teacher.waitForURL(/#\/song\//);
  await teacher.locator('.lesson-plan').waitFor();

  // ------------------------------------------------------------ song page
  const plan = await teacher.locator('.lesson-plan').innerText();
  assert.match(plan, /Fill the gaps/);
  assert.match(plan, /Eating alone can be a sensitive topic/);
  assert.equal(await teacher.locator('.lesson-step').count(), 7);
  assert.equal(await teacher.locator('.word-card').count(), 10);
  assert.equal(await teacher.locator('.lp-tr').first().innerText(), 'Ayer me desperté tarde,');
  assert.equal(await teacher.locator('.lp-plain').first().isVisible(), false);
  await teacher.getByRole('button', { name: 'In simple English' }).click();
  assert.equal(await teacher.locator('.lp-plain').first().isVisible(), true);
  assert.equal(await teacher.evaluate(async (songId) => (await import('/js/store.js')).getSong(songId).lesson.cards.length, id), 13);
  ok('song page: plan, warning, translations, word cards and simple English');

  // A saved pack survives a reload from the server.
  await teacher.reload();
  await teacher.locator('.lesson-plan').waitFor();
  ok('pack persists across a reload');

  // ---------------------------------------------------------- the games
  const stage = teacher.locator('.stage');
  const open = async (game, query = '') => { await go(`#/song/${id}`); await teacher.locator('.lesson-plan').waitFor(); await go(`#/play/${id}/${game}${query}`); await stage.locator('.setup-card, .k-start').first().waitFor(); };
  const start = () => stage.locator('.setup-card').getByRole('button', { name: /Start|Play the song/ }).click();

  // A plan step opens its game on its set.
  await go(`#/song/${id}`);
  await teacher.locator('.lesson-step', { hasText: 'Grammar hunt' }).click();
  await stage.locator('.setup-card').waitFor();
  assert.equal(await stage.locator('select.setup-select').inputValue(), 'pack:irregular-past');
  ok('plan step opens the game on the right set');

  await open('hunt', '?focus=pack%3Aafter-did');
  assert.equal(await stage.locator('select.setup-select').inputValue(), 'pack:after-did');
  await start();
  await stage.locator('.hunt-board').waitFor();
  assert.match(await stage.locator('.hunt-count').innerText(), /After did: the base form: 0 \/ 5/, 'only the words in context, not every "do" or "go"');
  await stage.locator('.hunt-line').filter({ hasText: 'Did you go?' }).getByRole('button', { name: 'go?' }).click();
  await stage.getByText('Did you go? Not: Did you went?').waitFor();
  ok('Grammar hunt: judged in context, explains each find');

  await open('gapfill');
  assert.equal(await stage.getByLabel('Word focus').inputValue(), 'pack:chorus-verbs');
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
  assert.match(await stage.locator('.setup-card').innerText(), /Lesson pack \(8 lines\)/);
  await start();
  await teacher.waitForFunction(() => [...document.querySelectorAll('.ww-word')].some((b) => /^let$/i.test(b.textContent.replace(/\W/g, ''))), null, { timeout: 15000 });
  ok('Wrong word: the AI\'s swap is on screen');

  await open('quiz', '?when=before');
  assert.match(await stage.locator('.setup-card').innerText(), /Lesson pack \(2\)/);
  await start();
  await stage.locator('.quiz-opt').first().waitFor();
  assert.match(await stage.locator('.quiz-text').innerText(), /What is it about/);
  await stage.locator('.quiz-opt', { hasText: 'The things someone did' }).click();
  await stage.locator('.quiz-explain').waitFor();
  ok('Song quiz: before-listening questions, with an explanation');

  await open('quiz');
  await start();
  await stage.locator('.quiz-opt').first().waitFor();
  await stage.locator('.quiz-opt').first().click();
  await stage.locator('.quiz-next button').click();
  await stage.locator('.quiz-opt').first().click();
  await stage.locator('.quiz-next button').click();
  await stage.getByRole('button', { name: 'Listen' }).waitFor();
  ok('Song quiz: after-listening questions can replay their line');

  await open('hotmic');
  assert.equal(await stage.getByRole('checkbox', { name: /Lesson pack \(13\)/ }).isChecked(), true);
  assert.equal(await stage.getByRole('checkbox', { name: /Rhymes/ }).isChecked(), false);
  await start();
  await stage.locator('.hm-pass').waitFor();
  await teacher.keyboard.press('Enter');
  await stage.locator('.hm-card').waitFor();
  const body = await stage.locator('.hm-card-body').innerText();
  const cards = JSON.parse(fixture).cards.map((c) => c.body);
  assert.ok(cards.includes(body), `a pack card: ${body}`);
  ok('Hot mic: only the pack\'s cards by default');

  await open('rhyme');
  assert.match(await stage.locator('.setup-card').innerText(), /Base and past/);
  await stage.locator('.setup-card').getByRole('button', { name: /English and Spanish/ }).click();
  await start();
  await stage.locator('.rm-card').first().waitFor();
  assert.equal(await stage.locator('.rm-card').count(), 12);
  const fronts = await stage.locator('.rm-front').allInnerTexts();
  const english = JSON.parse(fixture).pairs[1].pairs;
  const pair = english.find((p) => fronts.includes(p.a) && fronts.includes(p.b));
  await stage.locator('.rm-card', { hasText: pair.a }).first().click();
  await stage.locator('.rm-card', { hasText: pair.b }).first().click();
  await teacher.waitForFunction(() => document.querySelectorAll('.rm-card.done').length === 2);
  ok('Memory: a pack set, matching by pair');

  await open('echo');
  assert.match(await stage.locator('.setup-card').innerText(), /Lesson pack order \(5 steps\)/);
  await start();
  await stage.locator('.echo-count').waitFor();
  await teacher.waitForFunction(() => /Step 1 of 5: The hook/.test(document.querySelector('.echo-count')?.textContent || ''));
  assert.match(await stage.locator('.k-lines').innerText(), /Yesterday/);
  ok('Echo: teaches the hook first');

  await open('speak');
  if (await stage.locator('.setup-card').getByText('Lesson pack').count()) {
    await start();
    await stage.locator('.say-tips').waitFor();
    assert.match(await stage.locator('.gf-progress').innerText(), /of 5/);
    assert.match(await stage.locator('.say-tips').innerText(), /s \+ consonant: Start with the s/);
    assert.equal(await stage.locator('.say-word.target').count(), 2);
    ok('Say it!: the pack\'s lines, with the words marked and a tip');
  } else console.log('  --  Say it! skipped: no speech recognition in this browser');

  await open('finish');
  assert.match(await stage.locator('.setup-card').innerText(), /Lesson pack \(6\)/);
  await start();
  await stage.getByText('You woke up late. What did you do next?').waitFor({ timeout: 25000 });
  const hidden = await stage.locator('.lv-cur .gap-box').count();
  assert.ok(hidden >= 6, `the line is hidden from the stop on (${hidden} boxes)`);
  ok('Finish the line: stops before the word and asks the AI\'s question');

  await go(`#/song/${id}`);
  await teacher.locator('.lesson-plan').waitFor();
  await go(`#/play/${id}/karaoke`);
  await stage.locator('.k-start').waitFor();
  await stage.getByRole('button', { name: /Sing!/ }).click();
  await stage.locator('.k-popup').first().waitFor({ timeout: 25000 });
  assert.match(await stage.locator('.k-popups').innerText(), /wake → woke/);
  assert.ok((await stage.locator('.w.noted').count()) >= 2);
  assert.match(await stage.locator('.k-tr').innerText(), /Ayer me desperté tarde/);
  await stage.getByRole('button', { name: 'Game settings' }).click();
  await teacher.getByRole('checkbox', { name: /Language pop-ups/ }).uncheck();
  await teacher.keyboard.press('Escape');
  await teacher.waitForFunction(() => !document.querySelector('.k-popup'));
  ok('Karaoke: pop-ups, highlighted words and translations, and they switch off');

  await go(`#/song/${id}`);
  await teacher.locator('.lesson-plan').waitFor();
  await go(`#/play/${id}/freeze`);
  await stage.locator('.setup-card').waitFor();
  await start();
  await stage.getByText('Stretch and yawn!').waitFor({ timeout: 25000 });
  ok('Freeze dance: the gesture appears as the word is sung');

  // ----------------------------------------------- worksheet and chant
  await go(`#/song/${id}`);
  await teacher.locator('.lesson-plan').waitFor();
  await go(`#/print/${id}/lesson`);
  await teacher.locator('.sheet-words').waitFor();
  assert.equal(await teacher.locator('.sheet-words tr').count(), 10);
  assert.ok((await teacher.locator('.sheet-gap').count()) >= 9);
  const sheet = await teacher.locator('.sheet').innerText();
  assert.match(sheet, /Why did the singer run to school/);
  assert.match(sheet, /Talk about it/);
  ok('Worksheet: words, gaps, questions, talking points');

  await go(`#/chant?lesson=${id}`);
  await teacher.getByRole('button', { name: 'Make my song' }).waitFor();
  assert.equal(await teacher.getByPlaceholder('Song title').inputValue(), 'Tell Me, Tell Me');
  assert.match(await teacher.locator('.maker-text').inputValue(), /Did you sleep\? Yes, I slept!/);
  await teacher.locator('.maker-status.ok, .maker-status.warn').waitFor();
  ok('Song maker: opens with the original chant and composes it');

  // ---------------------------------------- an assignment on a gap set
  await go('#/assignments');
  await teacher.getByRole('button', { name: 'Create assignment' }).click();
  await teacher.getByLabel('Assignment song').selectOption(id);
  await teacher.getByLabel('Assignment title').fill('Irregular verbs homework');
  await teacher.getByLabel('Gap set').selectOption('pack:story-verbs');
  await teacher.getByRole('checkbox', { name: 'Choose the word', exact: true }).check();
  await teacher.getByRole('checkbox', { name: 'Class A', exact: true }).check();
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
  const seen = await student.evaluate(async (hash) => {
    const { api } = await import('/js/cloud/session.js');
    return api(`/api/attempts/${new URLSearchParams(location.hash.split('?')[1]).get('attempt')}`);
  }, null);
  assert.equal(seen.song.lesson.teacher, undefined);
  assert.equal(JSON.stringify(seen).includes('Eating alone'), false);
  assert.equal(JSON.stringify(seen).includes('Spanish speakers often'), false);
  ok('Student plays the assigned set, and never receives teacher notes');

  // ---------------------------------------------------- the public player
  const publicContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const visitor = await publicContext.newPage();
  watch(visitor, 'public');
  await visitor.goto(`${base}#/song/${id}`);
  await visitor.locator('.word-card').first().waitFor();
  assert.equal(await visitor.locator('.lesson-plan').count(), 0);
  assert.equal(await visitor.getByRole('link', { name: /AI lesson pack/ }).count(), 0);
  const body2 = await visitor.locator('#app').innerText();
  assert.equal(body2.includes('Eating alone'), false);
  const leak = await visitor.evaluate(async (songId) => JSON.stringify((await import('/js/store.js')).getSong(songId).lesson.teacher ?? null), id);
  assert.equal(leak, 'null');
  await visitor.goto(`${base}#/lesson/${id}`);
  await visitor.waitForURL(/create\//);
  ok('Public page: pack games and word cards, no plan, no notes, no lesson page');

  // ------------------------------------------------------- removing it
  await go(`#/lesson/${id}`);
  await teacher.getByRole('heading', { name: 'The saved pack' }).waitFor();
  await teacher.getByRole('button', { name: 'Remove the pack' }).click();
  await teacher.locator('.modal').getByRole('button', { name: 'Remove' }).click();
  await teacher.waitForURL(/#\/song\//);
  await teacher.getByRole('link', { name: /AI lesson pack/ }).waitFor();
  assert.equal(await teacher.locator('.lesson-plan').count(), 0);
  assert.equal(await teacher.locator('.lp-tr').first().innerText(), 'Ayer me desperté tarde,', 'translations stay with the song');
  ok('Removing the pack keeps what it added to the song');

  assert.deepEqual(errors, [], 'no page errors');
  ok('no page errors in any session');
  await context.close();
  await studentContext.close();
  await publicContext.close();
};
