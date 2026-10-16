/*
 * Background visualizer for the stage: spectrum bars from the band (or a
 * gentle fake one for videos), plus music notes drifting up.
 */
import { getSynth } from './music/synth.js';

export function startViz(canvas, { live = true } = {}) {
  const ctx = canvas.getContext('2d');
  const synth = live ? getSynth() : null;
  const analyser = synth ? synth.analyser : null;
  const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
  const notes = [];
  let raf = 0;
  let W = 0;
  let H = 0;
  let level = 0;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const resize = () => {
    W = canvas.width = Math.floor(canvas.clientWidth * dpr);
    H = canvas.height = Math.floor(canvas.clientHeight * dpr);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const hue = () => Number(getComputedStyle(canvas).getPropertyValue('--hue')) || 245;
  let fakeT = 0;
  let playing = false;

  const frame = () => {
    ctx.clearRect(0, 0, W, H);
    const bars = 64;
    const vals = new Array(bars).fill(0);
    if (analyser && playing) {
      analyser.getByteFrequencyData(data);
      for (let i = 0; i < bars; i += 1) {
        // Log-ish spacing so the bass does not hog the screen.
        const a = Math.floor(Math.pow(i / bars, 1.8) * data.length * 0.6);
        const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / bars, 1.8) * data.length * 0.6));
        let s = 0;
        for (let k = a; k < b; k += 1) s += data[k];
        vals[i] = s / (b - a) / 255;
      }
    } else if (playing) {
      fakeT += 0.04;
      for (let i = 0; i < bars; i += 1) vals[i] = 0.25 + 0.2 * Math.sin(fakeT * 2 + i * 0.4) * Math.sin(fakeT * 0.7 + i * 0.13) + 0.1 * Math.random();
    }
    const avg = vals.reduce((x, y) => x + y, 0) / bars;
    level = level * 0.85 + avg * 0.15;
    const h0 = hue();
    const bw = W / bars;
    for (let i = 0; i < bars; i += 1) {
      const v = vals[i];
      if (v <= 0.01) continue;
      const bh = v * H * 0.33;
      const grad = ctx.createLinearGradient(0, H, 0, H - bh);
      grad.addColorStop(0, `hsla(${h0 + i * 2}, 95%, 60%, 0.55)`);
      grad.addColorStop(1, `hsla(${h0 + 60 + i * 2}, 95%, 70%, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(i * bw + bw * 0.15, H - bh, bw * 0.7, bh);
    }
    // Floating notes, more of them when the music is loud.
    if (playing && Math.random() < 0.04 + level * 0.25) {
      notes.push({
        x: Math.random() * W,
        y: H + 20 * dpr,
        vy: (0.6 + Math.random() * 1.2) * dpr,
        sway: Math.random() * Math.PI * 2,
        size: (16 + Math.random() * 26) * dpr,
        ch: ['♪', '♫', '♩', '♬'][Math.floor(Math.random() * 4)],
        hue: h0 + Math.random() * 90,
      });
    }
    for (let i = notes.length - 1; i >= 0; i -= 1) {
      const n = notes[i];
      n.y -= n.vy * (1 + level * 2);
      n.sway += 0.02;
      const x = n.x + Math.sin(n.sway) * 20 * dpr;
      const alpha = Math.max(0, Math.min(0.5, (n.y / H) * 0.6));
      ctx.fillStyle = `hsla(${n.hue}, 90%, 75%, ${alpha})`;
      ctx.font = `${n.size}px serif`;
      ctx.fillText(n.ch, x, n.y);
      if (n.y < -40) notes.splice(i, 1);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return {
    setPlaying(p) { playing = p; },
    level: () => level,
    stop() { cancelAnimationFrame(raf); ro.disconnect(); },
  };
}
