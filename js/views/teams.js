/*
 * Teams: names, mascots and scores. The scoreboard chips show on the stage;
 * click a chip for +1, right-click (or long-press) for -1.
 *
 * Optional student names inside each team (team.members; team.next is who
 * answers on the team's next turn, js/games/turns.js whoAnswers). They are
 * kept in this browser only, like the rest of the teams.
 */
import { h, clear, openModal, toast } from '../ui.js';
import { getTeams, setTeams, teamPresets, onTeams, addPoints } from '../store.js';
import { parseNames, makeTeams, whoAnswers } from '../games/turns.js';
import { sfx, confetti } from '../sfx.js';

const EMOJIS = ['🎸', '🐼', '🐱', '🦖', '🐰', '🦉', '🦄', '🐸', '🦊', '🐙', '🚀', '⚡', '🌈', '🍕', '👑', '🎺', '🥁', '🎻', '🐝', '🐯'];

export function openTeamsDialog() {
  const box = h('div', { class: 'teams-dialog' });
  let teams = getTeams();
  // A game may change the turn or a score while this is open (the thinking
  // time runs on): change the latest teams, not a copy from when it opened.
  const update = (fn, redraw = true) => {
    teams = getTeams();
    fn(teams);
    setTeams(teams);
    if (redraw) draw();
  };
  const byId = (ts, id) => ts.list.find((x) => x.id === id);
  let studentsOpen = teams.list.some((t) => t.members?.length);
  let spinning = false;

  const draw = () => {
    clear(box);
    const turn = (teams.turn || 0) % Math.max(1, teams.list.length);
    box.append(
      h('h2', null, '👥 Teams'),
      h('p', { class: 'small' }, 'Play in teams to keep score in every game. On the stage, click a team for +1 point, right-click for -1.'),
      h('label', { class: 'inline' },
        h('input', { type: 'checkbox', checked: teams.on, onchange: (e) => update((ts) => { ts.on = e.target.checked; }) }),
        'Play in teams'),
    );
    const list = h('div', { class: 'team-edit-list' });
    const rows = teams.list.map((t, i) => {
      const who = whoAnswers(t);
      const row = h('div', { class: `team-edit${i === turn ? ' next' : ''}`, style: { '--team-hue': t.hue } },
        h('button', { class: 'btn icon-btn', type: 'button', title: 'Change mascot', onclick: () => update((ts) => {
          const team = byId(ts, t.id);
          team.emoji = EMOJIS[(EMOJIS.indexOf(team.emoji) + 1) % EMOJIS.length];
        }) }, t.emoji),
        h('input', { type: 'text', value: t.name, maxlength: 24, 'aria-label': 'Team name', oninput: (e) => update((ts) => { byId(ts, t.id).name = e.target.value; }, false) }),
        h('input', { type: 'color', value: hslToHex(t.hue), title: 'Colour', onchange: (e) => update((ts) => { byId(ts, t.id).hue = hexToHue(e.target.value); }) }),
        h('input', { class: 'team-score', type: 'number', value: t.score || 0, title: 'Score', 'aria-label': 'Score', onchange: (e) => update((ts) => { byId(ts, t.id).score = Number(e.target.value) || 0; }, false) }),
        h('span', { class: 'team-turns', title: 'Turns taken' }, `${t.turns || 0} ${t.turns === 1 ? 'turn' : 'turns'}`),
        h('button', { class: 'btn icon-btn', type: 'button', title: 'Remove team', disabled: teams.list.length <= 1, onclick: () => update((ts) => {
          const k = ts.list.findIndex((x) => x.id === t.id);
          ts.list.splice(k, 1);
          const now = ts.turn || 0;
          ts.turn = ((k < now ? now - 1 : now) % ts.list.length + ts.list.length) % ts.list.length;
        }) }, '✕'),
        i === turn && teams.on ? h('span', { class: 'team-next-tag' }, who ? `▶ next: ${who}` : '▶ next') : null,
      );
      list.append(row);
      return row;
    });
    box.append(list);
    const spinBtn = h('button', { class: 'btn', type: 'button', title: 'Pick the team that starts at random', disabled: teams.list.length < 2 || spinning, onclick: () => {
      spinning = true;
      spinBtn.disabled = true;
      spinTeams(rows, (pick) => {
        spinning = false;
        update((ts) => { ts.turn = pick; });
        const t = getTeams().list[pick];
        if (t) toast(`🎲 ${t.emoji} ${t.name} starts!`, '', 1800);
      });
    } }, '🎲 Who starts');
    box.append(h('div', { class: 'row top-space' },
      h('button', { class: 'btn', type: 'button', disabled: teams.list.length >= 6, onclick: () => update((ts) => {
        const used = new Set(ts.list.map((t) => t.name));
        const preset = teamPresets().find((p) => !used.has(p.name)) || { name: `Team ${ts.list.length + 1}`, emoji: EMOJIS[ts.list.length], hue: (ts.list.length * 67) % 360 };
        ts.list.push({ id: `t${Date.now().toString(36)}`, ...preset, score: 0 });
        ts.on = true;
      }) }, '➕ Add team'),
      spinBtn,
      h('button', { class: 'btn', type: 'button', title: 'Scores and turns back to 0; the first team starts', onclick: () => update((ts) => { ts.list.forEach((t) => { t.score = 0; t.turns = 0; t.next = 0; }); ts.turn = 0; }) }, '↺ Reset scores'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn primary', type: 'button', onclick: () => { m.close(); showPodium(); } }, '🏆 Show winner'),
    ));
    box.append(studentsBox());
  };

  // Students (optional): paste the class list and share it out, or type the
  // names under each team. On its own turn a team's students take turns.
  const studentsBox = () => {
    const roster = h('textarea', { rows: 4, placeholder: 'One name per line (or separated by commas)', 'aria-label': 'Class list' }, teams.roster || '');
    roster.addEventListener('input', () => update((ts) => { ts.roster = roster.value; }, false));
    const make = () => {
      const names = parseNames(roster.value);
      if (!names.length) { toast('Paste the class list first.', 'bad', 2200); roster.focus(); return; }
      update((ts) => {
        ts.roster = roster.value;
        makeTeams(names, ts.list.length).forEach((members, i) => { ts.list[i].members = members; ts.list[i].next = 0; });
      });
      sfx('pop', { volume: 0.4 });
    };
    const per = h('div', { class: 'team-members-list' }, teams.list.map((t) => h('label', { class: 'team-members', style: { '--team-hue': t.hue } },
      h('span', { class: 'tm-team' }, `${t.emoji} ${t.name}`),
      h('input', { type: 'text', value: (t.members || []).join(', '), placeholder: 'Names, separated by commas', 'aria-label': `${t.name}: students`,
        oninput: (e) => update((ts) => { const team = byId(ts, t.id); team.members = parseNames(e.target.value); team.next = 0; }, false) }))));
    const details = h('details', { class: 'team-students', open: studentsOpen },
      h('summary', null, '🧑‍🎓 Students (optional)'),
      h('p', { class: 'small' }, 'Paste your class list and 🔀 Make teams shares the names out at random, or type the names under each team. On its own turn each team\'s students answer one after another; steals are for the whole team. The names stay on this computer.'),
      roster,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: make }, '🔀 Make teams'),
        h('button', { class: 'btn', type: 'button', disabled: !teams.list.some((t) => t.members?.length) && !teams.roster, onclick: () => update((ts) => { ts.roster = ''; ts.list.forEach((t) => { delete t.members; delete t.next; }); }) }, '🗑️ Clear names')),
      per);
    details.addEventListener('toggle', () => { studentsOpen = details.open; });
    return details;
  };
  draw();
  const m = openModal(box);
}

