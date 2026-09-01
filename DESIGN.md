# Odd Ball — design spec (canonical)

A switch-accessible, turn-based golf game. You are the ball. Before every shot you
choose what **shape** to be; the golfer strikes you; you watch (and hear) what happens.
Shape choice is the entire skill. The game takes no timing, aiming or reflex input.

Target platform: web, standalone (Vite static build). Audience: switch users
(1–2 inputs) and low vision. Text is short sentences and common words. Speech
is the interface and a caption is read at a glance. Built **against** the NARBE
House developer guide (narbehouse.github.io/developer-guide.html) and the input
contract it names. The departures table below lists the places found so far
where this build does not follow it.

## Input grammar

Source: the NARBE hub's input contract, `bennyshub/ACCESSIBILITY.md`, which the
NARBE House developer guide names as the authority. It gives: hold-Space scans
backwards; Auto Scan is a saved setting, not a hold gesture, and with it on
Enter alone reaches everything; scan speed is 1/2/3/4 s, default 2 s; the scan
manager debounces 250 ms after any release; and the hold thresholds belong to
each game, by convention roughly 3 s to scan backwards and roughly 5 s to pause.

One hub game was also read against that contract: BENNYSMINIGOLF, 1 of the 21
in the library. BENNYSFOOTBALL was opened and nothing from it is cited here, so
it is not claimed as evidence. Where this file cites their
behavior it means those two files, not the library.

This build is standalone: it cannot call `NarbeScanManager`, so it stores and
enforces the same settings itself. "Where this departs from the hub contract"
below lists the places found so far.

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
  elements, manages no focus and tracks no highlight index. §4 gives the first
  half — `NarbeScanManager` "owns two values and no others", the scan interval
  and the 250 ms debounce — but that section is scoped to numbers and does not
  speak to focus or the DOM. The rest is from the file itself
  (`bennyshub/shared/scan-manager.js`): it installs capturing key and pointer
  listeners and contains no element query, no focus call and no highlight index.
  This is an addition, not a departure.
- Scan order is fixed top-to-bottom; never reordered mid-session.
- Returning from a submenu restores the highlight to the item that opened it.
- **Pointer (optional but required to work)**: click an item = select it.
  Click-and-hold (≥ 3 s, the same threshold as Enter) anywhere = context menu.
  Never require dragging.
- The context menu is reachable on every screen and stays open until an item is
  picked. During flight it is reachable by hold or pointer only, because the
  rack is cleared — see the departures table.

### Where this departs from the hub contract

This build is standalone — it is not inside the hub and cannot call the shared
modules — so some contract items are met differently:

