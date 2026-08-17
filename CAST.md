# The cast (Layer 1.5 — applied after the base build lands)

Every playable shape is a character. Some of them have disabilities. The rule that
makes this work: **a disability is never a debuff.** Each character is "can't X —
and that's why they're amazing at Y." The compensating ability IS their mechanical
identity, the language always leads with what they can do, and the narrator speaks
about them matter-of-factly, never with pity. Not every character gets a mapping;
forcing all six would cheapen it.

The game's strategy statement is the disability-positive statement: no shape is
ranked above another, and each purposeful shape has a hole where it is the right
choice (the gamble shapes win by luck, on purpose — the harness asserts exactly
that, no more).

## The six

| Shape | Name | Mapping | Mechanical identity |
|---|---|---|---|
| Sphere | **Dot** | Blind — hears everything | Homing rollout: after her bounces settle, her roll bends toward the cup's beeper (bounded — see below). NEW sim mechanic. |
| Cube | **Brick** | Deaf — the wind can't trick him | Lowest windSens + dead stop. Already true in tuning; zero sim change. |
| Pancake | **Penny** | Nonspeaking — taps once for yes | High lob, lands soft, stays put. Narrative only: when Penny holes out, one soft tap (sfx) before the piano note; the narrator waits for it. |
| Disc | **Glide** | Doesn't walk — flies | Longest reach, wind is their challenge. Aspirational mapping, no sim change. |
| Star | **Boing** | none — pure joy | Chaos bounces. Deliberately unmapped. |
| Egg | **Egg** | none — pure luck | Huge variance. Deliberately unmapped, comic relief. |

## Rack blurbs (spoken on focus, 3rd-grade level, ability-first)

- Dot: "Dot can't see. But she hears everything. She listens for the beeper at the cup, and rolls right to it."
- Brick: "Brick can't hear. The wind can't trick him. He lands, and he stays."
- Glide: "Glide doesn't walk. Glide flies. Nobody flies farther. But the wind pushes them around."
- Penny: "Penny doesn't talk. She taps once for yes. She flies high, lands soft, and stays right there."
- Boing: "Boing just loves to bounce. Boing! Where will he land? Even he doesn't know."
- Egg: "The egg. Who knows where it will go? Not even the egg."

## Dot's homing (the one new mechanic)

- Trigger: when Dot's roll would stop within `homing.radius` (~15 m) of the cup.
- Effect: she listens and rolls up to `homing.pull` (~5 m) toward the beeper,
  holing out if that walk reaches the gimme. GIMME_M is unchanged.
- Harness (calibrate): measured on a full APPROACH (150 m, green around the cup):
  homing must improve her mean finish distance by 1–6 m vs the same run with
  homing disabled, and her single-stroke hole-out rate must stay under 0.6.
- Amended 2026-08-15 (originally a 15 m-lie test with a 2–6 m band, written
  before measurement): the generous gimme makes putts under ~7 m near-automatic
  for EVERY shape by design ("no putting grind", DESIGN.md), so a short-lie test
  cannot separate homing from ordinary putting — Dot walking into the gimme from
  6 m is equivalent to Brick's σ≈0.2 m putt from the same spot. Homing's real
  identity shows on approach shots, which is what the harness now measures.
- Schema: `ShapeSpec.homing?: { radius: number; pull: number }` (types.ts + tuning).

## Narration rules

- The narrator describes ability matter-of-factly ("Brick doesn't mind the wind"),
  never as overcoming-tragedy framing, never "despite."
- Penny's celebrations are hers: the tap is the cheer. The narrator says
  "Penny taps once. That means yes."
- Score lines and outcome lines refer to characters by name, not by shape word.
- Title, help screen, and 'Where am I?' stay functional and plain.

## Before this ships to the NARBE library

This layer specifically — characters with disabilities, written for a disability
community — gets shown to the NARBE House community (their Discord) for a read
BEFORE any submission to their library; that step does not get skipped. They
are the qualified reviewers of whether it lands.
