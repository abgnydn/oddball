# Odd Ball — design spec

A switch-accessible, turn-based golf game. You are the ball. Before every shot
you choose what **shape** to be; the golfer strikes you; you watch (and hear)
what happens. Shape choice is the entire skill — the game takes no timing,
aiming or reflex input.

Platform: web, standalone (Vite static build). Audience: switch users (1–2
inputs) and low vision. Text is short sentences and common words. Speech is the
interface; a caption is read at a glance. Built **against** the NARBE House
developer guide (narbehouse.github.io/developer-guide.html) and the input
contract it names, `bennyshub/ACCESSIBILITY.md`. This build is standalone — it
cannot call the hub's shared modules — so it enforces the same rules with its
own copies. The departures table below lists everywhere it does not follow the
contract.

Evidence scope: besides the contract, one hub game was read closely
(BENNYSMINIGOLF) and one opened without being cited (BENNYSFOOTBALL). Where
this file cites "their games" it means those files, not the library.

## Input grammar

- **Space release** (held < 3 s): step the scan highlight forward one item.
  Fires on **keyup**, so an accidental hold does not trigger.
- **Space held ≥ 3 s**: backward scanning while held — one step at the
  threshold, then one per `scanMs` until release. The release does not step.
- **Auto Scan** (setting, default off): the highlight advances by itself, one
  step per `scanMs`, on every list — a single-switch player only ever presses
  Enter. Manual Space still steps and resets the beat.
- **Enter release**: select the highlighted item (keyup) — unless that press
  opened the menu. Any release short of the 3 s threshold selects; a slow
  release never costs a switch user their pick.
- **Enter held ≥ 3 s**: open the pause/context menu at the threshold. That
  press's release is consumed, so the menu stays open on the item it opened
  under. The contract's convention is ~3 s to scan backwards and ~5 s to pause;
  this build uses 3 s for both, matching its own Space threshold — a deliberate
  departure, listed below.
- **Hold progress is indicated** (§4): from 1200 ms a ring appears over the
  play area and fills to the 3000 ms threshold, and a beep a step higher each
  second makes the same progress audible. The Enter hold, the Space
  backward-scan hold and the pointer hold all drive it.
- **Two-step confirms**: New round, Exit and Delete all throw something away,
  so the first pick arms and only a second acts. Armed, the list becomes a
  two-row dialog — the cancel answer first, focus opening on it, nothing else
  reachable — so over-scanning cannot land on the destructive answer.
- **250 ms post-release cooldown** per key, guarding against switch bounce and
  tremor. Pointer selects (click and dwell) have their own.
- **Scanning is idle until the first press** (Auto Scan off). With Auto Scan
  on, the highlight starts moving as soon as a list appears.
- **Wrap deadzone**: one manual step before the wrap lands on "no highlight",
  so a held switch does not loop forever unnoticed; the next step focuses item
  0. Auto Scan skips the deadzone — a timer stepping into a silent slot reads
  as the app having died. (The contract does not specify wrap behaviour; this
  is an addition, not a departure.)
- Scan order is fixed top-to-bottom, never reordered mid-session. Returning
  from a submenu restores the highlight to the item that opened it.
- **Pointer**: click selects; click-and-hold (≥ 3 s) opens the menu; nothing
  requires a drag. Dwell (hover-to-pick) is a setting for head- and
  eye-tracking users.
- The menu is reachable on every screen: the hold, the on-screen Pause button,
  and a scannable **Menu** row at the end of both gameplay lists. During the
  flight animation there is no list, and there a single Enter press opens the
  menu.

### Where this departs from the hub contract