| `ACCESSIBILITY.md` says | This build |
| --- | --- |
| §1: the player "is not a child, and should not be talked to like one" — "the access is what is adapted, not the dignity" | the cast layer (CAST.md) writes the shapes as characters with feelings: "Brick is very pleased", "Boing bounces with joy". Whether that reads as warmth or as talking down is a call this build is not entitled to make for a player it has never met, so it is now a **setting, off by default**. The shipped reading names the shape for what it is and describes what it does: "Cube. Goes about 93 yards. It lands and it stays. Wind moves it less than any other shape." Turning the cast on is the player's choice. The setting does not settle the question — it just stops the game answering it for them |
| §1: give the player "a way to choose how hard the game pushes back", and a no-fail mode is "*the* version" for some players | no difficulty setting. Golf has no fail state in one-player (eight strokes and the hole ends); two-player does produce a winner. The practice range is unscored and endless. None of that is a difficulty the player chose. Not done |
| §4: `scan-manager.js` enforces a 250 ms global cooldown — "You do not need to write your own debounce, and you should not" | its own 250 ms cooldown: per key for switch presses, and a separate one on pointer selects (click and dwell). There is no `NarbeScanManager` to defer to |
| §4: the convention is ~3 s to scan backwards and ~5 s to pause, "and new games should match it" | 3 s for both. The backward hold matches; the menu hold does not |
| §5: use `SafeAudio`, never the Web Audio API (an `AudioContext` can take down the Electron renderer) | WebAudio, for the flight tone and the cup beeper. This build is web-only, so the Electron failure mode does not apply here — but it would if it were ever bundled |
| §4: the pause hold should be "discoverable while it happens" — a filling ring and a rising beep | no progress indication during the hold yet. The scannable Menu row below mitigates this. It does not replace the indication |
| §10: "Played start to finish with one switch, by someone who is not you" | **not done.** The one-switch path is verified by harness and by hand, never by a switch user |
| §5/§10: read TTS state from `NarbeVoiceManager`, "never keep your own copy" | raw `speechSynthesis`, with its own on/off, rate and volume settings |
| §7: Settings has a **Voice** row that cycles available voices | no voice picker, and no row named Voice. The on/off row is "Text to speech"; the rate and volume rows are "Speech speed" and "Speech volume", so §7's reserved word (Voice) is not reused |
| §7/§10: Settings reachable from the pause menu | reachable from the pause menu everywhere except during the flight animation, where the item is hidden |
| §7/§10: a two-step **Reset Progress** item | none. Saved holes delete individually (two-step); there is no wipe-everything item |
| §6/§10: `postMessage({ action: 'focusBackButton' })` on Exit Game | not sent. This build has no Exit Game — "Exit to menu" returns to its own title, still inside the frame. It would need one to go in the hub |
| §5/§10: Auto Scan and Scan Speed come from `NarbeScanManager`, so "a player configures their access once, not twenty times" | its own copies, saved under `oddball-save-v1`. Someone who set their scan speed in the hub sets it again here |
| §7: the Settings rows in the canonical order — Text to Speech, Voice, game-specific, Auto Scan, Scan Speed, Sound Effects, Reset Progress, Back | Scan speed sits before Auto scan. Most game-specific rows sit after both rather than before; one — Character names — sits with the speech rows instead, because it changes what speech says and nothing else |
| §5: `ios-audio-fix.js` unlocks WebAudio **and speechSynthesis** on first touch | the WebAudio half is handled here (lazy context + resume); nothing unlocks speechSynthesis, so the first utterance on iOS may be silent |
| §9: "large targets (**≥ 64 px** on tablet)" | **not met, in three ways.** Two numbers exist for every control and they are not the same: the `min-height` floor in the stylesheet, and the height the browser actually renders once padding, borders and line-height are added. The floors below are read from `theme.css`; the rendered heights are measured in a real browser. (1) The on-screen Pause button's floor is `min-height: 2.2rem`, so it tracks the text setting — rendered 38 px at 100 %, 44.6 px at the shipped 125 % default, then 52.8 / 61.6 / 70.4 px at 150 / 175 / 200 %. It first clears 64 px at 200 %. (2) On a viewport 560 px or shorter that floor becomes a flat 44 px, and there the button renders at exactly 44 px at **every** text scale — on a landscape phone it never reaches 64 px at all. (3) A scan row's 64 px floor survives only above 700 px of height **and** above 560 px of width. A short screen or a narrow one drops it to 56 px; 480 px of height or 360 px of width drops it to 44 px. On a 320x400 or 280x560 screen a plain row then renders at 44.4 px at every text scale — but not every row is plain: a shape row is 50 px, because the glyph and not the type sets its height, and a settings row whose value wraps to two lines is 66.8 px. Where no cap bites, rows are comfortably over: 65 px at 100 % and 124 px at 200 % on 1024x900. Each cap exists because the full-size control pushed itself or the footer off a short screen, and a target you cannot reach at all is worse than an undersized one — but they are departures, not compliance. `pnpm layout-check` measures all of it on every build |
| §12: pause should be "something you can *scan to and select*", because for a player who cannot sustain a hold the gesture "is not an accessible route to pause, it is a locked door" | met on both gameplay lists — the round shot rack and the practice range — via the scannable **Menu** row. The range had no such row until a lens went looking screen by screen; the claim had been written from the rack alone. NOT met during the flight animation: `scanner.clear()` runs and the panel is hidden, so the only routes there are the 3 s hold and the on-screen Pause button. A switch-only player who cannot hold cannot pause a flight. From the shape click to the panel returning, the constants give 3.45-7.95 s — and 3.45-6.45 s with Animations off, because the hole-out afterglow is skipped — 0.45 s of pre-roll, a 3-6 s flight, plus 1.5 s of afterglow when the ball goes in. `MIN_PLAY_S`/`MAX_PLAY_S` are 3 and 6, but `PRE_S` (0.45) runs before and `AFTER_TOTAL_S` (1.5) after a hole-out, and `scanner.clear()` covers the whole scene — reading the two constants understates the gap by a third. Turning Animations off removes the animated flight and with it this gap, but that is a setting the player has to find |
| §5: `tutorial-modal.js` provides the shared how-to-play modal | not used, and not reimplemented as a modal. How to play is a scannable **Help** screen in the same list grammar as everything else. A standalone build cannot call `window.BennyTutorial`, and there is no video to embed |
| §9: a focus label must be short — "it is read aloud at every scan step, and at a 1 s scan speed a long label becomes a drone" | the shape labels run about 4-10 s spoken at 160 wpm (4.1 s for Egg with the cast off, 10.5 s for Dot with it on, counted from `tuning.ts` at 160 wpm), and per-item focus labels deliberately do NOT hold the scan timer, so at any rung below their length the tail is not heard. Mitigated, not fixed: the yardage that decides the shot now comes FIRST (~1.9 s, inside the 2 s default), and the character blurb — which can be cut off without cost — comes after. `menu-check` asserts that order and that budget. At the 1 s rung nothing useful fits, and that is not solvable by wording |

