# The cast (Layer 1.5)

> **This layer has not been read by the switch-access community it is written
> for, and it went live in the hosted build anyway.** The honest statement is
> that it shipped unreviewed. It is now a setting, **off by default** (Settings
> → Character names), which is the flag that should have been there first; that
> does not convert "shipped unreviewed" into "reviewed". The review still comes
> before any submission to the NARBE library, and it decides whether the layer
> stays — but "pending review" would describe a gate that was applied, and it
> was not. Read the table
> below with that in mind: "can't X, so they're great at Y" is a trope with a
> long history of being written *about* disabled people rather than *by* them,
> and three of the four mappings here are narrative applied to physics numbers
> that already existed — the right-hand column says which.

Every playable shape can be a character. Some of them have disabilities. With
the setting off — the shipped default — none of this layer is spoken: a shape is
named for what it is and described by what it does.

The design rule this layer was built on — and the thing the review above has to
rule on — is **a disability is never a debuff**: the compensating ability is the
character's mechanical identity, the language leads with what they can do, and
the narrator is matter-of-fact rather than admiring. That is a compensation
framing, and it is contested; it is written here as the assumption under review,
not as a settled principle. Two of the six shapes are left unmapped.

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

## Rack blurbs (spoken on focus with the cast layer on)

These are the shipped strings from `src/tuning.ts`. They were rewritten once: the
first four each opened with the deficit ("Dot can't see. But she hears
everything."), which is the construction this file's own rule forbids.

They are no longer the opening of the spoken line. A focus label does not hold
the scan timer, so at the default 2 s rung the tail is not heard, and the
yardage — the number the shot turns on — has to come first: the line is
"`<name>`. Goes about N yards. `<blurb>`". Ability-first survives inside the
blurb, not at the top of the utterance. `menu-check` asserts that order.

Each shape also carries a `plainName` and a `plainBlurb` used when the setting
is off — same facts, no persona, no pronouns.

- Dot: "Dot hears everything. She listens for the beeper at the cup, and rolls right to it. She does not need to see it."
- Brick: "Brick lands, and he stays. Wind moves him less than any other shape. Brick is deaf."
- Glide: "Glide flies, and nobody flies farther. The wind pushes them around the most. Glide does not walk."
- Penny: "Penny flies high, lands soft, and stays right there. She taps once for yes — she says what she needs to."
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
- Score lines and outcome lines refer to characters by name, not by shape word —
  with the setting on. With it off they use the plain name, the hole-out line
  ends at "In the cup!", and Boing's "Boing!" bounce line falls back to the
  neutral wording every other shape already used.
- Title, help screen, and 'Where am I?' stay functional and plain.

## Before this goes to the NARBE library

This layer specifically — characters with disabilities, written for a disability
community — gets shown to the NARBE House community (their Discord) for a read
BEFORE any submission to their library; that step does not get skipped. They
are the qualified reviewers of whether it lands.

It should have been shown to them before it went live on the public build, and
it was not. It is now behind a setting that defaults off, which is what should
have happened first — but that is a correction after the fact, not the process
this section describes. Shipping first and asking after is what occurred, and
this file should not read as though it were otherwise.
