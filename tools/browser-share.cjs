// Isolated local accounts and synthetic audio only; no production resources.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const { stubGoogle } = require('./browser-access.cjs');

(async () => {
  const port = Number(process.env.SINGING_SHARE_TEST_PORT || 8789);
  const server = spawn(process.execPath, ['tools/test-cloud-server.mjs'], {
    cwd: path.resolve(__dirname, '..'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, SINGING_TEST_PORT: String(port) },
  });
  let output = ''; let browser;
  server.stdout.on('data', (data) => { output += data; }); server.stderr.on('data', (data) => { output += data; });
  const fixture = (command) => new Promise((resolve, reject) => {
    const requestId = Math.random().toString(36);
    const timer = setTimeout(() => { server.off('message', receive); reject(new Error('Fixture command timed out.')); }, 15000);
    const receive = (message) => {
      if (message.requestId !== requestId) return;
      clearTimeout(timer); server.off('message', receive);
      if (message.error) reject(new Error(message.error)); else resolve();
    };
    server.on('message', receive); server.send({ ...command, requestId });
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Fixture startup timed out: ${output}`)), 30000);
      server.on('message', (message) => { if (message.ready) { clearTimeout(timer); resolve(); } });
      server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}: ${output}`)); });
    });
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
    const errors = [];
    const base = `http://127.0.0.1:${port}/`;
    const teacherContext = await browser.newContext(); const teacher = await teacherContext.newPage();
    teacher.on('pageerror', (e) => errors.push(e.message));
    await teacher.goto(base + 'create/');
    await teacher.getByLabel('Teacher password', { exact: true }).fill('teacher');
    await teacher.getByRole('button', { name: 'Teacher sign in', exact: true }).click();
    await teacher.getByRole('heading', { name: 'Songs from a folder', exact: false }).waitFor();
    const song = await teacher.evaluate(async () => {
      const { mp3Blob } = await import('/js/media/mp3.js');
      const { putMedia, newMediaId } = await import('/js/media/store.js');
      const { saveCloudSong } = await import('/js/cloud/library.js');
      const pcm = Float32Array.from({ length: 44100 * 6 }, (_, i) => Math.sin(i * 440 * Math.PI * 2 / 44100) * 0.02);
      const blob = await mp3Blob([pcm, pcm], { rate: 44100, kbps: 128 });
      const mediaId = newMediaId(); await putMedia(mediaId, blob);
      return saveCloudSong({ id: `browser-share-${crypto.randomUUID()}`, title: 'Protected browser song', source: 'audio',
        audio: { mediaId, name: 'Synthetic.mp3' }, karaoke: { mediaId, name: 'Synthetic karaoke.mp3' }, vocals: { mediaId, name: 'Synthetic vocals.mp3' },
        synced: [{ text: 'Protected lyric for expiry test', start: 0, end: 3 }, { text: 'Sing along with the test', start: 3, end: 6 }],
      }, { rightsConfirmed: true });
    });
    await teacher.goto(base + `create/#/song/${song.id}`);
    await teacher.getByRole('button', { name: /Share link/ }).click();
    await teacher.getByLabel('Share with class Class A', { exact: true }).check();
    await teacher.getByRole('button', { name: 'Create new seven-day link', exact: true }).click();
    const linkField = teacher.getByLabel('Seven-day share link', { exact: true });
    await linkField.waitFor(); const originalUrl = await linkField.inputValue();
    const originalId = await teacher.evaluate(async (songId) => (await (await import('/js/cloud/session.js')).api(`/api/share-links?songId=${songId}`)).links[0].id, song.id);
    console.log('Teacher creates a seven-day class link with an explicit expiry.');

    const outsiderContext = await browser.newContext(); const outsider = await outsiderContext.newPage();
    await stubGoogle(outsider, 'outsider'); await outsider.goto(originalUrl);
    await outsider.getByRole('heading', { name: 'Sign in to open this song', exact: true }).waitFor();
    await outsider.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    await outsider.getByText('This link is for another student or class.', { exact: true }).waitFor();
    assert.equal(await outsider.getByText('Protected lyric for expiry test', { exact: true }).count(), 0);

    const studentContext = await browser.newContext();
    await studentContext.addInitScript(() => {
      const NativeAudio = window.Audio; window.__testAudio = [];
      window.Audio = function (...args) { const audio = new NativeAudio(...args); window.__testAudio.push(audio); return audio; };
      window.Audio.prototype = NativeAudio.prototype;
    });
    const student = await studentContext.newPage(); student.on('pageerror', (e) => errors.push(e.message));
    await stubGoogle(student, 'student'); await student.goto(originalUrl);
    await student.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    await student.getByRole('heading', { name: song.title, exact: true }).waitFor();
    await student.getByRole('button', { name: /Save to my songs/ }).click();
    await student.getByText('Saved. Access ends on the same expiry date.', { exact: true }).waitFor();
    assert.equal(await student.evaluate(() => JSON.stringify({ ...localStorage }).includes('Protected lyric')), false);
    await student.getByRole('link', { name: 'Open song', exact: false }).click();
    await student.getByText('Protected lyric for expiry test', { exact: true }).waitFor();
    assert.equal(await student.getByRole('link', { name: /Worksheets|Remix/ }).count(), 0);
    await student.route('**/js/views/help.js', (route) => route.fulfill({ status: 503, body: 'Simulated module load failure' }));
    await student.goto(base + '#/help');
    await student.getByText('Could not load this page. Check your connection.', { exact: true }).waitFor();
    assert.equal(await student.getByText('Protected lyric for expiry test', { exact: true }).count(), 0, 'a failed page import clears the previous protected screen');
    await student.unroute('**/js/views/help.js');
    await student.goto(base + `#/play/${song.id}/karaoke`);
    await student.getByRole('button', { name: 'Sing!', exact: false }).click();
    await student.locator('.karaoke .k-line .w').first().waitFor();
    await student.goto(base + '#/unknown-route');
    await student.getByText(/This page does not exist/).waitFor();
    assert.equal(await student.locator('#stage').isVisible(), false);
    assert.equal(await student.locator('.karaoke').count(), 0, 'an invalid route clears the previous activity');
    for (const route of ['print', 'remix']) {
      await student.goto(base + `#/${route}/${song.id}${route === 'print' ? '/gapfill' : ''}`);
      await student.getByText(/Saving a copy, printing and remixing are unavailable/).waitFor();
      assert.equal(await student.getByText('Protected lyric for expiry test', { exact: true }).count(), 0);
    }
    await student.goto(base + `#/song/${song.id}`);
    await student.getByRole('button', { name: 'Play', exact: true }).click();
    await student.evaluate((id) => {
      window.__protectedAudio = window.__testAudio.filter((audio) => audio.src.includes(`/api/media/${id}/`));
      const original = Date.now; Date.now = () => original() - 30 * 24 * 3600 * 1000;
    }, song.id);
    await fixture({ action: 'setShareExpiry', shareId: originalId, afterMs: 1500 });
    await student.evaluate(() => window.dispatchEvent(new Event('focus')));
    await student.getByRole('heading', { name: 'Song access', exact: true }).waitFor({ timeout: 10000 });
    assert.equal(await student.getByText('Protected lyric for expiry test', { exact: true }).count(), 0);
    assert.equal(await student.evaluate(() => window.__protectedAudio.length === 3 && window.__protectedAudio.every((audio) => audio.paused && !audio.getAttribute('src'))), true);
    console.log('An open player stops at server expiry despite a changed device clock; all three audio buffers and lyrics are cleared.');

    await student.goto(base);
    const savedCard = student.locator('.song-card').filter({ hasText: song.title });
    await savedCard.getByText('Access expired', { exact: false }).waitFor();
    await savedCard.locator('.song-title').click();
    await student.getByRole('heading', { name: 'Song access', exact: true }).waitFor();
    assert.equal(await student.getByText('Protected lyric for expiry test', { exact: true }).count(), 0);

    await teacher.getByLabel('Share with class Class A', { exact: true }).uncheck();
    await teacher.getByLabel('Share with student student', { exact: true }).check();
    await teacher.getByRole('button', { name: 'Create new seven-day link', exact: true }).click();
    await teacher.waitForFunction((previous) => document.querySelector('input[aria-label="Seven-day share link"]')?.value !== previous, originalUrl);
    const replacement = await linkField.inputValue();
    await student.goto(originalUrl);
    await student.getByText(/This link has expired or been withdrawn/).waitFor();
    await student.goto(replacement);
    await student.getByRole('link', { name: 'Open song', exact: false }).click();
    await student.getByText('Protected lyric for expiry test', { exact: true }).waitFor();
    const bookmarks = await student.evaluate(async (id) => (await (await import('/js/cloud/session.js')).api('/api/saved-songs')).songs.filter((s) => s.id === id), song.id);
    assert.equal(bookmarks.length, 1); assert.equal(bookmarks[0].locked, false);
    console.log('A replacement for one named student restores the existing bookmark; the original URL stays expired.');

    await student.getByRole('button', { name: 'Play', exact: true }).click();
    await studentContext.setOffline(true);
    await student.getByText('Connect to the internet to check access, then reopen this song.', { exact: true }).waitFor();
    assert.equal(await student.getByText('Protected lyric for expiry test', { exact: true }).count(), 0);
    await studentContext.setOffline(false);
    await student.getByRole('button', { name: 'Check access again', exact: true }).click();
    await student.getByText('Protected lyric for expiry test', { exact: true }).waitFor();
    const mediaUrl = await student.evaluate((id) => window.__testAudio.findLast((audio) => audio.src.includes(`/api/media/${id}/audio`)).src, song.id);
    await student.getByRole('button', { name: 'Play', exact: true }).click();
    await teacher.getByRole('button', { name: 'Revoke link', exact: true }).click();
    await teacher.getByText(/Withdrawn/).waitFor();
    await student.evaluate(() => window.dispatchEvent(new Event('focus')));
    await student.getByRole('heading', { name: 'Song access', exact: true }).waitFor();
    assert.equal((await studentContext.request.get(mediaUrl)).status(), 403);
    assert.equal(await student.getByText('Protected lyric for expiry test', { exact: true }).count(), 0);
    await student.goto(base + '#/s/jretired');
    await student.getByRole('heading', { name: 'A new share link is needed', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('Offline playback, revoked media URLs and legacy self-contained links are blocked. Browser share checks passed.');
  } finally {
    await browser?.close();
    if (server.connected) server.send({ action: 'shutdown' });
    const timer = setTimeout(() => server.kill(), 5000); timer.unref();
    if (server.exitCode === null) await new Promise((resolve) => server.once('exit', resolve));
    clearTimeout(timer);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