### §10, the shipping checklist, item by item

This is the list the README's summary points at. The README used to say only
that roughly half the checklist was unmet, with nothing behind it. §10 has 18 items. Counting the table below:
**7 met, 3 met by a different route, 8 not met** — where "different route" means
the behaviour is equivalent but the shared module it is supposed to come from
does not exist in a standalone build, and nothing else. Three of the 7 rest on harness
evidence alone. Row 2 says so explicitly, and by the last row none of the 18 has
been confirmed by a switch user. Count the rows;
this sentence is a summary of them and summaries drift.

| §10 item | This build |
| --- | --- |
| Every action reachable with **Space and Enter only** | met (`input-check`, `menu-check`) |
| Every action reachable with **Enter alone**, Auto Scan on | met by harness. Never by a switch user — see the last row |
| Menu actions fire on **release**, not press | met (`switch.ts` emits on keyup; `input-check` asserts it) |
| Holding Space scans backwards "in every menu", repeating at the player's scan speed from `NarbeScanManager` — "not a rate you picked" | **different route.** Every menu, at the player's saved speed. The speed comes from this build's own copy of that setting, because there is no `NarbeScanManager` to read |
| Holding Enter opens pause from anywhere in gameplay, with a visible and audible indication while holding | **not met.** The hold works everywhere including flight, but nothing indicates progress during it. §4 asks for the same thing and the row above says so |
| An on-screen Pause button does the same | met |
| Settings reachable from **both** the main menu and the pause menu | **not met.** Both, except during the flight animation, where the item is hidden. "Different route" would mean equivalent behaviour reached another way; this is one place it is not reachable |
| Auto Scan and Scan Speed present, reading from `NarbeScanManager` | **different route.** Present, from this build's own copies |
| TTS reads focus, selection and outcomes, via `NarbeVoiceManager` | **different route.** All three are read; the engine is raw `speechSynthesis` |
| Sound through `SafeAudio` — no `AudioContext` | **not met.** WebAudio, for the flight tone and the cup beeper |
| Reset Progress is two-step | **not met.** There is no Reset Progress item at all. Saved holes delete individually, two-step |
| Exit Game sends `postMessage({ action: 'focusBackButton' })` | **not met.** This build has no Exit Game — "Exit to menu" returns to its own title |
| Mouse and touch work everywhere, no interaction requires a drag | met by hand, on mouse and touch. No harness covers the pointer paths — see "What the harnesses do NOT establish" |
| Anything mouse-only or off-site sits behind a spoken confirm dialog, "with Cancel first in the scan order and the scan trapped in the dialog" | **not met.** The trigger does not arise — nothing here is mouse-only and nothing leaves the page, and the editor is fully scannable — but this build does have two-step confirms, and they do not follow the shape §10 asks for: in the saved-hole menu the cancel route ("Back") is **last** in the scan order, and the scan is not trapped in the prompt |
| Progress saves and resumes | met. `layout-check` resumes a seeded round through Continue on every run, which exercises the path without being a test of it |
| Readable at 100 % on a tablet | met, by eye on a 768x1024 viewport. `layout-check` establishes only that nothing is clipped or overflowing there; it does not measure type size, contrast or legibility |
| Added to `apps/games/games.json` with a thumbnail and genres | **not met.** Not submitted. That waits on the CAST.md review |
| **Played start to finish with one switch, by someone who is not you** | **not met.** §10 calls this "the only test that actually counts" |

