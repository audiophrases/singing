/*
 * The games and activities. Each one is a module in this folder exporting
 * start(ctx) - see js/views/stage.js for what ctx holds.
 *
 * needs: 'notes' - songs whose melody is known: the built-in band's, or an
 *                 UltraStar file imported in the Studio
 *        'round' - songs written as rounds
 *        'lines:N' - at least N sung lines
 * mic: uses the microphone.
 */
export const GAMES = [
  { id: 'karaoke', name: 'Karaoke', emoji: '🎤', group: 'Sing', desc: 'Big lyrics that light up as you sing, with a bouncing ball, pictures and a loudness meter.' },
  { id: 'echo', name: 'Echo', emoji: '🔁', group: 'Sing', desc: 'The song sings a line, then the class sings it back. The best way to learn a new song.' },
  { id: 'round', name: 'Round', emoji: '🌀', group: 'Sing', desc: 'Split the class into groups that start one after another.', needs: 'round' },
  { id: 'pitch', name: 'Pitch Pal', emoji: '🎯', group: 'Sing', desc: 'Sing into the microphone and hit the notes. Stars for every singer.', needs: 'notes', mic: true },
  { id: 'gapfill', name: 'Fill the gaps', emoji: '⌨️', group: 'Listen', desc: 'The music waits at the end of each line until the missing words are typed.' },
  { id: 'choose', name: 'Choose the word', emoji: '🔘', group: 'Listen', desc: 'Pick the word you hear from three options. Great for beginners.' },
  { id: 'wrongword', name: 'Wrong word', emoji: '🕵️', group: 'Listen', desc: 'One word in each line is wrong. Spot it while you listen!' },
  { id: 'order', name: 'Line order', emoji: '🧩', group: 'Listen', desc: 'The lines are mixed up. Put them in order while the song plays.', needs: 'lines:4' },
  { id: 'bingo', name: 'Lyrics bingo', emoji: '🎱', group: 'Listen', desc: 'Bingo cards with words from the song, on paper or on phones.' },
  { id: 'finish', name: 'Finish the line', emoji: '🛑', group: 'Play', desc: 'The music stops before the end of a line. Which team remembers the words?' },
  { id: 'builder', name: 'Line builder', emoji: '🧱', group: 'Play', desc: 'Tap the words of each line in the right order before the song gets there.' },
  { id: 'hotmic', name: 'Hot mic', emoji: '🔥', group: 'Play', desc: 'Pass the mic while the music plays. When it stops, the holder answers a card.' },
  { id: 'freeze', name: 'Freeze dance', emoji: '🧊', group: 'Play', desc: 'Dance and do the actions on the screen. When the music stops: freeze!' },
  { id: 'rhyme', name: 'Rhyme memory', emoji: '🃏', group: 'Words', desc: 'Turn the cards and find words that rhyme.' },
  { id: 'hunt', name: 'Grammar hunt', emoji: '🔎', group: 'Words', desc: 'Find all the past verbs, plurals, adjectives... hidden in the lyrics.' },
  { id: 'speak', name: 'Say it!', emoji: '🗣️', group: 'Words', desc: 'Say a line into the microphone; every word turns green or red.', mic: true },
  { id: 'quiz', name: 'Song quiz', emoji: '❓', group: 'Words', desc: 'Quick questions about words, rhymes and meaning, made from the song.' },
];

export const GROUPS = [
  { id: 'Sing', name: 'Sing', emoji: '🎤' },
  { id: 'Listen', name: 'Listen', emoji: '👂' },
  { id: 'Play', name: 'Play', emoji: '🎲' },
  { id: 'Words', name: 'Words', emoji: '🔤' },
];

export function gameById(id) {
  return GAMES.find((g) => g.id === id) || null;
}

export function gameFits(game, song, sungLineCount) {
  if (!game.needs) return true;
  if (game.needs === 'notes') return !song.source || song.source === 'band' || hasNotes(song);
  if (game.needs === 'round') return !!song.round && (!song.source || song.source === 'band');
  const m = /^lines:(\d+)$/.exec(game.needs);
  if (m) return sungLineCount >= Number(m[1]);
  return true;
}

export function hasNotes(song) {
  return (song.synced || []).some((l) => Array.isArray(l.notes) && l.notes.some((n) => Number.isFinite(n[2])));
}

export function loadGame(id) {
  return import(`./${id}.js`);
}
