/*
 * Sound effects (PinPlay's correct / wrong / drumroll clips) and confetti.
 */
import { getSettings } from './store.js';

const FILES = {
  correct: ['sounds/correct.mp3', 'sounds/correct2.mp3', 'sounds/correct3.mp3', 'sounds/correct4.mp3'],
  wrong: ['sounds/incorrect.mp3', 'sounds/incorrect2.mp3'],
  drumroll: ['sounds/drumrollwinner.mp3'],
  pop: ['sounds/answered.mp3'],
  tick: ['sounds/final-ten-tick.mp3'],
  jackpot: ['sounds/jackpot.mp3'],
  chest: ['sounds/chest-open.mp3'],
};

const cache = new Map();

function audioFor(src) {
  if (!cache.has(src)) {
    const a = new Audio(src);
    a.preload = 'auto';
    cache.set(src, a);
  }
  return cache.get(src);
}

export function sfx(name, { volume = 0.7 } = {}) {
  if (!getSettings().sfx) return null;
  const list = FILES[name];
  if (!list) return null;
  const src = list[Math.floor(Math.random() * list.length)];
  const base = audioFor(src);
  const a = base.paused ? base : base.cloneNode();
  a.volume = volume;
  try { a.currentTime = 0; } catch { /* not loaded yet */ }
  a.play().catch(() => {});
  return a;
}

export function stopSfx(name) {
  for (const src of FILES[name] || []) {
    const a = cache.get(src);
    if (a) { a.pause(); try { a.currentTime = 0; } catch { /* ignore */ } }
  }
}

// ------------------------------------------------------------------ confetti

export function confetti({ count = 140, duration = 2600, origin = null, colors = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:500';
  document.body.append(canvas);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = (canvas.width = innerWidth * dpr);
  const H = (canvas.height = innerHeight * dpr);
  const ctx = canvas.getContext('2d');
  const palette = colors || ['#605dff', '#ec4899', '#facc15', '#22c55e', '#38bdf8', '#f97316', '#ffffff'];
  const ox = origin ? origin.x * dpr : W / 2;
  const oy = origin ? origin.y * dpr : H * 0.35;
  const parts = Array.from({ length: count }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = (6 + Math.random() * 12) * dpr;
    return {
      x: ox, y: oy,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v - 8 * dpr,
      w: (6 + Math.random() * 8) * dpr, h: (8 + Math.random() * 10) * dpr,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
      c: palette[Math.floor(Math.random() * palette.length)],
      shape: Math.random() < 0.25 ? 'note' : 'rect',
    };
  });
  const start = performance.now();
  const frame = (now) => {
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.35 * dpr;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, 1 - t / duration);
      ctx.fillStyle = p.c;
      if (p.shape === 'note') {
        ctx.font = `${p.h * 2}px serif`;
        ctx.fillText('♪', 0, 0);
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

// Emoji that float up from a point (reactions, little rewards).
export function floatEmoji(emoji, x, y, { size = 42, rise = 160, ms = 1400 } = {}) {
  const el = document.createElement('div');
  el.textContent = emoji;
  el.style.cssText = `position:fixed;left:${x}px;top:${y}px;font-size:${size}px;pointer-events:none;z-index:500;transform:translate(-50%,-50%);transition:transform ${ms}ms cubic-bezier(.2,.7,.3,1), opacity ${ms}ms`;
  document.body.append(el);
  requestAnimationFrame(() => {
    const dx = (Math.random() - 0.5) * 80;
    el.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% - ${rise}px)) scale(1.3) rotate(${dx / 4}deg)`;
    el.style.opacity = '0';
  });
  setTimeout(() => el.remove(), ms + 50);
}
