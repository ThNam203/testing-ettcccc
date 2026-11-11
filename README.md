# English Derby 🐎

Live English-quiz horse race for TikTok LIVE — **local prototype** (no TikTok connection yet).
Viewers chat to join, answer A/B/C/D, every correct answer trains their horse by the same amount, then everyone races in 3D.

Design and fairness rules: [docs/design.md](docs/design.md)

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173
npm run server       # optional: stats database (data/derby.db) on 127.0.0.1:5180
```

1. Open **http://localhost:5173/** — the game (host screen). Keep it visible.
2. Click **💬 Open chat simulator** (or open `/player.html`) in a second window, side by side.
3. In the simulator, type a nickname and send any message → you join. Change the nickname to play as another viewer
   (recent nicknames are one click away). Use the **A B C D** buttons to answer.

Host controls (bottom bar): **Start now**, **Skip** phase, **Reset**, question level (A2/B1/B2), **Admin**.
Press **H** to hide the host bar before capturing the window for a stream.

> Keep the game tab **visible in its own window**. Chrome slows timers in hidden tabs (to about once a minute after
> 5 minutes), which freezes the game clock.

## TikTok LIVE (experimental)

```bash
npm run dev                         # game
npm run tiktok -- <username>        # stats server + bridge: reads that live's comments (must be live now)
```

Open **http://localhost:5173/?source=tiktok** — comments from the live become chat in the game.
Add **`&mode=firstchar`** to test with any live: every comment becomes an answer from its first character
(a–d as typed, anything else mapped to A–D), and the chat panel shows `comment → letter`.

- The bridge (part of `scripts/derby-server.mjs`) listens on `127.0.0.1:5180` only and answers only local pages.
  It logs counts, never names or comment text. Mapping/validation: `src/chat/tiktokBridge.ts` (unit-tested).
- Uses `tiktok-live-connector` (devDependency, **AGPL-3.0, unofficial**; room signing goes through the third-party
  Euler Stream service). Licence, TikTok terms and APPI (viewer names) need review by a qualified person before
  any public use.

## Stats database

`npm run server` (or `npm run tiktok -- <username>`, which includes it) stores usage stats in **`data/derby.db`**
(SQLite, built into Node 22 — no extra package). The game tab sends events every 2 s; the HUD pill shows
`stats: saving` or `stats: server offline` (events wait in the tab and are sent when the server is back).

- Saved: sessions, races, every answer (viewer, choice, correct, time), per-question results, race placings,
  viewers (nickname, TikTok @handle, first/last seen), activity per minute, gifts you record.
  **Not saved:** comment text, horse stats, cosmetics.
- Kept forever. Delete one viewer's data from **Admin → Stats → Players**. Back up = copy `data/derby.db`.
- **Admin → Stats**: headline numbers, viewer funnel, accuracy by level/category, hardest + misleading questions,
  players, sessions, activity by hour, CSV export. Period: today / 7 / 30 days / all time.
- **Admin → Winners & gifts**: pick a session → leaderboard (wins, correct answers, top-3, best place) and every
  race's finishing order, each with the viewer's @handle linked to their TikTok profile. **Give gift** records a prize
  (owed or already sent) for a race place or the whole session; the ledger tracks owed → sent / skipped, warns when a
  viewer got a gift in the last 7 days, and exports `gifts.csv`. Who wins is your call — the tab only shows the numbers.
  Contact winners by TikTok DM; keep phone numbers and addresses out of the notes. Deleting a viewer keeps their gifts'
  date, prize and status (so totals stay right) but removes who it was and the note.
- Open the file directly with any SQLite tool for your own queries. Design: `docs/design.md` §7b.
- If a browser ad/privacy blocker is installed: it blocks URLs containing "analytics", so the code and endpoints use
  `history` / `stats` names instead.

## Admin page (`/admin.html`)

Open it from **Admin** on the host bar, in another window of the same browser. It controls the game tab live.

| Tab | What you can do |
|---|---|
| Live | Phase + timer, Start / Skip / Reset (Reset asks for a second click), riders with stats and ✓ answered, **Kick** / **Block** per rider, queue, session leaderboard (Clear needs a second click) |
| Riders & joining | Max riders (1–12), riders needed before the countdown starts, max queue, **join word** (empty = any message joins) |
| Quiz & timing | Level, questions per race (3/6/9/12), points per correct answer, every phase time, live "one race loop ≈ …" estimate, locked fairness rules |
| Display | Hide answers in chat, explanations, name tags, host bar, chat lines (applies at once) |
| Questions | Browse/search/filter the bank by level and category, switch single questions on/off |
| Moderation | Block list: block by user ID, unblock |
| Stats | Usage history from the stats database (see above) |
| Winners & gifts | Session leaderboard, race placings, gift ledger (see above) |
| Backup | Download settings as JSON, import a file (validated, loads into the form only), load defaults |

How changes apply:
- Edits stay in the form until **Apply** (or Ctrl/⌘+S). The bar at the bottom lists unsaved changes and problems;
  Apply is disabled while any value is out of range.
- In the lobby, game rules apply at once. During a race they wait for the next lobby — the race in progress never
  changes. Display settings, kicks and blocks apply at once.
- The game tab validates everything again and saves it in this browser (localStorage). Use Export/Import to move
  settings to another computer.

The layout adapts to portrait (9:16, what phone viewers see) and landscape.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm test` | Unit tests (engine, fairness, parser, protocols, settings, admin commands) |
| `npm run coverage` | Tests + coverage (80% threshold on engine) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Typecheck + production build to `dist/` |

## Code map

| Path | What |
|---|---|
| `src/engine/` | Pure game logic: `game.ts` (reducer/state machine), `race.ts` (deterministic physics), `questions.ts`, `chatParser.ts`, `playback.ts`, seeded `rng.ts`. No DOM. |
| `src/content/questions.ts` | Question bank (A2/B1/B2). Edit freely; validated on startup. |
| `src/chat/` | `ChatSource` interface + `LocalChatSource` (BroadcastChannel). TikTok source plugs in here later. |
| `src/render/` | three.js scene: track, low-poly horses, cameras. |
| `src/ui/` | HUD overlay (DOM; chat text is always set with `textContent`). |
| `src/player.ts` | Chat simulator page. |
| `src/settings/` | Settings schema (validation, parsing of saved/imported JSON, race-length estimate) and localStorage. |
| `src/admin/` | Admin channel: message types + validators, pure command handler, game-tab bridge, admin-tab client. |
| `src/admin.ts`, `src/ui/admin/` | Admin page UI: draft store, form fields, tabs. |

## Tuning

- Timings, points, max riders, join word, question on/off: the admin page. Defaults: `src/engine/config.ts`;
  allowed ranges: `CONFIG_LIMITS` in `src/engine/configRules.ts`.
- Race physics: `RACE` in `src/engine/race.ts` — re-run `npm test` after changes; the fairness tests will fail if a
  stat stops mattering or luck can beat a correct answer.
