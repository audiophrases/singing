/*
 * makeTrack(song): the right player for a song.
 *   band    -> SynthTrack (built-in band, notes in the song)
 *   youtube -> YouTubeTrack (video + synced lyrics)
 *   audio   -> AudioTrack (an mp3 the teacher added, kept in this browser)
 *   none    -> ClockTrack (lyrics only: a clock that walks through them)
 */
import { SynthTrack } from './music/player.js';
import { getSettings } from './store.js';

export async function makeTrack(song, opts = {}) {
  const settings = getSettings();
  if (!song.source || song.source === 'band') {
    return new SynthTrack(song, { guide: opts.guide !== undefined ? opts.guide : settings.guide, style: opts.style, rate: opts.rate, transpose: opts.transpose });
  }
  if (song.source === 'youtube') {
    const { YouTubeTrack } = await import('./media/youtube.js');
    const t = new YouTubeTrack(song, opts);
    await t.ready;
    return t;
  }
  if (song.source === 'audio') {
    const { AudioTrack } = await import('./media/audio.js');
    const prepared = song.cloud ? await (await import('./cloud/library.js')).playbackSong(song) : song;
    const t = new AudioTrack(prepared, opts);
    await t.ready;
    return t;
  }
  const { ClockTrack } = await import('./media/clock.js');
  return new ClockTrack(song, opts);
}

export function isBand(track) {
  return track && track.kind === 'synth';
}
