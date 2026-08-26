# Odd Ball

You are the golf ball. Before every shot you pick what **shape** to be, and the
shape's physics is the whole strategy. There is no timing and no reflex input:
the game is fully playable with two keys, and built for switch-access users,
low vision, and text-to-speech.

Built **against** the input contract in the NARBE hub's
[ACCESSIBILITY.md](https://github.com/NARBEHOUSE/Narbehouse.github.io/blob/main/bennyshub/ACCESSIBILITY.md),
which the [NARBE House developer guide](https://narbehouse.github.io/developer-guide.html)
names as the authority. Against, not to: this is a standalone build that cannot
call the hub's shared modules, and roughly half of their shipping checklist is
unmet — including the one they say is the only test that counts. DESIGN.md lists
every departure, with the unflattering ones first.

## The cast

Every shape can be a character, and some of them have disabilities. The framing
below — a compensating ability for each one — is contested, and this layer has
not been read by the switch-access community it is written for. It shipped
unreviewed once, and it is now a **setting, off by default** (Settings →
Character names). The default reading describes what a shape does and stops:
*"Cube. Goes about 93 yards. It lands and it stays."* The hub's contract is
blunt that a player "is not a child, and should not be talked to like one", and
whether this layer crosses that line is not a call to make on someone else's
behalf. The setting does not answer the question; it stops the game answering it
for the player. That review still comes before any submission to their library,
and it decides whether the layer stays at all. CAST.md sets out the reasoning
and its limits.

- **Dot** (ball) — hears the beeper at the cup and her roll bends toward it.
  She is blind. She is the only shape with that mechanic.
- **Brick** (cube) — lands and stays; the lowest wind sensitivity of the six. He
  is deaf, and the wind cannot trick him.
- **Glide** (disc) — flies farther than anything else, and the wind moves it
  most. Glide does not walk.
- **Penny** (pancake) — lands soft and stays put. She is nonspeaking, and taps
  once for yes.
- **Boing** (star) — never stops bouncing.
- **Egg** — the highest carry variance of the six.

No shape is best everywhere. The four purposeful shapes each have at least one
hole where they are part of the best line. Egg and Boing are gambles by design.
The harness checks that their lucky tail beats the careful line on at least one
hole; it does not check that they are best anywhere. All of this is re-checked
on every change.

Three of the four mappings are narrative applied to physics that already
existed; only Dot's homing roll is a mechanic written for the character.
CAST.md's table says which is which.

## Playing

- **Space** — next choice. **Enter** — pick it. **Hold Enter** — menu (it stays
  open). There is also a **Menu** row at the end of both shot lists — a round and
  the practice range — and a Pause button on screen, so reaching the menu never
  depends on holding a switch down. One exception: during the flight animation
  there is no list, so there the routes are the hold and the Pause button only.
- Hold Space to scan backwards. **Auto Scan** (Settings) moves the highlight by
  itself, so a single switch on Enter is enough. Click/tap also works, and
  there is a hover-to-pick (dwell) mode for head- and eye-tracking users.
- Starting a new round, leaving a round, and deleting a saved hole all ask
  twice, because a mis-timed pick is an ordinary event when you scan (the
  NARBE hub's own accessibility notes make the same point).
- **Nobody has played this start to finish with one switch.** The hub's
  checklist calls that the only test that counts, and it is not ticked. The
  one-switch path is covered by harness and by hand; DESIGN.md lists that gap
  alongside the others.
- Everything is spoken and captioned. The ball sings higher as it flies higher;
  the cup beeps faster as a rolling ball gets close. It is playable without
  looking at the screen.
- Text scales to 200%. The scan list is what gets the room: the caption and
  footer give up theirs first. Separately, on a **short or narrow viewport** —
  which is about the window, not the text size — the rows stop growing, and on a
  **short** one the footer legend is dropped as well (those keys are also spoken
  and on the Help page), so the highlighted row stays on screen and inside its
  own box instead of scaling itself out of view. `pnpm layout-check` measures
  this on every build: 26 viewports x 4 text scales x 3 screens, from 1920x1080
  down to a 280x480 window, with the narrow-and-short corner enumerated rather
  than sampled. No row clipped, no sideways scrolling, the Pause button on
  screen everywhere. The rows do get small there — DESIGN.md gives the measured
  sizes and says where they fall short of the hub's 64 px guidance.
- Two six-hole courses, two-player pass-and-play, a practice range, and a
  **Make a Hole** editor (pick length, hills, water, sand, wind — par comes
  from simulating your hole, and you can save ten).

**Play it at [oddball.pages.dev](https://oddball.pages.dev)** — or run it
locally with the commands below. Speech uses the browser's built-in voices
(best in Chrome, Edge, or Safari; some Linux/Firefox setups have no voices
installed).

## Development

Needs Node 22+ and pnpm 10+.

```sh
pnpm install
pnpm dev            # http://localhost:5184
pnpm typecheck && pnpm lint
pnpm calibrate      # shape-identity harness (must stay green)
pnpm holes          # course playability / no-dominance harness
pnpm editor-check   # composer clamps make every combo playable; samples 62 of 540
pnpm input-check    # switch/scan grammar self-test
pnpm menu-check     # pause menu / confirms / Auto Scan, through the real flow
pnpm layout-check   # drives the built bundle in a browser: 26 viewports x 4 text
                    # scales x 3 screens; needs `pnpm build` first
pnpm mutate         # breaks the shipped code one edit at a time; each must go red
                    # (this one WRITES to src/ and restores it — needs a clean tree)
pnpm build
```

TypeScript + Vite, canvas-2D renderer, Web Speech API, WebAudio. No runtime
dependencies. The physics is deterministic (seeded); the harnesses above are
the safety net — pars come from simulation, with no hand-set values.

## Sound credits

All recordings are CC0: Kenney's Interface Sounds and Impact Sounds
(kenney.nl) plus two freesound.org recordings by bolkmar and WizardOZ —
details in `public/sfx/CREDITS.md`.

## License

MIT — see [LICENSE](LICENSE).
