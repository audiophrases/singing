# 🎤 Singing

Songs, karaoke and lyric games for the English class. A sister app to
[PinPlay](https://github.com/audiophrases/pinplay): same look, same "free, no ads,
no sign-up" spirit, and it reuses PinPlay's sound effects, voices and quiz format.

Everything runs in the browser. There is no build step and no server: open
`index.html` from any static host (GitHub Pages, Cloudflare Pages, or
`npm run serve` locally).

## What's inside

### A band in the browser
Built-in songs are written as **lyrics + notes + chords** and played live by a
Web Audio band. Nothing is a recording, so any song can be:

- **slowed down or sped up** (50–130%) with no loss of quality,
- **moved to another key** to suit children's or adults' voices,
- **played in 16 styles**: pop, rock, campfire, lullaby, music box, waltz,
  marching band, reggae, blues shuffle, disco, hip-hop, country, sea shanty,
  reggaeton, 8-bit, just piano or drums only. (Twinkle Twinkle as reggae is a feature.)
- sung by a **robot singer**: a Klatt-style formant synthesizer that sings the real
  words, consonants included. It looks words up in a 16,000-word pronunciation
  dictionary (from CMUdict) and guesses the rest from their spelling. It can also be a flute,
  piano, whistle, synth or bells, or switched off for real karaoke.

All instruments (FM e-piano, Karplus-Strong guitar/ukulele/harp, organ,
accordion, strings, brass, basses, drum kit, claps, stomps...) are synthesized.
An automated pitch-detection check confirms they play in tune.

### The songbook
14 songs to start with, each with level (Pre-A1–A2), grammar focus, key
vocabulary, a picture for every line, and teacher notes:

- **Originals** written for grammar: *What Did You Do Yesterday?* (past simple,
  irregular verbs, with a question-and-answer section), *Ode to Friends* (countries
  and *to be*, on Beethoven's tune), *Hello, Hello, How Are You?* (feelings,
  call and response), *Goodbye, Goodbye* (end-of-class waltz).
- **Traditional / public-domain**: Twinkle Twinkle, Row Row Row Your Boat (with
  the crocodile, lion and polar bear verses), Are You Sleeping Brother John,
  Old MacDonald, The Wheels on the Bus, This Old Man, Mary Had a Little Lamb,
  London Bridge, Happy Birthday, Jingle Bells.

Teachers add their own songs in the **Studio**. Songs can also be made from any
text in the **Song maker** (below).

### 17 activities for every song
| Sing | Listen | Play | Words |
|---|---|---|---|
| 🎤 Karaoke: syllable-by-syllable wipe, bouncing ball, pictures, mic loudness meter | ⌨️ Fill the gaps: LyricsTraining-style, 4 levels or a grammar focus ("only the past verbs") | 🛑 Finish the line: teams shout the ending | 🃏 Rhyme memory, with spoken words |
| 🔁 Echo: the song sings a line, the class sings it back | 🔘 Choose the word | 🧱 Line builder: word order against the clock | 🔎 Grammar hunt: find every past verb, plural, preposition... |
| 🌀 Round: 2–4 groups with panned robot voices | 🕵️ Wrong word: spot the sound-alike intruder | 🔥 Hot mic: musical hot potato with task cards | 🗣️ Say it!: speech recognition checks each word |
| 🎯 Pitch Pal: SingStar-style pitch tracking, any octave | 🧩 Line order | 🧊 Freeze dance: imperatives and freezes | ❓ Song quiz: questions generated from the song |
| | 🎱 Lyrics bingo: phones via QR, printed cards or the projector, all matched by card number with no server | | |

All of them run on a projector stage with **team scores** (click +1, right-click −1),
a winner podium with drumroll and confetti, an audio-reactive visualizer and
keyboard shortcuts (Space, ←/→, F, T, W, H, Esc).

### ✨ Song maker
Type any text, such as a vocabulary list, a grammar rule or your class rules, and
Singing composes a song for it:

1. an English **syllabifier** and stress guesser splits the words,
2. **dynamic programming** places stressed syllables on strong beats,
3. a mood picks the **chord progression** (pop, campfire, calm, rock, minor,
   reggae, march, disco, rap/chant), with V–I cadences at verse ends,
4. the **melody** arches over chord tones and comes home to the tonic, and lines
   with the same shape reuse the same tune so the song is catchy.

🎲 *Another tune* re-rolls it. Made songs work in every game.

### Bring your own songs
- **Studio**: paste lyrics (with `[Chorus]` sections, emoji pictures, `A:`/`B:`
  parts and `| translations`), link a **YouTube** video or add an **audio file**
  (kept in the browser), then **tap along** to sync each line with fine-tuning.
- **Timing files**: drop an mp3 and its lyrics file on the Studio. It reads
  **UltraStar** `.txt` (every syllable's time and pitch, duet parts),
  **LRC** (with `<mm:ss.xx>` word times), **SRT** and **WebVTT** (including
  YouTube's rolling captions). *All lines earlier / later* and *Tap to align*
  fix timing made for another version of the song. Editing the lyrics keeps
  the timing of every line.
- **🪄 Auto-align**: an UltraStar file carries the melody, so Singing listens
  to the audio file (chroma, in the browser, about a second) and moves the
  lyrics to where that melody is sung. It runs by itself on import, and only
  moves anything when the match is clear.
- **Karaoke version**: add the same recording without the singer (an official
  instrumental, or the song through a vocal remover). It is lined up with the
  song automatically (onset correlation) and plays in step with it; the
  🎤 *Singer* knob switches between the two. Karaoke starts with the karaoke
  version, Echo's "your turn" and Pitch Pal's "I know it" use it.
- **Remix**: rewrite any line (new animals, students' names, new verbs). The
  tune bends to fit the new syllables.
- **Share link**: the whole song is compressed into the URL; no server needed.
- **Worksheets**: lyrics, gap fill with word bank, cut-up strips, bingo cards.
- **Export to PinPlay**: a PinPlay quiz (context gaps read aloud, word choice,
  word order, error hunt, rhyme matching) ready to import in PinPlay's builder.

### Real recordings (YouTube or audio file) in the games
| Timing | What works |
|---|---|
| Lines only (tapped, LRC, SRT) | Every game except Pitch Pal and Round. Words inside a line are timed by syllable weight, so Karaoke's wipe and Finish the line's stops are close, not exact. |
| Word times (enhanced LRC, VTT) | The same, with exact word starts. |
| UltraStar | Everything above with exact syllables, plus **Pitch Pal** and auto-align. |
| + karaoke version | Real karaoke, Echo over the music, Pitch Pal without the singer. |

The ideal set for a song is the audio file, its UltraStar `.txt` and its
karaoke version: drop all three on the Studio. A recording cannot change key
or style, so those knobs, Round and Remix stay with the built-in band; without
a karaoke version, Echo's "your turn" pauses the music. YouTube videos cannot
be listened to or swapped, so auto-align and the karaoke version need audio
files. Audio files stay in the browser that added them: keep copyrighted
recordings out of this repository, since the site is public.

## Reused from PinPlay
- Visual language: tokens, buttons, cards, Inter, the purple `#605dff`.
- Sound effects (correct / wrong / drumroll / jackpot) and the Lottie assets.
- PinPlay's Edge TTS endpoint for neural voices (falls back to the browser's voice).
- PinPlay's quiz JSON format for the export.
- The QR-join idea for phones.

PinPlay itself is not modified.

## Develop

```bash
npm test          # node --test: parser, band, every song, lyric tools, composer
npm run serve     # http://localhost:8080
```

```
index.html, css/singing.css
js/main.js            router (#/, #/song/<id>, #/play/<id>/<game>, #/studio, #/chant, ...)
js/music/             notes, score (song format), synth, band (styles), player, composer, timeline
js/media/             YouTube, audio file and lyrics-only players (same interface as the band), timing files, auto-align
js/lyrics/            word lists, grammar spotter, rhymes, syllables, phonemes (robot singer), gaps & distractors, bingo, Studio lyrics format
js/games/             one module per activity
js/views/             library, song, stage, studio, song maker, remix, print, party, help, card
js/data/songs/        the songbook
lab/karaoke.html      prototype: make a karaoke version in the browser (Demucs v4 on WebGPU, js/media/separate*.js);
                      can watch a folder and make every new song (js/media/folder-watch.js);
                      saves MP3 (lamejs, js/media/mp3*.js) or WAV
js/vendor/lamejs/     MP3 encoder, unmodified, LGPL 3.0
tests/                unit tests (109)
tools/                build-phonedict.mjs: regenerates js/lyrics/phonedict.js from CMUdict
```

### Song format (built-in band)
```js
{ id: 'twinkle', title: '...', level: 'Pre-A1', bpm: 92, meter: 4, key: 'C', style: 'musicbox',
  intro: 'C G',
  lines: [
    { s: 'Verse 1', t: 'Twin-kle, twin-kle, lit-tle star,', n: 'C4 C G G A A G:2', c: 'C F:2 C:2', pic: '⭐' },
  ] }
```
Hyphens split syllables, each sung note takes the next syllable, `_` holds a
syllable over another note, notes without an octave go to the nearest one,
`:2` is a duration in beats, `r` is a rest, `x` is a clap. Lines can share a
tune (`phrases`) and start with a pickup (`pk`). The tests check every song
compiles cleanly and that its melody sits on its chords.

## Not done yet (ideas for next time)
- Live phone mode (a Cloudflare Worker like PinPlay's) so students answer on phones.
- More songs (more originals for B1/B2 grammar).
- An offline service worker.
