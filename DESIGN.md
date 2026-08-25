# Odd Ball — design spec (canonical)

A switch-accessible, turn-based golf game. You are the ball. Before every shot you
choose what **shape** to be; the golfer strikes you; you watch (and hear) what happens.
Shape choice is the entire skill. The game takes no timing, aiming or reflex input.

Target platform: web, standalone (Vite static build). Audience: switch users
(1–2 inputs) and low vision. Text is short sentences and common words. Speech
is the interface and a caption is read at a glance. Built to the NARBE House
developer guide (narbehouse.github.io/developer-guide.html) constraints.

## Input grammar

Source: the NARBE hub's input contract, `bennyshub/ACCESSIBILITY.md`, which the
NARBE House developer guide names as the authority. It gives: hold-Space scans
backwards; Auto Scan is a saved setting, not a hold gesture, and with it on
Enter alone reaches everything; scan speed is 1/2/3/4 s, default 2 s; the scan
manager debounces 250 ms after any release; and the hold thresholds belong to
each game, by convention roughly 3 s to scan backwards and roughly 5 s to pause.

Two hub games were also read against that contract — BENNYSFOOTBALL and
BENNYSMINIGOLF, 2 of the 20 in the library. Where this file cites their
behavior it means those two files, not the library.

This build is standalone: it cannot call `NarbeScanManager`, so it stores and
enforces the same settings itself. "Where this departs from the hub contract"
below lists every place that shows.

- **Spacebar release** (held < 3 s): step scan highlight FORWARD one item.
  Activates on **keyup** so accidental holds don't trigger.
- **Spacebar held ≥ 3 s**: BACKWARD scanning while held — one step at the
  threshold, then one per `scanMs`, until release. The release does not step.
- **Auto Scan (setting, default off)**: the highlight advances forward by
  itself, one step per `scanMs`, on every list — a single-switch player only
  ever presses Enter. Manual Space still steps and resets the beat;
  hold-Space backward takes priority while held.
- **Enter release**: SELECT the highlighted item (fires on keyup) — unless that
  press opened the menu. A slow release must never cost a switch user their
  selection, and any release short of the 3 s threshold selects normally.
- **Enter held ≥ 3 s**: open the context/pause menu, at the threshold. That
  press's release is then consumed, so the menu stays open on the item it opened
  under. BENNYSMINIGOLF reaches the same outcome by a different route: its
  `pauseGame()` calls `Input.setMode('MENU')`, which clears `enterPressed`, so
  the keyup handler bails out before it can select (`js/input.js`).
  Sourcing for 3 s: §4 gives the convention as ~3 s to scan backwards and ~5 s
  to pause and asks new games to match, while noting no shared file enforces
  either — Mini Golf uses 6 s, and only during play. This build uses 3 s,
  matching its own hold-Space threshold, and so departs from the ~5 s figure
  deliberately (listed below).
- **New round and Exit are two-step.** Both throw away a round in progress, so
  the first pick arms the item and only a second acts. A mis-timed select is the
  normal failure mode of scanning, not a rare one.
- **Post-release cooldown (250 ms)**: a re-press of the SAME key within the
  window is ignored, guarding against switch bounce and tremor. The hub's
  scan-manager uses the same window across all its inputs; this one is per-key.
- **With Auto Scan off (the default)**: scanning is idle until the first Spacebar
  press in a scene — no highlight moves on its own before that (the first list
  still shows highlight on item 0, but nothing advances). With Auto Scan on, the
  highlight begins advancing as soon as a list appears.
- **Wrap deadzone**: when the player is stepping the scan themselves, one scan step
  before the wrap lands on "no highlight" (nothing focused, nothing spoken) so a
  held switch does not loop forever unnoticed. The next step focuses item 0.
  Auto Scan SKIPS it — an automatic timer stepping into a silent slot reads as the
  app having died. Neither behaviour comes from the contract: `ACCESSIBILITY.md`
  does not specify wrap, and no shared module moves a highlight to depart from —
  `scan-manager.js` intercepts keys and owns the settings, but queries no
  elements, manages no focus and tracks no highlight index. §11 makes the
  related point about the hub's own modules. This is an addition, not a
  departure.
