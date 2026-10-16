const verse = (a, b, label, pic) => [
  { s: label, t: a, p: 'A', pic },
  { t: `${b}, ${b},`, p: 'B', pic },
  { t: a, p: 'A', pic },
  { t: 'My fair la-dy!', p: 'C', pic: '👸' },
];

export default {
  id: 'london-bridge',
  title: 'London Bridge Is Falling Down',
  artist: 'Traditional',
  credit: 'Traditional English nursery rhyme (17th century).',
  level: 'A1',
  ages: 'kids',
  emoji: '🌉',
  hue: 12,
  grammar: ['Present continuous', 'Future with will', 'Imperatives'],
  themes: ['Cities', 'Building'],
  vocab: ['bridge', 'falling', 'build', 'iron', 'bars', 'bend', 'break', 'stone', 'strong', 'last'],
  about: 'Two students make a bridge with their arms; everyone walks under it and the bridge "falls" on "My fair lady!". Materials: what would you build a bridge with?',
  bpm: 116,
  meter: 4,
  key: 'C',
  style: 'march',
  intro: 'C G7',
  phrases: {
    A: { n: 'G4:1.5 A:.5 G F E F G:2', c: 'C C' },
    B: { n: 'D4 E F:2 E F G:2', c: 'G7 C' },
    C: { n: 'D4:2 G:2 E C:3', c: 'G7 C' },
  },
  lines: [
    ...verse('Lon-don Bridge is fall-ing down,', 'fall-ing down', 'Verse 1', '🌉'),
    ...verse('Build it up with i-ron bars,', 'i-ron bars', 'Verse 2', '🔩'),
    ...verse('I-ron bars will bend and break,', 'bend and break', 'Verse 3', '💥'),
    ...verse('Build it up with stone so strong,', 'stone so strong', 'Verse 4', '🪨'),
    ...verse('Stone so strong will last so long,', 'last so long', 'Verse 5', '🏰'),
  ],
};
