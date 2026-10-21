/*
 * How well can the robot singer be understood? Renders the same lines with
 * each robot voice (headless Chromium, OfflineAudioContext), then has them
 * transcribed by local speech recognizers (tools/robo-listen.py) and scores:
 *
 *   words   Whisper word error rate (WER) against the lyrics
 *   cons    consonant error rate from a phoneme recognizer (wav2vec2, no
 *           language model, so it cannot guess words from context)
 *
 * Material (--only): songs, lines of the built-in songs (familiar, so
 * recognizers can guess); sus, semantically unpredictable sentences ("The
 * heavy rabbit paints the window": the classic speech-synthesis
 * intelligibility test); pairs, minimal-pair word lists ("pin, bin, tin,
 * kin"); cv, every consonant in "uh-Ca" and "aC" (phoneme recognizer only).
 * Each is sung alone and with the band (--no-band, --band-only).
 *
 *   node tools/robo-eval.mjs <outDir> [--python <python>] [--voices roboclassic,robo,roboclear]
 *     [--only songs,sus,pairs,cv] [--no-band | --band-only] [--transpose n]
 *     [--tweak '{"sing":{"hiss":2},"guides":{"robo":{"room":{"duck":6}}}}']
 *     [--render-only | --score-only]
 *
 * Needs Playwright (npm i; PLAYWRIGHT_CHROMIUM_EXECUTABLE picks a browser)
 * and, for listening, Python with faster-whisper, transformers and torch
 * (see tools/robo-listen.py). The audio stays in <outDir>: keep it out of
 * the repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { BUILTIN_SONGS as SONGS } from '../js/data/songs/index.js';
import { composeSong } from '../js/music/composer.js';
import { compileSong } from '../js/music/score.js';
import { phonemes, cleanWord } from '../js/lyrics/phonemes.js';
import { seeded } from '../js/ui.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null;
if (!outDir) {
  console.error('Usage: node tools/robo-eval.mjs <outDir> [--python <python>] [--voices a,b] [--only songs,sus,pairs] [--no-band] [--render-only]');
  process.exit(1);
}
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const VOICES = opt('voices', 'roboclassic,robo,roboclear').split(',');
const ONLY = opt('only', 'songs,sus,pairs').split(',');
const BANDS = args.includes('--no-band') ? [false] : args.includes('--band-only') ? [true] : [false, true];
const PYTHON = opt('python', process.env.ROBO_PYTHON || 'python');
const TWEAK = opt('tweak', '');
const TRANSPOSE = Number(opt('transpose', 0));

// ------------------------------------------------------------- material

function songItems() {
  const items = [];
  for (const song of SONGS) {
    const c = compileSong(song);
    const seen = new Set();
    for (const l of c.lines) {
      if (l.instrumental || seen.has(l.text) || seen.size >= 3) continue;
      seen.add(l.text);
      items.push({ id: `${song.id}-${l.index}`, set: 'songs', song, from: l.start, to: l.end, text: l.text });
    }
  }
  return items;
}

const NOUNS = 'table river chair window garden pencil rabbit kitchen mountain letter doctor bottle cloud horse ticket bridge carpet lemon rocket pocket button monkey castle candle jacket teacher dinner basket'.split(' ');
const ADJS = 'green quiet heavy funny empty dirty soft cold tall brave sleepy round sweet yellow busy'.split(' ');
const VERBS = 'eats paints kicks builds catches follows washes carries finds pushes opens sells keeps drops visits'.split(' ');
const IMPS = 'take wash find paint open follow carry catch push sell'.split(' ');

function susItems(n = 24) {
  const rnd = seeded(7);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const lines = [];
  for (let i = 0; i < n; i += 1) {
    const kind = i % 3;
    if (kind === 0) lines.push(`The ${pick(ADJS)} ${pick(NOUNS)} ${pick(VERBS)} the ${pick(NOUNS)}.`);
    else if (kind === 1) {
      const verb = pick(IMPS);
      lines.push(`${verb[0].toUpperCase()}${verb.slice(1)} the ${pick(NOUNS)} and the ${pick(ADJS)} ${pick(NOUNS)}.`);
    }
    else lines.push(`Why does the ${pick(NOUNS)} ${pick(IMPS)} the ${pick(ADJS)} ${pick(NOUNS)}?`);
  }
  return composedItems('sus', lines, 11);
}

const PAIRS = [
  'pin, bin, tin, kin', 'pat, bat, cat, hat', 'ten, pen, hen, men', 'big, pig, dig, wig',
  'coat, goat, boat, note', 'bed, red, fed, led', 'sip, ship, chip, zip', 'bake, cake, take, make',
  'fan, van, than, man', 'light, night, right, white', 'dog, log, fog, hog', 'cap, cab, cat, can',
  'bag, back, bat, bad', 'rice, rise, ride, right', 'seat, sheet, feet, neat', 'thin, fin, sin, win',
];
const pairItems = () => composedItems('pairs', PAIRS, 23);

// Lines through the song maker (one song per line, so tunes don't repeat).
function composedItems(set, lines, seed) {
  return lines.map((text, i) => {
    const song = { ...composeSong(text, { mood: 'pop', seed: seed + i }), id: `${set}-${i}` };
    const l = compileSong(song).lines.find((x) => !x.instrumental);
    return { id: `${set}-${i}`, set, song, from: l.start, to: l.end, text };
  });
}

/*
 * Consonant identification: every consonant sung in "uh-Ca" (onset of a
 * stressed syllable) and "aC" (end of a phrase) with the vowels of "father",
 * "see" and "too", on one pitch. Only the phoneme recognizer scores these.
 */
