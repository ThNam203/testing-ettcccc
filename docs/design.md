# English Derby — Game Design (v0.1, local prototype)

> Status: draft for review. Local-only prototype; TikTok LIVE integration is phase 2.

## 1. Pitch

A TikTok LIVE room where viewers learn English by racing horses.
Viewers **join by chatting**, answer English questions **by typing A/B/C/D in chat**, and every correct
answer trains their horse. After the quiz rounds, all horses race on a 3D track. Better English = faster horse.

## 2. Goals / non-goals / anti-goals

| | |
|---|---|
| **Goals** | Fun, fast loop (~3–4 min) that keeps live viewers chatting; real learning moment after every question (correct answer + explanation); provably fair scoring; runs locally with zero external services. |
| **Non-goals (v0.1)** | TikTok connection, accounts, persistence, gifts/monetization, mobile-native app, sound. |
| **Anti-goals** | Typing speed or chat lag decides who wins. Luck beats knowledge. Spam-guessing pays off. Late joiners are crushed by people who were there earlier. |

## 3. Core loop

```
LOBBY ──► QUESTION ──► REVEAL ──(×6)──► RACE ──► RESULTS ──► LOBBY
 30s        15s          6s             ~35s       15s
```

1. **Lobby** — "Type anything in chat to join!" First 12 chatters get a lane (horse + jockey colour).
   Countdown starts when the first racer joins. Host can start early.
2. **Question** (6 rounds) — Question + 4 choices on screen. Each round trains one stat, rotating
   **Speed → Stamina → Strength** (2 rounds each). Racers answer `A`/`B`/`C`/`D` (or type the exact answer text).
   Ends early when every racer has answered.
3. **Reveal** — Correct answer highlighted, short explanation, "+10 SPEED → 7 racers". Horses that gained flash.
4. **Race** — 3-2-1 countdown, deterministic simulation driven by stats, 3D chase camera follows the pack.
5. **Results** — Podium + full order with finish time and correct-answer count. Session leaderboard updated.
   Viewers who chatted during the race are already queued for the next one.

## 4. Fairness rules (the core requirement)

| Rule | Why |
|---|---|
| Every correct answer = **same fixed points (+10)**, no time bonus | Chat latency differs per viewer (TikTok chat is not real-time-equal). Speed of typing must not matter. |
| **First answer locks** — later messages ignored | Kills spam-guessing (A, B, C, D in a row). |
| Wrong answer = 0, no penalty | Encourages beginners to try. |
| Everyone gets the **same questions**, same window | Equal opportunity. |
| Stat per round **rotates evenly** (2/2/2) | Max possible stats identical for everyone (20/20/20). |
| **Join only in lobby**; mid-game chatters go to a **queue** with priority for next race | Late joiners never start a race having missed questions. |
| Each stat point is worth **about the same race time** (tuned + tested) | No "dead" questions — a Stamina question matters as much as a Speed one. |
| Luck is capped at **±1% top speed** and is **always smaller than one correct answer** (tested over thousands of seeds) | Breaks ties between equal racers without ever overruling knowledge. |
| Race is a **pure deterministic simulation** from (stats, seed) | Reproducible, auditable, testable. |

## 5. Stats → race physics

| Stat | Effect | 0 pts → 20 pts (max in one race) |
|---|---|---|
| **Speed** | top speed | 14.0 → 14.9 m/s |
| **Stamina** ("duration") | energy pool; when empty the horse drops to 80% of top speed. Pool never covers the whole race, so every point counts | 30 → 62 |
| **Strength** | time from standstill to top speed (acceleration out of the gate) | 11 s → 5 s |

Measured (tests/race.test.ts + tuning run): every **+10 points ≈ 1.1–1.4 s faster**, in any stat, across the whole range.
Max luck swing ≈ **0.4 s** (±0.5% top speed). Race length **≈ 35 s (perfect) to ≈ 43 s (no correct answers)**.

Track: straight 450 m, 12 lanes (riders fill from the centre out). Simulation at 60 Hz, sampled at 20 Hz for rendering.

## 6. Screen (designed for streaming, works portrait 9:16 and landscape)

- **3D scene** (Three.js): grass, dirt track with lane lines, rails, start gate, checkered finish line,
  low-poly horses built from primitives (galloping legs), jockeys in racer colour, name tags.
- **Camera**: slow orbit around the gate in lobby/quiz; elevated chase cam on the leader during the race.
- **HUD** overlay: phase title + timer bar, question card with A–D choices, answered counter,
  racer list with SPD/STA/STR bars and ✓ when answered (never shows *what* they answered),
  live chat feed, results podium.
- **Host bar**: Start now, Skip phase, Reset, question level (A2 / B1 / B2), open chat simulator, open admin page.
- **Admin page** (`admin.html`, see §7a): every setting below, live moderation, question on/off, backup.

## 7. Architecture

```
ChatSource (interface)  ──ChatMessage──►  Game engine (pure reducer)  ──GameState──►  Renderer + HUD
  ├─ LocalChatSource (BroadcastChannel; player.html tabs)        src/engine/*             src/render/*, src/ui/*
  └─ TikTokChatSource (phase 2: tiktok-live-connector → WS)
```

- **Engine** (`src/engine`): `createGame` + `reduce(state, action)`; actions = `chat`, `tick`, host actions.
  No DOM, no Date.now inside — time is passed in. Seeded RNG kept in state. Unit-tested.
