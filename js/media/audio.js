/*
 * AudioTrack: an audio file the teacher added (kept in this browser), or a
 * URL. Played through the band's mixer so the visualizer sees it.
 *
 * A song can also have a karaoke version: the same recording without the
 * singer. Both play together, in step, and only one is heard: the knob
 * setSinger(on) and the games' setMute('lead', true) (Echo's "your turn",
 * Pitch Pal's "I know it") switch to the karaoke version, as the band does
 * when its melody is muted. song.karaoke.offset: karaoke time = song time + offset.
 */
import { PolledTrack } from './base.js';
import { getMedia } from './store.js';
import { getSynth, unlockAudio } from '../music/synth.js';

function loadElement(el, src, what) {
  el.src = src;
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error(`This ${what} cannot be played.`)); };
    const cleanup = () => { el.removeEventListener('loadedmetadata', ok); el.removeEventListener('error', bad); };
    el.addEventListener('loadedmetadata', ok);
    el.addEventListener('error', bad);
  });
}

function newElement() {
  const el = new Audio();
  el.preload = 'auto';
  el.preservesPitch = true;
  return el;
}

export class AudioTrack extends PolledTrack {
  constructor(song) {
    super(song);
    this.kind = 'audio';
    this.audio = newElement();
    this.kar = null;
    this.voc = null;
    this.karOffset = Number(song.karaoke && song.karaoke.offset) || 0;
    this.vocOffset = Number(song.vocals?.offset) || 0;
    this.vocalsOnly = false;
    this.singer = true;
    this.leadMuted = false;
    this.objectUrls = [];
    this.lastFix = 0;
    this.ready = this.load();
  }

  async load() {
    const a = this.song.audio || {};
    let src = a.url || '';
    if (a.mediaId) {
      const blob = await getMedia(a.mediaId).catch(() => null);
      if (!blob) throw new Error('The audio file is not on this computer. Open the song in the Studio and add the file again.');
      src = this.urlFor(blob);
    }
    if (!src) throw new Error('This song has no audio file yet.');
    await loadElement(this.audio, src, 'audio file');
    if (Number.isFinite(this.audio.duration)) this.timeline.duration = Math.max(this.timeline.duration, this.audio.duration);
    this.audio.addEventListener('ended', () => {
      if (this.playing) { this.playing = false; this.kar?.pause(); this.voc?.pause(); this.emit('end'); }
    });
    // The karaoke version is a bonus: the song plays without it if it is missing.
    const k = this.song.karaoke;
    const kblob = k && k.mediaId && k.mediaId !== a.mediaId ? await getMedia(k.mediaId).catch(() => null) : null;
    if (kblob) {
      const el = newElement();
      try {
        await loadElement(el, this.urlFor(kblob), 'karaoke version');
        this.kar = el;
      } catch (e) {
        console.warn(e.message);
      }
    }
    const v = this.song.vocals;
    const vblob = v?.mediaId ? await getMedia(v.mediaId).catch(() => null) : null;
    if (vblob) {
      const el = newElement();
      try {
        await loadElement(el, this.urlFor(vblob), 'vocals file');
        this.voc = el;
      } catch (e) {
        console.warn(e.message);
      }
    }
    try {
      const sy = getSynth();
      const route = (el) => {
        const node = sy.ctx.createMediaElementSource(el);
        const gain = sy.ctx.createGain();
        node.connect(gain).connect(sy.master);
        return { node, gain };
      };
      this.main = route(this.audio);
      if (this.kar) this.karNode = route(this.kar);
      if (this.voc) this.vocNode = route(this.voc);
    } catch { /* plays without the visualizer (and switches by volume) */ }
    this.applyVoice(true);
  }

  urlFor(blob) {
    const url = URL.createObjectURL(blob);
    this.objectUrls.push(url);
    return url;
  }

  get duration() { return this.timeline.duration; }

