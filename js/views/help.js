/*
 * Help: how to use Singing in class.
 */
import { h } from '../ui.js';
import { GAMES } from '../games/index.js';
import { getSettings, setSettings } from '../store.js';
import { VOICES } from '../tts.js';

export async function render(el) {
  const s = getSettings();
  const voice = h('select', { style: { width: 'auto' } }, VOICES.map(([v, name]) => h('option', { value: v, selected: v === s.ttsVoice }, name)));
  voice.addEventListener('change', () => setSettings({ ttsVoice: voice.value }));
  const sfxBox = h('input', { type: 'checkbox', checked: s.sfx });
  sfxBox.addEventListener('change', () => setSettings({ sfx: sfxBox.checked }));
  const backend = h('input', { type: 'url', value: s.backend, placeholder: 'https://api.pinplay.win' });
  backend.addEventListener('change', () => setSettings({ backend: backend.value.trim() }));
  el.append(
    h('section', { class: 'card help' },
      h('h1', { class: 'page-title' }, '🎤 How Singing works'),
      h('p', null, 'Singing is a free toolbox for songs in the English class. Everything runs in the browser: no accounts, no ads, nothing uploaded.'),
      h('h2', null, '1. Pick a song'),
      h('p', null, 'The built-in songs are played by Singing\'s own band, so you can change the speed (slow down to learn!), the key (to suit the voices) and even the style - try Twinkle Twinkle as reggae. The robot singer sings the melody; switch it off for real karaoke.'),
      h('h2', null, '2. Choose an activity'),
      h('ul', null, GAMES.map((g) => h('li', null, h('b', null, `${g.emoji} ${g.name}: `), g.desc))),
      h('h2', null, '3. Bring your own songs'),
      h('p', null, 'In the Studio, paste the lyrics of any song and link a YouTube video or add an audio file, then tap along to sync the lines. Or use the Song maker: type any text and Singing composes a tune for it. Share any song with a link.'),
      h('p', null, 'Got the song as an mp3 and a lyrics file? Drop both on the Studio. It reads UltraStar (.txt), LRC, SRT and WebVTT files, so the lines arrive already in time; if they are all a little early or late (another version of the song, a video with a longer intro), move them together or tap once to align. UltraStar files also have every note of the melody, so Pitch Pal can score real songs too, and Singing lines them up with your audio file by itself (🪄 Auto-align).'),
      h('p', null, 'Add the karaoke version too (the same recording without the singer: an official instrumental, or your file through a vocal remover) and Karaoke plays it so the class is the singer, Echo plays it for “your turn”, and Pitch Pal can play it instead of the song. The 🎤 Singer knob switches between the two at any time.'),
      h('h2', null, 'On the projector'),
      h('p', null, h('kbd', null, 'Space'), ' play/pause · ', h('kbd', null, '←'), ' ', h('kbd', null, '→'), ' previous/next line · ', h('kbd', null, 'F'), ' full screen · ', h('kbd', null, 'T'), ' teams · ', h('kbd', null, 'W'), ' show the winner · ', h('kbd', null, 'H'), ' hide the controls · ', h('kbd', null, 'Esc'), ' back'),
      h('p', null, 'Teams: click a team on the stage for +1 point, right-click for -1. Most games give points to the team whose turn it is.'),
      h('h2', null, 'Settings'),
      h('label', null, 'Voice for words and lines (PinPlay neural voices)'), voice,
      h('label', { class: 'inline top-space' }, sfxBox, 'Sound effects'),
      h('label', null, 'PinPlay server (for neural voices)'), backend,
      h('p', { class: 'small' }, 'Singing borrows PinPlay\'s voice service when it can; otherwise it uses the browser\'s own voice. Microphone games (Pitch Pal, Say it!, the loudness meter) work best in Chrome or Edge.'),
    ),
  );
  return null;
}
