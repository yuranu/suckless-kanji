# suckless-kanji

A kanji/vocabulary trainer: a fixed JLPT curriculum (N5→N1), spaced repetition (FSRS-5 or Anki's SM-2), and minigames where you draw kanji stroke by stroke. Client-side only for now. It has no framework, no bundler and no runtime dependencies, and works offline.

## Run

```bash
python3 -m http.server 8765 --directory web
```

Open http://localhost:8765. The app uses ES modules, so it must be served over HTTP; opening `index.html` as a file does not work. It installs as a PWA and keeps working offline.

```bash
npm test               # unit tests: schedulers, state replay, distractors, queues
npm run test:matcher   # Monte-Carlo check of the stroke matcher
```

## How it works

- **Lessons:** consecutive groups of curriculum items, 4 by default.
- **Learning a lesson:**
  - Each new item is introduced first. New kanji get a stroke-order animation and a trace pad.
  - Then every card is drilled until it has been answered correctly `learnRepeats` times.
  - Each word adds a *reading* card and a *writing* card. Kanji-only items add a *kanji* card.
- **Reading card:**
  - Pick the kana for the word.
  - The word is read aloud; pick its translation.
  - Summary.
- **Writing card:**
  - Shown: the kana, and the word with blanks where the kanji go.
  - Single-kanji words: draw the kanji on a blank pad. A wrong stroke shows the outline. A hint is always available but fails the card.
  - Multi-kanji words: fill the blanks from a 9- or 12-kanji grid.
  - Then the translation, then the summary.
- **Kanji card:** draw the kanji from its meaning and readings.
- **"I misclicked":** every choice step has this corner button, which takes back a wrong answer.
- **Drawing escape hatch:** "I know it, something's wrong" accepts the kanji as written and stores a local report about the stroke checker.
- **Reviews:**
  - Today's due cards are shown, rated Hard, Good or Easy (an Again rating is automatic when the card was missed).
  - Missed cards come back later in the same session.
- **Practice** (from a lesson or a kanji page) never changes the schedule.
- **Next lesson** is the next N *unlearned* items in curriculum order, so gaps (items skipped by an import or by learning lessons out of order) are filled first, in full-size lessons.
- **Mobile first:** every exercise fits one screen, down to 360×640. The drawing pad sizes itself to the viewport height, many-option questions switch to compact layouts, and a new kanji gets its own intro screen.

## Importing prior knowledge

For people switching from another app (Settings → *Import prior knowledge*):

1. **Mark the kanji you know.** Tap to toggle, use *Fill up to* to mark everything before a kanji, add whole JLPT levels, or paste any text to mark the kanji in it.
2. **Pick the vocabulary level you reached.** A word counts as known when all its kanji are known and its JLPT level is at or below that level.
3. **Pick a window for first reviews** (the default aims at about 25 a day), with a load preview.

Each card gets an assumed memory strength: early curriculum items are strong, recent ones weak, and writing is weaker than reading. First reviews are spread evenly across the window, weakest first. Nothing is due on import day and nothing is dropped. After the first real review, scheduling follows your actual answers. The import is one `seed` event and can be undone.

## State and sync design

User progress is an append-only **event log** in IndexedDB. Everything else is derived by replaying it ([web/js/state.js](web/js/state.js)):

| event | data | effect |
|---|---|---|
| `learn` | `{cards: {cardId: rating}}` | lesson finished: creates the cards and schedules them for the first time |
| `review` | `{card, rating, ms}` | an SRS answer |
| `seed` | `{cards: {cardId: [stability, dueInDays]}}` | prior-knowledge import |
| `forget` | `{items: [itemId]}` | un-learns items |
| `settings` | `{key: value}` | synced settings, last writer wins |

- **Event fields:** each event carries `id`, `t` (ms timestamp), `tz` (timezone offset) and `dev` (device id). Replay is ordered by `(t, id)` and is deterministic, so every device reaches the same state from the same events.
- **Stable keys:** item ids (`word|kana`, or the kanji itself) come from the curriculum. Regenerating the data doesn't orphan progress, and unknown ids are ignored.
- **Both schedulers at once:** each card keeps an SM-2 state and an FSRS state, both updated on every answer. Switching the algorithm or the desired retention re-times every card immediately.
- **Sync later:** the server only stores events. Clients upload the events the server lacks and download the ones they lack (matched by `id`), then replay. There are no conflicts to resolve; concurrent reviews on two devices simply both count.
- **Backups:** Settings → *Export backup* writes the full log as JSON. *Import / merge* adds events by id, so importing twice, or from another device, is safe.
- **Device-only settings:** voice, theme and stroke leniency live in `localStorage`.

## Data

```bash
npm install     # once: kuromoji, used at build time only
npm run all     # fetch.sh (checksum-verified) + build-curriculum.mjs + build.mjs
```

Generated files are committed; never edit them by hand:
- `data/curriculum.yaml`: the human-readable curriculum.
- `web/data/curriculum.json`: the app's copy of the same lessons.
- `web/data/kanji.json`: stroke paths, readings and visual components of the 2297 curriculum kanji.

The build is deterministic:
- GitHub sources are pinned to fixed commits/releases.
- Every download is checked against `scripts/sources.sha256`.
- Tatoeba only publishes a "latest" export. If it changes, `fetch.sh` fails; run `scripts/fetch.sh --relock` to accept it deliberately.

### Curriculum

A flat list of lessons, one per word+reading, in study order:
- **Levels:** N5→N1. A word appears only once its JLPT level is reached and all its kanji are learned.
- **Level start:** each level begins with that level's words that use only kanji from earlier levels.
- **Kanji order:** kanji are introduced one at a time. The next one is the most frequent kanji that unlocks a word at that point.
- **Kanji-only lessons:** a kanji that no word at its level uses gets its own lesson.
- **Examples:** Tatoeba sentences matched by word *and* reading, at most 32 characters. Kanji not learned yet are written in hiragana.

### Sources

| Source | Used for | License |
|---|---|---|
| [KanjiVG](https://kanjivg.tagaini.net) | stroke paths, order, components | CC BY-SA 3.0 |
| [kanji-data](https://github.com/davidluzgouveia/kanji-data) | KANJIDIC2 readings/meanings, JLPT kanji levels (tanos) | MIT / CC BY-SA 4.0 |
| [yomitan-jlpt-vocab](https://github.com/stephenmk/yomitan-jlpt-vocab) | JLPT vocabulary lists (tanos) mapped to JMdict | — |
| [JMdict](https://www.edrdg.org/) via jmdict-simplified | meanings, part of speech, usage notes | CC BY-SA 4.0 |
| [JmdictFurigana](https://github.com/Doublevil/JmdictFurigana) | per-kanji reading split | CC BY-SA 4.0 |
| [Tatoeba](https://tatoeba.org) / Tanaka corpus | example sentences | CC BY 2.0 FR |

`ref/*.pdf` contains the original tanos kanji lists, kept as a cross-check.

## Layout

```
scripts/        data pipeline (fetch, build-curriculum, build) and matcher test
data/           curriculum.yaml (generated)
web/            the app (static files)
  data/         generated JSON
  js/state.js   event replay, scheduling queries
  js/srs/       sm2.js, fsrs.js
  js/store.js   IndexedDB event log, export format
  js/session.js review queue, lesson drill
  js/distractors.js  wrong answers for choices and grids
  js/stroke.js  stroke matcher
  js/ui/        drawpad, minigames, DOM helpers
  js/screens/   home, lessons, learn, review, practice, kanji, settings
tests/          node:test unit tests
```
