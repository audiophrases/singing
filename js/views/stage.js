/*
 * The stage: a full-screen dark room for the projector. It loads the song,
 * its player and the chosen game, and gives the game a small toolkit (ctx):
 *
 *   ctx.song, ctx.track, ctx.timeline, ctx.params, ctx.settings
 *   ctx.main            the big centre area (the game draws here)
 *   ctx.setBottom(el)   replace the transport bar (null = default, false = none)
 *   ctx.onKey(fn)       fn(event) -> true when the game used the key
 *   ctx.award(n, opts)  points for the team whose turn it is (if teams are on)
 *   ctx.finish(result)  the end screen with stars
 *   ctx.options(build)  fill the ⚙ menu with the game's settings
 *   ctx.addCleanup(fn)
 */
import { h, clear, typingTarget, toast, modalOpen, openModal } from '../ui.js';
import { getSong, getSettings, getTeams, addPoints, recordPlay, bestScore } from '../store.js';
import { makeTrack } from '../track.js';
import { transportBar, knobsBar, applyKnobs } from '../controls.js';
import { gameById, loadGame, gameFits } from '../games/index.js';
import { teamStrip, openTeamsDialog, showPodium } from './teams.js';
import { startViz } from '../viz.js';
import { sfx, confetti, floatEmoji } from '../sfx.js';
import { lineIndexAt } from '../music/timeline.js';
import { api } from '../cloud/session.js';

