// Run against tools/test-cloud-server.mjs, never a production account.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  try {
  const errors = [];
  const teacherContext = await browser.newContext();
  const teacher = await teacherContext.newPage();
  teacher.on('pageerror', (e) => errors.push(e.message));
  teacher.on('response', async (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !r.url().endsWith('/api/auth/session')) { try { console.log('API failure:', r.status(), (await r.json()).error); } catch {} } });
  const base = 'http://127.0.0.1:8788/';
  async function login(page, who) {
    await page.goto(base + '#/assignments');
    await page.locator('.topbar-right').getByRole('button', { name: 'Sign in', exact: false }).click();
    await page.getByLabel('Teacher password', { exact: true }).fill(who);
    await page.getByRole('button', { name: 'Teacher sign in', exact: true }).click();
    await page.getByText('Signed in as ' + who + '.', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
  }
  await login(teacher, 'teacher');
  const mp3 = Buffer.from(await teacher.evaluate(async () => {
    const { mp3Blob } = await import('/js/media/mp3.js');
    const data = Float32Array.from({ length: 44100 * 6 }, (_, i) => Math.sin(i * 440 * Math.PI * 2 / 44100) * 0.02);
    const blob = await mp3Blob([data, data], { rate: 44100, kbps: 128 });
    return [...new Uint8Array(await blob.arrayBuffer())];
  }));
  await teacher.goto(base + '#/studio');
  await teacher.getByPlaceholder('Song title', { exact: true }).fill('Cloud browser song');
  await teacher.getByRole('button', { name: 'Audio file', exact: false }).click();
  const files = teacher.locator('.studio-card input[type=file][accept="audio/*"]');
  await files.nth(0).setInputFiles({ name: 'Cloud browser song.mp3', mimeType: 'audio/mpeg', buffer: mp3 });
  await files.nth(1).setInputFiles({ name: 'Cloud browser song (Karaoke).mp3', mimeType: 'audio/mpeg', buffer: mp3 });
  await files.nth(2).setInputFiles({ name: 'Cloud browser song (Vocals).mp3', mimeType: 'audio/mpeg', buffer: mp3 });
  await teacher.locator('.studio-card input[type=file][accept^=".txt"]').setInputFiles({ name: 'Cloud browser song.lrc', mimeType: 'text/plain', buffer: Buffer.from('[00:00.10]Hello world\n[00:02.00]Sing along') });
  await teacher.locator('.studio-card').getByRole('checkbox').check();
  await teacher.getByRole('button', { name: 'Save song', exact: false }).click();
  try { await teacher.waitForURL(/#\/song\//); } catch (e) { console.log((await teacher.locator('.studio-card').innerText()).slice(-1800)); throw e; }
  await teacher.getByRole('combobox', { name: 'Singer', exact: true }).waitFor();
  const songUrl = teacher.url();
  await teacher.reload();
  await teacher.getByRole('combobox', { name: 'Singer', exact: true }).selectOption('vocals');
  await teacher.getByRole('button', { name: 'Play', exact: true }).click();
  await teacher.getByRole('button', { name: 'Pause', exact: true }).click();
  console.log('Cloud Studio upload, reload, karaoke/vocals playback passed');
  await teacher.evaluate(async (id) => {
    const { getSong } = await import('/js/store.js');
    const { saveCloudSong } = await import('/js/cloud/library.js');
    const { makeTrack } = await import('/js/track.js');
    let refused = false;
    try { await saveCloudSong(getSong(id), { rightsConfirmed: false }); }
    catch (error) { refused = /permission/.test(error.message); }
    if (!refused) throw new Error('An existing song bypassed permission confirmation.');
    const track = await makeTrack(getSong(id));
    try {
      const originalUrl = track.audio.src;
      track.seek(1); await track.play();
      track.song.playbackExpiresAt = Date.now() + 100;
      track.poll();
      if (!track.refreshing) throw new Error('Expected automatic playback renewal.');
      await track.refreshing;
      if (track.audio.src === originalUrl || !track.playing || track.time() < 0.9 || !track.kar || !track.voc) throw new Error('Renewal lost playback position or stems.');
    } finally { track.destroy(); }
  }, songUrl.split('/').pop());
  console.log('Private playback grants renew without losing position or stems');

  const folderChecks = await teacher.evaluate(async (bytes) => {
    const { importFolderSelection, setFolderUploadRights } = await import('/js/media/folder-library.js');
    const { userSongs } = await import('/js/store.js');
    const { saveCloudSong, playbackSong } = await import('/js/cloud/library.js');
    const folderRoot = `SmokeFolder-${crypto.randomUUID()}`;
    const rate = 44100, count = rate * 2;
    const buffer = new ArrayBuffer(44 + count * 2), view = new DataView(buffer);
    const str = (offset, value) => [...value].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); str(8, 'WAVE');
    str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, count * 2, true);
    for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, Math.sin(i * 440 * Math.PI * 2 / rate) * 500, true);
    const file = (name, data, type) => {
      const f = new File([data], name, { type, lastModified: 1000 });
      Object.defineProperty(f, 'webkitRelativePath', { value: `${folderRoot}/${name}` }); return f;
    };
    const files = [file('Format conversion.wav', buffer, 'audio/wav'),
      file('Format conversion (Karaoke).mp3', new Uint8Array(bytes), 'audio/mpeg'),
      file('Format conversion (Vocals).mp3', new Uint8Array(bytes), 'audio/mpeg'),
      file('Format conversion.lrc', '[00:00.10]Hello again\n[00:01.00]Keep singing', 'text/plain')];
    setFolderUploadRights(true);
    const first = await importFolderSelection(files);
    let song = userSongs().find((s) => s.title === 'Format conversion');
    if (!song?.sourceFile || !song?.audio?.name.endsWith('.mp3') || song.status !== 'ready') throw new Error('Conversion did not preserve its source and MP3 derivative.');
    song = await saveCloudSong({ ...song, title: 'Edited folder title' }, { rightsConfirmed: true });
    const second = await importFolderSelection(files);
    const saved = userSongs().find((s) => s.id === song.id);
    const prepared = await playbackSong(saved);
    const source = await fetch(prepared.sourceFile.url);
    return { first, second, title: saved.title, sourceBytes: (await source.arrayBuffer()).byteLength, expectedBytes: buffer.byteLength };
  }, [...mp3]);
  assert.equal(folderChecks.first.added, 1);
  assert.equal(folderChecks.second.unchanged, 1);
  assert.equal(folderChecks.title, 'Edited folder title');
  assert.equal(folderChecks.sourceBytes, folderChecks.expectedBytes);
  console.log('Whole-folder cloud import converts WAV, preserves sources and skips unchanged songs');

  await teacher.goto(base + '#/assignments');
  await teacher.getByRole('button', { name: 'Create assignment', exact: false }).click();
  await teacher.getByRole('textbox', { name: 'Assignment title' }).fill('Browser homework');
  await teacher.getByRole('combobox', { name: 'Assignment song' }).selectOption(songUrl.split('/').pop());
  await teacher.getByRole('checkbox', { name: 'Choose the word', exact: true }).check();
  await teacher.getByRole('checkbox', { name: 'Class A', exact: true }).check();
  await teacher.getByRole('button', { name: 'Create assignment', exact: true }).click();
  await teacher.waitForURL(/#\/assignment\//);
  await teacher.getByRole('heading', { name: 'Browser homework', exact: true }).waitFor();
  const assignmentUrl = teacher.url();
  console.log('Teacher created a native Singing assignment');

  const studentContext = await browser.newContext();
  const student = await studentContext.newPage();
  student.on('pageerror', (e) => errors.push(e.message));
  await login(student, 'student');
  await student.goto(assignmentUrl);
  await student.getByRole('button', { name: 'Start activity', exact: true }).click();
  await student.waitForURL(/attempt=/);
  await student.locator('.stage .setup-card').getByRole('button', { name: 'Start', exact: false }).waitFor();
  assert.equal(await student.getByRole('button', { name: 'Expert', exact: false }).isDisabled(), true);
  await student.locator('.stage .setup-card').getByRole('button', { name: 'Start', exact: false }).click();
  for (let i = 0; i < 2; i++) {
    await student.waitForFunction(() => document.querySelectorAll('.bank-word').length > 0);
    const target = await student.evaluate(async () => {
      const { pickGaps } = await import('/js/lyrics/gaps.js');
      const { timelineFromSynced } = await import('/js/music/timeline.js');
      const id = new URLSearchParams(location.hash.split('?')[1]).get('attempt');
      const { api } = await import('/js/cloud/session.js');
      const attempt = await api('/api/attempts/' + id);
      const timeline = timelineFromSynced(attempt.song.synced, attempt.song.duration || 0);
      const gaps = pickGaps(timeline, { mode: attempt.settings.level, seed: attempt.settings.seed });
      const words = timeline.lines.flatMap(l => [...(gaps.get(l.index) || [])].sort((a,b) => a-b).map(w => l.words[w].text.replace(/^[^A-Za-z0-9'’]+|[^A-Za-z0-9'’]+$/g, '')));
      const done = Number(document.querySelector('.gf-progress').textContent.split('/')[0]);
      return words[done];
    });
    const buttons = student.locator('.bank-word');
    let clicked = false;
    for (let n = 0; n < await buttons.count(); n++) if ((await buttons.nth(n).textContent()).slice(1).trim() === target) { await buttons.nth(n).click(); clicked = true; break; }
    assert.ok(clicked, 'correct answer option exists');
  }
  await student.getByText(/Your assignment result is saved/).waitFor({ timeout: 15000 });
  await student.getByRole('button', { name: 'Back to assignment', exact: true }).click();
  await student.getByRole('button', { name: 'Start activity', exact: true }).waitFor();
  assert.equal(await student.getByRole('button', { name: 'Start activity', exact: true }).isDisabled(), true);
  await teacher.goto(assignmentUrl);
  await teacher.getByRole('button', { name: 'Refresh results', exact: true }).click();
  await teacher.locator('.results-table').waitFor();
  await teacher.getByRole('cell', { name: '2/2 (checked-answers)', exact: true }).waitFor();
  await teacher.getByText('Not started student: 0/1 activities completed', { exact: true }).waitFor();
  console.log('Student native game, server-checked result, attempt limit and teacher dashboard passed');

  const outsiderContext = await browser.newContext();
  const outsider = await outsiderContext.newPage();
  await login(outsider, 'outsider');
  await outsider.goto(assignmentUrl);
  await outsider.getByText('Assignment not found for your class.', { exact: true }).waitFor();
  console.log('Copied assignment links refused for another class');

  await teacher.evaluate(async (bytes) => {
    const { putMedia } = await import('/js/media/store.js');
    await putMedia('legacy-audio', new File([new Uint8Array(bytes)], 'Legacy.mp3', { type: 'audio/mpeg' }));
    localStorage.setItem('singing.songs.v1', JSON.stringify([{ id: 'legacy-browser-song', title: 'Legacy browser song', source: 'audio', audio: { mediaId: 'legacy-audio', name: 'Legacy.mp3' }, synced: [{ text: 'Keep my original', start: 0, end: 3 }] }]));
  }, [...mp3]);
  await teacher.locator('.topbar-right').getByRole('button', { name: 'teacher', exact: false }).click();
  await teacher.getByRole('checkbox', { name: 'I have permission to store and use the songs I migrate.', exact: true }).check();
  await teacher.getByRole('button', { name: 'Migrate local songs', exact: false }).click();
  await teacher.getByText(/1 songs migrated\. Local originals were kept/).waitFor();
  assert.equal(await teacher.evaluate(async () => !!await (await import('/js/media/store.js')).getMedia('legacy-audio')), true);
  await teacher.getByRole('button', { name: 'Migrate local songs', exact: false }).click();
  await teacher.getByText(/1 songs migrated\. Local originals were kept/).waitFor();
  await teacher.keyboard.press('Escape');
  await teacher.goto(base + '#/');
  assert.equal(await teacher.locator('.song-title', { hasText: 'Legacy browser song' }).count(), 1);
  console.log('Local migration is repeatable and keeps source files');
  const legacyContext = await browser.newContext();
  const legacy = await legacyContext.newPage();
  legacy.on('pageerror', (e) => errors.push(e.message));
  await legacy.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Old static host' }));
  await legacy.goto('http://localhost:8788/#/');
  await legacy.evaluate(async (bytes) => {
    const { putMedia } = await import('/js/media/store.js');
    await putMedia('old-host-audio', new File([new Uint8Array(bytes)], 'Old host.mp3', { type: 'audio/mpeg' }));
    localStorage.setItem('singing.songs.v1', JSON.stringify([{ id: `old-host-${Date.now()}`, title: 'Cross-origin legacy song', source: 'audio',
      audio: { mediaId: 'old-host-audio', name: 'Old host.mp3' }, karaoke: { mediaId: 'old-host-audio', name: 'Old host karaoke.mp3' }, synced: [{ text: 'Keep every original', start: 0, end: 3 }] }]));
  }, [...mp3]);
  await legacy.locator('.topbar-right').getByRole('button', { name: 'Sign in', exact: false }).click();
  await legacy.getByText(/Cloud sign-in is not connected on this host/).waitFor();
  const downloading = legacy.waitForEvent('download');
  await legacy.getByRole('button', { name: 'Export local backup with audio', exact: true }).click();
  const download = await downloading;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const backupBytes = Buffer.concat(chunks);
  await teacher.locator('.topbar-right').getByRole('button', { name: 'teacher', exact: false }).click();
  await teacher.getByRole('checkbox', { name: 'I have permission to store and use the songs I migrate.', exact: true }).check();
  await teacher.getByLabel('Local song backup with audio', { exact: true }).setInputFiles({ name: 'old-host.singing', mimeType: 'application/octet-stream', buffer: backupBytes });
  await teacher.getByText('1 songs imported to your cloud library.', { exact: true }).waitFor();
  const repeated = await teacher.evaluate(async (bytes) => {
    const { importSongBackup } = await import('/js/cloud/library.js');
    const { userSongs } = await import('/js/store.js');
    const result = await importSongBackup(new Blob([new Uint8Array(bytes)]), { rightsConfirmed: true });
    const songs = userSongs().filter((s) => s.title === 'Cross-origin legacy song');
    return { result, count: songs.length, status: songs[0].status };
  }, [...backupBytes]);
  assert.equal(repeated.result.migrated, 1); assert.equal(repeated.count, 1); assert.equal(repeated.status, 'ready');
  assert.equal(await legacy.evaluate(async () => !!await (await import('/js/media/store.js')).getMedia('old-host-audio')), true);
  await teacher.keyboard.press('Escape');
  console.log('Audio-inclusive backup migrates between app origins and preserves the old browser files');
  assert.deepEqual(errors, []);
  await teacher.setViewportSize({ width: 390, height: 844 });
  await teacher.goto(assignmentUrl);
  await teacher.getByRole('heading', { name: 'Browser homework', exact: true }).waitFor();
  if (process.env.PLAYWRIGHT_SCREENSHOT) await teacher.screenshot({ path: process.env.PLAYWRIGHT_SCREENSHOT, fullPage: true, animations: 'disabled' });
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
