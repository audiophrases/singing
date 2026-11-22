# Team turns: an orderly game on the teacher's computer

Everything happens on the teacher's computer and the projector. Students answer
aloud; the teacher enters what they said. Teams take turns, so the class plays in
order instead of everyone shouting at once. Planned 2026-11-22 with the owner;
decisions below are settled.

## Before (2026-11-22)

- Up to 6 teams (name, mascot, colour, score) kept in this browser. Stage chips:
  click +1, right-click −1; T opens Teams, W shows the winner.
- A `turn` pointer exists, but only Song quiz and Rhyme memory move it.
- Finish the line and Hot mic ask "Who got it?" with a button per team.
- **Bug:** Fill the gaps, Choose the word, Wrong word, Line order, Line builder,
  Grammar hunt and Say it! give their points to "the team whose turn it is", and
  nothing moves the turn on, so every point goes to the same team
  (`ctx.award` in `js/views/stage.js`).
- Wrong answers have no consequence for the team.

## Decisions (owner, 2026-11-22)

| Question | Decision |
|---|---|
| Points | **2** right on your own turn, **1** for a steal. First hand up: 1. No minus points. |
| Wrong answer | **One steal**, by the next team only. |
| Pass / don't know | A **🤷 Pass** button (key **P**): the team loses its turn, with no buzzer. The next team can still steal it. |
| Students inside teams | **Yes, optional names**; the banner rotates students within each team. |
| Music | **Always waits at the item** in turn mode; no early answers, no speed bonus. |

## How a turn works

One turn is one item: a question, a gap, a stop, a line.

1. A banner on the projector names the team (and the student, when names are
   entered): "🐼 Pop Pandas · Marta". Their chip glows. Between items it shows who
   is next.
2. The music stops at the item, as now. In turn mode the item only opens there.
3. The student answers aloud; the teacher enters it. Optional thinking time
   (none / 5 / 10 / 15 / 30 s): time's up counts as a pass.
4. **Right** → +2, celebration, the song carries on.
5. **Wrong** → "🐱 Jazz Cats, steal it for 1 point!" The next team gets one try
   (a wrong option stays greyed out). Wrong again → the answer is shown or sung,
   no points.
6. **Pass** (🤷, P) → the team loses its turn quietly ("That's OK!"); the steal
   still goes to the next team. A pass on the steal shows the answer.
7. The next turn goes to the team after the one whose turn it was, whatever
   happened in the steal, so the order never jumps.

The order carries on from game to game in the same lesson, so turns even out.

## Two ways to answer (setup card, remembered)

- **🔄 Turns**: the default when teams are on.
- **✋ First hand up**: the teacher picks the team that put its hand up (click
  it, or ↑/↓), then enters its answer. A wrong team is out for that item; the
  others can try. In ✓/✗ games one click on a team means "they got it".
  **🙈 Nobody** (P) shows the answer.

With teams off, every game plays exactly as before. Homework (assignment) runs
never use turns.

Shared settings on each game's setup card: Answering, Steal (on/off), Thinking
time. They are stored with the teams.

## Teacher input per game

| Game | One turn | Teacher presses |
|---|---|---|
| Song quiz | a question | **1–4** for the option they said |
| Choose the word | a gap | **1–3** |
| Fill the gaps | a gap | **Y** right / **N** wrong (answer mode "🗣️ Said aloud"); typing still possible |
| Finish the line | a stop | **Y** / **N**; the song then sings the ending |
| Wrong word | a line | click the word they name |
| Line order | a line | click the line they name |
| Grammar hunt | one word | click the word they name |
| Rhyme memory | two cards | click the two cards they choose |
| Line builder | a line | tap the tiles in the order they say; a wrong tile hands the rest to the next team |
| Say it! | a line at the mic | the mic marks it, then the next team comes up |

Unchanged: Hot mic (holding the mic decides who answers) and Karaoke, Echo,
Round, Pitch Pal, Freeze dance and Bingo.

Keys in turn mode: **1–4** option · **Y** right · **N** wrong · **P** pass ·
**S** show the answer · **↑/↓** change who is answering. Chips still fix points
by hand.

## Teams dialog

- **Students (optional)**: paste the class list and **🔀 Make teams** shares the
  names out at random, or type names per team. Names stay on this computer.
- **🎲 Who starts**: a quick spin picks the first team.
- **Turns taken** next to each score, on the podium too ("Pandas 7 in 4 turns").

## Build steps

1. **Turn rules** `js/games/turns.js` (pure: rotation, steal, pass, first hand
   up, points; `tests/turns.test.js`) and the **turn banner** on the stage
   `js/views/turnbar.js` (`ctx.turns`, timer, keys). `ctx.award` in games not
   yet on the banner gives the point to the glowing team and passes the turn
   on, which ends the stuck-turn bug.
2. **Song quiz, Choose the word, Finish the line** on the banner. Song quiz
   drops its own turn code.
3. **Fill the gaps (said aloud), Wrong word, Line order, Grammar hunt, Rhyme
   memory.**
4. **Teams dialog**: students, Make teams, Who starts, turns taken; podium.
5. **Line builder, Say it!**

Each step: unit tests, then a 3-team game in the browser (right, wrong + steal,
pass, ↑/↓, the next game carrying the order on). Help page and README at the end.

## Status

- 2026-11-22: plan agreed.
- 2026-11-22: **steps 1–2 built.** `js/games/turns.js` (rules, 10 unit tests in
  `tests/turns.test.js`), `js/views/turnbar.js` (banner, thinking time, keys,
  set-up rows), `ctx.turns` in `stage.js`; Song quiz, Choose the word and Finish
  the line play in turns or first hand up. Games flagged `scores` in
  `js/games/index.js` (Fill the gaps, Wrong word, Line order, Line builder,
  Grammar hunt, Say it!) give `ctx.award` points to the glowing team and pass
  the turn on; Rhyme memory counts its turns. Podium shows turns taken; Reset
  scores also resets turns and the first team. Also fixed on the way: Fill the
  gaps' **R** (Again) at a stop now stops at that line again instead of
  playing on while the game waits; stage content scrolls instead of being cut
  off at the top when it is taller than the screen.
  Checked in Chrome (1280×800): 3 teams through all three games, right, wrong
  + steal, pass, time's up, ↑/↓, first hand up, games without teams, Karaoke
  layout.
- Next: step 3.