| `ACCESSIBILITY.md` says | This build |
| --- | --- |
| §1: the player "is not a child, and should not be talked to like one" | the cast layer (CAST.md) writes the shapes as characters with feelings. Whether that reads as warmth or as talking down is not this build's call to make for a player it has never met, so it is a **setting, off by default**; the shipped reading names the shape for what it is and describes what it does |
| §1: give the player "a way to choose how hard the game pushes back" | no difficulty setting. One-player golf has no fail state (eight strokes end the hole); the practice range is unscored. Neither is a difficulty the player chose. Not done |
| §4: `scan-manager.js` enforces the 250 ms cooldown — "you should not" write your own | its own 250 ms cooldowns: there is no `NarbeScanManager` in a standalone build to defer to |
| §4: ~3 s to scan backwards, **~5 s to pause**, "and new games should match it" | 3 s for both. The backward hold matches; the pause hold is deliberately shorter. (BENNYSMINIGOLF itself uses 6 s, undocumented in their §12 — not reported to them yet) |
| §5: use `SafeAudio`, never the Web Audio API | WebAudio throughout — see the §10 table row for the full position |
| §5/§10: TTS via `NarbeVoiceManager`, "never keep your own copy" | raw `speechSynthesis` with its own on/off, rate and volume settings |
| §7: Settings has a **Voice** row cycling available voices | no voice picker. The rows here are "Text to speech", "Speech speed", "Speech volume" — §7's reserved word is not reused |
| §7: canonical Settings row order | Scan speed sits before Auto scan; game-specific rows sit after both; Character names sits with the speech rows because it changes what speech says |
| §5: `ios-audio-fix.js` unlocks WebAudio **and speechSynthesis** on first touch | the WebAudio half is handled (lazy context + resume); nothing unlocks speechSynthesis, so the first utterance on iOS may be silent |
| §9: "large targets (**≥ 64 px** on tablet)" | **not met on small screens.** The Pause button tracks the text setting: 44.6 px at the shipped 125 % default, first clearing 64 px at 200 % — and on viewports ≤ 560 px tall it is capped at a flat 44 px at every scale. Scan rows keep a 64 px floor only above 700 px of height and 560 px of width; short or narrow screens drop them to 56 px, then 44 px. Each cap exists because the full-size control pushed itself or the footer off a short screen — a target you cannot reach at all is worse than an undersized one — but they are departures, not compliance. `pnpm layout-check` measures all of it on every build |
| §12: pause must be "something you can *scan to and select*" — a hold-only pause is "a locked door" | met: a scannable **Menu** row sits at the end of both gameplay lists, and during the flight animation — where there is no list — a single Enter press opens the menu. The animation hides the list for 3.45-7.95 s (0.45 s pre-roll + a 3-6 s flight + 1.5 s afterglow on a hole-out), or 3.45-6.45 s with Animations off since the afterglow is skipped; turning Animations off removes the animated flight entirely. §12 also prices a scannable row — every pass costs a stop — so the Menu row is placed last, after the shapes, where it does not sit between the player and the shot |
| §5: `tutorial-modal.js` provides the shared how-to-play modal | not used and not reimplemented as a modal. How to Play is a scannable Help screen in the same list grammar as everything else |
| §9: focus labels must be short — at a 1 s scan speed "a long label becomes a drone" | shape labels run ~4-10 s spoken, and focus labels deliberately do not hold the scan timer, so at short rungs the tail is not heard. Mitigated: the yardage the shot turns on comes first (~1.9 s, inside the 2 s default) and the character blurb — skippable without cost — comes after. `menu-check` asserts that order. At the 1 s rung nothing useful fits, and wording cannot solve that |

### §10, the shipping checklist, item by item

§10 has 18 items. Counting the table below:
**12 met, 3 met by a different route, 3 not met** — where "different route" means
the behaviour is equivalent but the shared module it is supposed to come from
does not exist in a standalone build, and nothing else. Three of the 12 rest on
harness evidence alone, and none of the 18 has been confirmed by a switch user.
Count the rows; this sentence is a summary of them and summaries drift.