const CV_NAMES = { T: 'th', D: 'dh', S: 'sh', Z: 'zh', C: 'ch', J: 'jh', N: 'ng' };
function cvItems() {
  const items = [];
  for (const c of 'pbtdkgfvTDszSZCJmnNlrwyh') {
    const name = CV_NAMES[c] || c;
    for (const v of 'aiu') {
      if (c !== 'N') items.push({ id: `cv-on-${name}-${v}`, set: 'cv-onset', cons: c, sylls: [{ on: '', nu: '^', co: '', stress: 0 }, { on: c, nu: v, co: '', stress: 2 }] });
      if (!'hwy'.includes(c)) items.push({ id: `cv-co-${v}-${name}`, set: 'cv-coda', cons: c, sylls: [{ on: '', nu: v, co: c, stress: 2 }] });
    }
  }
  return items;
}

const words = (text) => String(text).split(/\s+/).map(cleanWord).filter(Boolean);
const ITEMS = [
  ...(ONLY.includes('songs') ? songItems() : []),
  ...(ONLY.includes('sus') ? susItems() : []),
  ...(ONLY.includes('pairs') ? pairItems() : []),
  ...(ONLY.includes('cv') ? cvItems() : []),
].map((it) => (it.sylls ? it : { ...it, words: words(it.text), phones: words(it.text).map(phonemes) }));

