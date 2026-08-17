# Odd Ball — design spec (canonical)

A switch-accessible, turn-based golf game. You are the ball. Before every shot you
choose what **shape** to be; the golfer strikes you; you watch (and hear) what happens.
Shape choice is the entire skill — there is no timing, no aiming, no reflex input.

Target platform: web, standalone (Vite static build). Audience: switch users
(1–2 inputs), low vision, ~3rd-grade reading level. Built to the NARBE House
developer guide (narbehouse.github.io) constraints.

## Input grammar (NARBE spec — do not deviate)

- **Spacebar release** (held < 3 s): step scan highlight FORWARD one item.
  Activates on **keyup** so accidental holds don't trigger.
- **Spacebar held ≥ 3 s**: auto-scan forward (one step per `scanMs`) until release.
  The release that ends auto-scan does NOT also fire a step.
- **Return release** (held < 1.5 s): SELECT the highlighted item (fires on keyup).
- **Return held ≥ 1.5 s**: open the context/pause menu. Fires AT the threshold;
  the eventual keyup is swallowed.
- Scanning is idle until the first Spacebar press in a scene — no highlight moves on its own
  before that (the first list still shows highlight on item 0, but nothing advances).
- **Wrap deadzone**: before the highlight wraps from the last item back to the first,
  one scan step lands on "no highlight" (nothing focused, nothing spoken). The next
  step focuses item 0.
- Scan order is fixed top-to-bottom; never reordered mid-session.
- Returning from a submenu restores the highlight to the item that opened it.
- **Pointer (optional but required to work)**: click an item = select it.
  Click-and-hold (≥ 1.5 s) anywhere = context menu. Never require dragging.
- The context menu is reachable on EVERY screen, including during flight
  (pauses the animation).

## TTS

- Web Speech API (`speechSynthesis`). Speak on focus AND on selection. Never block
  input — speech is interrupted by the next focus, input is never queued behind speech.
- Everything spoken is also shown as a large-print caption (the caption bar).
- Every utterance is ALSO `console.log`-ed as `[tts] <text>` (used for automated verification).
- Settings: TTS on/off, rate, volume.
- All text lives in `src/game/lines.ts`, written at ~3rd-grade level: short sentences,
  common words, numbers in whole yards.

## Visual

- DOM UI for all menus/racks (scannable lists); canvas only for the course view.
- Four color profiles via CSS custom properties + `data-theme` on `<html>`:
  `high-contrast` (default), `light`, `dark`, `warm`.
- Font scaling presets 100/125/150/175/200 % (CSS var, applies to all UI text).
- Highlight ring: thick outline + high contrast; thickness setting thin/medium/thick;
  focused item also gets a gentle pulse (disabled by reduce-motion).
- Header on every screen: game title, current screen name. Footer: current mode,
  the currently highlighted item's name, and the legend
  "Space = next · Return = select · Hold Return = menu".
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
- `pnpm input-check` — headless self-test of the switch/scan grammar state machines.
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
  composed hole (~150 ms). Up to 10 saved holes ("My Hole N") under My Holes.
- **Dwell-to-select**: hover an item for 1.2/2 s (setting) to select — head- and
  eye-tracking users. Visible fill via the --dwell custom property.
- **Flight sonification**: a quiet tone glides with the ball's height (setting;
  eyes-closed play). The cup beeper accelerates as a rolling ball closes in.

## Persistence

- `localStorage` key `oddball-save-v1`. Auto-save after every state-changing selection.
- Resume restores: hole, strokes, ball position/lie, settings, and the highlighted index
  of the frame the player was in. Title screen offers Continue when a round exists.

## Module map

- `src/types.ts` — shared contracts between modules.
- `src/tuning.ts` — every number: shapes, courses, physics constants, editor tables.
- `src/sim/` — deterministic physics; `tools/` — the verification harnesses
  (`calibrate`, `holes`, `editor-check`, plus `input-check` for the scan grammar).
- `src/input/` — switch grammar + scanner; `src/speech/` — TTS; `src/audio/` — sound.
- `src/render/draw.ts` — the canvas renderer; `src/ui/` — DOM shell and styles.
- `src/game/` — flow state machine, all player-facing text, composer, saves.