- Scan order is fixed top-to-bottom; never reordered mid-session.
- Returning from a submenu restores the highlight to the item that opened it.
- **Pointer (optional but required to work)**: click an item = select it.
  Click-and-hold (≥ 3 s, the same threshold as Enter) anywhere = context menu.
  Never require dragging.
- The context menu is reachable on EVERY screen, including during flight
  (pauses the animation), and stays open until an item is picked.

### Where this departs from the hub contract

This build is standalone — it is not inside the hub and cannot call the shared
modules — so some contract items are met differently:

| `ACCESSIBILITY.md` says | This build |
| --- | --- |
| §4: `scan-manager.js` enforces a 250 ms global cooldown — "You do not need to write your own debounce, and you should not" | its own 250 ms cooldown: per key for switch presses, and a separate one on pointer selects (click and dwell). There is no `NarbeScanManager` to defer to |
| §4: the convention is ~3 s to scan backwards and ~5 s to pause, "and new games should match it" | 3 s for both. The backward hold matches; the menu hold does not |
| §5: use `SafeAudio`, never the Web Audio API (an `AudioContext` can take down the Electron renderer) | WebAudio, for the flight tone and the cup beeper. This build is web-only, so the Electron failure mode does not apply here — but it would if it were ever bundled |
| §4: the pause hold should be "discoverable while it happens" — a filling ring and a rising beep | no progress indication during the hold yet. The scannable Menu row below mitigates this. It does not replace the indication |
| §10: "Played start to finish with one switch, by someone who is not you" | **not done.** The one-switch path is verified by harness and by hand, never by a switch user |
| §5/§10: read TTS state from `NarbeVoiceManager`, "never keep your own copy" | raw `speechSynthesis`, with its own on/off, rate and volume settings |
| §7: Settings has a **Voice** row that cycles available voices | no voice picker, and no row named Voice. The on/off row is "Text to speech" (§7 writes it "Text to Speech"); the rate and volume rows are "Speech speed" and "Speech volume", so §7's reserved word is not reused |
| §7/§10: Settings reachable from the pause menu | reachable from the pause menu everywhere except during the flight animation, where the item is hidden |
| §7/§10: a two-step **Reset Progress** item | none. Saved holes delete individually (two-step); there is no wipe-everything item |
| §6/§10: `postMessage({ action: 'focusBackButton' })` on Exit Game | not sent. This build has no Exit Game — "Exit to menu" returns to its own title, still inside the frame. It would need one to go in the hub |
| §5/§10: Auto Scan and Scan Speed come from `NarbeScanManager`, so "a player configures their access once, not twenty times" | its own copies, saved under `oddball-save-v1`. Someone who set their scan speed in the hub sets it again here |
| §7: the Settings rows in the canonical order — Text to Speech, Voice, game-specific, Auto Scan, Scan Speed, Sound Effects, Reset Progress, Back | Scan speed sits before Auto scan, and the game-specific rows sit after both rather than before |
| §5: `ios-audio-fix.js` unlocks WebAudio **and speechSynthesis** on first touch | the WebAudio half is handled here (lazy context + resume); nothing unlocks speechSynthesis, so the first utterance on iOS may be silent |
| §9: "large targets (**≥ 64 px** on tablet)" | **not met, in three separate ways.** (1) The on-screen Pause button never reaches 64 px: it is `min-height: 2.2rem`, measured 38 px at 100 % text and 44.6 px at the shipped 125 % default, on every viewport, tall or short. It only clears 64 px at 200 %. (2) A scan row is 64 px only above 700 px of viewport height; at or under 700 px its floor drops to 56 px, which includes an iPad Mini or a 768 pt iPad in **landscape**, where browser chrome puts the viewport under 700 px. (3) At or under 400 px of height the row floor drops again to 44 px and the portrait to 30 px. Each cap exists because the full-size control pushed itself or the footer off a short screen — a target you cannot reach at all is worse than one under-sized — but they are departures, not compliance. Measured, not estimated: 60 viewport x text-scale combinations, 0 rows clipped |
| §12: pause should be "something you can *scan to and select*", because for a player who cannot sustain a hold the gesture "is not an accessible route to pause, it is a locked door" | met on both gameplay lists — the round shot rack and the practice range — via the scannable **Menu** row. The range had no such row until a lens went looking screen by screen; the claim had been written from the rack alone. NOT met during the flight animation: `scanner.clear()` runs and the panel is hidden, so the only routes there are the 3 s hold and the on-screen Pause button. A switch-only player who cannot hold cannot pause a flight — they can only wait it out |
| §5: `tutorial-modal.js` provides the shared how-to-play modal | not used, and not reimplemented as a modal. How to play is a scannable **Help** screen in the same list grammar as everything else. A standalone build cannot call `window.BennyTutorial`, and there is no video to embed |
| §9: a focus label must be short — "it is read aloud at every scan step, and at a 1 s scan speed a long label becomes a drone" | the shape labels run 6-10 s spoken, and per-item focus labels deliberately do NOT hold the scan timer, so at any rung below their length the tail is not heard. Mitigated, not fixed: the yardage that decides the shot now comes FIRST (~1.9 s, inside the 2 s default), and the character blurb — which can be cut off without cost — comes after. `menu-check` asserts that order and that budget. At the 1 s rung nothing useful fits, and that is not solvable by wording |

