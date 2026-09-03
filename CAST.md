# The cast — optional character layer

**What it is:** every shape in the game can be a character with a name and a
personality. This is a **setting, off by default** (Settings → Character
names). With it off — the default — a shape is just a shape: "Ball", "Cube",
described by what it does. With it on, "Ball" becomes "Dot", "Cube" becomes
"Brick", and the spoken lines get a persona.

**Where you see it** (only with the setting on): the shot list during a round,
the practice range, the Help page ("The shapes" becomes "Meet the team"), and
the hole-out lines.

## The six

Four of the characters are written as disabled. The design rule: a disability
never makes a character worse at the game — the language leads with what they
can do, and the narrator is matter-of-fact, never admiring, never "despite".

| Shape | Name | Written as | Where the mechanic came from |
|---|---|---|---|
| Sphere | **Dot** | blind | Homing rollout: after her bounces settle, her roll bends toward the cup's beeper (bounded — see below). NEW sim mechanic, written for her, and the only one in the table. |
| Cube | **Brick** | deaf | Lowest windSens + dead stop, already in tuning before the character existed. The link between deafness and wind is a pun. It is not a mapping, and it is the weakest row in this table. |
| Pancake | **Penny** | nonspeaking | High lob, lands soft, stays put. Narrative only: with the cast layer on, one soft tap (sfx) when she holes out, before the piano note. |
| Disc | **Glide** | not walking | Longest reach; wind is their challenge. Already in tuning; no sim change. |
| Star | **Boing** | no mapping | Chaos bounces. Deliberately unmapped. |
| Egg | **Egg** | no mapping | Huge variance. Deliberately unmapped, comic relief. |

Only Dot's mechanic was actually built for her character. The other three are
physics that existed first, with a story written onto them afterwards — the
right-hand column says which. Boing and Egg are left unmapped on purpose:
forcing a mapping onto all six would cheapen the real ones.

## Rack blurbs (spoken on focus with the cast layer on)

These are the shipped strings from `src/tuning.ts`, reprinted verbatim. The
spoken line is "`<name>`. Goes about N yards. `<blurb>`" — the yardage comes
first because it is the number the shot turns on, and a focus label can be cut
off by the scan timer.

- Dot: "Dot hears everything. She listens for the beeper at the cup, and rolls right to it. She does not need to see it."
- Brick: "Brick lands, and he stays. Wind moves him less than any other shape. Brick is deaf."
- Glide: "Glide flies, and nobody flies farther. The wind pushes them around the most. Glide does not walk."
- Penny: "Penny flies high, lands soft, and stays right there. She taps once for yes."
- Boing: "Boing just loves to bounce. Boing! Where will he land? Even he doesn't know."
- Egg: "The egg. Who knows where it will go? Not even the egg."

Each shape also has a `plainName` and a `plainBlurb` used when the setting is
off — same facts, no persona, no pronouns.

## Dot's homing (the one new mechanic)

- Trigger: when Dot's roll would stop within `homing.radius` (~15 m) of the cup.
- Effect: she listens and rolls up to `homing.pull` (~5 m) toward the beeper,
  holing out if that walk reaches the gimme. GIMME_M is unchanged.
- Bounded on purpose: `pnpm calibrate` requires homing to improve her mean
  finish by 1–6 m on a full approach shot, and her single-stroke hole-out rate
  to stay under 0.6. She is the best putter, not an aimbot.
- Schema: `ShapeSpec.homing?: { radius: number; pull: number }`.

## Narration rules

- Ability first, matter-of-fact. Never overcoming-tragedy framing, never
  "despite".
- With the cast on, Penny's hole-out plays one soft tap sound and the narrator
  says "Penny taps once." — and stops there. The narrator does not translate
  what her tap means; that is not the game's to decide.
- With the setting off, every line uses the plain name, the hole-out line ends
  at "In the cup!", and nothing from this layer is spoken. `menu-check` greps
  every file under `src/` for a reader of the cast strings that skips the
  setting, so a new leak fails the suite.

## Status: unreviewed

**This layer has not been read by the switch-access community it is written
for.** "Can't X, so they're great at Y" is a trope with a long history of being
written *about* disabled people rather than *by* them, and whether this layer
crosses that line is not a call to make on someone else's behalf. That is why
it defaults off.

Before this game is submitted to the NARBE library, disabled switch users need
to read this file and say whether the layer lands or grates. Their answer
decides whether it stays. That ask has not been made yet.