  get hasKaraoke() { return !!this.kar || !!(this.song.audio?.stems && this.voc); }
  get hasVocals() { return !!this.voc; }

  setVocalsOnly(on) {
    this.vocalsOnly = !!on && this.hasVocals;
    this.applyVoice();
    this.emit('change', { vocalsOnly: this.vocalsOnly });
  }

  // The singer on (the song) or off (the karaoke version).
  setSinger(on) {
    this.singer = !!on;
    this.applyVoice();
    this.emit('change', { singer: this.singer });
  }

  // Games mute the "lead" for a moment, like the band's melody.
  setMute(bus, muted) {
    if (bus !== 'lead') return;
    this.leadMuted = !!muted;
    this.applyVoice();
  }

  applyVoice(now = false) {
    const voice = this.singer && !this.leadMuted;
    const solo = this.vocalsOnly && voice;
    const set = (el, ng, on) => {
      if (!el) return;
      if (ng) {
        const t = ng.gain.context.currentTime;
        ng.gain.gain.cancelScheduledValues(t);
        if (now) ng.gain.gain.setValueAtTime(on ? 1 : 0, t);
        else ng.gain.gain.setTargetAtTime(on ? 1 : 0, t, 0.04);
      } else {
        el.volume = on ? 1 : 0;
      }
    };
    if (this.song.audio?.stems) {
      set(this.audio, this.main, !solo);
      set(this.kar, this.karNode, false);
      set(this.voc, this.vocNode, voice);
    } else {
      set(this.audio, this.main, (!this.kar || voice) && !solo);
      set(this.kar, this.karNode, !voice);
      set(this.voc, this.vocNode, solo);
    }
  }

  // Keep the karaoke version where the song is.
  syncKaraoke(force = false) {
    this.syncCompanion(this.kar, this.karOffset, 'lastFix', force);
    this.syncCompanion(this.voc, this.vocOffset, 'lastVocFix', force);
  }

  syncCompanion(k, offset, fixKey, force) {
    if (!k) return;
    const want = this.audio.currentTime + offset;
    if (!this.playing || want < 0 || want >= (k.duration || 0) - 0.05) {
      if (!k.paused) k.pause();
      return;
    }
    if (k.paused) {
      k.currentTime = want;
      k.play().catch(() => {});
      return;
    }
    const now = performance.now();
    if (Math.abs(k.currentTime - want) > 0.06 && (force || now - (this[fixKey] || 0) > 800)) {
      k.currentTime = want;
      this[fixKey] = now;
    }
  }

  poll() {
    super.poll();
    this.syncKaraoke();
  }

  time() { return this.audio.currentTime || 0; }

  async rawPlay() {
    await unlockAudio();
    try { await this.audio.play(); } catch (e) { this.playing = false; throw e; }
    this.syncKaraoke(true);
  }

  rawPause() {
    this.audio.pause();
    if (this.kar) this.kar.pause();
    if (this.voc) this.voc.pause();
  }

  rawSeek(sec) {
    this.audio.currentTime = sec;
    if (this.kar) this.kar.currentTime = Math.max(0, Math.min(sec + this.karOffset, this.kar.duration || 0));
    if (this.voc) this.voc.currentTime = Math.max(0, Math.min(sec + this.vocOffset, this.voc.duration || 0));
  }

  rawRate(r) {
    this.audio.playbackRate = r;
    if (this.kar) this.kar.playbackRate = r;
    if (this.voc) this.voc.playbackRate = r;
    return r;
  }

  destroy() {
    super.destroy();
    for (const n of [this.main, this.karNode, this.vocNode]) if (n) try { n.node.disconnect(); n.gain.disconnect(); } catch { /* ignore */ }
    this.audio.removeAttribute('src');
    if (this.kar) this.kar.removeAttribute('src');
    if (this.voc) this.voc.removeAttribute('src');
    this.objectUrls.forEach((u) => URL.revokeObjectURL(u));
  }
}