export async function render(root, params) {
  let song = getSong(params.id);
  let assignmentRun = null;
  if (params.attempt) {
    try {
      assignmentRun = await api(`/api/attempts/${encodeURIComponent(params.attempt)}`);
      if (assignmentRun.attempt.song_id !== params.id || assignmentRun.attempt.activity !== params.game) throw new Error('This attempt belongs to another activity.');
      if (assignmentRun.attempt.submitted_at) {
        clear(root).append(h('div', { class: 'stage-main' }, h('h2', null, 'Attempt already submitted'), h('a', { class: 'btn', href: `#/assignment/${assignmentRun.attempt.assignment_id}` }, 'Back to assignment')));
        return;
      }
      song = { ...assignmentRun.song, assigned: true, mine: false };
      params = { ...params, ...assignmentRun.settings };
    } catch (e) {
      clear(root).append(h('div', { class: 'stage-main' }, h('p', null, e.message), h('a', { class: 'btn', href: '#/assignments' }, 'Back to assignments')));
      return;
    }
  }
  const game = gameById(params.game);
  clear(root);
  root.className = 'stage';
  if (!song || !game) {
    root.append(h('div', { class: 'stage-main' }, h('p', null, 'Song or game not found.'), h('a', { class: 'btn', href: '#/' }, 'Back')));
    return null;
  }
  document.title = `${game.name} · ${song.title} · Singing`;
  root.style.setProperty('--hue', song.hue ?? 245);

  const cleanups = [];
  const keyHandlers = [];
  const canvas = h('canvas', { class: 'viz', 'aria-hidden': 'true' });
  const main = h('div', { class: 'stage-main' }, h('div', { class: 'stage-loading' }, '🎵'));
  const bottom = h('div', { class: 'stage-bottom' });
  const teams = teamStrip();
  cleanups.push(() => teams.destroy && teams.destroy());

  let optionsBuilder = null;
  const optBtn = h('button', { class: 'btn icon-btn', type: 'button', title: 'Game settings', 'aria-label': 'Game settings', onclick: () => openOptions() }, '⚙️');
  const fsBtn = h('button', { class: 'btn icon-btn', type: 'button', title: 'Full screen (F)', 'aria-label': 'Full screen', onclick: () => toggleFullscreen() }, '⛶');
  const assignmentLink = assignmentRun ? `#/assignment/${assignmentRun.attempt.assignment_id}` : null;
  const back = () => { location.hash = assignmentLink || `#/song/${encodeURIComponent(song.id)}`; };
  const top = h('div', { class: 'stage-top' },
    h('button', { class: 'btn icon-btn', type: 'button', title: 'Back to the song (Esc)', 'aria-label': 'Back', onclick: back }, '✕'),
    h('div', { class: 'stage-title' },
      h('span', { class: 'st-emoji' }, song.emoji || '🎵'),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 'st-name' }, song.title), h('div', { class: 'st-game' }, `${game.emoji} ${game.name}`))),
    teams,
    optBtn,
    fsBtn,
  );
  root.append(canvas, top, main, bottom);

  let track;
  try {
    track = await makeTrack(song);
  } catch (e) {
    clear(main).append(h('p', null, `This song cannot play here: ${e.message}`));
    return null;
  }
  applyKnobs(track, song);
  if (!gameFits(game, song, track.timeline.lines.filter((l) => !l.instrumental).length)) {
    toast('This game does not work with this song.', 'bad');
  }

  const viz = startViz(canvas, { live: track.kind === 'synth' });
  cleanups.push(() => viz.stop());

  // Transport, knobs and visualizer follow whichever track is current.
  let transport = null;
  let defaultBottom = null;
  let trackOffs = [];
  let bottomMode = null;
  const bindTrack = () => {
    trackOffs.forEach((off) => off());
    if (transport) transport.destroy();
    const syncViz = () => viz.setPlaying(track.playing);
    trackOffs = ['play', 'pause', 'end', 'barrier'].map((ev) => track.on(ev, syncViz));
    transport = transportBar(track);
    defaultBottom = h('div', { class: 'row', style: { width: '100%', flexWrap: 'wrap', gap: '.6rem' } }, transport, knobsBar(track, song));
    if (assignmentRun && ['bingo', 'hotmic'].includes(game.id)) defaultBottom.append(h('button', { class: 'btn', type: 'button', onclick: () => ctx.finish({ title: 'Practice complete', text: 'Classroom activity marked complete.' }) }, 'Mark practice complete'));
    if (ctx) ctx.transport = transport;
  };
  cleanups.push(() => { trackOffs.forEach((off) => off()); if (transport) transport.destroy(); });

  const setBottom = (el) => {
    bottomMode = el;
    clear(bottom);
    if (el === false) { bottom.classList.add('hidden'); return; }
    bottom.classList.remove('hidden');
    bottom.append(el || defaultBottom);
  };
  let ctx = null;
  const pendingAnswers = new Map();
  let answerQueue = Promise.resolve();
  bindTrack();
  setBottom(null);

  ctx = {
    song,
    track,
    timeline: track.timeline,
    params,
    assignment: assignmentRun?.attempt || null,
    savedAnswers: assignmentRun?.answers || [],
    reportAnswer(answer) {
      if (!assignmentRun) return;
      pendingAnswers.set(answer.itemId, answer);
      answerQueue = answerQueue.then(async () => {
        const pending = pendingAnswers.get(answer.itemId);
        if (!pending) return;
        await api(`/api/attempts/${params.attempt}/answers`, { method: 'POST', body: pending });
        if (pendingAnswers.get(answer.itemId) === pending) pendingAnswers.delete(answer.itemId);
      }).catch(() => { toast('Progress is waiting to sync. Keep this page open and retry submission if your connection drops.', 'bad', 4500); });
    },
    settings: getSettings(),
    game,
    root,
    main,
    transport,
    viz,
    setBottom,
    addCleanup: (fn) => cleanups.push(fn),
    onKey: (fn) => keyHandlers.push(fn),
    options: (build) => { optionsBuilder = build; },
    award(points, { x, y, team } = {}) {
      const t = getTeams();
      if (t.on && t.list.length) {
        const target = team || t.list[(t.turn || 0) % t.list.length].id;
        addPoints(target, points);
      }
      if (x !== undefined) floatEmoji(points > 0 ? `+${points}` : String(points), x, y, { size: 36 });
    },
    async finish(result) {
      track.pause();
      if (!assignmentRun) { showResult(result); return; }
      try {
        await answerQueue;
        for (const answer of pendingAnswers.values()) await api(`/api/attempts/${params.attempt}/answers`, { method: 'POST', body: answer });
        pendingAnswers.clear();
        const saved = await api(`/api/attempts/${params.attempt}/submit`, { method: 'POST', body: result });
        showResult({ ...result, score: saved.score ?? 0, max: saved.max ?? 0, text: `${result.text || ''} Your assignment result is saved.` });
      } catch (e) {
        clear(main).append(h('div', { class: 'setup-card' }, h('h2', null, 'Result not saved yet'), h('p', null, e.message),
          h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.finish(result) }, 'Retry submission'),
          h('a', { class: 'btn', href: assignmentLink }, 'Back to assignment')));
      }
    },
    restart() { location.hash = assignmentLink || `#/play/${encodeURIComponent(song.id)}/${game.id}?r=${Date.now().toString(36)}`; },
    replaceTrack(next) {
      track.destroy();
      track = next;
      ctx.track = next;
      ctx.timeline = next.timeline;
      bindTrack();
      setBottom(bottomMode);
    },
  };

  function openOptions() {
    const box = h('div');
    box.append(h('h2', null, `${game.emoji} ${game.name}`), h('p', { class: 'small' }, game.desc));
    if (optionsBuilder) box.append(optionsBuilder());
    box.append(h('h3', { style: { marginTop: '1rem', fontSize: '1rem' } }, 'Keyboard'),
      h('p', { class: 'small' }, h('kbd', null, 'Space'), ' play/pause · ', h('kbd', null, '←'), h('kbd', null, '→'), ' lines · ', h('kbd', null, 'F'), ' full screen · ', h('kbd', null, 'T'), ' teams · ', h('kbd', null, 'W'), ' winner · ', h('kbd', null, 'H'), ' hide controls · ', h('kbd', null, 'Esc'), ' back'));
    openModal(box);
  }

  function showResult({ score = 0, max = 0, emoji = '🎉', title = 'Well done!', text = '', stars } = {}) {
    track.pause();
    const ratio = max ? score / max : 1;
    const nStars = stars !== undefined ? stars : ratio >= 0.9 ? 3 : ratio >= 0.6 ? 2 : ratio > 0.2 ? 1 : 0;
    const prev = bestScore(song.id, game.id);
    recordPlay(song.id, game.id, max ? Math.round(ratio * 100) : undefined);
    if (nStars >= 2) { confetti(); sfx('jackpot', { volume: 0.5 }); } else sfx('chest', { volume: 0.5 });
    const overlay = h('div', { class: 'result-overlay' },
      h('div', { class: 'result-card' },
        h('div', { class: 'result-emoji' }, emoji),
        h('h2', null, title),
        h('div', { class: 'result-stars', 'aria-label': `${nStars} stars` }, [0, 1, 2].map((i) => h('span', { class: i < nStars ? 'on' : '' }, '★'))),
        max ? h('div', { class: 'result-score' }, `${score} / ${max}`) : null,
        text ? h('p', null, text) : null,
        prev !== undefined && max ? h('p', { class: 'small' }, `Best before: ${prev}%`) : null,
        h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '1rem' } },
          h('button', { class: 'btn primary btn-lg', type: 'button', onclick: () => ctx.restart() }, assignmentRun ? 'Back to assignment' : '🔁 Play again'),
          h('a', { class: 'btn btn-lg', href: assignmentLink || `#/song/${encodeURIComponent(song.id)}` }, '🎵 Other activities'),
          getTeams().on ? h('button', { class: 'btn btn-lg', type: 'button', onclick: () => showPodium() }, '🏆 Winner') : null,
        ),
      ));
    root.append(overlay);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  const onKey = (e) => {
    if (modalOpen() || typingTarget(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    for (let i = keyHandlers.length - 1; i >= 0; i -= 1) {
      if (keyHandlers[i](e)) { e.preventDefault(); return; }
    }
    const k = e.key.toLowerCase();
    if (e.code === 'Space') { e.preventDefault(); transport.toggle(); return; }
    if (k === 'escape') { back(); return; }
    if (k === 'f') { toggleFullscreen(); return; }
    if (k === 't') { openTeamsDialog(); return; }
    if (k === 'w') { showPodium(); return; }
    if (k === 'h') { root.classList.toggle('stage-hide-controls'); return; }
    if (k === 'arrowright' || k === 'arrowleft') {
      const lines = track.timeline.lines;
      const t = track.time();
      const cur = lineIndexAt(track.timeline, t);
      let target;
      if (k === 'arrowright') target = lines[Math.min(lines.length - 1, cur + 1)];
      else target = cur >= 0 && t - lines[cur].start > 1.5 ? lines[cur] : lines[Math.max(0, cur - 1)];
      if (target) track.seek(Math.max(0, target.start - 0.05));
    }
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));

  // Hide the mouse pointer when it rests on the projector.
  let idle = 0;
  const onMove = () => {
    root.classList.remove('stage-idle');
    clearTimeout(idle);
    idle = setTimeout(() => root.classList.add('stage-idle'), 3000);
  };
  root.addEventListener('mousemove', onMove);
  cleanups.push(() => { clearTimeout(idle); root.removeEventListener('mousemove', onMove); });

  clear(main);
  let gameCleanup = null;
  try {
    const mod = await loadGame(game.id);
    gameCleanup = await mod.start(ctx);
  } catch (e) {
    console.error(e);
    clear(main).append(h('div', { class: 'card', style: { color: '#1c2430' } }, h('h2', null, 'This game could not start'), h('p', { class: 'small' }, String(e.message || e))));
  }

  return () => {
    if (typeof gameCleanup === 'function') {
      try { gameCleanup(); } catch (e) { console.error(e); }
    }
    for (const fn of cleanups.reverse()) {
      try { fn(); } catch (e) { console.error(e); }
    }
    track.destroy();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    root.removeAttribute('style');
    clear(root);
  };
}