Two items are met by a different route rather than skipped: the pause menu has
both an on-screen Pause button and a scannable **Menu** row in the shot rack, so
a player who cannot sustain a 3 s hold still reaches settings, a new round and
the exit (§12 calls a hold-only pause "a locked door") — everywhere except the
flight animation, which has no rack and so is hold-or-pointer only, as the table
says; and the hole editor is fully scannable, so §7's one-way-door warning has
nothing to catch.

§12 also prices that Menu row, and the price is real: a scannable control "puts
another stop on the scan cycle, and the player passes that stop on *every single
pass*, for the whole session", and it suggests making such a route a setting.
This build makes it unconditional, and places it last in the rack — after Where
am I? and the six shapes — so it does not sit between the player and the shot.
Making it a setting instead is not done.

## TTS

- Web Speech API (`speechSynthesis`). Speak on focus AND on selection. Never block
  input — speech is interrupted by the next focus, input is never queued behind speech.
- Everything spoken is also shown as a large-print caption (the caption bar).
- Every utterance is ALSO `console.log`-ed as `[tts] <text>` (used for automated verification).
- Settings: TTS on/off, rate, volume.
- All text lives in `src/game/lines.ts`: short sentences, common words, numbers in
  whole yards. No hold threshold is ever quoted to the player (§4); the Scan
  speed row speaks its value in seconds, as §7's canonical table does. Scores
  are reported with their margin rather than praised for it.
- With Auto Scan on, the scan timer waits while narration is speaking, so the
  highlight is never stepped off an item mid-sentence. Per-item focus labels do
  NOT hold it, or speech length would replace the player's chosen scan speed.
  A watchdog releases the hold if the browser never reports the utterance
  ending, which is a real case rather than a theoretical one.

## Visual

- DOM UI for all menus/racks (scannable lists); canvas only for the course view.
- Four color profiles via CSS custom properties + `data-theme` on `<html>`:
  `high-contrast` (default), `light`, `dark`, `warm`.
- Font scaling presets 100/125/150/175/200 % (CSS var, applies to all UI text).
- Highlight ring: thick outline + high contrast; thickness setting thin/medium/thick;
  focused item also gets a gentle pulse (disabled by reduce-motion).
- Header on every screen: game title, current screen name. Footer: current mode,
  the currently highlighted item's name, the legend
  "Space = next · Hold Space = back · Enter = pick · Hold Enter = menu",
  and an on-screen **Pause** button (pointer/touch parity with holding Enter).
  The button is not in the scan order; the scannable route is the Menu row at
  the end of the shot rack.