// ------------------------------------------------------------- render

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/__eval.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>robo eval</title>'); return; }
    const file = path.join(root, url);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function render() {
  const server = await serve();
  const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/__eval.html`);
  // --tweak '{"sing":{"air":0},"guides":{"robo":{"room":{"duck":6}}}}': try
  // other profile or mix values without editing singer.js / band.js.
  if (TWEAK) {
    await page.evaluate(async (tw) => {
      const { PROFILES } = await import('/js/music/singer.js');
      const { GUIDES } = await import('/js/music/band.js');
      for (const [k, v] of Object.entries(tw)) {
        if (k === 'guides') for (const [g, o] of Object.entries(v)) Object.assign(GUIDES[g], o);
        else Object.assign(PROFILES[k], v);
      }
    }, JSON.parse(TWEAK));
  }
  const meta = [];
  const started = Date.now();
  let audioSec = 0;
  for (const voice of VOICES) {
    for (const band of BANDS) {
      if (band && ITEMS.every((it) => it.sylls)) continue;
      const dir = path.join(outDir, `${voice}-${band ? 'mix' : 'voice'}`);
      fs.mkdirSync(dir, { recursive: true });
      for (const it of ITEMS) {
        if (it.sylls && band) continue;
        const r = await page.evaluate(async ({ song, from, to, sylls, voice, band, transpose }) => {
          const { renderSong, renderEvents, wavBytes } = await import('/js/music/render.js');
          const { loudness, peak } = await import('/js/media/loudness.js');
          const { GUIDES, linkNotes } = await import('/js/music/band.js');
          const t0 = performance.now();
          let buf;
          if (sylls) {
            // One syllable per beat at 120 bpm, on D4.
            const sung = sylls.map((ph, i) => [{
              t: i, d: 0.98, inst: GUIDES[voice].inst, midi: 62, vel: 0.85, bus: 'lead', text: 'la', first: true, last: true,
              ph, stress: ph.stress, wordStart: i === 0,
            }, 1]);
            linkNotes(sung);
            buf = await renderEvents(sung.map(([e]) => e), { to: sylls.length, beatSec: 0.5 });
          } else {
            buf = await renderSong(song, { from, to, guide: voice, band, transpose });
          }
          const ms = performance.now() - t0;
          const chans = [buf.getChannelData(0), buf.getChannelData(1)];
          const lufs = loudness(chans, buf.sampleRate);
          const pk = peak(chans);
          // Files at -20 LUFS (recognizers hear them all equally loud), never clipped.
          const g = Math.min(10 ** ((-20 - lufs) / 20), 0.98 / pk);
          for (const c of chans) for (let i = 0; i < c.length; i += 1) c[i] *= g;
          const bytes = wavBytes(buf);
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return { wav: btoa(bin), lufs, peak: pk, ms, sec: buf.duration };
        }, { song: it.song, from: it.from, to: it.to, sylls: it.sylls, voice, band, transpose: TRANSPOSE });
        fs.writeFileSync(path.join(dir, `${it.id}.wav`), Buffer.from(r.wav, 'base64'));
        audioSec += r.sec;
        meta.push({ voice, band, id: it.id, lufs: r.lufs, peak: r.peak, renderMs: r.ms, sec: r.sec });
      }
      console.log(`rendered ${voice} ${band ? 'with band' : 'alone'}: ${ITEMS.length} lines`);
    }
  }
  console.log(`${audioSec.toFixed(0)} s of audio in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  await browser.close();
  server.close();
  fs.writeFileSync(path.join(outDir, 'items.json'), JSON.stringify(ITEMS.map(({ song, ...it }) => it), null, 1));
  fs.writeFileSync(path.join(outDir, 'render.json'), JSON.stringify(meta, null, 1));
}

// ------------------------------------------------------------- score