| §10 item | This build |
| --- | --- |
| Every action reachable with **Space and Enter only** | met (`input-check`, `menu-check`) |
| Every action reachable with **Enter alone**, Auto Scan on | met by harness. Never by a switch user — see the last row |
| Menu actions fire on **release**, not press | met (`switch.ts` emits on keyup; `input-check` asserts it) |
| Holding Space scans backwards "in every menu", repeating at the player's scan speed from `NarbeScanManager` — "not a rate you picked" | **different route.** Every menu, at the player's saved speed. The speed comes from this build's own copy of that setting, because there is no `NarbeScanManager` to read |
| Holding Enter opens pause from anywhere in gameplay, with a visible and audible indication while holding | met. The hold works everywhere including flight; from 1200 ms a ring fills to the 3000 ms threshold and a blip a step higher each second makes the progress audible. §4 names Race Tracks as the build to copy; this matches its shape and beep figures. The pointer hold and the Space hold drive the same indicator |
| An on-screen Pause button does the same | met. The hold-progress requirement does not apply to a button press |
| Settings reachable from **both** the main menu and the pause menu | met, including during the flight animation: Back from Settings restores the flight's screen state and reopens the paused menu. `menu-check` asserts the row is there, that it reaches Settings, and that Back does not strand the player |
| Auto Scan and Scan Speed present, reading from `NarbeScanManager` | **different route.** Present, from this build's own copies |
| TTS reads focus, selection and outcomes, via `NarbeVoiceManager` | **different route.** All three are read; the engine is raw `speechSynthesis` |
| Sound through `SafeAudio` — no `AudioContext` | **not met.** WebAudio throughout: the 23 samples are decoded through an `AudioContext`, and the flight tone and cup beeper are synthesised on it. `shared/safe-audio.js` says why the rule exists — some hub games run in an Electron desktop build "where an `AudioContext` can take the renderer process down with it" — so this is a functional risk in that build, not a style difference. It is reachable: the samples are already files, and the flight tone's 180-900 Hz glide is a 5:1 ratio that `playbackRate` with `preservesPitch = false` covers. Not done, and disclosed on submission rather than quietly left |
| Reset Progress is two-step | met. Last row in Settings; arms on the first pick, acts on the second, guarded against a bounce. Clears settings, the round, saved holes, the editor draft and best scores |
| Exit Game sends `postMessage({ action: 'focusBackButton' })` | met. Exit posts it to the parent when running in the hub's iframe, guarded on `window.parent !== window` the way their own games guard it, and falls back to this build's title when standalone |
| Mouse and touch work everywhere, no interaction requires a drag | met by hand, on mouse and touch. No harness covers the pointer paths — see "What the harnesses do NOT establish" |
| Anything mouse-only or off-site sits behind a spoken confirm dialog, "with Cancel first in the scan order and the scan trapped in the dialog" | met, though the trigger does not arise — nothing here is mouse-only and nothing leaves the page. The shape is followed anyway by the three two-step confirms: armed, each becomes a two-row dialog with the cancel answer first and focus starting on it. `menu-check` asserts the order, the trapping and the opening focus |
| Progress saves and resumes | met. `layout-check` resumes a seeded round through Continue on every run, which exercises the path without being a test of it |
| Readable at 100 % on a tablet | met, by eye on a 768x1024 viewport. `layout-check` establishes only that nothing is clipped or overflowing there; it does not measure type size, contrast or legibility |
| Added to `apps/games/games.json` with a thumbnail and genres | **not met.** Not submitted. That waits on the CAST.md review |
| **Played start to finish with one switch, by someone who is not you** | **not met.** §10 calls this "the only test that actually counts" |

## TTS

- Web Speech API (`speechSynthesis`). Speak on focus AND on selection. Speech
  never blocks input — the next focus interrupts it; input is never queued
  behind it.
- Everything spoken is also shown as a large-print caption, and `console.log`-ed
  as `[tts] <text>` for automated verification.
- Settings: TTS on/off, rate, volume, and **Character names** — the cast layer
  (CAST.md), off by default. With it off, every spoken line uses the shape's
  plain name and plain blurb, the hole-out line ends at "In the cup!", the Help
  page's shapes entry is titled "The shapes", and Penny's tap sound and
  tap-bounce are gated too (via a `data-characters` attribute). Every spoken
  line that names a shape routes through `shapeName()`/`shapeBlurb()`, and
  `menu-check` greps every file under `src/` for a reader that skips the
  setting — a leak fails the suite. The ball's face is deliberately NOT gated:
  it is the game's art, not a character's name; nothing enforces that boundary,
  so it is recorded here.
- All text lives in `src/game/lines.ts`: short sentences, common words, whole
  yards. No hold threshold is quoted to the player (§4). Scores are reported
  with their margin, not praised.
- With Auto Scan on, the scan timer waits while narration speaks, so the
  highlight never steps off an item mid-sentence. Per-item focus labels do NOT
  hold it — speech length must not replace the player's chosen scan speed. A
  watchdog releases the hold if the browser never reports the utterance ending
  (a real Chrome behaviour, not a theoretical one).

## Visual

- DOM UI for all menus and racks (scannable lists); canvas only for the course
  view.
- Four color themes (`high-contrast` default, `light`, `dark`, `warm`) and
  five text scales (100–200 %).
- Highlight ring: thick outline, thickness setting thin/medium/thick, gentle
  focus pulse (off under reduce-motion). Its reach outside the row is defined
  once as `--hl-reach` and consumed by the scroll padding that keeps it on
  screen. On screens ≤ 480 px tall or ≤ 400 px wide, the offset drops to 0 and
  the thick setting is served the medium width — a 12 px ring cannot be drawn
  whole there, and a ring missing an edge reads as thinner than the medium one.
  That overrides a player's explicit setting; it buys the thickest ring that
  closes.
- Header: game title + screen name. Footer: mode, the highlighted item's name,
  the legend, and an on-screen **Pause** button (pointer/touch parity with the
  hold). The button is not in the scan order; the scannable route is the Menu
  row.