- Big shapes, thick trajectory line, no clutter. Reduce-motion setting: flight is
  summarized (ball drawn at end position, events spoken) instead of animated.

## Game rules

- 6-hole course, played in order. Stroke count per hole; friendly score names vs par.
- Max 8 strokes per hole, then "the ball takes a rest" and you move on (no fail state).
- Each stroke: scan the shape rack → select a shape → short swing anticipation
  (no input) → flight plays out with sound + narration → result spoken
  ("The cube went 82 yards and stopped dead. 41 yards to the cup.").
- The golfer always aims at the cup and strikes with sensible force for the distance
  (capped by the shape's reach). The SHAPE determines what actually happens.
- Cup is generous: ball at rest within `GIMME_M` of the cup = holed. No putting grind.
- Water: splash, spoken kindly, ball returns to where it was before the shot;
  the stroke still counts.
- Sand/rough: lie penalty multiplies the next strike's power (sand 0.6, rough 0.85).
- Rack also contains "Where am I?" (speaks hole, distance to cup in yards, lie, wind)
  — selecting it does not cost a stroke.

## The six shapes (identity → mechanical hook)

| Shape | Identity | Mechanics |
|---|---|---|
| Ball (sphere) | the baseline, rolls out long | mid carry, real rollout, mild variance |
| Cube | lands dead; the precision tool | short max reach (~85 m), near-zero bounce/roll, tiny variance |
| Disc | glides far, drifts in wind | longest reach, lift (reduced effective gravity), windSens ≫ others |
| Egg | the gamble | mid reach, huge carry variance |
| Star | chaos bounces, fun over function | mid reach, high restitution + large bounce-angle jitter |
| Pancake | carries exactly, sits down | high lob, no bounce, no roll, low variance |

No shape may dominate: no single-shape strategy may beat the intended mixed strategy
over the course, and each purposeful shape (sphere, cube, disc, pancake) must be part
of the best line on ≥ 1 hole. The gamble shapes (egg, star) are "fun over function"
by design — they are never the sober best line; instead each must have ≥ 1 hole where
its lucky tail beats the intended line (P(strokes < round(intended mean)) ≥ CAL.gambleLuckyRate).
All harness-asserted.

The golfer aims with no wind compensation (solves for a calm day); wind acts only on
the real flight. Wind is therefore a shape-choice consideration, not an aiming skill.

## The six holes (design intent)

1. **The Runway** — ~170 m, flat, no wind. Tutorial; ball/disc obvious.
2. **The Pond** — ~150 m, water ~70–120 m. Carry it (pancake/disc) or lay up (cube) —
   the sphere's rollout and variance make it risky.
3. **The Gale** — ~210 m, strong headwind. Disc is punished, sphere/pancake grind it out.
4. **Tiny** — ~55 m, green ringed by sand. The cube hole.
5. **The Staircase** — ~240 m up three terraces. Bouncy shapes (ball/star) climb;
   dead-stop shapes need exact carries. Star's gamble hole.
6. **Home Stretch** — ~320 m, mild tailwind. Sequencing test: disc opener, precise finisher.

Pars are set by measurement (harness), not by hand.

## Physics (side view, x downrange, y up; SI units internally, speech in yards)

- Projectile with quadratic drag (per-shape `drag`), per-shape launch angle,
  per-shape `lift` = fraction of gravity cancelled while airborne (disc glide).
- Wind = horizontal acceleration ∝ wind speed × shape `windSens`, applied while airborne.
- Terrain = per-hole heightfield polyline; flight lands where the trajectory crosses it.
- Bounce: velocity reflected about the surface normal × `restitution`, angle perturbed
  by `bounceJitter` (seeded RNG). Below a speed threshold → roll.
- Roll: 1-D along terrain with decel; `rollMult` scales rollout; slopes accelerate/brake.
- Sand: kills bounce and roll on contact. Green: normal roll. Water: splash event.
- **Aiming**: the sim binary-searches strike speed so the NOISE-FREE simulated total
  distance ≈ distance to cup (capped at shape max). Noise (carrySigma etc.) is applied
  only to the real strike. No hand-tuned aim factors.
- Determinism: `mulberry32` seeded RNG threaded through every strike. Same seed = same round.

## Verification harnesses (tools/, run headless via esbuild+node)

- `pnpm calibrate` — per-shape distance/dispersion on a flat reference hole vs. bands
  declared in tuning; asserts every shape identity (cube stops dead, pancake no roll,
  disc wind swing ≫ sphere's, egg σ ≫ others, star bounce spread).
- `pnpm holes` — plays the course over many seeds with (a) the per-hole intended
  strategy and (b) every single-shape strategy. Asserts: every hole completable
  ≤ 8 strokes ≥ 95 % of seeds by intended play; intended beats every single-shape
  strategy on course total; each shape appears in some hole's best line; measured
  pars match tuning pars.
- Layout is a correctness question here, not a cosmetic one: a highlight drawn
  outside its panel is a switch user with no idea what they are about to pick.
  The order of yielding is fixed and deliberate — the caption bar shrinks first
  (its text is spoken and it scrolls), then the footer legend disappears, then
  the header, footer and list type sizes stop scaling. `.main` keeps a floor
  (`flex: 1 1 0` plus `min-height`) so the scan panel is the last thing to give
  up room, and the context menu lives inside `.main` so the caption bar and
  footer — which sit above the scrim on purpose — can never cover a menu row.
  Verified by driving the real bundle across viewport and font-scale
  combinations, including a landscape phone and 200 % text, because no harness
  can see any of this.
- `pnpm input-check` — headless self-test of the switch/scan grammar state machines.
- `pnpm menu-check` — drives the REAL switch machine, scanner and flow through the
  context menu: that the menu latches after the hold that opened it, that Auto Scan
  cannot pick an item on that release, that New round, Exit and Delete are
  two-step, that the rack has a scannable Menu row, that an armed warning holds
  the scan so it cannot be cut off, and that a stalled utterance still releases
  the scan rather than stranding a hands-free player, that a settings row's
  spoken explanation matches the value it is reading, that Auto Scan wraps from
  the last row to the first with no silent step while a deliberate press still
  gets the deadzone beat, that a second pointer select inside the 250 ms window
  does nothing while one after it selects normally, that BOTH gameplay lists
  carry the Menu row, and that a shape's yardage is spoken before its blurb and
  inside the default scan interval. Most of those were real
  defects, and they survived a green suite because no other harness imported
  `flow.ts`.
- `pnpm mutate` — proof that the harnesses are not vacuous. It breaks the shipped
  code one edit at a time and requires the named harness to go red for every one,
  plus one pair applied together to check that two faults do not cancel out. Run
  it for the count and the split; the mutation list is the source, and a number
  copied into this sentence is a number that will drift. It refuses to start on a
  dirty tree, because it writes to `src/` and restores in a `finally` — a SIGINT
  mid-run would otherwise leave mutated code that looks like your own edits.
  Two mutations survived the whole suite the first time it ran, which is how the
  Auto-Scan-wrap and pointer-bounce checks came to be written. That is checkable
  rather than asserted: delete either check from `menu-check`'s runner and
  `mutate` reports the matching survivor and exits 1.

What no harness covers, stated plainly: no harness EXECUTES `main.ts`,
`draw.ts`, `hud.ts`, `sfx.ts` or `save.ts` — `menu-check` imports two types from
`hud.ts` and nothing else, and a type import compiles away, so no runtime code
from those files reaches a harness bundle. One pointer path is now executed
headlessly — `menu-check` dispatches a real click into the handler `scanner.ts`
registers, so click-to-select and its cooldown are covered. The rest are not:
click-and-hold, the Pause button and its bounce guard, the click-swallow after
a hold, hover-to-pick, the `aria-hidden` targets, and every layout question are
verified only by driving a real browser against the built bundle. Two of those
live in `hud.ts`, which no harness executes and no mutation can reach — putting
`main.setAttribute('aria-hidden', 'true')` back would hide the pause menu from
every screen reader, silently, with the whole suite green. That is the largest
uncovered surface in this repo and it is where the next defect will come from. Most defects this project shipped and then had to fix
lived in code no harness executes. One did not: the published build's
`input-check` ran the hold-Space path and asserted the wrong contract, so a green
harness certified the wrong behaviour. A harness is only as good as the contract
it encodes.
- Harness failures are exit-code failures with a printed table. These are the safety
  net — tune `tuning.ts` until they pass; never weaken an assertion to pass.

## Modes (added 2026-08-16)

- **Two courses**: Sunny Meadows (the original six) and Wild Canyon (elevated tee,
  island green, canyon carry, ascending washboard, a 10 m wall, tailwind bomb).
  Pars measured per hole; 1P best-total per course tracked and spoken in the picker.
- **Pass-and-play 2P**: each hole is played out by Player 1, then Player 2 from the
  tee; per-player scorecards; gentle match verdict. Same input grammar throughout.
- **Practice range**: no cup, no score; every shot from the tee, narrated. The #1
  parent request (cause-and-effect) as its own mode.
- **Make a Hole**: parameter-combo editor (length/ground/water/sand/wind rows that
  cycle like settings) — every combo is playable BY CONSTRUCTION (composer clamps
  geometry; tools/editor-check.ts asserts it). Par is MEASURED by simulating the
  composed hole. `EDITOR_OPTIONS` spans 4x3x3x3x5 = **540** combinations;
  `pnpm editor-check` exercises a **62-combination sample** — all 32 corners
  (every option at its min or max) plus 30 deterministic mixed picks — and
  prints the mean and max across them on the machine it ran on (this machine:
  mean ~162 ms, max ~325 ms over four runs). The gate is 15 s, and it is a
  smoke test, not a benchmark — read the printed line, not this one. The
  playability guarantee is by CONSTRUCTION, from the composer's clamps; the
  harness spot-checks it, and 62/540 is a sample, not the space.
  `MAX_CUSTOM_HOLES` saved holes ("My Hole N").
- **Dwell-to-select**: hover an item for 1.2/2 s (setting) to select — head- and
  eye-tracking users. Visible fill via the --dwell custom property. One
  qualification a reader needs: after the list rebuilds, the dwell does NOT
  restart until the pointer moves `DWELL_REARM_PX` (24 px). Without that, arming
  a two-step confirm re-fired `pointerenter` under a still pointer and the dwell
  timer confirmed the prompt it had just opened — a 4 s gaze destroyed a round.
  Re-arming on ANY movement is defeated by an eye tracker's idle jitter, hence a
  pixel threshold. The cost is real: hold perfectly still on a freshly rebuilt
  list and nothing selects until you move.
- **Flight sonification**: a quiet tone glides with the ball's height (setting;
  eyes-closed play). The cup beeper accelerates as a rolling ball closes in.

## Persistence

- `localStorage` key `oddball-save-v1`. Auto-save after every state-changing selection.
- A saved scan speed from an older build is kept exactly as it is (never snapped
  onto the 1/2/3/4 s ladder under the player); cycling the Settings row once
  rejoins the ladder. Nobody's speed changes without them asking.
- Resume restores: hole, strokes, ball position/lie, settings, and the highlighted index
  of the frame the player was in. Title screen offers Continue when a round exists.

## Module map

- `src/types.ts` — shared contracts between modules.
- `src/tuning.ts` — every number: shapes, courses, physics constants, editor tables.
- `src/sim/` — deterministic physics; `tools/` — the verification harnesses
  (`calibrate`, `holes`, `editor-check`, `input-check` and `menu-check` for the
  scan grammar and the menu, and `mutate`, which breaks the shipped code to
  check the others are not vacuous).
- `src/input/` — switch grammar + scanner; `src/speech/` — TTS; `src/audio/` — sound.
- `src/render/draw.ts` — the canvas renderer; `src/ui/` — DOM shell and styles.
- `src/game/` — flow state machine, all player-facing text, composer, saves.