// Phones (js/lyrics/phonemes.js codes) and recognizer IPA -> consonant symbols.
const CONS_CODE = { b: 'b', C: 'tʃ', d: 'd', D: 'ð', f: 'f', g: 'ɡ', h: 'h', J: 'dʒ', k: 'k', l: 'l', m: 'm', n: 'n', N: 'ŋ', p: 'p', r: 'ɹ', s: 's', S: 'ʃ', t: 't', T: 'θ', v: 'v', w: 'w', y: 'j', z: 'z', Z: 'ʒ' };
const IPA_CONS = new Set(Object.values(CONS_CODE));
const consOfPhones = (codes) => [...codes].map((c) => CONS_CODE[c]).filter(Boolean);
function consOfIpa(tokens) {
  const out = [];
  for (let tok of tokens) {
    tok = tok.replace('ɾ', 't').replace('g', 'ɡ').replace('r', 'ɹ');
    if (IPA_CONS.has(tok)) out.push(tok);
    else if (tok.endsWith('ɹ') && tok.length > 1) out.push('ɹ'); // ɑːɹ, ɔːɹ, ɛɹ...
    else if (tok === 'əl') out.push('l');
  }
  return out;
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

const NUM = { 0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' };
const norm = (text) => String(text).replace(/\b\d+\b/g, (n) => NUM[n] || n).split(/[\s,.!?;:"-]+/).map(cleanWord).map((w) => w.replace(/'/g, '')).filter(Boolean);

function score() {
  const items = JSON.parse(fs.readFileSync(path.join(outDir, 'items.json'), 'utf8'));
  const heard = JSON.parse(fs.readFileSync(path.join(outDir, 'heard.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'render.json'), 'utf8'));
  const rows = {};
  const detail = [];
  const cv = {};
  for (const h of heard) {
    const [cond, file] = h.file.split(/[\\/]/).slice(-2);
    const it = items.find((x) => `${x.id}.wav` === file);
    if (!it) continue;
    if (it.sylls) {
      // Right if the consonant heard is exactly the one sung.
      const got = consOfIpa(h.phones || []);
      const ok = got.length === 1 && got[0] === CONS_CODE[it.cons];
      const r = cv[cond] || (cv[cond] = { 'cv-onset': [0, 0], 'cv-coda': [0, 0], by: {} });
      r[it.set][0] += ok ? 1 : 0;
      r[it.set][1] += 1;
      const b = r.by[`${it.set === 'cv-onset' ? '' : '-'}${CV_NAMES[it.cons] || it.cons}`] ||= [];
      b.push(ok ? '✓' : (got.join('') || '∅'));
      detail.push({ cond, id: it.id, ref: CONS_CODE[it.cons], heard: got.join(' '), phones: (h.phones || []).join(' '), ok });
      continue;
    }
    const ref = it.words.map((w) => w.replace(/'/g, ''));
    const hyp = norm(h.text);
    const refC = it.phones.flatMap(consOfPhones);
    const hypC = consOfIpa(h.phones || []);
    const key = `${cond}|${it.set}`;
    const r = rows[key] || (rows[key] = { words: 0, wordErr: 0, cons: 0, consErr: 0, n: 0 });
    r.words += ref.length;
    r.wordErr += editDistance(ref, hyp);
    r.cons += refC.length;
    r.consErr += Math.min(refC.length, editDistance(refC, hypC));
    r.n += 1;
    detail.push({ cond, id: it.id, ref: ref.join(' '), heard: hyp.join(' '), wer: editDistance(ref, hyp) / ref.length });
  }
  const conds = [...new Set(Object.keys(rows).map((k) => k.split('|')[0]))];
  const sets = [...new Set(Object.keys(rows).map((k) => k.split('|')[1]))];
  const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
  console.log('\nError rates (lower is better). words: Whisper WER; cons: phoneme-recognizer consonant errors\n');
  console.log(['voice', ...sets.flatMap((s) => [`${s} words`, `${s} cons`]), 'all words', 'all cons'].map((x, i) => x.padEnd(i ? 14 : 20)).join(''));
  for (const c of conds) {
    const all = { words: 0, wordErr: 0, cons: 0, consErr: 0 };
    const cells = sets.flatMap((s) => {
      const r = rows[`${c}|${s}`];
      if (!r) return ['-', '-'];
      for (const k of Object.keys(all)) all[k] += r[k];
      return [pct(r.wordErr, r.words), pct(r.consErr, r.cons)];
    });
    console.log([c, ...cells, pct(all.wordErr, all.words), pct(all.consErr, all.cons)].map((x, i) => String(x).padEnd(i ? 14 : 20)).join(''));
  }
  if (Object.keys(cv).length) {
    console.log('\nConsonants identified (phoneme recognizer; onset "uh-Ca", coda "aC"; vowels a, i, u)\n');
    const cconds = Object.keys(cv);
    console.log(['consonant', ...cconds].map((x) => x.padEnd(20)).join(''));
    console.log(['ONSETS', ...cconds.map((c) => `${cv[c]['cv-onset'][0]}/${cv[c]['cv-onset'][1]}`)].map((x) => x.padEnd(20)).join(''));
    console.log(['CODAS', ...cconds.map((c) => `${cv[c]['cv-coda'][0]}/${cv[c]['cv-coda'][1]}`)].map((x) => x.padEnd(20)).join(''));
    for (const k of Object.keys(cv[cconds[0]].by)) {
      console.log([k, ...cconds.map((c) => (cv[c].by[k] || []).join(' '))].map((x) => x.padEnd(20)).join(''));
    }
  }
  console.log('\nLevels and render speed');
  for (const c of conds) {
    const [voice, kind] = c.split('-');
    const m = meta.filter((x) => x.voice === voice && (kind === 'mix') === x.band);
    const avg = (f) => m.reduce((a, x) => a + f(x), 0) / m.length;
    console.log(`${c.padEnd(18)} loudness ${avg((x) => x.lufs).toFixed(1)} LUFS  peak max ${(20 * Math.log10(Math.max(...m.map((x) => x.peak)))).toFixed(1)} dBFS  render ${(avg((x) => x.renderMs) / avg((x) => x.sec) / 10).toFixed(1)}% of real time`);
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ rows, detail }, null, 1));
  console.log(`\nEvery line, as heard: ${path.join(outDir, 'report.json')}`);
}

if (!args.includes('--score-only')) await render();
if (args.includes('--render-only')) process.exit(0);
if (!args.includes('--score-only')) {
  const res = spawnSync(PYTHON, [path.join(root, 'tools', 'robo-listen.py'), outDir], { stdio: 'inherit' });
  if (res.status !== 0) { console.error('Listening failed (see above).'); process.exit(1); }
}
score();
