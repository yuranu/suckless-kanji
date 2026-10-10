# suckless-kanji

*Like any other kanji learning app, but doesn't suck.*

A kanji/vocabulary trainer: a fixed JLPT curriculum (N5→N1), spaced repetition (FSRS-5 or Anki's SM-2), and minigames where you draw kanji stroke by stroke. The client has no framework, no bundler and no runtime dependencies, and works offline. A thin Cloudflare Worker adds Google sign-in and sync between devices.

The name is borrowed from the [suckless.org](https://suckless.org) philosophy (small, simple, no bloat). This project is not affiliated with suckless.org.

**License:** code [MIT](LICENSE); data and icons [CC BY-SA 4.0](DATA-LICENSE.md), because they are derived from KanjiVG, KANJIDIC2, JMdict and other freely licensed sources. See [DATA-LICENSE.md](DATA-LICENSE.md) for the full attributions.

## Run

```bash
python3 -m http.server 8765 --directory web
```

Open http://localhost:8765. The app uses ES modules, so it must be served over HTTP; opening `index.html` as a file does not work. `npm run dev` (Wrangler, port 8787) serves it exactly as production does, including clean URLs.

**Installable and offline:**
- **Installing:** in Chrome or Edge, Home shows an *Install* card while installing is possible. On iOS Safari it shows "Share → Add to Home Screen" instructions instead. The card never appears inside the installed app.
- **Offline:** the service worker ([web/sw.js](web/sw.js)) downloads every file of the app when it installs, so everything works offline from then on.
  - Requests try the network first, so updates show up immediately, but fall back to the cached copy after 3 seconds.
  - [tests/pwa.test.mjs](tests/pwa.test.mjs) fails if a file in `web/` is missing from the offline list, or if the manifest or icons stop meeting Chrome's install requirements.
- **Icons:** `npm run icons` regenerates `web/icons/` from KanjiVG's strokes of 字. No fonts are involved, so the output is the same on any machine.

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
  - Exception: if a kanji has no single-kanji word of its own (or none within 300 lessons), the word that introduces it is a *draw* card instead. Only that kanji is blanked, the word's other kanji are shown, and you draw it. This way every kanji is drawn at least once.
  - Then the translation, then the summary.
- **Kanji card:** draw the kanji from its meaning and readings.
- **"I misclicked":** every choice step has this corner button, which takes back a wrong answer.
- **"Wait, I know it":** shown in drawing steps while the outline is visible (after a mistake or a hint). It hides the outline and takes back the mistakes and hint so far: finishing the kanji from memory then counts as correct. It also stores a local report about the stroke checker.
- **Reviews:**
  - Today's due cards are shown, rated Hard, Good or Easy (an Again rating is automatic when the card was missed).
  - Missed cards come back later in the same session.
- **Practice** (from a lesson or a kanji page) never changes the schedule.
- **Next lesson** is the next N *unlearned* items in curriculum order, so gaps (items skipped by an import or by learning lessons out of order) are filled first, in full-size lessons.
- **Welcome screen:** shown once per device, on first launch with no progress. It offers *Start learning*, *I already know some kanji* (the import) and *Sign in to sync* (only where the sync server is reachable); any of them dismisses it for good. Links into the app skip it.
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
- **Sync:** the server only stores events. Clients upload the events the server lacks and download the ones they lack (matched by `id`), then replay. Concurrent reviews on two devices simply both count (see *Server*).
- **Backups:** Settings → *Export progress* writes a readable YAML file: a summary, settings, every card with its due date, and the full event log, one event per line. *Import / merge* reads the event log back and adds events by id, so importing twice, or from another device, is safe.
- **Device-only settings:** voice, theme and stroke leniency live in `localStorage`.

## Server (sync)

Cloudflare serves the static app at https://suckless-kanji.com directly, and a thin Worker ([server/worker.js](server/worker.js)) runs only for the sync API and sign-in (`/api/*`, `/auth/*`). A separate tiny Worker ([server/redirect.js](server/redirect.js)) redirects www.suckless-kanji.com and the old kanji.yuranu.com there. It uses Workers, static assets and D1 (serverless SQLite), all on the free plan.

- **Auth:** Google sign-in; the session is a signed, HttpOnly cookie. The app itself is public, and signing in is only needed to sync.
- **Signup and limits** (`wrangler.toml` vars):
  - `SIGNUP_MODE = "open"`: any verified Google account can sync, up to `MAX_USERS` accounts. After that new accounts get "sync is full" (the app still works, locally). `"allowlist"` admits only listed emails instead.
  - `MAX_USER_BYTES` of stored events per account (raise it per account with `users.sh quota`), and `MAX_EVENT_BYTES` per event.
  - Rate limits: 60 API requests per minute per account, checked before any database read, and 20 sign-in attempts per minute per IP.
  - The defaults bound the worst case (every account full) to ~3 GB, inside D1's free 5 GB. On Cloudflare's free plan, exhausting a limit makes requests fail until it resets; it is never billed.
  - Requests that are not signed in are rejected by the cookie signature check, before touching the database. Static files never run the Worker.
- **Sync:** clients upload the events the server lacks and download newer ones, with duplicates ignored by id. Normal use never conflicts. When histories genuinely diverge (a first sync with data on both sides, a reset or "use local" on another device, a different account), the app asks: merge / use this device / use the cloud.
- **No data loss:**
  - "Use local" and reset start a new *generation* on the server; old generations stay in the database as an archive.
  - "Use cloud" keeps a local backup of the replaced log.

The app shows its version in Settings → About, written to `web/version.json` at deploy time. Releases are tags `vMAJOR.MINOR`: exactly on a tag the version is `v1.0`, and commits after it count up (`v1.0.1`, `v1.0.2`, …) until the next tag. `+` / `-dirty` marks a deploy with uncommitted changes. To release: `git tag -a v1.1 -m "…" && git push origin v1.1`, then `npm run deploy`.

```bash
scripts/server/users.sh stats|ls [--local]          # accounts, storage use, database size
scripts/server/users.sh block|unblock <email>       # refuse / restore sync for an account
scripts/server/users.sh quota <email> <MB|default>  # per-account storage quota
scripts/server/users.sh allow|disallow|allowed       # allowlist (SIGNUP_MODE = "allowlist")
npm run dev        # wrangler dev on :8787 (local D1; .dev.vars: SESSION_SECRET, DEV_LOGIN=1)
npm run deploy     # write web/version.json, apply D1 migrations, deploy both Workers
```

**First deploy:**
1. `npx wrangler login`
2. `scripts/server/setup.sh`: creates the D1 database and records its id in `wrangler.toml`, migrates, deploys, and sets a random `SESSION_SECRET`.
3. `npx wrangler secret put GOOGLE_CLIENT_SECRET`
4. With `SIGNUP_MODE = "allowlist"`: `scripts/server/users.sh allow <email>`.

The Google OAuth client must list `https://suckless-kanji.com/auth/callback` (and `http://localhost:8787/auth/callback` for local testing) as redirect URIs.

**Self-hosting a fork:** the domains in `wrangler.toml` and `server/redirect.wrangler.toml` and the D1 `database_id` belong to this deployment. Replace them with your own, create your own Google OAuth client (put its id in `GOOGLE_CLIENT_ID`), then follow the first-deploy steps above.

**Local testing without Google:** with `DEV_LOGIN=1` in `.dev.vars`, `/auth/dev?email=<email>` signs in directly (subject to the signup mode). This only works when `DEV_LOGIN` is set, which it never is in production.

## Data

```bash
npm install     # once: kuromoji, used at build time only
npm run all     # fetch.sh (checksum-verified) + build-curriculum.mjs + build.mjs
```

Generated files are committed; never edit them by hand:
- `data/curriculum.yaml`: the human-readable curriculum.
- `web/data/curriculum.json`: the app's copy of the same lessons.
- `web/data/kanji.json`: stroke paths, readings and visual components of the 2297 curriculum kanji.
- `web/fonts/klee-one.woff2`: [Klee One](https://github.com/fontworks-fonts/Klee) SemiBold (SIL OFL 1.1), cut down by `scripts/fonts.mjs` to the characters the app can show (about 3,100, 1.2 MB instead of 8.5 MB). It is a textbook-style font: its kanji have the handwritten shapes the drawing pad expects (氵, 心, 糸, ...), unlike printed Mincho or Gothic. Settings → Display → *Japanese font* can switch to the device's Mincho or Gothic instead.

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
- **Draw cards:** a word introducing a kanji with no single-kanji lesson within 300 lessons gets `draw: <kanji>`. Its writing card draws that kanji instead of using the kanji grid.
- **Examples:** Tatoeba sentences matched by word *and* reading, at most 32 characters. Kanji not learned yet are written in hiragana.

### Sources

KanjiVG, KANJIDIC2 and JMdict (EDRDG), JmdictFurigana, jmdict-simplified, Jonathan Waller's JLPT lists (tanos.co.uk), yomitan-jlpt-vocab, kanji-data and Tatoeba. Authors, links and licences are in [DATA-LICENSE.md](DATA-LICENSE.md). The app shows them on its *Credits & licences* page (Settings → About).

kanji-data also carries WaniKani content, which is not freely licensed; the build reads only its KANJIDIC and JLPT fields.


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
  js/sync.js    sync client
  js/ui/        drawpad, minigames, DOM helpers
  js/screens/   home, lessons, learn, review, practice, kanji, settings
server/         Cloudflare Worker (auth, allowlist, sync) and D1 migrations
tests/          node:test unit tests (incl. Worker + sync end to end on a D1 stand-in)
```
