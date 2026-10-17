/*
 * Player controls shared by the song page and the stage: play button,
 * progress bar with a tick per line, and the band's knobs (speed, key,
 * style, guide voice). Knob values are remembered per song for the session.
 * Recordings with a karaoke version get a singer on/off knob instead (not
 * remembered: each game starts with the singer it needs).
 */
import { h, fmtTime } from './ui.js';
import { STYLES, GUIDES } from './music/band.js';
import { transposeChordName } from './music/notes.js';
import { getSettings, setSettings } from './store.js';

const KNOB_KEY = 'singing.knobs.v1';

export const ICONS = {
  play: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/></svg>',
};

export function getKnobs(songId) {
  try {
    const all = JSON.parse(sessionStorage.getItem(KNOB_KEY) || '{}');
    return { rate: 1, transpose: 0, style: '', guide: getSettings().guide, ...(all[songId] || {}) };
  } catch {
    return { rate: 1, transpose: 0, style: '', guide: getSettings().guide };
  }
}

export function setKnobs(songId, patch) {
  try {
    const all = JSON.parse(sessionStorage.getItem(KNOB_KEY) || '{}');
    all[songId] = { ...(all[songId] || {}), ...patch };
    sessionStorage.setItem(KNOB_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

export function applyKnobs(track, song) {
  const k = getKnobs(song.id);
  if (k.rate && k.rate !== 1) track.setRate(k.rate);
  if (track.kind === 'synth') {
    if (k.style && k.style !== track.style) track.setStyle(k.style);
    if (k.transpose) track.setTranspose(k.transpose);
    if (k.guide !== undefined && k.guide !== track.guide) track.setGuide(k.guide);
  }
}

// Play/pause + progress + time. onSeekLine(i) optional.
export function transportBar(track, { onToggle } = {}) {
  const playBtn = h('button', { class: 'btn primary play-btn', type: 'button', title: 'Play / pause (Space)', 'aria-label': 'Play', html: ICONS.play });
  const fill = h('div', { class: 'fill' });
  const bar = h('div', { class: 'progress', role: 'slider', 'aria-label': 'Position', tabindex: '0' }, fill);
  const time = h('span', { class: 'time-label' }, `0:00 / ${fmtTime(track.duration)}`);
  const dur = () => track.duration || 1;
  for (const l of track.timeline.lines) {
    if (l.instrumental) continue;
    bar.append(h('span', { class: 'tick', style: { left: `${(l.start / dur()) * 100}%` } }));
  }
  const toggle = () => {
    if (onToggle) { onToggle(); return; }
    if (track.playing) track.pause(); else track.play();
  };
  playBtn.addEventListener('click', toggle);
  bar.addEventListener('click', (e) => {
    const r = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    track.seek(x * dur());
  });
  const sync = () => {
    playBtn.innerHTML = track.playing ? ICONS.pause : ICONS.play;
    playBtn.setAttribute('aria-label', track.playing ? 'Pause' : 'Play');
  };
  const offs = ['play', 'pause', 'end', 'barrier'].map((ev) => track.on(ev, sync));
  let raf = 0;
  const loop = () => {
    const t = Math.max(0, track.time());
    fill.style.width = `${Math.min(100, (t / dur()) * 100)}%`;
    time.textContent = `${fmtTime(t)} / ${fmtTime(dur())}`;
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  const el = h('div', { class: 'transport' }, playBtn, bar, time);
  el.style.display = 'contents';
  el.destroy = () => { cancelAnimationFrame(raf); offs.forEach((off) => off()); };
  el.toggle = toggle;
  return el;
}

export function knobsBar(track, song) {
  const wrap = h('div', { class: 'knobs' });

  // Speed
  const rateVal = h('span', { class: 'val' }, `${Math.round((track.rate || 1) * 100)}%`);
  const rate = h('input', { type: 'range', min: 50, max: 130, step: 5, value: Math.round((track.rate || 1) * 100), 'aria-label': 'Speed' });
  rate.addEventListener('input', () => { rateVal.textContent = `${rate.value}%`; });
  rate.addEventListener('change', () => {
    const r = Number(rate.value) / 100;
    track.setRate(r);
    setKnobs(song.id, { rate: r });
  });
  wrap.append(h('div', { class: 'knob', title: 'Slower for learning, faster for fun' }, h('span', { class: 'knob-label' }, '🐢 Speed'), rate, rateVal));

  if (track.kind === 'synth') {
    // Key
    const keyName = () => {
      const base = song.key || 'C';
      return `${transposeChordName(base, track.transpose)}${track.transpose ? ` (${track.transpose > 0 ? '+' : ''}${track.transpose})` : ''}`;
    };
    const keyVal = h('span', { class: 'val' }, keyName());
    const step = (d) => {
      track.setTranspose(track.transpose + d);
      keyVal.textContent = keyName();
      setKnobs(song.id, { transpose: track.transpose });
    };
    wrap.append(h('div', { class: 'knob', title: 'Move the song up or down to suit the voices' },
      h('span', { class: 'knob-label' }, '🎚️ Key'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => step(-1), 'aria-label': 'Lower' }, '−'),
      keyVal,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => step(1), 'aria-label': 'Higher' }, '+')));

    // Style
    const styleSel = h('select', { 'aria-label': 'Band style' },
      Object.entries(STYLES).map(([id, s]) => h('option', { value: id, selected: id === track.style }, `${s.emoji} ${s.name}${id === (song.style || 'pop') ? ' ★' : ''}`)),
      h('option', { value: 'none', selected: track.style === 'none' }, '🔇 No band'));
    styleSel.addEventListener('change', () => {
      track.setStyle(styleSel.value);
      setKnobs(song.id, { style: styleSel.value });
    });
    wrap.append(h('div', { class: 'knob', title: 'Play the song in another style' }, h('span', { class: 'knob-label' }, '🎨 Band'), styleSel));

    // Guide voice
    const guideSel = h('select', { 'aria-label': 'Guide melody' },
      Object.entries(GUIDES).map(([id, g]) => h('option', { value: id, selected: id === track.guide }, `${g.emoji} ${g.name}`)),
      h('option', { value: 'off', selected: track.guide === 'off' }, '🙊 Off (karaoke)'));
    guideSel.addEventListener('change', () => {
      track.setGuide(guideSel.value);
      setKnobs(song.id, { guide: guideSel.value });
      if (guideSel.value !== 'off') setSettings({ guide: guideSel.value });
    });
    wrap.append(h('div', { class: 'knob', title: 'Who sings the melody' }, h('span', { class: 'knob-label' }, '🎵 Melody'), guideSel));
  }

  // A recording with a karaoke version: the singer on or off.
  if (track.hasKaraoke) {
    const singerSel = h('select', { 'aria-label': 'Singer' },
      h('option', { value: 'on' }, '🎤 On (the song)'),
      h('option', { value: 'off' }, '🙊 Off (karaoke version)'));
    singerSel.value = track.singer ? 'on' : 'off';
    singerSel.addEventListener('change', () => track.setSinger(singerSel.value === 'on'));
    track.on('change', (e) => { if (e && 'singer' in e) singerSel.value = e.singer ? 'on' : 'off'; });
    wrap.append(h('div', { class: 'knob', title: 'The song, or its karaoke version without the singer' }, h('span', { class: 'knob-label' }, '🎤 Singer'), singerSel));
  }
  return wrap;
}
