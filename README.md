# Odd Ball

You are the golf ball. Before every shot you pick what **shape** to be, and the
shape's physics is the whole strategy. There is no timing and no reflex input:
the game is fully playable with two keys, and built for switch access, low
vision, and text-to-speech.

Built **against** the input contract in the NARBE hub's
[ACCESSIBILITY.md](https://github.com/NARBEHOUSE/Narbehouse.github.io/blob/main/bennyshub/ACCESSIBILITY.md),
which the [NARBE House developer guide](https://narbehouse.github.io/developer-guide.html)
names as the authority. This is a standalone build that cannot call the hub's
shared modules, so it follows the contract without being able to import it.
DESIGN.md lists every departure, and itemises their §10 shipping checklist item
by item — including the one they say is the only test that counts, which is not
ticked.

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
- Everything is spoken and captioned. A tone rises with the ball's height. The
  cup beeper speeds up as a rolling ball gets close. It is playable without
  looking at the screen.
- Text scales to 200%. The scan list is what gets the room: the caption and
  footer give up theirs first. Separately, on a **short or narrow viewport** —
  which is about the window, not the text size — the rows stop growing. The
  footer legend goes too on a short one: below 560px of height always, and
  between 561 and 700px only at 175% or 200% text. (Those keys are spoken and on
  the Help page.) At large print on a mid-width window the list stops sharing the
  screen with the course view and takes the full width instead. All of it so the
  highlighted row stays on screen and inside its own box rather than scaling
  itself out of view. `pnpm layout-check` measures this on every build — run it
  for the cell count; it prints one. It sweeps every text scale across viewports
  from 1920x1080 down to 280x480, enumerating the two corners where the tiers
  overlap (narrow-and-short, and mid-width-and-tall), plus focused passes for the
  thick highlight ring and the character names. It checks four things per row:
  nothing clipped vertically, nothing overflowing sideways, the highlight ring
  drawn whole, and the Pause button on screen. The rows do get small on the
  smallest screens — DESIGN.md gives the measured sizes and says where they fall
  short of the hub's 64 px guidance.
- Two six-hole courses, two-player pass-and-play, a practice range, and a
  **Make a Hole** editor (pick length, hills, water, sand, wind — par comes
  from simulating your hole, and you can save ten).

**Play it at [oddball.pages.dev](https://oddball.pages.dev)** — or run it
locally with the commands below. Speech uses the browser's built-in voices
(best in Chrome, Edge, or Safari; some Linux/Firefox setups have no voices
installed).

## The cast (optional, off by default)

Every shape can be a character, and four of them have disabilities. That layer
is a **setting, off by default** (Settings → Character names); with it off a
shape is named for what it is and described by what it does — *"Cube. Goes about
93 yards. It lands and it stays. Wind moves it less than any other shape."*

The framing — a compensating ability for each character — is contested, and it
has not been read by the switch-access community it is written for. It shipped
unreviewed. The hub's contract is blunt that a player "is not a child, and
should not be talked to like one", and whether this layer crosses that line is
not a call to make on someone else's behalf. The setting does not resolve the
question; it means the game does not apply it unless the player asks. That
review still comes before any submission to their library, and it decides
whether the layer stays at all.

**CAST.md** has the six characters, the mapping for each, and the limits of the
whole idea — including that three of the four mappings are narrative applied to
physics that already existed, and only one is a mechanic written for a
character.

No shape is best everywhere. The four purposeful shapes each have at least one
hole where they are part of the best line. Egg and Boing are gambles by design:
the harness checks their lucky tail beats the careful line on at least one hole,
not that they are best anywhere. Re-checked on every change.

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
pnpm layout-check   # drives the built bundle in a browser across every text
                    # scale and viewport tier; needs `pnpm build` first
pnpm mutate         # breaks the shipped code one edit at a time; each must go red
                    # (this one WRITES to src/ and restores it — needs a clean tree)
pnpm build
pnpm deploy          # Cloudflare Pages; publishes dist/ to oddball.pages.dev
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
