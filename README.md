# 🎤 Singing

Songs, karaoke and lyric games for the English class. A sister app to
[PinPlay](https://github.com/audiophrases/pinplay): same look, same "free, no ads,
no sign-up" spirit, and it reuses PinPlay's sound effects, voices and quiz format.

The built-in band and activities run in the browser. For static mode, open
`index.html` from any static host (GitHub Pages, Cloudflare Pages, or
`npm run serve` locally).

Cloud classroom mode adds a Cloudflare Worker, private R2 songs and Singing-only
D1 assignments/results, connected to PinPlay's shared identity directory. See
[cloud setup and migration](docs/CLOUD_DEPLOYMENT.md) and the
[repository audit and architecture](docs/CLOUD_ARCHITECTURE.md). The starter songs still play
on a static host; new uploaded recordings require cloud sign-in.

The public app needs no login for songs and games. Teachers sign in at
**`/create/`**, where Studio, folder import, cloud uploads and assignment management
are available. Students sign in with their school Google account only when they
open an assignment link. Copied assignment links point to the public app and
return students to their assignment after sign-in.

On Windows, double-click **`deploy-fast.bat`** for routine Singing updates, or
choose **1** in **`deploy.bat`**. It builds and publishes Singing using the existing
cloud setup, without checking out or redeploying PinPlay, running the full test
suites, or provisioning/migrating storage. For first setup or changes to database
migrations/shared authentication, choose **2 — Full setup / deployment** instead.
Either computer can deploy, but both options publish only what is on GitHub's
`main`: push your work first, and pull if it says this computer is behind.
The numbered launchers in `deployment/` also provide preparation, verification
and Google login setup separately. See the
[Windows deployment guide](docs/CLOUD_DEPLOYMENT.md#windows-quick-start) for the two
remaining browser steps and recovery details.

## What's inside

### A band in the browser
Band songs, like the starter songs, are written as **lyrics + notes + chords**
and played live by a Web Audio band. Each teacher gets a copy of every starter
song in their cloud library, to edit or delete like any other song. The public
player (no sign-in) shows the owner's band songs that are switched to Public:
the owner's starter songs start public, new Song maker songs start private, and
uploaded recordings are always private.

Band, Key, Speed and Melody are saved with each song. Students make and play
songs in the Song maker without signing in; saving asks for their school Google
account. The student keeps their copy, and the owner's library gets a private
copy marked with the student's name and class. Saving again sends "(v2)". Nothing is a recording, so any song can be:

- **slowed down or sped up** (50–130%) with no loss of quality,
- **moved to another key** to suit children's or adults' voices,
- **played in 16 styles**: pop, rock, campfire, lullaby, music box, waltz,
  marching band, reggae, blues shuffle, disco, hip-hop, country, sea shanty,
  reggaeton, 8-bit, just piano or drums only. (Twinkle Twinkle as reggae is a feature.)
- sung by a **robot singer**: a Klatt-style formant synthesizer that sings the real
  words, consonants included. It looks words up in a 16,000-word pronunciation
  dictionary (from CMUdict) and guesses the rest from their spelling. It can also be a flute,
  piano, whistle, synth or bells, or switched off for real karaoke.
- **Robot · clear English**: the same melody and rhythm, sung for pronunciation
  rather than realism: in a speaking voice's range (often an octave lower),
  no vibrato, fully released final consonants, a short break before words
  that start with a vowel, and a band that makes more room.
  The original robot singer is still in the menu, and the **🔬 Voice lab**
  (in the Studio) compares the voices on identical notes, volume-matched, with
  a blind listening test. `tools/robo-eval.mjs` measures them with local speech
  recognizers (see [the voice notes](docs/ROBOT_SINGER.md)).

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

### 🧠 AI song packs
An external AI can study a song's lyrics and add depth to Singing's games. It does
not plan lessons: teachers choose when and how to use each game. On any of your
songs, choose **AI song pack**:

1. Describe the class: age, first language and, if you like, what to work on.
   Leave **Level** empty and the AI rates the song from how abstract its meaning
   is and how hard its vocabulary is. Either way the activities cover that level
   and the one on each side of it, up to C2.
2. Copy the prompt into a chatbot like ChatGPT, Claude or Gemini, or hand it to an
   AI agent. It holds the lyrics, the melody, the instructions and the JSON format.
   The app sends nothing itself, and no API key is needed.
3. Bring the results back. As with long PinPlay quizzes, a chatbot works in batches:
   **Create in batches of** sets the size, the prompt carries the whole plan, and
   the AI sends one JSON object per reply and stops, one family of games at a time
   (a size of 60 gives five batches). Paste each reply in and copy the message for
   the next batch, or choose all its files at once with **Open files**. An **AI
   agent** instead does the whole job in one run, goes deeper, checks its own work
   and leaves one file. Each reply is added to the pack, unsaved batches wait in
   this browser, pasting a batch twice adds nothing, and any section can ask the AI
   for more later. Singing finds the JSON in whatever the AI wrote around
   it and checks every item against the lyrics. Items quote words rather than count
   them, so a wrong line number is corrected from the quote, and anything else that
   does not match is listed and left out, with a message to send back to the AI.
4. Read through the pack, remove what you do not want, and save it with the song.

| In the pack | Where it goes |
|---|---|
| Profile | The song's level, grammar, themes, key words and summary |
| Teacher notes, content warnings | Teachers only: the notes on the pack page, the warnings on the song page |
| Clean | The clean version (below) |
| Lines | Pictures, translations and a "in simple English" view of the lyrics |
| Words | Key word cards: meaning, translation, example, IPA; click to hear |
| Pop-ups | Language notes in Karaoke, beside the highlighted words |
| Hunts | Grammar hunt, judged word by word in context, explaining each find |
| Gap sets | Fill the gaps, Choose the word and worksheets; real mistakes as wrong answers. Can be assigned as homework, marked by the server |
| Swaps | Wrong word: what learners with this first language really mishear |
| Stops | Finish the line: the music stops before a word and asks a question |
| Quiz | Song quiz, before and after listening, by level; Listen replays the line that answers it |
| Cards | Hot mic, by level: questions about students' own lives, role plays, fix-the-sentence |
| Pairs | Rhyme memory with any pairs: base and past, word and meaning, English and first language |
| Moves | Freeze dance: a gesture for a word, shown as the word is sung |
| Say | Say it!: the lines worth practising, the words to watch, and a tip |
| Echo | The order to teach the song in, easiest and most useful first |
| Chant | An original chant on the same language point, opened in the Song maker |

A 🧠 number on an activity shows what the pack added to it, and the printed **AI
worksheet** gathers one level of the pack on a sheet. The melody goes to the AI as
measured facts rather than as the raw UltraStar file, whose beat numbers need
#BPM and #GAP arithmetic: seconds per syllable, long notes, rests, jumps, the fastest
and slowest lines. So it can plan vowel work on held notes, warn about fast lines
and about stress the melody bends, and choose where to pause. Band songs send
the same facts from their score; songs timed by line get line timing only.

**Clean version:** off until the teacher ticks it on the song's pack page, and it
then applies to everyone who plays the song. On a recording, words on the pack's
clean list are masked on screen and on paper, and the singer drops out on them while
the music plays on, because the karaoke version takes over for that moment. Without
a karaoke version all the sound dips for the word instead, and a video can only mask
its lyrics. The AI suggests the words, and teachers can add their own. Word times
are exact with an UltraStar file and estimated with line timing. Masked words never
become gaps, and the server masks them too, so homework is marked on what students saw.

Students and the public player receive the pack without its teacher section, and
share links leave the pack out. A pack belongs to one saved version of a song: if
the lyrics change, the items whose words are gone drop out and the rest keep working.

### Bring your own songs
- **Studio**: paste lyrics (with `[Chorus]` sections, emoji pictures, `A:`/`B:`
  parts and `| translations`), link a **YouTube** video or add an **audio file**
  (uploaded to private cloud storage when saved), then **tap along** to sync each line with fine-tuning.
- **Timing files**: drop an mp3 and its lyrics file on the Studio. It reads
  **UltraStar** `.txt` (every syllable's time and pitch, duet parts),
  **LRC** (with `<mm:ss.xx>` word times), **SRT** and **WebVTT** (including
  YouTube's rolling captions). *All lines earlier / later* and *Tap to align*
  fix timing made for another version of the song. Editing the lyrics keeps
  the timing of every line.
- **🪄 Auto-align**: an UltraStar file carries the melody, so Singing listens
  to the audio file (chroma, in the browser, about a second) and moves the
  lyrics to where that melody is sung. It runs by itself on import, and only
  moves anything when the match is clear. Studio and folder imports use the same
  alignment, and saving waits for it to finish. Other lyric formats keep their
  supplied timing; use *All lines earlier / later* or *Tap to align* to adjust it.
- **Karaoke version**: add the same recording without the singer (an official
  instrumental, or the song through a vocal remover). Use files that share the
  original recording's timeline, such as Karaoke Studio's Demucs exports.
  Original, karaoke and vocals stay together; aligning the lyrics once serves
  all three, without independently shifting the recordings. The
  🎤 *Singer* knob switches between the two. Karaoke starts with the karaoke
  version, Echo's "your turn" and Pitch Pal's "I know it" use it.
- **Vocals only**: keep an isolated vocals file alongside the original and
  karaoke track. The player's *Singer* menu offers **Vocals only** for practice.
  A karaoke/vocals pair can also play together without the original recording.
- **Songs folder** (in Songs or Studio): choose a folder containing, for example,
  `Sia - Chandelier.m4a`, `Sia - Chandelier (Karaoke).mp3`,
  `Sia - Chandelier (Vocals).mp3` and `Sia - Chandelier.txt`.
  Matching files become one song; subfolders and UltraStar audio references are
  supported. Chrome/Edge check every five seconds while the app is open, waiting
  for files to stop changing. **Scan now** checks manually, **Pause watching**
  stops automatic checks, and **Reconnect folder** restores access if needed.
  Other browsers offer a folder import; select the folder again to rescan.
  Rescans skip unchanged files, attach new stems and lyrics to existing songs,
  and preserve Studio edits when the corresponding source file has not changed.
  Folder access is read-only. After teacher sign-in and permission confirmation,
  songs upload to the private cloud library. Removing a disk file does not remove
  its cloud copy. Watching runs while the app is open.
  To fix a previously imported song, open it in Studio and choose **Repair lyric
  timing** (UltraStar), check playback, then **Save song**. Manual timing edits
  survive unchanged rescans and companion additions. Replacing a recording also
  preserves edited timing and asks you to check it. Saving a repair creates a new
  cloud version; existing assignments keep their pinned version.
- **Remix**: rewrite any line (new animals, students' names, new verbs). The
  tune bends to fit the new syllables.
- **Share link**: band and lyrics-only songs can travel in a compressed URL.
  Uploaded recordings use private links; students need a class assignment and sign-in.
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
files. Uploaded audio persists in private R2 storage across devices. Keep music
out of the public repository and only upload recordings you have permission to use.

## Reused from PinPlay
- Visual language: tokens, buttons, cards, Inter, the purple `#605dff`.
- Sound effects (correct / wrong / drumroll / jackpot) and the Lottie assets.
- PinPlay's Edge TTS endpoint for neural voices (falls back to the browser's voice).
- PinPlay's quiz JSON format for the export.
- The QR-join idea for phones.

The optional shared identity adapter adds a service-only entrypoint to PinPlay;
each app keeps its own assignments and results. See [cloud deployment](docs/CLOUD_DEPLOYMENT.md).

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
js/lesson/            AI song packs: pack.js reads, checks and joins replies and feeds the games, prompt.js writes the prompt
js/games/             one module per activity
js/views/             library, song, stage, studio, lesson, song maker, remix, print, party, help, card
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