Two of those rows deserve their reasoning spelled out, because the table only
has room for a verdict. The pause menu has
both an on-screen Pause button and a scannable **Menu** row on both gameplay
lists — the shot rack and the practice range — so
a player who cannot sustain a 3 s hold still reaches settings, a new round and
the exit (§12 calls a hold-only pause "a locked door") — everywhere except the
flight animation, which has no rack and so is hold-or-pointer only, as the table
says; and the hole editor is fully scannable, so §7's one-way-door warning has
nothing to catch.

§12 also prices that Menu row, and the price is real: a scannable control "puts
another stop on the scan cycle, and the player passes that stop on *every single
pass*, for the whole session", and it suggests making such a route a setting.
This build makes it unconditional on both gameplay lists, and places it last —
after the six shapes, and after Where am I? in the rack — so it does not sit
between the player and the shot.
Making it a setting instead is not done.

## TTS

- Web Speech API (`speechSynthesis`). Speak on focus AND on selection. Never block
  input — speech is interrupted by the next focus, input is never queued behind speech.
- Everything spoken is also shown as a large-print caption (the caption bar).
- Every utterance is ALSO `console.log`-ed as `[tts] <text>` (used for automated verification).
- Settings: TTS on/off, rate, volume, and **Character names** — the cast layer
  (CAST.md), off by default. With it off, `shapeFocus`, `shapeConfirm` and the
  narration use each shape's plain name and plain blurb, the hole-out line ends
  at "In the cup!", the Help page's shapes entry is titled "The shapes" instead
  of "Meet the team", and the star's "Boing!" bounce line falls back to the
  neutral wording every other shape already used. Every spoken line that names a
  shape routes through `shapeName()`/`shapeBlurb()`.
  Five separate leaks were found by review before that sentence was true. It is
  enforced now: `menu-check` greps every `.ts` under `src/` for a read of
  a shape's `.name` or `.blurb` outside the two accessors, and greps separately
  for a cast phrase typed into a string, which a name-reader check cannot see.
  Both have non-vacuity assertions. Neither can see a leak that is not a string:
  Penny's tap sound and tap-bounce were the fifth, and are gated through a
  `data-characters` attribute with their own source-level checks. The ball's
  face is deliberately NOT gated — it is the game's art rather than a
  character's name — and that boundary is recorded here because nothing
  enforces it. Old saves get `false` for free: `mergeSettings` starts from
  `DEFAULT_SETTINGS` and only takes keys the saved object actually has.
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
  the end of each gameplay list (the shot rack and the practice range).
- The scan list and the course view sit side by side above 900 px of width.
  Below that the layout stacks and the list takes the full width — always under
  560 px, and under 900 px whenever text is above 100 %.
  The reason is a defect worth recording, because the fix for it was wrong twice
  before it was right. The panel was sized `clamp(min(16rem, 46vw), 34%, 30rem)`.
  `16rem` tracks the text setting, because rem follows `--font-scale`; `46vw`
  does not, and `min()` let the one that ignores text win. On a 600 px window at
  200 % the panel came out 276 px and the longest label overran its row by
  132 px. The first fix capped the row's padding, which only moved the overrun
  somewhere the detector could not see. The second added two stack breakpoints,
  900 px and 640 px; the 640 was 17 px inside the band it was meant to avoid,
  and both numbers came from a sweep run with a detector that ignored the row's
  flex gap. With the gap counted the 900 was wrong too — the real edge at 200 %
  is about 940 px. What is there now is one breakpoint and a fixed lower bound
  (`55vw` instead of `46vw`), so the panel cannot be starved by a viewport share
  at any width the side-by-side layout applies to.
