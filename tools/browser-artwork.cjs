// Song pictures from end to end, called by browser-smoke.cjs against the isolated
// local cloud fixture. The picture services are stubbed: no request leaves this
// computer, and the stubs count the visits, because a reload must make none.
const assert = require('node:assert/strict');
const { stubGoogle } = require('./browser-access.cjs');

const shots = process.env.ARTWORK_SCREENSHOTS;
const groupId = (n) => `${String(n).repeat(8)}-0000-4000-8000-000000000000`;
const FOUND = groupId(1);
const CHOICE = groupId(2);
const MISSING = groupId(3);
const run = Date.now().toString(36); // the fixture keeps songs between runs
const FOUND_TITLE = `Picture found ${run}`;
const LOST_TITLE = `Picture lost ${run}`;

module.exports = async (browser, base) => {
  const createBase = `${base}create/`;
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const teacher = await context.newPage();
  teacher.on('pageerror', (e) => errors.push(e.message));
  await stubGoogle(teacher, 'teacher');
  await teacher.goto(createBase);
  await teacher.getByLabel('Teacher password', { exact: true }).fill('teacher');
  await teacher.getByRole('button', { name: 'Teacher sign in', exact: true }).click();
  await teacher.getByRole('heading', { name: 'Songs from a folder', exact: false }).waitFor();

  const picture = (color, label) => teacher.evaluate(([fill, text]) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 700, height: 700 });
    const c = canvas.getContext('2d');
    c.fillStyle = fill; c.fillRect(0, 0, 700, 700);
    c.fillStyle = '#fff'; c.font = '90px sans-serif'; c.fillText(text, 60, 370);
    return canvas.toDataURL('image/png').split(',')[1];
  }, [color, label]).then((data) => Buffer.from(data, 'base64'));
  const images = { [FOUND]: await picture('#2a6f97', 'Found'), [CHOICE]: await picture('#9d2449', 'Chosen') };
  const apple = await picture('#40704a', 'Apple');
  const mine = await picture('#7a5c00', 'Mine');

  const visits = { musicbrainz: 0, apple: 0, covers: 0 };
  const cors = { 'Access-Control-Allow-Origin': '*' };
  const json = (route, data) => route.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify(data) });
  const release = (id, title) => ({ status: 'Official', date: '1987', 'release-group': { id, title, 'primary-type': 'Album' } });
  await context.route('https://musicbrainz.org/**', (route) => {
    visits.musicbrainz += 1;
    const url = new URL(route.request().url());
    const query = url.searchParams.get('query');
    if (url.pathname.includes('release-group')) return json(route, { 'release-groups': /Better words/.test(query) ? [{ id: CHOICE, title: 'Better words' }, { id: MISSING, title: 'No picture here' }] : [] });
    const found = query.includes(FOUND_TITLE);
    return json(route, { recordings: found ? [{ title: FOUND_TITLE, 'artist-credit': [{ name: 'Art Band' }], releases: [release(FOUND, 'Studio album')] }] : [] });
  });
  await context.route('https://itunes.apple.com/**', (route) => {
    visits.apple += 1;
    const term = new URL(route.request().url()).searchParams.get('term');
    json(route, { results: /Better words/.test(term) ? [{ collectionName: 'From Apple', trackName: 'Better words', artistName: 'Art Band', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/source/100x100bb.jpg' }] : [] });
  });
  await context.route('https://coverartarchive.org/**', (route) => {
    visits.covers += 1;
    const id = Object.keys(images).find((key) => route.request().url().includes(key));
    return id ? route.fulfill({ contentType: 'image/png', headers: cors, body: images[id] }) : route.fulfill({ status: 404, headers: cors, body: 'none' });
  });
  await context.route('https://is1-ssl.mzstatic.com/**', (route) => route.fulfill({ contentType: 'image/png', headers: cors, body: apple }));

  const makeSong = (title, artist) => teacher.evaluate(async (song) => {
    const { mp3Blob } = await import('/js/media/mp3.js');
    const { putMedia } = await import('/js/media/store.js');
    const { saveCloudSong } = await import('/js/cloud/library.js');
    const silence = new Float32Array(44100);
    const blob = await mp3Blob([silence, silence], { rate: 44100, kbps: 128 });
    const id = `art-${Math.random().toString(36).slice(2)}`;
    await putMedia(`${id}-a`, new File([blob], 'a.mp3', { type: 'audio/mpeg' }));
    await putMedia(`${id}-k`, new File([blob], 'k.mp3', { type: 'audio/mpeg' }));
    const saved = await saveCloudSong({ ...song, id, source: 'audio', audio: { mediaId: `${id}-a`, name: 'a.mp3' }, karaoke: { mediaId: `${id}-k`, name: 'k.mp3' }, synced: [{ text: 'Hello world', start: 0, end: 3 }] }, { rightsConfirmed: true });
    return saved.id;
  }, { title, artist });
  const found = await makeSong(FOUND_TITLE, 'Art Band');
  const lost = await makeSong(LOST_TITLE, 'Art Band');
  const songDoc = (id) => teacher.evaluate(async (songId) => (await (await import('/js/store.js')).getSong(songId)), id);
  const cardImage = (title) => teacher.locator('.song-card', { hasText: title }).locator('.song-cover img');
  const onLibrary = async () => {
    await teacher.goto(`${createBase}#/`);
    await teacher.locator('.song-card', { hasText: FOUND_TITLE }).scrollIntoViewIfNeeded();
  };

  // First visit: the cover is found, shown and saved with the song.
  const savedCover = teacher.waitForResponse((r) => r.url().endsWith(`/api/songs/${found}/artwork`) && r.request().method() === 'PUT');
  savedCover.catch(() => {}); // reported below, if the page got that far
  await onLibrary();
  assert.equal((await savedCover).status(), 200);
  await teacher.locator('.song-card', { hasText: LOST_TITLE }).scrollIntoViewIfNeeded();
  await cardImage(FOUND_TITLE).waitFor({ state: 'attached' });
  await teacher.waitForFunction((titles) => {
    const asked = Object.keys(JSON.parse(localStorage.getItem('singing.artwork.v1') || '{}'));
    return titles.every((title) => asked.some((key) => key.includes(title.toLowerCase())));
  }, [FOUND_TITLE, LOST_TITLE]);
  // Other audio songs on the page take their turn, a second apart.
  for (let last = ''; last !== JSON.stringify(visits);) {
    last = JSON.stringify(visits);
    await teacher.waitForTimeout(3000);
  }
  assert.ok(visits.musicbrainz >= 2, 'both songs were looked up');
  console.log(`Song pictures: first visit made ${visits.musicbrainz} MusicBrainz and ${visits.apple} iTunes requests`);

  // Next visits: nothing is asked of anyone.
  const seen = { ...visits };
  await teacher.reload();
  await teacher.locator('.song-card', { hasText: FOUND_TITLE }).scrollIntoViewIfNeeded();
  await teacher.locator('.song-card', { hasText: LOST_TITLE }).scrollIntoViewIfNeeded();
  await teacher.waitForFunction(() => document.querySelector('.song-cover img[src^="/api/art/"]'));
  await cardImage(FOUND_TITLE).evaluate((img) => img.decode());
  await teacher.waitForTimeout(1500);
  assert.deepEqual(visits, seen, 'a reload makes no request to any picture service');
  assert.equal(await cardImage(LOST_TITLE).count(), 0);
  assert.equal(await teacher.evaluate(() => performance.getEntriesByType('resource').some((r) => r.name.includes('/api/art/'))), true);
  console.log('Song pictures: a reload shows the saved cover and looks nothing up');

  // The saved cover is on the song page too, and clicking it offers a change.
  const firstCover = (await songDoc(found)).artwork;
  assert.match(firstCover, /^\/api\/art\//);
  assert.equal((await songDoc(found)).revision, 1, 'saving a cover made no revision');

  // A song that failed: better words find it, and the song keeps its name.
  await teacher.goto(`${createBase}#/song/${lost}`);
  await teacher.getByRole('button', { name: 'Change picture', exact: false }).click();
  const dialog = teacher.getByRole('dialog');
  await dialog.getByText('Nothing found. Try other words', { exact: false }).waitFor();
  assert.equal(await dialog.getByLabel('Song or album').inputValue(), LOST_TITLE);
  assert.equal(await dialog.getByLabel('Artist').inputValue(), 'Art Band');
  await dialog.getByLabel('Song or album').fill('Better words');
  await dialog.getByRole('button', { name: 'Search', exact: false }).click();
  await dialog.locator('.art-choice').first().waitFor();
  await dialog.getByText('Click a picture to use it.').waitFor();
  await dialog.locator('.art-choice[title="No picture here"]').waitFor({ state: 'detached' });
  assert.equal(await dialog.locator('.art-choice').count(), 2, 'albums with no picture leave the list');
  if (shots) await teacher.screenshot({ path: `${shots}/dialog.png` });
  await dialog.locator('.art-choice[title="Better words"]').click();
  await dialog.waitFor({ state: 'detached' });
  const cover = teacher.locator('.song-head .song-cover img');
  await teacher.waitForFunction(() => document.querySelector('.song-head .song-cover img')?.src.includes('/api/art/'));
  await cover.evaluate((img) => img.decode());
  assert.equal(await teacher.getByRole('heading', { level: 1 }).innerText(), LOST_TITLE, 'the search words do not rename the song');
  await teacher.reload();
  await teacher.waitForFunction(() => document.querySelector('.song-head .song-cover img')?.src.includes('/api/art/'));
  assert.equal(await teacher.locator('.song-head .song-cover img').evaluate(async (img) => { await img.decode(); return [img.naturalWidth, img.naturalHeight].join('x'); }), '500x500', 'a large picture is saved at the size the page needs');
  assert.equal(await teacher.locator('.song-head .cover-emoji').evaluate((el) => getComputedStyle(el).visibility), 'hidden', 'the emoji does not sit on the picture');
  console.log('Song pictures: a search with better words saves the chosen cover, which survives a reload');
  if (shots) await teacher.screenshot({ path: `${shots}/song.png` });

  // Anything that is not a picture is refused, in words.
  await teacher.getByRole('button', { name: 'Change picture', exact: false }).click();
  const file = dialog.getByLabel('Picture file');
  await file.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a picture') });
  await dialog.getByText('This file is not a picture Singing can read.').waitFor();

  // The teacher's own file, replacing the cover that was there.
  const before = await teacher.locator('.song-head .song-cover img').getAttribute('src');
  await file.setInputFiles({ name: 'mine.png', mimeType: 'image/png', buffer: mine });
  await dialog.waitFor({ state: 'detached' });
  await teacher.waitForFunction((old) => { const src = document.querySelector('.song-head .song-cover img')?.getAttribute('src'); return src && src !== old && src.includes('/api/art/'); }, before);
  assert.equal(await teacher.evaluate((url) => fetch(url).then((r) => r.status), before), 404, 'the replaced picture is gone');

  // A copied picture, pasted into the dialog.
  await teacher.getByRole('button', { name: 'Change picture', exact: false }).click();
  await dialog.getByText('Nothing found', { exact: false }).or(dialog.getByText('Click a picture', { exact: false })).waitFor();
  const pasted = await teacher.evaluate(async (bytes) => {
    const before = document.querySelector('.song-head .song-cover img').getAttribute('src');
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], 'copied.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    return before;
  }, [...apple]);
  await dialog.waitFor({ state: 'detached' });
  await teacher.waitForFunction((old) => { const src = document.querySelector('.song-head .song-cover img')?.getAttribute('src'); return src && src !== old && src.includes('/api/art/'); }, pasted);
  console.log('Song pictures: a file or a pasted picture replaces the cover; other files are refused');

  // A later save of the song keeps the picture on screen.
  const beforeSave = await songDoc(lost);
  await teacher.evaluate(async (id) => {
    const { getSong } = await import('/js/store.js');
    const { saveCloudSong } = await import('/js/cloud/library.js');
    const { mine: _, ...song } = getSong(id);
    await saveCloudSong(song, { rightsConfirmed: true });
  }, lost);
  const afterSave = await songDoc(lost);
  assert.equal(afterSave.revision, beforeSave.revision + 1);
  assert.equal(afterSave.artwork, beforeSave.artwork);

  // Songs that are not the teacher's have nothing to click.
  await teacher.goto(`${base}#/song/${lost}`);
  await teacher.waitForTimeout(500);
  assert.equal(await teacher.getByRole('button', { name: 'Change picture', exact: false }).count(), 0, 'not outside the teacher area');
  assert.deepEqual(errors, []);
  console.log('Song pictures: saving a song keeps its picture; only the teacher area can change it');
  await context.close();
};
