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
| --- | --- |
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
| --- | --- | --- |
| Song quiz | a question | **1–4** for the option they said |
| Choose the word | a gap | **1–3** |
| Fill the gaps | a gap | **Y** right / **N** wrong (answer mode "🗣️ Said aloud"); typing still possible |
| Finish the line | a stop | **Y** / **N**; the song then sings the ending |
| Wrong word | a line | click the word they name |
| Line order | a line | click the line they name |
| Grammar hunt | one word | click the word they name; when nobody finds one, the game shows one |
| Rhyme memory | two cards | click the two cards they choose; a pair keeps the turn, no steals, always in turn order |
| Line builder | a line | tap the tiles in the order they say; a wrong tile hands the rest to the next team |
| Say it! | a line at the mic | the mic suggests ✓/✗; Enter accepts, Y / N decide; then the next team comes up |

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
  and steal, pass, time's up, ↑/↓, first hand up, games without teams, Karaoke
  layout.
- 2026-11-22: **step 3 built.** Fill the gaps, Wrong word, Line order, Grammar
  hunt and Rhyme memory play on the banner (`turns` in `js/games/index.js`;
  Rhyme memory is `turns: 'only'`). Fill the gaps has a 🗣️ Said aloud answer
  mode in teams (Y/N, the default there); typing and tapping also go through
  the banner (the teacher types or clicks what the team says, and the box
  opens only at the stop). Wrong word and Line order: one line per turn, the
  word or card a team missed stays red for the steal. Grammar hunt: one word
  per turn, wrong words stay crossed out, the game shows one when nobody finds
  one. Rhyme memory: rules `{ steal: false, keep: true }` (`keepsTurn` in
  `turns.js`), a pass turns an open card back. The banner gained per-game
  options (`prompt`, `mode`, `steal`, `keep`, `show`, `flash`) and **S** shows
  the answer in every turn game. Also fixed: **R** in Wrong word and Line order
  at a stop now stops at that line again.
  Checked in Chrome: 3 teams through all five games (right, wrong + steal,
  pass, S, R at a stop, no early answers), the step 1–2 games again, and games
  without teams.
- 2026-11-22: **step 4 built.** Teams dialog: 🧑‍🎓 Students (optional) with
  a pasted class list, 🔀 Make teams (random, sizes differ by one at most),
  names typed per team, 🗑️ Clear names; 🎲 Who starts (a light runs round the
  teams, also on each game's start card); turns taken on every team row; the
  team that starts next is marked. Students are `team.members` and
  `team.next` (`parseNames`, `makeTeams`, `whoAnswers` in `turns.js`, unit
  tested); `endTurn` moves a team on to its next student. The banner and the
  start card name the student on the team's own turn ("🐼 Pop Pandas · Aina,
  your turn!"); steals and first hand up stay whole-team. Names are kept in
  this browser only (`singing.teams.v1`, never synced). The dialog now changes
  the latest teams, so a turn ending while it is open is not undone.
  Checked in Chrome: Make teams, typed names, Who starts in the dialog and on
  the start card, the student on the banner and rotating after the turn,
  Clear names, Reset scores, the dialog at 420 px wide.
- 2026-11-22: **step 5 built; the plan is done.** Line builder: one line per
  turn at the stop; the teacher taps the tiles in the order the team says
  them, a wrong tile hands the rest of the line to the next team (it carries
  on from there), and S fills the line in. Say it!: each line is one team's
  turn; the mic marks it (75% of the words or more is right) and Y / N on the
  banner overrules it; the next line comes up for the next team, and a line
  nobody said is read aloud (and shown, from memory). Every game that keeps a
  team score now does it on the banner, so `ctx.award` and the `scores` flag
  are gone; games without `turns` (Hot mic, Karaoke, Echo...) score by the
  chips. Help page and README updated.
  Checked in Chrome: both games with 3 teams (right, wrong + steal, pass, S,
  no early taps, the mic's right and wrong with Y overruling it, From memory),
  then all the earlier checks again.
- 2026-11-22: **review fixes.** (1) A game that starts in teams keeps them to
  the end: switching teams off mid-game used to leave the next item with no
  turn (every turn game stalled); now the banner and chips stay and "Teams go
  off after this game" shows. (2) Grammar hunt in teams: 👀 Show the rest ends
  the hunt with the results ("Hunt over!") instead of leaving it unfinishable.
  (3) Enter in the Teams window (class list, names) or any text box no longer
  starts the game behind it. (4) Say it!: a mic error (blocked, nothing
  heard, stopped) is not marked, so the same team tries again. (5) Say it!:
  the mic only suggests: the banner lights up ✓ or ✗, Enter accepts, Y / N
  decide (before, its verdict was final and Y after a wrong verdict scored the
  stealing team). (6) Say it!: ◀ ▶ while waiting for the next line opens a
  turn on the new line. (7) No literal "null" on start cards that leave out
  the Answering or Steal row.
- 2026-11-22: **two more Say it! scoring fixes.** (1) A recording and the
  mic's suggestion belong to the line and the try that produced them: ◀ ▶,
  a steal or ↑/↓ drop the suggestion and stop the mic, and a recording that
  ends after either changed marks nothing (before, a "right" on line 1
  followed by ▶ and Enter gave line 2 two points). The banner has a
  `turnId` that changes with every new try. (2) ◀ on the first line and ▶
  on the last do nothing; before, ▶ after scoring the last line opened a
  fresh turn on it, so Y could score it again and again. Also fixed:
  `ctx.turns` copied the banner's getters once (`...turnbar.api`), so
  `playing` and `turnId` read there never changed.
- 2026-11-22: **Say it!: no steal on another line.** ◀ ▶ during a steal used
  to take the steal along to the new line ("steal it for 1" on a line nobody
  had missed). Now a turn nobody has tried yet still comes along, but an
  item a team already missed (`started` in `turns.js`: a steal, or a team
  out in first hand up) ends with no points (`T.close()`), the turn order
  moves on as after any item, and the new line is the next team's own turn.
  In first hand up, teams that were out are back in on the new line.