- The list and the course view sit side by side above 900 px of width; below
  that the layout stacks — always under 560 px, and under 900 px whenever text
  is above 100 %. The panel's width floor is `55vw` inside a clamp, so it
  cannot be starved at any width the side-by-side layout applies to.
- On a small window the caption bar shrinks first (its text is spoken and it
  scrolls), then the footer legend goes, then the type sizes stop scaling — so
  the highlighted row is the last thing to give up room.
- Reduce-motion: flight is summarized (ball drawn at its end position, events
  spoken) instead of animated.

## Game rules

- Six-hole courses, played in order. Stroke count per hole; friendly score
  names vs par. Max 8 strokes per hole, then the hole ends — the line says so
  plainly. One-player has no fail state; two-player produces a winner.
- Each stroke: scan the shape rack → pick a shape → short swing anticipation →
  flight plays out with sound and narration → result spoken, with the distance
  and what remains.
- The golfer always aims at the cup with sensible force (capped by the shape's
  reach). The SHAPE determines what actually happens. Aiming solves for a calm
  day; wind acts only on the real flight — wind is a shape-choice
  consideration, never an aiming skill.
- The cup is generous: at rest within `GIMME_M` = holed. No putting grind.
- Water: splash, spoken kindly, ball returns to where it was; the stroke
  counts. Sand/rough: lie penalty multiplies the next strike's power.
- The rack also carries "Where am I?" (hole, distance, lie, wind — costs
  nothing) and the **Menu** row.

## The six shapes

| Shape | Identity | Mechanics |
|---|---|---|
| Ball (sphere) | the baseline, rolls out long | mid carry, real rollout, mild variance |
| Cube | lands dead; the precision tool | short reach (~85 m), near-zero bounce/roll, tiny variance |
| Disc | glides far, drifts in wind | longest reach, lift, windSens ≫ others |
| Egg | the gamble | mid reach, huge carry variance |
| Star | chaos bounces, fun over function | high restitution + large bounce-angle jitter |
| Pancake | carries exactly, sits down | high lob, no bounce, no roll, low variance |

No shape may dominate: no single-shape strategy may beat the intended mixed
strategy over a course, and each purposeful shape (sphere, cube, disc, pancake)
must be part of the best line on at least one hole. The gamble shapes (egg,
star) are never the sober best line; instead each must have a hole where its
lucky tail beats the intended line. All harness-asserted (`pnpm holes`).

## Courses

**Sunny Meadows**: The Runway (tutorial, flat), The Pond (carry or lay up),
The Gale (headwind punishes the disc), Tiny (the cube hole), The Staircase
(bouncy shapes climb terraces), Home Stretch (sequencing test).
**Wild Canyon**: elevated tee, island green, canyon carry, ascending washboard,
a 10 m wall, tailwind bomb.

Pars are literals in `tuning.ts`; `pnpm holes` fails if any differs from the
measured value.

## Physics

Side view; x downrange, y up; SI internally, yards in speech.

