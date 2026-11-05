import test from 'node:test';
import assert from 'node:assert/strict';
import { findFalseFriends, formsIndex, friendsList } from '../js/lesson/false-friends.js';
import { buildPrompt, lyricFalseFriends } from '../js/lesson/prompt.js';
import { POPUP_KINDS, readPack } from '../js/lesson/pack.js';
import { timelineFromSynced } from '../js/music/timeline.js';

const timeline = (...lines) => timelineFromSynced(lines.map((text, i) => ({ text, start: i * 4, end: i * 4 + 3 })), lines.length * 4);
const song = { title: 'Test song' };
const words = (...list) => [{ number: 1, words: list }];
const looks = (found) => found.map((f) => f.looksLike);

test('every row of the list is complete, and no form belongs to two rows', () => {
  const list = friendsList('Catalan');
  assert.ok(list.length >= 200, `${list.length} rows`);
  for (const row of list) {
    assert.equal(row.length, 4, row[0]);
    assert.ok(row.every((cell) => typeof cell === 'string' && cell.trim()), row[0]);
    assert.notEqual(row[1].toLowerCase(), row[2].toLowerCase(), `${row[0]}: a look-alike with the same meaning is no false friend`);
  }
  const heads = list.flatMap((row) => row[0].split('|'));
  assert.equal(new Set(heads).size, heads.length, 'a word is listed twice');
  const index = formsIndex(list);
  for (const row of list) for (const word of row[0].split('|')) assert.equal(index.get(word), row, `${word} answers to another row`);
});

test('the list is for the class language: Catalan and Valencian, nothing else yet', () => {
  for (const language of ['Catalan', 'català', 'Valencian', 'valencià']) assert.deepEqual(looks(findFalseFriends(words('library'), language)), ['llibreria'], language);
  for (const language of ['Spanish', 'French', '', undefined]) assert.deepEqual(findFalseFriends(words('library'), language), [], String(language));
});

test('a word is found in the forms and spellings lyrics use', () => {
  const finds = (word, catalan) => assert.deepEqual(looks(findFalseFriends(words(word), 'Catalan')), [catalan], word);
  for (const word of ['notice', 'Notice!', 'notices', 'noticed', 'noticing', 'noticin’', "noticin'", '“Noticed,”']) finds(word, 'notícia');
  finds('tapped', 'tap');
  finds('taped', 'tapa');
  finds('apologies', 'apologia');
  finds('apologised', 'apologia');
  finds('realise', 'realitzar');
  finds('realized', 'realitzar');
  finds('largest', 'llarg');
  finds("parent's", 'parents');
  finds("parents'", 'parents');
});

test('only whole words count', () => {
  for (const word of ['noticeable', 'actuality', 'reason', 'season', 'special', 'perfect', 'Sonny']) assert.deepEqual(findFalseFriends(words(word), 'Catalan'), [], word);
});

test('a repeated line counts once, and a word sung on two different lines names both', () => {
  const t = timeline('Did you notice me', 'I am here', 'Did you notice me', 'I noticed you notice', 'Actually no');
  const found = lyricFalseFriends(t, 'Catalan');
  assert.deepEqual(looks(found), ['notícia', 'actualment'], 'in the order they are sung');
  assert.deepEqual(found[0].spots, [{ line: 1, word: 'notice' }, { line: 4, word: 'noticed' }]);
  assert.deepEqual(found[1].spots, [{ line: 5, word: 'Actually' }]);
  assert.equal(found[1].looksLikeMeans, 'currently, nowadays');
  assert.equal(found[1].means, 'de fet, en realitat');
});

test('the prompt names the false friends it found and tells the AI to judge them', () => {
  const t = timeline('Did you notice the rain', 'Actually, it is fine');
  const prompt = buildPrompt(song, t, { language: 'Catalan' });
  assert.match(prompt, /# False friends in these lyrics/);
  assert.match(prompt, /L1 "notice": looks like Catalan "notícia" \(a piece of news\), but means: adonar-se, avís\./);
  assert.match(prompt, /L2 "Actually": looks like Catalan "actualment"/);
  assert.match(prompt, /do not add any/);
  assert.match(prompt, /kind "false-friend"/);
  assert.match(prompt, /"notice = adonar-se, not notícia"/, 'the example is from this song');
  assert.ok(prompt.indexOf('# False friends in these lyrics') > prompt.indexOf('# The lyrics'));
  assert.ok(prompt.indexOf('# False friends in these lyrics') < prompt.indexOf('# Think first'));
  assert.match(buildPrompt(song, t, { language: 'Catalan', ai: 'agent' }), /# False friends in these lyrics/);
  assert.match(buildPrompt(song, t, { language: 'Catalan', level: 'B1' }), /L1 "notice"/);
});

test('with no match, or no list for the language, the prompt has no false friends section', () => {
  const none = 'The sun is up';
  assert.doesNotMatch(buildPrompt(song, timeline(none), { language: 'Catalan' }), /# False friends in these lyrics/);
  const t = timeline('Did you notice the rain');
  assert.doesNotMatch(buildPrompt(song, t, { language: 'Spanish' }), /# False friends in these lyrics/);
  assert.doesNotMatch(buildPrompt(song, t, {}), /# False friends in these lyrics/);
});

test('a false friend pop-up from the AI keeps its own kind', () => {
  const t = timeline('Did you notice the rain');
  assert.ok(POPUP_KINDS['false-friend']);
  assert.match(buildPrompt(song, t, { language: 'Catalan' }), /kind is one of .*false-friend/);
  const reply = JSON.stringify({ format: 'singing-lesson-pack', version: 1, popups: [{ line: 1, words: 'notice', kind: 'false-friend', text: 'notice = adonar-se, not notícia' }] });
  assert.equal(readPack(reply, t).pack.popups[0].kind, 'false-friend');
});
