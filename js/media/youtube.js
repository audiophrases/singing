/*
 * YouTubeTrack: a YouTube video with lyrics synced to it. The video sits in
 * a small window in the corner (YouTube needs it visible); the stage can
 * make it big behind the lyrics.
 */
import { PolledTrack } from './base.js';
import { h } from '../ui.js';

let apiPromise = null;

export function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev();
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiPromise = null; reject(new Error('YouTube could not be reached. Check the internet connection.')); };
    document.head.append(s);
    setTimeout(() => reject(new Error('YouTube is taking too long to load.')), 15000);
  });
  return apiPromise;
}

export function youtubeId(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1, 12);
    if (u.searchParams.get('v')) return u.searchParams.get('v').slice(0, 11);
    const m = /\/(embed|shorts|live)\/([\w-]{11})/.exec(u.pathname);
    if (m) return m[2];
  } catch { /* not a URL */ }
  return '';
}

let dock = null;

export function videoDock() {
  if (!dock) {
    dock = h('div', { class: 'yt-dock', id: 'ytDock' },
      h('div', { class: 'yt-dock-bar' },
        h('span', null, '▶ YouTube'),
        h('button', { class: 'yt-dock-btn', type: 'button', title: 'Bigger / smaller', onclick: () => dock.classList.toggle('big') }, '⤢')),
      h('div', { class: 'yt-dock-slot' }));
    document.body.append(dock);
  }
  return dock;
}

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export class YouTubeTrack extends PolledTrack {
  constructor(song) {
    super(song);
    this.kind = 'youtube';
    this.videoId = (song.youtube && song.youtube.id) || '';
    this.lastT = 0;
    this.lastPerf = 0;
    this.ready = this.load();
  }

  async load() {
    if (!this.videoId) throw new Error('This song has no YouTube video.');
    const YT = await loadYouTubeApi();
    const d = videoDock();
    d.classList.remove('hidden');
    const slot = d.querySelector('.yt-dock-slot');
    slot.innerHTML = '';
    const target = h('div');
    slot.append(target);
    await new Promise((resolve, reject) => {
      this.player = new YT.Player(target, {
        videoId: this.videoId,
        width: '100%',
        height: '100%',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, controls: 1, start: Math.floor(this.song.youtube.start || 0) },
        events: {
          onReady: () => resolve(),
          onError: (e) => reject(new Error(e.data === 101 || e.data === 150 ? 'The owner of this video does not allow it to play on other websites. Try another video.' : `YouTube error ${e.data}.`)),
          onStateChange: (e) => this.onState(e.data),
        },
      });
    });
    const dur = this.player.getDuration();
    if (dur) this.timeline.duration = dur;
  }

  onState(state) {
    const YT = window.YT;
    this.sample();
    if (state === YT.PlayerState.PLAYING && !this.playing) {
      // Played from YouTube's own controls.
      this.playing = true;
      this.startPolling();
      this.emit('play');
    } else if (state === YT.PlayerState.PAUSED && this.playing) {
      this.playing = false;
      this.emit('pause');
    } else if (state === YT.PlayerState.ENDED) {
      this.playing = false;
      this.emit('end');
    }
  }

  sample() {
    if (!this.player || !this.player.getCurrentTime) return;
    this.lastT = this.player.getCurrentTime() || 0;
    this.lastPerf = performance.now();
  }

  time() {
    if (!this.player) return 0;
    if (!this.playing) return this.player.getCurrentTime ? this.player.getCurrentTime() || 0 : 0;
    const raw = this.player.getCurrentTime() || 0;
    // getCurrentTime moves in steps; smooth between them.
    if (raw !== this.lastT) { this.lastT = raw; this.lastPerf = performance.now(); }
    return this.lastT + ((performance.now() - this.lastPerf) / 1000) * this.rate;
  }

  async rawPlay() { this.player.playVideo(); this.sample(); }

  rawPause() { if (this.player && this.player.pauseVideo) this.player.pauseVideo(); }

  rawSeek(sec) { this.player.seekTo(sec, true); this.sample(); }

  rawRate(r) {
    const best = RATES.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a), 1);
    this.sample();
    this.player.setPlaybackRate(best);
    return best;
  }

  destroy() {
    super.destroy();
    try { this.player.destroy(); } catch { /* gone */ }
    if (dock) dock.classList.add('hidden');
  }
}
