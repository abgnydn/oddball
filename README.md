# Odd Ball

You are the golf ball. Before every shot you pick what **shape** to be, and the
shape's physics is the whole strategy. There is no timing and no reflex input:
the game is playable with two keys, and built for switch access, low
vision, and text-to-speech.

Built **against** the input contract in the NARBE hub's
[ACCESSIBILITY.md](https://github.com/NARBEHOUSE/Narbehouse.github.io/blob/main/bennyshub/ACCESSIBILITY.md),
which the [NARBE House developer guide](https://narbehouse.github.io/developer-guide.html)
names as the authority. This is a standalone build that cannot call the hub's
shared modules, so it follows the contract without being able to import it.
DESIGN.md lists the departures found so far, and itemises their §10 shipping
checklist item by item — including the item §10 calls the only test that counts, which is not
ticked.

**Odd Ball is not a NARBE House project.** It is not in their library, it has
not been submitted, and nobody there has reviewed or endorsed it. It is one
person's build against their published contract. Their §13 reserves "Benny's
Accessibility Hub", "NARBE" and "NARBE Foundation" as project identifiers,
grants no trademark rights, and says forks must not imply endorsement or
affiliation. The names above cite their contract and claim no connection to it.

## Playing

**Setting it up for one switch.** Map the switch to Enter. In Settings, turn
**Auto scan** on and set **Scan speed** to the slowest rung your player is
comfortable with. If your player cannot hold a switch down, also turn
**Animations** off: that removes the flight animation, which is the one place
the menu is not scannable. Settings save in the browser.

- **Space** — next choice. **Enter** — pick it. **Hold Enter** — menu (it stays
  open). There is also a **Menu** row at the end of both shot lists — a round and
  the practice range — and a Pause button on screen, so reaching the menu never
  depends on holding a switch down anywhere except the flight animation. There
  the list is hidden, so the only routes are the 3 s hold and the Pause button,
  and the Pause button needs a pointer — it is not in the scan order. A
  switch-only player who cannot hold cannot pause a flight. The panel is gone
  for a measured 3.45 to 7.95 seconds. It is longest when the ball goes in,
  because a hole-out has an afterglow. Turning **Animations** off in Settings
  removes the animated flight, and with it this gap.
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
  cup beeper speeds up as a rolling ball gets close. Every screen is spoken, so
  the screen should not be needed to play — but nobody has played it through
  that way, and no harness does either.
- Text scales to 200%. On a small window the caption bar, the footer legend and
  the row sizes give up room in that order, so the highlighted row stays on
  screen and whole. `pnpm layout-check` drives the built game in a browser and
  measures it on every deploy. The rows do get small on the smallest screens —
  DESIGN.md gives the measured sizes and says where they fall short of the hub's
  64 px guidance.
- Two six-hole courses, two-player pass-and-play, a practice range, and a
  **Make a Hole** editor (pick length, ground, water, sand, wind — par comes
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
not that they are best anywhere. `pnpm holes` asserts both, and it runs when
someone types it — there is no CI, and the git hooks run biome and gitleaks
only.

## Development

Needs Node 22+ and pnpm 10+. `pnpm layout-check` and `pnpm deploy` also need a
chromium binary — `pnpm exec playwright-core install chromium`, once.

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
                    # scale and viewport tier; needs `pnpm build` first, and a
                    # chromium binary: `pnpm exec playwright-core install chromium`
                    # once. `pnpm install` does not fetch a browser; the
                    # installer ships with playwright-core.
pnpm mutate         # breaks the shipped code one edit at a time; each must go red
                    # (this one WRITES to src/ and restores it — needs a clean tree)
pnpm format         # biome, writes
pnpm preview        # serve the built dist
pnpm build
pnpm deploy          # build + layout-check, then publish dist/ to oddball.pages.dev
```

TypeScript + Vite, canvas-2D renderer, Web Speech API, WebAudio. No runtime
dependencies. The physics is deterministic (seeded); the harnesses above are
the safety net. Pars are literals in `src/tuning.ts`, and `pnpm holes` fails if
any of them differs from what simulating the hole produces.

## Sound credits

All recordings are CC0: Kenney's Interface Sounds and Impact Sounds
(kenney.nl) plus two freesound.org recordings by bolkmar and WizardOZ —
details in `public/sfx/CREDITS.md`.

## License

MIT — see [LICENSE](LICENSE).
