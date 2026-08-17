# Odd Ball

You are the golf ball. Before every shot you pick what **shape** to be, and the
shape's physics is the whole strategy. There is no timing and no reflex input:
the game is fully playable with two keys, and built for switch-access users,
low vision, and text-to-speech.

Built to the accessibility constraints of the
[NARBE House developer guide](https://narbehouse.github.io).

## The cast

Every shape is a character, and no character's disability is ever a weakness
in the game:

- **Dot** (ball) — blind; she hears the beeper at the cup and rolls toward it.
- **Brick** (cube) — deaf; the wind can't trick him. Lands and stays.
- **Glide** (disc) — doesn't walk, flies. Nobody flies farther.
- **Penny** (pancake) — nonspeaking; taps once for yes. Lands soft, stays put.
- **Boing** (star) — never stops bouncing.
- **Egg** — who knows? Not even the egg.

No shape is best everywhere. The four purposeful shapes each have at least one
hole where they are part of the best line, and Egg and Boing are gambles by design — the
harness checks that their lucky tail beats the careful line somewhere, never
that they are best. A harness checks all of this on every change.

The character layer has not yet had a read from the switch-access community it
is written for; that review happens before any submission to their library.

## Playing

- **Space** — next choice. **Return** — pick it. **Hold Return** — menu.
- Hold Space to auto-scan. Click/tap also works, and there is a hover-to-pick
  (dwell) mode for head- and eye-tracking users.
- Everything is spoken and captioned. The ball sings higher as it flies higher;
  the cup beeps faster as a rolling ball gets close — playable eyes closed.
- Two six-hole courses, two-player pass-and-play, a practice range, and a
  **Make a Hole** editor (pick length, hills, water, sand, wind — par comes
  from simulating your hole, and you can save ten of them).

There is no hosted build yet — run it locally with the commands below. Speech
uses the browser's built-in voices (best in Chrome, Edge, or Safari; some
Linux/Firefox setups have no voices installed).

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
