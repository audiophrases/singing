# The robot singer: making the words clear

The robot singer is a Klatt-style formant synthesizer in the browser
(`js/music/singer.js`, played by `js/music/synth.js`). This page records why
its words were hard to understand, what changed, how it was measured, and
what could still be done. The first version is still in the app, unchanged, as
`roboClassic` ("📼 Robot singer (original)") so the two can always be compared.

## Three voices

| In the Melody menu | Instrument | What it is for |
| --- | --- | --- |
| 🤖 Robot singer | `robo` | The default singer, rebuilt for clarity. Same pitch as the melody. |
| 🗣️ Robot · clear English | `roboClear` | Words before singing realism: a speaking voice's range, no vibrato, released final consonants, breaks before vowel-initial words, more room in the band. |
| 📼 Robot singer (original) | `roboClassic` | The first version, untouched, for comparison. |

All three sing the same lyrics on the same notes, rhythm and timing. Clear
English moves the melody down by octaves when it is high (its middle note
ends up at or below A3, 220 Hz); the tune itself does not change.

## Audit: why the words were hard to understand

Found by reading the code, then confirmed with spectrograms and speech
recognizers (see *Measuring*).

1. **Notes ran over the next consonants.** A note sounded until
   `t + 0.98 beat + 50 ms`, while the next syllable's onset started up to 70 ms
   *before* its beat. The vowel kept playing at full level under the next
   consonant, filling the silent closure that makes a "t", "p" or "k".
2. **The voice was muffled.** The vocal tract is a cascade of five low-pass
   resonators with no "higher-pole correction", so the spectrum fell steeply
   above F3. Against the average speech spectrum (Byrne et al., 1994), the
   original voice was 9 dB too weak at 2 kHz, 16 dB at 3.15 kHz and 21 dB at
   4 kHz. The F2/F3 movements that tell b/d/g, m/n and p/t/k apart were buried.
3. **Weak, short consonants.** 12 ms bursts that took 6–8 ms to reach their
   level, 35 ms of aspiration after p/t/k (English uses 50–80 ms; it is the
   cue that tells "pin" from "bin"), half-released final stops whose noise then
   hissed on through the note's fade-out, voiced stops whose closure buzzed
   like a tap ("uh-ga" heard as "uh-ra"), fast glides that sounded like stops
   ("w" heard as "b"/"m"), nasals with no anti-resonance.
4. **No word stress.** Every note had the same velocity, so "the", "-kle" and
   "STAR" were equally loud.
5. **Children's pitch, adult formants.** The songs sit around C4–A4
   (262–440 Hz). At that pitch the harmonics are too far apart to show F1
   clearly, which blurs vowels.
6. **The mix buried the voice.** In pop arrangements the voice was about as
   loud as the band (−0.2 LU in *What Did You Do Yesterday?*), with a 30%
   reverb send and no EQ, and the band filled the 2–4 kHz consonant region.
   The master compressor's make-up gain also let the odd peak clip
   (up to +0.6 dBFS).
7. **Pronunciation.** A few song words were not in the dictionary and were
   guessed wrongly from spelling ("hooray" as "hor-ay", "baa-baa" as "ba-uh",
   "one-horse" as "an-e-horse"), and the stress rules got "Mary", "babies",
   "polar" and "MacDonald" wrong.

## What changed

In `js/music/singer.js` (both new voices):

- **Hand-over.** Each note knows the next one (`melodyEvents` → `linkNotes`).
  It stops exactly where the next onset starts: with a short cut before a stop
  (so its closure is silent) and a cross-fade before anything else (a gap then
  a sound is heard as a "t").
- **Higher-pole correction**: a high shelf on the voiced path (+12 dB above
  2.2 kHz), bringing the long-term spectrum close to average speech.
- **Consonants**: longer closures; voiced closures as a low, muffled hum;
  sudden bursts coloured by place (a "k" takes its colour from the next vowel);
  aspiration after stressed p/t/k; final stops released and then silent; glides
  that move slowly into the vowel and start softly; nasals with a notch
  (anti-resonance) at their place; voiced fricatives that buzz more than they
  hiss.
- **Word stress** from CMUdict (`js/lyrics/stressdict.js`, built by
  `tools/build-stressdict.mjs`), falling back to the old rules for unknown
  words. Unstressed syllables and small words are a little softer and quicker,
  and only stressed syllables get the scoop into the note.
- **Less robotic**: a slow pitch drift, a delayed and irregular vibrato, glides
  within melismas, a little breath in the vowels.
