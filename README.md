# Odd Ball

**You are the golf ball.** Before every shot you pick what **shape** to be —
ball, cube, disc, egg, star, or pancake — and the shape's physics is the whole
strategy. No timing, no reflexes: the whole game plays with two keys, and it is
built for switch access, low vision, and text-to-speech.

**Play it now: [oddball.pages.dev](https://oddball.pages.dev)** — free, no
account, runs in the browser. Speech uses the browser's built-in voices (best
in Chrome, Edge, or Safari).

**Odd Ball is not a NARBE House project.** It is not in their library, it has
not been submitted, and nobody there has reviewed or endorsed it. It is one
person's build against their published contract. Their §13 reserves "Benny's
Accessibility Hub", "NARBE" and "NARBE Foundation" as project identifiers,
grants no trademark rights, and says forks must not imply endorsement or
affiliation. The names in this repo cite their contract and claim no connection
to it. The contract is the input spec in the NARBE hub's
[ACCESSIBILITY.md](https://github.com/NARBEHOUSE/Narbehouse.github.io/blob/main/bennyshub/ACCESSIBILITY.md),
which their [developer guide](https://narbehouse.github.io/developer-guide.html)
names as the authority; this is a standalone build, so it follows the contract
without importing the hub's shared modules.

## Controls

| Input | What it does |
|---|---|
| **Space** | next choice |
| **Enter** | pick the highlighted choice |
| **Hold Space** | scan backwards |
| **Hold Enter** | open the menu (works everywhere, even mid-animation) |
| Click / tap | also works everywhere; nothing needs a drag |
| Hover (dwell) | optional hover-to-pick mode for head- and eye-tracking users |

While you hold a switch, a ring fills on screen and a beep rises each second,
so a working hold never looks like a dead switch. There is also a scannable
**Menu** row on every shot list and a Pause button on screen, so reaching the
menu never depends on being able to hold a switch down. During the flight
animation the list is hidden for 3.45 to 7.95 seconds; there, a single
**Enter** press opens the menu, and turning **Animations** off in Settings
removes the animated flight altogether.

## Setting it up for one switch

1. Map the switch to **Enter** in your switch interface's own software (the
   game has no remapping).
2. In Settings, turn **Auto scan** on — the highlight then moves by itself and
   Enter is the only key needed.
3. Set **Scan speed** to what your player needs: 1, 2, 3 or 4 seconds.
4. If your player cannot hold a switch down, turn **Animations** off too.

Settings are saved in the browser; clearing site data resets them and any round
in progress. On iOS the first spoken line can be silent until you tap once.

## What's in the game

- Two six-hole courses, and a two-player pass-and-play mode.
- A practice range.
- A **Make a Hole** editor: pick length, ground, water, sand and wind; par is
  measured by simulating your hole, and you can save ten.
- An optional character layer, **off by default** (Settings → Character
  names): each shape becomes a character — see [CAST.md](CAST.md) for who they
  are and for the open question about that layer.
- Everything is spoken and captioned. A tone rises with the ball's height, and
  the cup beeper speeds up as a rolling ball gets close.
- Text scales to 200%. On small screens the caption bar, footer legend and row
  sizes give up room in that order, so the highlighted row stays whole and on
  screen.
- Destructive actions (new round, exit, delete a saved hole) ask twice, and the
  confirm is a two-row dialog with the "no" answer first — a mis-timed pick is
  an ordinary event when you scan.

## Honest status

- **Nobody has played this start to finish with one switch.** The hub's own
  checklist calls that the only test that counts. The one-switch path is
  covered by automated harnesses and by hand, which is not the same thing.
- The character layer has not been reviewed by the switch-access community it
  is written for. It ships off by default; the review decides whether it stays.
- [DESIGN.md](DESIGN.md) walks their §10 shipping checklist item by item and
  says exactly what is met, what is met by a different route, and what is not.

## Development

Needs Node 22+ and pnpm 10+. `pnpm layout-check` and `pnpm deploy` also need a
chromium binary — `pnpm exec playwright-core install chromium`, once
(`pnpm install` does not fetch a browser).

```sh
pnpm install
pnpm dev            # http://localhost:5184
pnpm typecheck && pnpm lint
pnpm calibrate      # shape-identity harness
pnpm holes          # course playability / no-dominance harness
pnpm editor-check   # every editor combo stays playable; samples 62 of 540
pnpm input-check    # switch/scan grammar self-test
pnpm menu-check     # menus, confirms, Auto Scan, cast gating — the real flow
pnpm layout-check   # drives the BUILT game in a browser across every text
                    # scale and viewport tier; run `pnpm build` first
pnpm mutate         # breaks the code one edit at a time; each must go red
                    # (writes to src/ and restores it — needs a clean tree)
pnpm build
pnpm preview        # serve the built dist
pnpm deploy         # build + layout-check, then publish to oddball.pages.dev
```

TypeScript + Vite, canvas-2D renderer, Web Speech API, WebAudio. No runtime
dependencies. Physics is deterministic (seeded). Pars are literals in
`src/tuning.ts`, and `pnpm holes` fails if any differs from what simulating the
hole produces. The harnesses run when someone types them — there is no CI; the
git hooks run biome and gitleaks only.

## Sound credits

All recordings are CC0: Kenney's Interface Sounds and Impact Sounds
(kenney.nl) plus two freesound.org recordings by bolkmar and WizardOZ —
details in `public/sfx/CREDITS.md`.

## License

MIT — see [LICENSE](LICENSE).
