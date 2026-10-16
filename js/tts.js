/*
 * Spoken English for words and lines: PinPlay's Edge TTS endpoint (neural
 * voices) when it answers, the browser's own voice otherwise.
 */
import { getSettings } from './store.js';

const cache = new Map();
let edgeDown = false;
let current = null;

export const VOICES = [
  ['en-US-AriaNeural', 'Aria (US)'],
  ['en-US-GuyNeural', 'Guy (US)'],
  ['en-US-AnaNeural', 'Ana (US, child)'],
  ['en-GB-SoniaNeural', 'Sonia (UK)'],
  ['en-GB-RyanNeural', 'Ryan (UK)'],
  ['en-AU-NatashaNeural', 'Natasha (Australia)'],
  ['en-IE-EmilyNeural', 'Emily (Ireland)'],
  ['en-IN-NeerjaNeural', 'Neerja (India)'],
];

export function stopSpeaking() {
  if (current) {
    try { current.pause(); } catch { /* ignore */ }
    current = null;
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

async function edgeAudio(text, voice, rate) {
  const { backend } = getSettings();
  if (!backend || edgeDown) return null;
  const key = `${voice}|${rate}|${text}`;
  if (cache.has(key)) return cache.get(key);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${backend.replace(/\/+$/, '')}/api/tts/edge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, rate }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      if (res.status >= 500 || res.status === 404) edgeDown = true;
      return null;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    cache.set(key, url);
    return url;
  } catch {
    edgeDown = true;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function browserVoice(lang = 'en') {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang === 'en-US' && /natural|google|samantha|aria/i.test(v.name))
    || voices.find((v) => v.lang && v.lang.startsWith(lang))
    || null;
}

// speak('Hello', { slow: true }) -> resolves when finished.
export async function speak(text, { slow = false, voice } = {}) {
  stopSpeaking();
  const clean = String(text || '').replace(/[-_=]/g, (c) => (c === '=' ? '-' : '')).replace(/\s+/g, ' ').trim();
  if (!clean) return;
  const settings = getSettings();
  const v = voice || settings.ttsVoice || 'en-US-AriaNeural';
  const url = await edgeAudio(clean, v, slow ? '-30%' : '+0%');
  if (url) {
    const a = new Audio(url);
    current = a;
    await new Promise((resolve) => {
      a.addEventListener('ended', resolve, { once: true });
      a.addEventListener('error', resolve, { once: true });
      a.play().catch(resolve);
    });
    if (current === a) current = null;
    return;
  }
  if (!('speechSynthesis' in window)) return;
  await new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'en-US';
    const bv = browserVoice();
    if (bv) u.voice = bv;
    u.rate = slow ? 0.7 : 0.95;
    u.onend = resolve;
    u.onerror = resolve;
    window.speechSynthesis.speak(u);
  });
}

// Raw audio for the chant maker (needs Web Audio decoding).
export async function speechBuffer(ctx, text, { voice, rate = '+0%' } = {}) {
  const v = voice || getSettings().ttsVoice || 'en-US-AriaNeural';
  const url = await edgeAudio(text, v, rate);
  if (!url) return null;
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    return await ctx.decodeAudioData(buf);
  } catch {
    return null;
  }
}

export function ttsAvailable() {
  return !edgeDown || 'speechSynthesis' in window;
}