- **The mix** (`Synth.voxChain`, `Synth.setVoiceRoom`): the new voices have
  their own high-pass, presence boost and smaller reverb send; the band dips
  around 3 kHz and plays a few dB quieter while they sing (robot singer: 3 dB
  dip, 5 dB quieter; Clear English: 6 and 8). A soft ceiling at the end of the
  master chain stops clipping (identical below −0.9 dBFS, for every sound).

Clear English adds the speaking range, no vibrato or scoops, released final
consonants with a puff of air, a little longer consonants, and a 35 ms break
before words that start with a vowel.

Elsewhere: missing song words added to the pronunciation list
(`js/lyrics/phonemes.js`); offline rendering (`js/music/render.js`) that
schedules notes just in time, as the live player does.

## Measuring

`tools/robo-eval.mjs` renders the same material through each voice in headless
Chrome and has it transcribed by local recognizers (`tools/robo-listen.py`):
Whisper (small) for words, and a wav2vec2 phoneme recognizer (no language
model, so it cannot guess words) for consonants. No audio is kept in the
repository.

Material: three lines of every built-in song (familiar, so recognizers can
guess them), 24 semantically unpredictable sentences sung by the song maker
("The heavy rabbit paints the window", the standard test for synthetic speech,
because context cannot help), and every consonant in "uh-Ca" and "aC".

Final run (2026-10-21; 42 song lines and 24 sentences, each sung alone and
with the band; Whisper word error rate, lower is better):

| | Original | Robot singer | Clear English |
| --- | --- | --- | --- |
| Alone: song lines | 74.4% | 41.1% | **21.3%** |
| Alone: unpredictable sentences | 75.6% | 29.8% | **11.9%** |
| With the band: all lines | 95.3% | 57.5% | **23.0%** |
| Consonant errors, alone (phoneme recognizer) | 75.4% | 56.9% | **38.0%** |
| Syllable-initial consonants identified ("uh-Ca") | 4/69 | **26/69** | 18/69 |
| Highest peak, with the band | +0.6 dBFS* | −0.1 dBFS | −0.1 dBFS |
| Render time (share of real time) | 7–10% | 9–12% | 9–12% |

\* Before the master ceiling; with it, every voice stays below full scale.

Recognizers are not learners: these numbers are a consistent, repeatable
proxy, not a substitute for listening. Two notes from tuning:

- The phoneme recognizer mishears even espeak-ng's "uh-gah", so it is only
  good for large effects; word errors on unpredictable sentences were the
  main guide.
- Making Clear English "more clear" by brute force backfired: louder
  consonant noise and exaggerated vowels raised word errors (47.6% → 40.5% and
  41.7% when each was brought back to the singing voice's value). What helped
  was the low register (35.7% → 18.5% for the same voice an octave lower),
  the break before vowel-initial words, and the high-frequency correction.

## The voice lab

Studio → 🔬 Voice lab (`#/voicelab`, `js/views/voicelab.js`):

- Each clip (one or two lines) is rendered once per voice, alone and with the
  band, then all versions play in sync with only one heard: switching (A/B/C
  or 1/2/3) is instant and keeps the place.
- Every version is matched in loudness (BS.1770, `js/media/loudness.js`), so a
  louder voice cannot win by being louder; the buttons show how loud each was.
- Click a word to loop just that word. Speed 100/85/70% applies to all.
- Blind test: sentences sung by a hidden, randomly chosen voice (balanced);
  type what you hear and the lab counts the words heard right per voice.
  "Unfamiliar sentences" are generated fresh each time, so nobody can guess
  them. Results stay in this browser; *Copy results* gives a table for a
  spreadsheet.

## What could still be done

- **Listening tests with learners.** The blind test in the lab is built for
  it: a class or a few colleagues, 9–18 sentences each.
- **Female formants for the singing voice.** The vowels are an adult male's.
  A formant set scaled for higher voices (or switched by register) would
  likely help the default singer at children's pitch, the way the low
  register helped Clear English.
- **A parallel formant branch for fricatives and bursts** (as in Klatt's full
  synthesizer) instead of one band-pass, for better f/θ and s/ʃ contrasts.
- **Coarticulation across notes**: consonant clusters between words ("next
  step") and vowel-to-vowel transitions are still handled one note at a time.
- **Ducking that follows the lines**: the band is quieter for the whole song
  with the new voices; lowering it only while a line is sung would keep the
  intros full.
- **Song-maker stress**: the composer still uses the old stress rules
  (`stressIndex`); giving it the CMUdict stress would place "Mary" and
  "babies" better in new songs (it changes the tunes it writes, so it was
  left alone here).