// 🎲 Who starts: a light runs round the teams and slows down on one.
export function spinTeams(els, onPick) {
  const n = els.length;
  if (!n) return;
  const pick = Math.floor(Math.random() * n);
  const steps = n * 2 + pick;
  let k = 0;
  const tick = () => {
    els.forEach((el, j) => el.classList.toggle('spin', j === k % n));
    if (k >= steps) {
      sfx('correct', { volume: 0.4 });
      setTimeout(() => { els.forEach((el) => el.classList.remove('spin')); onPick(pick); }, 600);
      return;
    }
    sfx('tick', { volume: 0.25 });
    k += 1;
    setTimeout(tick, 45 + 320 * (k / steps) ** 2);
  };
  tick();
}

export function showPodium() {
  const teams = getTeams();
  const ranked = teams.list.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const top = ranked[0];
  const tie = ranked.length > 1 && ranked[1].score === top.score;
  // Songs don't share out evenly between teams: show who had more turns.
  const turnsShown = teams.list.some((t) => t.turns);
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
      h('ol', { class: 'podium-list' }, ranked.map((t) => h('li', { style: { '--team-hue': t.hue } }, h('span', null, `${t.emoji} ${t.name}`),
        h('span', null, h('b', null, String(t.score || 0)), turnsShown ? h('span', { class: 'podium-turns' }, ` · ${t.turns || 0} ${t.turns === 1 ? 'turn' : 'turns'}`) : null)))),
    );
    confetti({ count: 220 });
    if (drum) drum.pause();
  }, 2600);
  return m;
}

// Chips for the stage header; keeps itself up to date. glow(teams): light up
// the team whose turn it is (in games that take turns).
export function teamStrip({ glow = () => false } = {}) {
  const el = h('div', { class: 'team-strip' });
  const draw = (teams = getTeams(), detail = {}) => {
    clear(el);
    if (!teams.on) {
      el.append(h('button', { class: 'btn btn-sm', type: 'button', title: 'Teams (T)', onclick: () => openTeamsDialog() }, '👥'));
      return;
    }
    teams.list.forEach((t, i) => {
      const chip = h('button', {
        class: `team-chip${detail.bump === t.id ? ' bump' : ''}${(teams.turn || 0) % teams.list.length === i && glow(teams) ? ' turn' : ''}`,
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
