// Called by browser-smoke.cjs against the isolated local cloud fixture.
const assert = require('node:assert/strict');

module.exports = async function timingChecks(page, base) {
  const { timingFixture } = await import('../tests/fixtures/lyric-alignment.js');
  const fixture = timingFixture();
  const createFiles = () => page.evaluate(async (fixture) => {
    const rate = 44100, count = fixture.duration * rate;
    const vocals = new Float32Array(count), backing = new Float32Array(count);
    for (const [start, end, midi] of fixture.notes) {
      const a = Math.floor((start + fixture.shift) * rate), b = Math.min(count, Math.floor((end + fixture.shift) * rate));
      const hz = 440 * 2 ** ((midi - 69) / 12);
      for (let i = a; i < b; i++) {
        const env = Math.min(1, (i - a) / 400, (b - i) / 400);
        vocals[i] = env * 0.3 * (Math.sin(2 * Math.PI * hz * i / rate) + 0.3 * Math.sin(4 * Math.PI * hz * i / rate));
        backing[i] = env * 0.02 * Math.sin(2 * Math.PI * 220 * i / rate);
      }
    }
    const wav = new ArrayBuffer(44 + count * 2), view = new DataView(wav);
    const str = (offset, value) => [...value].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); str(8, 'WAVE');
    str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, count * 2, true);
    for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, (vocals[i] + backing[i]) * 32767, true);
    const { mp3Blob } = await import('/js/media/mp3.js');
    const [karaoke, voice] = await Promise.all([backing, vocals].map((samples) => mp3Blob([samples, samples], { rate, kbps: 128 })));
    const file = (blob, name, type) => new File([blob], name, { type, lastModified: 1000 });
    window.timingFiles = [file(wav, 'Timing regression.wav', 'audio/wav'), file(karaoke, 'Timing regression (Karaoke).mp3', 'audio/mpeg'),
      file(voice, 'Timing regression (Vocals).mp3', 'audio/mpeg'), file(fixture.text, 'Timing regression.txt', 'text/plain')];
  }, fixture);
  const selectFile = (index) => page.evaluate((index) => {
    const inputs = [...document.querySelectorAll('.studio-card input[type=file]')];
    const input = index === 3 ? inputs.find((el) => el.accept.startsWith('.txt')) : inputs.filter((el) => el.accept === 'audio/*')[index];
    const transfer = new DataTransfer(); transfer.items.add(window.timingFiles[index]);
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, index);
  const readSong = (id, revision) => page.evaluate(async ({ id, revision }) => {
    const { api } = await import('/js/cloud/session.js');
    return (await api(`/api/songs/${id}${revision ? `?revision=${revision}` : ''}`)).song;
  }, { id, revision });
  const assertTiming = (song) => {
    const shift = song.synced[0].start - fixture.lines[0].start;
    assert.ok(Math.abs(shift - fixture.shift) <= 0.06, `expected ${fixture.shift}, got ${shift}`);
    assert.equal(song.karaoke.offset, 0);
    assert.equal(song.vocals.offset, 0);
    for (let i = 0; i < song.synced.length; i++) {
      assert.ok(Math.abs(song.synced[i].start - fixture.lines[i].start - shift) < 0.011);
      assert.ok(Math.abs(song.synced[i].end - fixture.lines[i].end - shift) < 0.011);
      song.synced[i].notes.forEach((note, n) => {
        assert.ok(Math.abs(note[0] - fixture.lines[i].notes[n][0] - shift) < 0.011);
        assert.ok(Math.abs(note[1] - fixture.lines[i].notes[n][1] - shift) < 0.011);
      });
    }
  };

  await page.goto(base + '#/studio');
  await page.getByRole('button', { name: 'Audio file', exact: false }).click();
  await createFiles();
  // Import lyrics and companions first: only the original should be analyzed.
  await selectFile(3);
  await page.locator('.sync-row.done').first().waitFor();
  await selectFile(1); await selectFile(2);
  await page.evaluate(() => {
    const original = OfflineAudioContext.prototype.decodeAudioData;
    window.timingDecodeCalls = 0;
    const gate = new Promise((resolve) => { window.releaseTimingDecode = resolve; });
    OfflineAudioContext.prototype.decodeAudioData = async function (...args) {
      window.timingDecodeCalls++;
      if (window.timingDecodeCalls === 1) await gate;
      return original.apply(this, args);
    };
    window.restoreTimingDecode = () => { OfflineAudioContext.prototype.decodeAudioData = original; };
  });
  await selectFile(0);
  await page.waitForFunction(() => window.timingDecodeCalls === 1);
  let commits = 0;
  const watchCommits = (request) => { if (request.url().endsWith('/commit')) commits++; };
  page.on('request', watchCommits);
  await page.locator('.studio-card').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Save song', exact: false }).click();
  assert.equal(await page.getByRole('button', { name: 'Save song', exact: false }).isDisabled(), true);
  assert.equal(commits, 0, 'no song may be committed before pending alignment finishes');
  await page.evaluate(() => window.releaseTimingDecode());
  await page.waitForURL(/#\/song\//);
  page.off('request', watchCommits);
  const studioId = page.url().split('/').pop();
  const studioSong = await readSong(studioId);
  assertTiming(studioSong);
  assert.equal(await page.evaluate(() => window.timingDecodeCalls), 2, 'one melody analysis and one WAV-to-MP3 conversion, with no stem alignment');
  await page.evaluate(() => window.restoreTimingDecode());
  await page.reload();
  await page.getByRole('combobox', { name: 'Singer', exact: true }).waitFor();
  assert.deepEqual((await readSong(studioId)).synced, studioSong.synced);
  const playback = await page.evaluate(async (id) => {
    const { api } = await import('/js/cloud/session.js');
    const { makeTrack } = await import('/js/track.js');
    const { alignSongLyrics } = await import('/js/media/lyric-alignment.js');
    const song = (await api(`/api/songs/${id}`)).song;
    const checked = await alignSongLyrics(song);
    const track = await makeTrack(song);
    try {
      track.seek(10); track.setSinger(false); track.setVocalsOnly(true);
      return { status: checked.status, residual: checked.offset, position: [track.audio.currentTime, track.kar.currentTime, track.voc.currentTime] };
    } finally { track.destroy(); }
  }, studioId);
  assert.ok(['aligned', 'unchanged'].includes(playback.status));
  assert.ok(Math.abs(playback.residual) <= 0.08, `MP3 conversion changed alignment by ${playback.residual}`);
  for (const position of playback.position) assert.ok(Math.abs(position - 10) < 0.01);
  console.log('Studio awaits lyric alignment; saved MP3, cloud reload and all three playback positions agree');

  await createFiles();
  const importFolder = () => page.evaluate(async () => {
    const { importFolderSelection, setFolderUploadRights } = await import('/js/media/folder-library.js');
    setFolderUploadRights(true);
    return importFolderSelection(window.timingFiles);
  });
  const folderId = await page.evaluate(() => {
    const root = `TimingFolder-${crypto.randomUUID()}`;
    window.timingFiles.forEach((file) => Object.defineProperty(file, 'webkitRelativePath', { value: `${root}/${file.name}` }));
    return root.toLowerCase() + '/timing regression';
  });
  assert.equal((await importFolder()).added, 1);
  let folderSong = await page.evaluate(async (key) => {
    const { userSongs } = await import('/js/store.js');
    return userSongs().find((s) => s.folderImport?.key === key);
  }, folderId);
  assertTiming(folderSong);
  assert.equal((await importFolder()).unchanged, 1);
  assert.equal((await readSong(folderSong.id)).revision, folderSong.revision);

  // Reproduce an old import without any alignment metadata. A rescan leaves it
  // alone; Studio offers a deliberate preview and saves a new immutable version.
  folderSong = await page.evaluate(async ({ song, lines }) => {
    const { saveCloudSong } = await import('/js/cloud/library.js');
    delete song.folderImport.timing;
    return saveCloudSong({ ...song, synced: lines }, { rightsConfirmed: true });
  }, { song: folderSong, lines: fixture.lines });
  assert.equal((await importFolder()).unchanged, 1);
  await page.evaluate((id) => { location.hash = `#/studio/${id}`; }, folderSong.id);
  const repair = page.getByRole('button', { name: 'Repair lyric timing', exact: false });
  await repair.click();
  await page.getByText(/^All lyrics moved /).waitFor();
  assert.deepEqual((await readSong(folderSong.id)).synced, fixture.lines, 'repair is a preview until Save');
  await page.getByRole('button', { name: 'Save song', exact: false }).click();
  await page.waitForURL(/#\/song\//);
  const repaired = await readSong(folderSong.id);
  assertTiming(repaired);
  assert.equal(repaired.revision, folderSong.revision + 1);
  assert.deepEqual((await readSong(folderSong.id, folderSong.revision)).synced, fixture.lines, 'the previous assigned version stays intact');
  assert.equal((await importFolder()).unchanged, 1);
  console.log('Folder import aligns once; older songs can be repaired explicitly without changing prior versions');

  // A teacher can still correct timing while audio analysis is pending. Its old
  // result must not overwrite that edit when decoding finally completes.
  await page.evaluate((id) => { location.hash = `#/studio/${id}`; }, repaired.id);
  await repair.waitFor();
  await page.evaluate(() => {
    const original = OfflineAudioContext.prototype.decodeAudioData;
    const gate = new Promise((resolve) => { window.releaseTimingDecode = resolve; });
    window.timingDecodeStarted = false;
    OfflineAudioContext.prototype.decodeAudioData = async function (...args) {
      window.timingDecodeStarted = true; await gate; return original.apply(this, args);
    };
    window.restoreTimingDecode = () => { OfflineAudioContext.prototype.decodeAudioData = original; };
  });
  await repair.click();
  await page.waitForFunction(() => window.timingDecodeStarted);
  await page.locator('.sync-shift').getByRole('button', { name: '+1 s', exact: true }).click();
  await page.evaluate(() => window.releaseTimingDecode());
  await page.getByText(/Lyrics changed while listening/).waitFor();
  await page.evaluate(() => window.restoreTimingDecode());
  await page.getByRole('button', { name: 'Save song', exact: false }).click();
  await page.waitForURL(/#\/song\//);
  const manual = await readSong(repaired.id);
  assert.ok(Math.abs(manual.synced[0].start - repaired.synced[0].start - 1) < 0.01);
  assert.equal((await importFolder()).unchanged, 1);
  assert.deepEqual((await readSong(manual.id)).synced, manual.synced);
  await page.evaluate((id) => { location.hash = `#/studio/${id}`; }, manual.id);
  await repair.waitFor();
  await selectFile(0);
  await page.getByText(/Recording changed. Your lyric timing was kept/).waitFor();
  await page.getByRole('button', { name: 'Save song', exact: false }).click();
  await page.waitForURL(/#\/song\//);
  assert.deepEqual((await readSong(manual.id)).synced, manual.synced, 'replacing the recording preserves manual timing');
  console.log('Manual edits survive pending analysis, folder rescans and Studio recording replacement');
};