- **Content** (`src/content/questions.ts`): editable question bank, validated at startup. Choices are shuffled per race
  so the right answer isn't always in the same slot.
- **Local chat simulator** (`player.html`): type as any nickname; messages go over `BroadcastChannel` to the host tab.
  One tab can play many viewers by changing the nickname.

## 7a. Admin settings (v0.2)

| Group | Settings (range) | When it applies |
|---|---|---|
| Riders & joining | max riders 1–12 · riders needed to start the countdown 1–max · max queue 0–1000 · join word (empty = any message; whole-word match, case/punctuation ignored, not a–d) | next lobby (at once if in the lobby) |
| Quiz | level A2/B1/B2 · questions per race 3/6/9/12 · points per correct 1–100 · questions switched off (each level keeps ≥ questions per race) | next lobby |
| Timing (s) | lobby 5–300 · answer 5–60 · close after all answered 0–5 · reveal 2–30 · gate countdown 0–10 · after finish 0–15 · results 5–120 | next lobby |
| Display | hide answers in chat · explanations · name tags · host bar · chat lines 0–20 | at once |
| Moderation | kick (lobby: lanes re-seat from the queue; quiz: lane empties, answer dropped; race/results: result stands, removed from queue) · block / unblock (blocked chat ignored and hidden) | at once |

Fairness with variable settings: the race uses each stat **as a share of its maximum** (`scaleStats`), so changing
questions-per-race or points-per-answer never changes the balance. Tests confirm one extra correct answer beats luck
for 3, 6, 9 and 12 questions. Stat order, equal points, first-answer-locks and lobby-only joining are not settings.

Transport: admin tab ⇄ game tab over `BroadcastChannel('english-derby-admin')` (same browser only). Every message is
validated on arrival; the game tab re-validates settings before applying and saves them to localStorage.
Phase 2 note: when the game runs behind a server, admin commands must move to an authenticated endpoint.

## 7b. Stats database (v0.4)

Goal: let the operator see how the service is used and which questions work, to improve it. Local only.

- **Storage:** SQLite file `data/derby.db` via Node's built-in `node:sqlite` (no dependency). Kept forever; viewers can be
  deleted one by one from the admin page. Nicknames are stored (local machine only).
- **Not stored:** horse stats/physics, cosmetics, comment text (comments are only counted).
- **Flow:** game tab derives analytics events from state changes (`src/history/events.ts`, pure) → batches them to the
  local derby server (`scripts/derby-server.mjs`, 127.0.0.1:5180, also runs the TikTok bridge) → `src/stats/store.ts`
  writes SQLite and answers stats queries → admin **Stats** page. Events carry unique ids, so retries never double-count.
  If the server is down, events queue in the game tab (capped) and the HUD warns.
- **Events:** sessionStarted / sessionSource / sessionEnded, chatSeen, viewerJoined, raceStarted, answerLocked,
  questionClosed, raceEnded (finished | reset, with `placings`: viewer, place, correct answers, finish ms).
  chatSeen carries the TikTok @handle when the source has one (simulator viewers have none).
- **Tables:** sessions, races, question_plays (per-choice counts by *original* choice index so distractors compare across
  races), answers (viewer, choice, correct, ms after open), viewers (nickname, first/last seen, totals),
  room_minutes + minute_chatters (activity per minute), event_log (dedupe), race_results (placings), gifts (ledger).
- **Stats page:** headline numbers, comments→joined→answered→finished funnel, accuracy by level and category,
  hardest and misleading questions (a wrong choice beats the right one), top players, recent sessions, activity by
  hour, CSV export, delete viewer.
- **Winners & gifts (v0.5):** the admin decides who gets a prize; the tool shows the numbers and records it.
  `src/stats/gifts.ts`: per-session leaderboard (wins → correct → top-3 → best place → nickname) and race placings;
  ledger rows `owed | sent | skipped` with prize, note, sent time. One open gift per viewer per race (skipped ones don't
  block). TikTok cannot send gifts to viewers, so prizes are delivered outside TikTok and the @handle is how the admin
  finds the winner. Deleting a viewer nulls the gift's viewer and clears its note; prize, status and dates stay.

## 8. Phase 2 — TikTok LIVE (experimental bridge built, v0.3)

Built: `npm run tiktok -- <username>` (Node bridge, Server-Sent Events on 127.0.0.1:5180) + `TikTokChatSource`
(`?source=tiktok`, optional `&mode=firstchar` test mode). Viewer id = TikTok numeric user id (stable across renames).
Verified against a real public live: 22/22 comments forwarded, real viewers joined, answered and raced.
Note: tiktok-live-connector 2.5 emits `content` / `user.idStr` / `user.displayId` (README says `comment` / `uniqueId`);
both shapes are handled.

Original plan:

- Small Node server using `tiktok-live-connector` → forwards `chat` events (`uniqueId`, `nickname`, `profilePictureUrl`, `comment`)
  over a local WebSocket → `TikTokChatSource` implements the same `ChatSource` interface. Engine unchanged.
- Host streams the browser window via TikTok LIVE Studio.
- Open items: Euler Stream rate limits/plan, AGPL-3.0 licence review, TikTok ToS and APPI review for storing viewer names
  (confirm with a qualified person), gifts → cosmetic only (never stats, to keep it fair).

## 9. Ideas parked for later

Gift = cosmetic horse skins/trails only; "Teacher mode" custom question sets; sound + commentator TTS;
weekly season leaderboard (needs persistence); team races (half the room vs the other half); question difficulty
picked from room's recent accuracy.
