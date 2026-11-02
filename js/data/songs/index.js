/*
 * The starter songbook. Each song is a module in this folder; see
 * js/music/score.js for the notation. Teachers get a copy of every starter
 * song in their cloud library (js/cloud/starters.js), where it is an ordinary
 * song they can edit or delete. The public player shows these originals.
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

export const STARTER_SONGS = [
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
].map((s) => ({ ...s, source: 'band', starter: true }));
