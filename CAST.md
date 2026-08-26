# The cast (Layer 1.5)

> **This layer has not been read by the switch-access community it is written
> for, and it went live in the hosted build anyway. It shipped unreviewed.** It is now a setting, **off by default** (Settings
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

That sentence was false when it was first written. Two places read the cast
strings without consulting the setting: the practice range's narration, and this
file's own contents by way of the Help page's "Meet the team", which was a
module-level constant and so could not consult a setting even in principle. A
player who turned the layer off could still be told "Brick is deaf" and "Glide
does not walk". There were four in the end: those two, the main-menu row that
opened the Help page (it said "meet the team" in both modes), and a help line
that called the shapes "friends". All four are gated now. `menu-check` covers
the rack, the range and the Help page in both modes, greps every file under
`src/` for a new ungated reader, and greps separately for cast phrases typed
into a string — because the behavioural checks written for this missed the
sites their author had not thought of, and a grep does not depend on
remembering that a call site exists.

The design rule this layer was built on — and the thing the review above has to
rule on — is that no character's disability makes them worse at the game: the
compensating ability is the
character's mechanical identity, the language leads with what they can do, and
the narrator is matter-of-fact rather than admiring. That is a compensation
framing, and it is contested; it is written here as the assumption under review,
not as a settled principle. Two of the six shapes are left unmapped.

The four purposeful shapes are not ranked against each other; each has a hole
where it is the right choice. The two gamble shapes are never the sober best
line, by design — they win by luck. `pnpm holes` asserts both.

## The six

The middle column says how each character is written. It is deliberately not
phrased as "can't X, so they're great at Y"; the right-hand column says where
each mechanic came from, and for three of the four it existed first and the
character was written onto it afterwards.

| Shape | Name | Written as | Where the mechanic came from |
|---|---|---|---|
| Sphere | **Dot** | blind | Homing rollout: after her bounces settle, her roll bends toward the cup's beeper (bounded — see below). NEW sim mechanic, written for her. The only one. |
| Cube | **Brick** | deaf | Lowest windSens + dead stop, already in tuning before the character existed. The link between deafness and wind is a pun, not a mapping. |
| Pancake | **Penny** | nonspeaking | High lob, lands soft, stays put. Narrative only: with the cast layer on, one soft tap (sfx) when she holes out, before the piano note. |
| Disc | **Glide** | not walking | Longest reach; wind is their challenge. Already in tuning; no sim change. |
| Star | **Boing** | no mapping | Chaos bounces. Deliberately unmapped. |
| Egg | **Egg** | no mapping | Huge variance. Deliberately unmapped, comic relief. |

The one disability the game wrote code for is Dot's, and the code turns it into
a targeting advantage. That is the most criticisable thing in this file, and it
belongs here rather than left to be found.

Penny's blurb opens on the deficit in the published build — "Penny doesn't
talk. She taps once for yes. She flies high, lands soft, and stays right
there." — which this file's own rule forbids. What ships next puts the ability
first and stops at the tap: "Penny flies high, lands soft, and stays right
there. She taps once for yes." The narrator's hole-out line stops there too. It
used to add "That means yes", which is a hearing player being told what a
nonspeaking character's one output means. That is not the game's to decide.

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
- Penny: "Penny flies high, lands soft, and stays right there. She taps once for yes."
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

- The narrator describes ability matter-of-factly ("Brick lands, and he stays.
  Wind moves him less than any other shape." — `tuning.ts`),
  never as overcoming-tragedy framing, never "despite."
- Penny's celebrations are hers: the tap is the cheer. The narrator says
  "Penny taps once. That means yes."
- Score lines and outcome lines refer to characters by name, not by shape word —
  with the setting on. With it off they use the plain name, the hole-out line
  ends at "In the cup!", the practice range says "Pancake went 145 yards!"
  rather than "Penny…", the Help page's shapes entry is titled "The shapes"
  rather than "Meet the team", and Boing's "Boing!" bounce line falls back to
  the neutral wording every other shape already used.
- Title, help screen, and 'Where am I?' stay functional and plain.

## Before this goes to the NARBE library

This layer needs to be read by disabled switch users before it goes anywhere
near the NARBE library. The NARBE House Discord is the obvious place to ask.
That ask has not been made, and nobody there has agreed to do it.

It should have been shown to them before it went live on the public build, and
it was not. It is now behind a setting that defaults off, which is what should
have happened first — but that is a correction after the fact, not the process
this section describes. Shipping first and asking after is what occurred, and
this file should not read as though it were otherwise.
