/*
 * Echo: the song sings a line, then the class sings it back over the same
 * music with the melody switched off - the classic way to teach a song.
 * Recordings do the same with their karaoke version; without one, the music
 * waits while the class sings.
 */
import { h, clear } from '../ui.js';
import { lineEl, paintLine } from './karaoke.js';
import { setupCard, choiceRow } from './common.js';
import { sfx } from '../sfx.js';

export async function start(ctx) {
  const { track, timeline, main } = ctx;
  const synth = track.kind === 'synth';
  const kar = !synth && !!track.hasKaraoke;
  if (kar) track.setSinger(true);
  const conf = { chunk: 1, music: true };
  const lines = timeline.lines.filter((l) => !l.instrumental);

  const card = setupCard({
    emoji: '🔁',
    title: 'Echo',
    intro: 'Listen to a line, then sing it back! Great for learning a new song. The class sings over the music with the melody turned off.',
    body: h('div', null,
      h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Echo'),
        choiceRow([[1, 'Line by line'], [2, 'Two lines at a time']], conf.chunk, (v) => { conf.chunk = v; })),
      synth ? h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Your turn'),
        choiceRow([[true, '🎹 With the band'], [false, '🗣️ Voices only']], conf.music, (v) => { conf.music = v; })) : null,
      kar ? h('div', { class: 'setup-row' }, h('span', { class: 'setup-label' }, 'Your turn'),
        choiceRow([[true, '🎤 Over the karaoke version'], [false, '🗣️ Voices only']], conf.music, (v) => { conf.music = v; })) : null,
    ),
    onStart: () => { card.destroy(); run(); },
  });
  clear(main).append(card);
  ctx.addCleanup(() => card.destroy());

  let gen = 0;
  let raf = 0;
  ctx.addCleanup(() => {
    gen += 1;
    cancelAnimationFrame(raf);
    if (synth) { track.setMute('lead', false); track.setMute('comp', false); track.setMute('bass', false); track.setMute('drums', false); track.setMute('pad', false); }
    if (kar) track.setMute('lead', false);
  });

  function run() {
    const phase = h('div', { class: 'echo-phase' });
    const box = h('div', { class: 'k-lines' });
    const pic = h('div', { class: 'k-pic' });
    const count = h('div', { class: 'echo-count small' });
    clear(main).append(h('div', { class: 'karaoke echo' }, phase, pic, box, count));
    let chunkEls = [];
    let virtualT = null;
    let curIdx = 0;

    const show = (group) => {
      clear(box);
      chunkEls = group.map((l) => lineEl(l));
      box.append(...chunkEls);
      pic.textContent = group[0].pic && ctx.settings.showPics !== false ? group[0].pic : '';
    };
    const loop = () => {
      const t = virtualT !== null ? virtualT() : track.time();
      for (const el of chunkEls) paintLine(el, t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const playSpan = (from, to) => new Promise((resolve) => {
      const my = gen;
      track.setBarrier(to);
      const off = track.on('barrier', () => { off(); resolve(my === gen); });
      track.seek(Math.max(0, from));
      track.play(synth ? { preroll: from < 0.5 ? 0 : timeline.meter || 4 } : {});
    });

    const mute = (on) => {
      if (!synth && !kar) return;
      track.setMute('lead', on);
      if (synth && !conf.music) ['comp', 'bass', 'pad'].forEach((b) => track.setMute(b, on));
    };

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    async function go(startIdx) {
      const my = ++gen;
      for (let i = startIdx; i < lines.length; i += conf.chunk) {
        curIdx = i;
        const group = lines.slice(i, i + conf.chunk);
        const from = group[0].start;
        const to = group[group.length - 1].singEnd + 0.15;
        count.textContent = `Line ${i + 1} of ${lines.length}`;
        show(group);
        // 1. Listen.
        phase.className = 'echo-phase listen';
        phase.textContent = '👂 Listen…';
        mute(false);
        if (!(await playSpan(from, to)) || my !== gen) return;
        // 2. Your turn.
        phase.className = 'echo-phase sing';
        phase.textContent = '🎤 Your turn!';
        sfx('pop', { volume: 0.3 });
        if (synth || (kar && conf.music)) {
          mute(true);
          if (!(await playSpan(from, to)) || my !== gen) return;
          mute(false);
        } else {
          track.pause();
          const t0 = performance.now();
          virtualT = () => from + (performance.now() - t0) / 1000;
          await wait((to - from) * 1000 + 300);
          virtualT = null;
          if (my !== gen) return;
        }
        await wait(250);
        if (my !== gen) return;
      }
      phase.textContent = '';
      ctx.finish({ emoji: '🦜', title: 'Great echo!', text: 'Now sing the whole song in Karaoke!', stars: 3 });
    }

    // ←/→ jump between lines.
    ctx.onKey((e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return false;
      const step = e.key === 'ArrowRight' ? conf.chunk : -conf.chunk;
      track.pause();
      go(Math.max(0, Math.min(lines.length - 1, curIdx + step)));
      return true;
    });
    go(0);
  }
}
