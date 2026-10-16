const verse = (animal, sound, pic, label) => {
  const a = /^[aeiou]/.test(sound) ? 'an' : 'a';
  return [
    { s: label, t: 'Old Mac-Don-ald had a farm,', p: 'A', pic: '👨‍🌾' },
    { t: 'E-I-E-I-O!', p: 'B', pic: '🎶' },
    { t: `And on that farm he had a ${animal},`, p: 'C', pic },
    { t: 'E-I-E-I-O!', p: 'B', pic: '🎶' },
    { t: `With ${a} ${sound}-${sound} here and ${a} ${sound}-${sound} there,`, p: 'D', pic },
    { t: `Here ${a} ${sound}, there ${a} ${sound}, ev-ery-where ${a} ${sound}-${sound}!`, p: 'E', pic },
    { t: 'Old Mac-Don-ald had a farm,', p: 'A', pic: '👨‍🌾' },
    { t: 'E-I-E-I-O!', p: 'B', pic: '🎶' },
  ];
};

export default {
  id: 'old-macdonald',
  title: 'Old MacDonald Had a Farm',
  artist: 'Traditional',
  credit: 'Traditional (USA/UK, early 20th century).',
  level: 'Pre-A1',
  ages: 'kids',
  emoji: '🐄',
  hue: 95,
  grammar: ['Have got / had', 'There is / here, there'],
  themes: ['Animals', 'Farm'],
  vocab: ['farm', 'cow', 'pig', 'duck', 'sheep', 'dog', 'here', 'there', 'everywhere'],
  about: 'Animal sounds are different in every language - ask the class how a pig says "oink" in theirs. Students choose new animals and sounds in Remix.',
  bpm: 126,
  meter: 4,
  key: 'G',
  style: 'country',
  intro: 'G D7',
  phrases: {
    A: { n: 'G4 G G D E E D:2', c: 'G C:2 G:2' },
    B: { n: 'B4 B A A G:4', c: 'G:2 D7:2 G' },
    C: { pk: 1, n: 'D4 G G G D E E D:2', c: 'G C:2 G:2' },
    D: { pk: 1, n: 'D4:.5 D:.5 G:1 G G D:.5 D:.5 G G G:2', c: 'G G' },
    E: { n: 'G4:.5 G:.5 G G:.5 G:.5 G G:.5 G:.5 G:.5 G:.5 G G', c: 'G G' },
  },
  lines: [
    ...verse('cow', 'moo', '🐄', 'Cow'),
    ...verse('pig', 'oink', '🐖', 'Pig'),
    ...verse('duck', 'quack', '🦆', 'Duck'),
    ...verse('sheep', 'baa', '🐑', 'Sheep'),
    ...verse('dog', 'woof', '🐕', 'Dog'),
  ],
};