- The highlight ring's reach outside the row — outline width plus offset — is
  defined once as `--hl-reach` and consumed by the scroll padding that keeps it
  on screen. It was three hard-coded numbers that had drifted apart, and one of
  the three — the focus pulse's `box-shadow` — was still hard-coded after that
  comment claimed otherwise, overshooting the scroll padding by 2 px. On screens
  480 px tall or shorter, or 400 px wide or narrower, the offset drops to 0, and
  the **thick**
  setting is served the medium width: a 12 px ring cannot be drawn whole on a
  320x320 panel at 200 % text, and a thick ring missing an edge reads as thinner
  than the medium one. That overrides a player's explicit setting, which is a
  real cost; it buys the thickest ring that closes.
- Big shapes, thick trajectory line, no clutter. Reduce-motion setting: flight is
  summarized (ball drawn at end position, events spoken) instead of animated.

## Game rules

- 6-hole course, played in order. Stroke count per hole; friendly score names vs par.
- Max 8 strokes per hole, then the hole ends. One-player has no fail state;
  two-player produces a winner.
  The line says so plainly — it used to say "the ball takes a rest", which is a
  euphemism aimed at an adult and the clearest §1 breach in the shipped default.
- Each stroke: scan the shape rack → select a shape → short swing anticipation
  (no input) → flight plays out with sound + narration → result spoken
  ("Cube landed and stayed right there. Cube went 82 yards. 41 yards to the
  cup." — executed, not paraphrased; with the cast on the name is "Brick").
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

Pars are literals in `tuning.ts`; `pnpm holes` fails if any differs from the
measured value.

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
  strategy on course total; each of the four purposeful shapes appears in some
  hole's best line, and each gamble shape's lucky tail beats intended play on at
  least one hole; measured
  pars match tuning pars.
- Layout is a correctness question here, not a cosmetic one: a highlight drawn
  outside its panel leaves a switch user unable to see what they are about to
  pick.
  The order of yielding is fixed and deliberate — the caption bar shrinks first
  (its text is spoken and it scrolls), then the footer legend disappears, then
  the header, footer and list type sizes stop scaling. `.main` keeps a floor
  (`flex: 1 1 0` plus `min-height`) so the scan panel is the last thing to give
  up room, and the context menu lives inside `.main` so the caption bar and
  footer — which sit above the scrim on purpose — can never cover a menu row.
  None of this is visible to a harness that imports modules, so it gets one
  that drives the built bundle in a real browser: `pnpm layout-check`.
- `pnpm layout-check` — serves `dist/` and drives the real bundle in headless
  Chromium across every text scale, a viewport list that runs from 1920x1080
  down to 280x480, and five screens (title; settings, which has the most rows;
  an in-round shot rack, seeded to the hole with the longest name because the
  header was the one bar with no yield rule; the pause menu, which is a second
  scrolling list;
  and the practice range, which carries the longest labels in the game). It
  prints its own cell count — do not copy one into this sentence. For every
  row on every screen it scrolls the row into view and measures it against the
  panel's **scrollport** — the padding box, not the content box; measuring the
  content box under-reports the visible area and flags a clean layout as clipped,
  which is what the first version of this harness did on 199 of 208 cells. It
  also measures the **highlight ring** as its own thing — it is drawn outside
  the row's border box, so a row fully on screen can still have its ring cut off
  by the scrollport, which shipped: 12.4 px of the bottom stroke gone on the
  last settings row, on every viewport, while every row measured as unclipped.
  It checks the Pause button is inside the viewport and that the document
  overflows in neither direction — the vertical half was missing until a footer
  6 px outside the viewport, on a screen already being measured, went
  unreported. Before the sweep it runs a self-test that forces a 4000 px
  row, a 4000 px-wide row, a 400 px ring on an unclipped row, and a Pause button
  translated 9000 px down, and exits non-zero if any of those four probes fails
  to fire. Two more gates run beside them, printed in the same line: the two
  routes to the pause menu must open the same menu, and the focus pulse's
  keyframe must take its spread from `--hl-reach`. The pulse cannot be measured
  per cell — it is an animation, and sampling it just after focus returns about
  zero, which is how a build with a 400 px overshoot passed every cell. It
  is checked in the stylesheet instead: a detector that never fires cannot tell a clean build from a broken
  one. The grid is not a general sample — it enumerates BOTH corners where the
  tiers overlap: narrow-and-short, and mid-width-and-tall. The second was added
  after the first grid missed it entirely; every wide cell in it was ≥ 900 px
  and every short cell ≤ 400 px tall, so no cell existed where a tablet in
  portrait lives, and a rendering review found the longest label painting 132 px
  outside its row while this harness reported ALL PASS. Four focused passes
  follow the grid, for the settings that change layout without changing size and
  for the tier boundaries: the thick highlight ring on the tightest viewports,
  the character names on the mid-width band, every breakpoint at N and N+1, and
  the shipped motion default. Two of the four failed on their first run. The
  ring pass measures at 200 % as well as 125 %, because at 125 % a defective and
  a fixed Pause button are both exactly 44 px.
- `pnpm editor-check` — asserts the hole composer's clamps make every parameter
  combination playable, on a 62-of-540 sample. Described in full under **Modes**.
- `pnpm input-check` — headless self-test of the switch/scan grammar state machines.
- `pnpm menu-check` — drives the REAL switch machine, scanner and flow through the
  context menu: that the menu latches after the hold that opened it, that Auto Scan
  cannot pick an item on that release, that New round, Exit and Delete are
  two-step, that an armed warning holds
  the scan so it cannot be cut off, and that a stalled utterance still releases
  the scan rather than stranding a hands-free player, that a settings row's
  spoken explanation matches the value it is reading, that Auto Scan wraps from
  the last row to the first with no silent step while a deliberate press still
  gets the deadzone beat, that a second pointer select inside the 250 ms window
  does nothing while one after it selects normally, that BOTH gameplay lists
  carry the Menu row, that a shape's yardage is spoken before its blurb and
  inside the default scan interval **in both cast modes**, that a course's best
  score is spoken before its blurb, and that the cast layer is all-or-nothing:
  a plain reading carries no character name, blurb, pronoun or cup line, on the
  shot rack, the practice range and the Help page alike — plus the source-level
  check above, which is the only one of these that does not depend on someone
  remembering a call site. Most of those were real
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

What no harness covers, stated plainly. Two kinds of coverage are in play, and
conflating them is how this paragraph came to be wrong:

- **No harness IMPORTS `main.ts`, `draw.ts`, `hud.ts`, `sfx.ts` or `save.ts`.**
  `menu-check` imports two types from `hud.ts` and nothing else, and a type
  import compiles away, so no runtime code from those files reaches a harness
  bundle. `mutate` cannot reach them either: every anchor in a *source* file
  sits in `switch.ts`, `scanner.ts`, `flow.ts`, `tts.ts` or `lines.ts`, and three
  more anchor in `CAST.md` and `DESIGN.md`.
- **`layout-check` RUNS all of them**, because it loads the built bundle in a
  browser. `main.ts` is the entry, `hud.ts` builds the footer and the rows,
  `draw.ts` paints the glyphs, and it writes `oddball-save-v1`, which only
  `save.ts` reads. But it observes layout and nothing else. A logic defect in
  any of those files passes straight through it.

So the uncovered surface is not those files, it is the behaviour in them that is
neither layout nor imported: click-and-hold, the Pause button's bounce guard,
the click-swallow after a hold, hover-to-pick, and the `aria-hidden` targets.
The last is the sharpest: putting `main.setAttribute('aria-hidden', 'true')`
back would hide the pause menu from every screen reader, silently, with the
whole suite green, and no mutation can reach it to prove otherwise.

Most defects this project shipped and then had to fix lived in code no harness
executes. Two did not. The published build's `input-check` ran the hold-Space
path and asserted the wrong contract, so a green harness certified the wrong
behaviour: it encoded the wrong contract. And the cast setting shipped with two
ungated readers — the practice range and the Help page — in `lines.ts`, a file
three harnesses import, because every check written for it tested the call sites
its author remembered, and the defect was forgetting the others — four in the
end. `menu-check` now greps every file under `src/` instead, for readers of a
cast string and for cast phrases typed into one. A grep does not depend on a
call site being remembered.
- Harness failures are exit-code failures with a printed table. These are the safety
  net — tune `tuning.ts` until they pass; never weaken an assertion to pass.

### What the harnesses do NOT establish

Written down because this document has repeatedly claimed more than the check
under the claim establishes. Every item below was one of those claims:

- **"Every row" means every row the grid visits.** `layout-check` enumerates
  viewports and screens; it does not prove a property for all of either. Eight
  regions have been missed so far, each found by a review rather than by a run:
  the narrow-and-short corner; the mid-width-and-tall band; the 150 % text
  scale; the pause menu, which is a second scrolling list; every in-round
  screen, which is where the header defect lived; the `max-width: 400px` tier,
  which the breakpoint parser silently dropped; `reduceMotion: false`, the
  shipped default, which every pass hard-coded to true — that one survived a
  round after the parameter for fixing it was added, because a comment claimed
  the fix in the past tense and nobody read the four literals under it; and the
  280-310 px wide by 561-589 px tall band at 150 % text, where the grid had
  nothing between 280x560 and 280x653 and the boundary pass ran two scales out
  of five. A ninth has not been ruled out.
- **`layout-check` measures five screens; the game has more.** The course
  picker, the two-player picker, the hole editor, My Holes, the saved-hole menu
  with its armed delete, the four Help pages, the two end-of-round summaries and
  the in-round pause menu — five rows, where the `overlay` cells open the
  two-row title one — are visited by no cell. That is a known region rather than an unruled-out one.
  Two of the three live defects found so far were on screens the harness does
  not visit; the third was on screens it does, at a scale its boundary pass did
  not run.
- **An assertion can stop running instead of failing.** One did: a CAST.md quote
  check only fired when the quote shared a prefix with the shipped line, so
  changing either side dropped it and the suite went 191/191 to 190/190 with the
  regression shipped. `menu-check` pins its own check count for that reason — an
  assertion that stops running now fails the suite.
- **A detector can be wrong in the direction of passing.** Three in this file
  have been silently inert at some point, and two measured the wrong box: one
  used the content box instead of the scrollport, one ignored the row's flex
  gap. Both reported ALL PASS over a real defect. That is what the self-test is
  for, and the self-test only covers the detectors someone thought to add.
- **The cast checks match strings.** The greps catch a read of `.name`/`.blurb`
  and a fixed list of phrases. The fifth cast leak found was a sound effect and
  an animation, which neither grep can see; it was found by reading the code.
- **Passing is not the same as applying.** `layout-check` measures outcomes, so
  a rule that never applies passes it. Two have shipped: a `.footer-pause` cap
  placed above the rule it meant to beat, and a `.canvas-wrap` share that lost
  on specificity to an `!important` rule with a higher-specificity selector.
- **No harness plays the game without looking at the screen**, and nobody has.
  Everything is spoken, which is a property of the code; that it is playable
  that way is not tested.
- **`mutate` proves the harnesses catch the faults in its list.** It does not
  measure coverage, and its anchors reach five source files.
- **Nobody has played this with one switch.** No harness substitutes for that,
  and §10 says so.

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
  prints the mean and max across them on the machine it ran on. The gate is
  15 s. It is a smoke test. The harness prints the mean and max it measured;
  read those. The playability guarantee is by CONSTRUCTION, from the composer's
  clamps; the harness spot-checks it, and 62/540 is a sample of the space.
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
  the screen not needed). The cup beeper accelerates as a rolling ball closes in.

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
  scan grammar and the menu, `layout-check`, which drives the built bundle in a
  browser because layout is invisible to the others, and `mutate`, which breaks
  the shipped code to check that none of them are vacuous).
- `src/input/` — switch grammar + scanner; `src/speech/` — TTS; `src/audio/` — sound.
- `src/render/draw.ts` — the canvas renderer; `src/ui/` — DOM shell and styles.
- `src/game/` — flow state machine, all player-facing text, composer, saves.
