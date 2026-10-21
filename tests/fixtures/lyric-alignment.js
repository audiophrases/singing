import { readTimingFile } from '../../js/media/timing.js';
import { RATE, features } from '../../js/media/align.js';

// A nonrepeating UltraStar melody with a real #GAP. The recording sings it
// 3.2 seconds later, on one shared timeline for original and Demucs stems.
export function timingFixture() {
  let seed = 7, beat = 16;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const rows = ['#TITLE:Timing regression', '#BPM:120', '#GAP:1000'];
  for (let i = 0; i < 40; i++) {
    const length = 2 + Math.floor(random() * 3);
    rows.push(`: ${beat} ${length} ${Math.floor(random() * 20) - 3} word${i} `);
    beat += length + 1 + Math.floor(random() * 3);
    if (i % 4 === 3) rows.push(`- ${beat}`);
  }
  rows.push('E');
  const text = rows.join('\n');
  const lines = readTimingFile(text, 'Timing regression.txt').lines;
  return { text, lines, notes: lines.flatMap((line) => line.notes), shift: 3.2, duration: 40 };
}

export function recordingFeatures(fixture = timingFixture()) {
  const samples = new Float32Array(fixture.duration * RATE);
  for (const [start, end, midi] of fixture.notes) {
    const a = Math.floor((start + fixture.shift) * RATE), b = Math.min(samples.length, Math.floor((end + fixture.shift) * RATE));
    const hz = 440 * 2 ** ((midi - 69) / 12);
    for (let i = a; i < b; i++) {
      const env = Math.min(1, (i - a) / 100, (b - i) / 100);
      samples[i] = env * 0.3 * (Math.sin(2 * Math.PI * hz * i / RATE) + 0.3 * Math.sin(4 * Math.PI * hz * i / RATE));
    }
  }
  return features(samples);
}