- Projectile with quadratic drag, per-shape launch angle, per-shape `lift`
  (fraction of gravity cancelled while airborne — the disc's glide).
- Wind = horizontal acceleration ∝ wind speed × shape `windSens`, airborne only.
- Terrain = per-hole heightfield polyline. Bounce: velocity reflected about the
  surface normal × `restitution`, angle perturbed by `bounceJitter` (seeded).
  Below a speed threshold → roll (1-D along terrain; slopes accelerate/brake).
- Sand kills bounce and roll on contact. Water: splash event.
- **Aiming**: the sim searches strike speed so the noise-free simulated total ≈
  distance to cup. Noise applies only to the real strike. No hand-tuned aim
  factors.
- Deterministic: `mulberry32` seeded RNG threaded through every strike.

## Verification harnesses

Seven harnesses in `tools/`, run headless. They are the safety net: tune
`tuning.ts` until they pass; never weaken an assertion to pass.

- `pnpm calibrate` — per-shape distance/dispersion vs bands declared in tuning;
  asserts every shape identity (cube stops dead, disc's wind swing ≫ sphere's,
  Dot's homing helps but is bounded, …).
- `pnpm holes` — plays every course over many seeds with the intended strategy
  and every single-shape strategy. Asserts completability (≤ 8 strokes on ≥
  95 % of seeds), no single-shape dominance, every purposeful shape in some
  best line, every gamble shape's lucky tail paying somewhere, and measured
  pars matching tuning.
- `pnpm editor-check` — the hole composer's clamps make every parameter combo
  playable; samples 62 of 540 combinations (all 32 corners + 30 mixed picks).
  The playability guarantee is by construction; this spot-checks it.
- `pnpm input-check` — headless self-test of the switch/scan state machines:
  release semantics, hold thresholds, cooldowns, cancel paths.
- `pnpm menu-check` — drives the real switch machine, scanner and flow.
  Asserts: the menu latches after the hold that opened it; two-step confirms
  arm, bounce-guard, and take the cancel-first two-row shape; Auto Scan wraps
  without a silent step and waits for narration; Settings is reachable during
  flight and Back returns; the hold-progress constants are sane; a shape's
  yardage is spoken before its blurb inside the default scan interval in both
  cast modes; and the cast layer is all-or-nothing — including a source-level
  grep of every file under `src/` for ungated readers, which does not depend on
  anyone remembering a call site. It pins its own check count, so an assertion
  that silently stops running fails the suite.
- `pnpm layout-check` — serves `dist/` and drives the real bundle in headless
  Chromium across every text scale and a viewport grid from 1920x1080 down to
  280x480, over ten screens reached by real click paths. For every row it
  measures clipping against the scrollport, the highlight ring's own edges, the
  Pause button's reachability, and document overflow in both directions. Four
  focused passes cover the thick ring, character names, every breakpoint at N
  and N+1, and the shipped motion default. Before the sweep it self-tests: it
  plants a clipped row, an overflowing row, a cut ring and an out-of-viewport
  Pause button, and exits non-zero if any detector fails to fire — a detector
  that cannot fail is not a check.
- `pnpm mutate` — proof the harnesses are not vacuous: breaks the shipped code
  (and the docs) one edit at a time and requires the named harness to go red
  for each, plus one pair applied together. Refuses to start on a dirty tree.
  Run it for the count; a number copied here would drift.

### What the harnesses do NOT establish

- **"Every row" means every row the grid visits.** `layout-check` enumerates
  viewports and screens; it does not prove a property for all of either.
- The end-of-round summaries need a real hole-out to reach and are not
  automated; they were swept by hand.
- **No harness imports** `main.ts`, `draw.ts`, `hud.ts`, `sfx.ts` or `save.ts`;
  `layout-check` runs them in the browser but observes layout only. The
  uncovered surface is the behaviour in them that is neither layout nor
  imported: click-and-hold, the Pause button's bounce guard, the click-swallow
  after a hold, hover-to-pick, and the `aria-hidden` targets — restoring
  `aria-hidden` on `main` would hide the pause menu from every screen reader
  with the whole suite green.
- **The cast checks match strings.** A leak that is not a string — a sound, an
  animation — is invisible to them; Penny's tap is gated and checked
  separately because exactly that happened.
- **Passing is not the same as applying**: `layout-check` measures outcomes, so
  a CSS rule that never applies still passes.
- **No harness plays the game without looking at the screen**, and nobody has.
- **Nobody has played this with one switch.** No harness substitutes for that,
  and §10 says so.

## Modes

- **Two courses**, 1P best-total per course tracked and spoken in the picker.
- **Pass-and-play 2P**: each hole played out by Player 1, then Player 2;
  per-player scorecards; a match verdict naming the winner.
- **Practice range**: no cup, no score, every shot narrated.
- **Make a Hole**: parameter rows (length/ground/water/sand/wind) that cycle
  like settings; every combo playable by construction; par measured by
  simulating the composed hole; up to `MAX_CUSTOM_HOLES` saved.
- **Dwell-to-select**: hover 1.2/2 s (setting) to pick. After a list rebuilds
  the dwell does not re-arm until the pointer moves `DWELL_REARM_PX` (24 px) —
  otherwise arming a two-step confirm would let a still gaze confirm the prompt
  it had just opened.
- **Flight sonification**: a quiet tone glides with the ball's height; the cup
  beeper accelerates as a rolling ball closes in.

## Persistence

- `localStorage` key `oddball-save-v1`; auto-save after every state-changing
  selection.
- A saved scan speed from an older build is kept exactly as it is — nobody's
  speed changes without them asking; cycling the row once rejoins the ladder.
- Resume restores hole, strokes, ball position/lie, settings, and the
  highlighted index. Title offers Continue when a round exists.

## Module map

- `src/types.ts` — shared contracts. `src/tuning.ts` — every number.
- `src/sim/` — deterministic physics. `src/input/` — switch grammar + scanner.
- `src/speech/` — TTS. `src/audio/` — sound. `src/render/draw.ts` — canvas.
- `src/ui/` — DOM shell and styles. `src/game/` — flow, text, composer, saves.
- `tools/` — the seven harnesses above.
