/*
 * The built-in songbook. Each song is a module in this folder; see
 * js/music/score.js for the notation.
 */
import twinkle from './twinkle.js';
import rowYourBoat from './row-your-boat.js';
import brotherJohn from './brother-john.js';
import maryLamb from './mary-lamb.js';
import oldMacdonald from './old-macdonald.js';
import londonBridge from './london-bridge.js';
import happyBirthday from './happy-birthday.js';
import jingleBells from './jingle-bells.js';
import thisOldMan from './this-old-man.js';
import wheelsOnTheBus from './wheels-on-the-bus.js';
import odeToFriends from './ode-to-friends.js';
import whatDidYouDo from './what-did-you-do.js';
import helloSong from './hello-song.js';
import goodbyeSong from './goodbye-song.js';

export const BUILTIN_SONGS = [
  helloSong,
  whatDidYouDo,
  odeToFriends,
  twinkle,
  rowYourBoat,
  brotherJohn,
  oldMacdonald,
  wheelsOnTheBus,
  thisOldMan,
  maryLamb,
  londonBridge,
  happyBirthday,
  jingleBells,
  goodbyeSong,
].map((s) => ({ ...s, source: 'band', builtin: true }));
