# Odd Ball

You are the golf ball. Before every shot you pick what **shape** to be, and the
shape's physics is the whole strategy. There is no timing and no reflex input:
the game is fully playable with two keys, and built for switch-access users,
low vision, and text-to-speech.

Built to the input contract in the NARBE hub's
[ACCESSIBILITY.md](https://github.com/NARBEHOUSE/Narbehouse.github.io/blob/main/bennyshub/ACCESSIBILITY.md),
which the [NARBE House developer guide](https://narbehouse.github.io) names as
the authority. DESIGN.md lists where this standalone build departs from it, and
why.

## The cast

Every shape is a character, and some of them have disabilities. The framing
below — a compensating ability for each one — is contested, and this layer has
not been read by the switch-access community it is written for. That review
happens before any submission to their library, and it decides whether the
layer ships at all. CAST.md sets out the reasoning and its limits.

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
  open). There is also a **Menu** row at the end of the shot list and a Pause
  button on screen, so reaching it never depends on holding a switch down.
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
- Text scales to 200%. At that size the scan list keeps its space and the
  caption and footer give up theirs, so the highlighted choice is always
  fully visible.
- Two six-hole courses, two-player pass-and-play, a practice range, and a
  **Make a Hole** editor (pick length, hills, water, sand, wind — par comes
  from simulating your hole, and you can save ten of them).

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
pnpm editor-check   # every editor combination is playable by construction
pnpm input-check    # switch/scan grammar self-test
pnpm menu-check     # pause menu / confirms / Auto Scan, through the real flow
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
