/*
 * ClockTrack: no music at all, just time passing through the lyrics - for
 * songs the teacher sings or plays on the guitar, or poems and chants.
 */
import { PolledTrack } from './base.js';

export class ClockTrack extends PolledTrack {
  constructor(song) {
    super(song);
    this.kind = 'clock';
    this.pos = 0;
    this.t0 = 0;
  }

  get ready() { return Promise.resolve(); }

  time() {
    if (!this.playing) return this.pos;
    return this.pos + ((performance.now() - this.t0) / 1000) * this.rate;
  }

  async rawPlay() { this.t0 = performance.now(); }

  rawPause() { this.pos = this.time(); }

  rawSeek(sec) {
    this.pos = sec;
    this.t0 = performance.now();
  }

  rawRate(r) {
    this.pos = this.time();
    this.t0 = performance.now();
    return r;
  }
}
