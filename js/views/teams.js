/*
 * Teams: names, mascots and scores. The scoreboard chips show on the stage;
 * click a chip for +1, right-click (or long-press) for -1.
 */
import { h, clear, openModal } from '../ui.js';
import { getTeams, setTeams, teamPresets, onTeams, addPoints } from '../store.js';
import { sfx, confetti } from '../sfx.js';

const EMOJIS = ['🎸', '🐼', '🐱', '🦖', '🐰', '🦉', '🦄', '🐸', '🦊', '🐙', '🚀', '⚡', '🌈', '🍕', '👑', '🎺', '🥁', '🎻', '🐝', '🐯'];

export function openTeamsDialog() {
  const box = h('div');
  let teams = getTeams();
  const save = () => setTeams(teams);

  const draw = () => {
    clear(box);
    box.append(
      h('h2', null, '👥 Teams'),
      h('p', { class: 'small' }, 'Play in teams to keep score in every game. On the stage, click a team for +1 point, right-click for -1.'),
      h('label', { class: 'inline' },
        h('input', { type: 'checkbox', checked: teams.on, onchange: (e) => { teams.on = e.target.checked; save(); draw(); } }),
        'Play in teams'),
    );
    const list = h('div', { class: 'team-edit-list' });
    teams.list.forEach((t, i) => {
      const emojiBtn = h('button', { class: 'btn icon-btn', type: 'button', title: 'Change mascot', onclick: () => {
        const idx = (EMOJIS.indexOf(t.emoji) + 1) % EMOJIS.length;
        t.emoji = EMOJIS[idx];
        save();
        draw();
      } }, t.emoji);
      list.append(h('div', { class: 'team-edit', style: { '--team-hue': t.hue } },
        emojiBtn,
        h('input', { type: 'text', value: t.name, maxlength: 24, oninput: (e) => { t.name = e.target.value; save(); } }),
        h('input', { type: 'color', value: hslToHex(t.hue), title: 'Colour', onchange: (e) => { t.hue = hexToHue(e.target.value); save(); draw(); } }),
        h('input', { type: 'number', value: t.score || 0, title: 'Score', style: { width: '5rem' }, onchange: (e) => { t.score = Number(e.target.value) || 0; save(); } }),
        h('button', { class: 'btn icon-btn', type: 'button', title: 'Remove team', disabled: teams.list.length <= 1, onclick: () => { teams.list.splice(i, 1); save(); draw(); } }, '✕'),
      ));
    });
    box.append(list);
    box.append(h('div', { class: 'row top-space' },
      h('button', { class: 'btn', type: 'button', disabled: teams.list.length >= 6, onclick: () => {
        const used = new Set(teams.list.map((t) => t.name));
        const preset = teamPresets().find((p) => !used.has(p.name)) || { name: `Team ${teams.list.length + 1}`, emoji: EMOJIS[teams.list.length], hue: (teams.list.length * 67) % 360 };
        teams.list.push({ id: `t${Date.now().toString(36)}`, ...preset, score: 0 });
        teams.on = true;
        save();
        draw();
      } }, '➕ Add team'),
      h('button', { class: 'btn', type: 'button', onclick: () => { teams.list.forEach((t) => { t.score = 0; }); save(); draw(); } }, '↺ Reset scores'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn primary', type: 'button', onclick: () => { m.close(); showPodium(); } }, '🏆 Show winner'),
    ));
  };
  draw();
  const m = openModal(box);
}

export function showPodium() {
  const teams = getTeams();
  const ranked = teams.list.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const top = ranked[0];
  const tie = ranked.length > 1 && ranked[1].score === top.score;
  const drum = sfx('drumroll', { volume: 0.8 });
  const box = h('div', { class: 'podium' },
    h('h2', null, '🏆 And the winner is...'),
    h('div', { class: 'podium-reveal' }, h('span', { class: 'podium-drum' }, '🥁')),
  );
  const m = openModal(box, { wide: true });
  setTimeout(() => {
    const reveal = box.querySelector('.podium-reveal');
    clear(reveal);
    reveal.append(
      h('div', { class: 'podium-winner', style: { '--team-hue': top.hue } },
        h('div', { class: 'pw-emoji' }, tie ? '🤝' : top.emoji),
        h('div', { class: 'pw-name' }, tie ? 'It\'s a tie!' : top.name),
        h('div', { class: 'pw-score' }, `${top.score || 0} points`)),
      h('ol', { class: 'podium-list' }, ranked.map((t) => h('li', { style: { '--team-hue': t.hue } }, h('span', null, `${t.emoji} ${t.name}`), h('b', null, String(t.score || 0))))),
    );
    confetti({ count: 220 });
    if (drum) drum.pause();
  }, 2600);
  return m;
}

// Chips for the stage header; keeps itself up to date.
export function teamStrip() {
  const el = h('div', { class: 'team-strip' });
  const draw = (teams = getTeams(), detail = {}) => {
    clear(el);
    if (!teams.on) {
      el.append(h('button', { class: 'btn btn-sm', type: 'button', title: 'Teams (T)', onclick: () => openTeamsDialog() }, '👥'));
      return;
    }
    teams.list.forEach((t, i) => {
      const chip = h('button', {
        class: `team-chip${detail.bump === t.id ? ' bump' : ''}${(teams.turn || 0) % teams.list.length === i && teams.showTurn ? ' turn' : ''}`,
        type: 'button',
        style: { '--team-hue': t.hue },
        title: `${t.name}: click +1, right-click -1`,
        onclick: () => { addPoints(t.id, 1); sfx('pop', { volume: 0.4 }); },
        oncontextmenu: (e) => { e.preventDefault(); addPoints(t.id, -1); },
      }, h('span', { class: 'tc-emoji' }, t.emoji), h('span', { class: 'tc-name' }, t.name), h('span', { class: 'tc-score' }, String(t.score || 0)));
      el.append(chip);
    });
  };
  draw();
  const off = onTeams(draw);
  el.destroy = off;
  return el;
}

function hslToHex(hue) {
  const s = 0.8;
  const l = 0.55;
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHue(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let hue;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return Math.round(((hue * 60) + 360) % 360);
}
