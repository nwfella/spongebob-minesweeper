# Bikini Bottom Mines

A single-file HTML5 Minesweeper set in Bikini Bottom. Classic rules, SpongeBob art drawn entirely in canvas code, synthesized audio, best times per difficulty.

**Live:** https://nwfella.github.io/spongebob-minesweeper/
**Repo:** https://github.com/nwfella/spongebob-minesweeper

## Game design

| Aspect | Decision |
|---|---|
| Genre | Classic Minesweeper (the Windows 3.1 ruleset, not a variant) |
| Goal | Uncover every Plankton-free tile without detonating a mine |
| Levels | Jellyfish Fields 9×9 / 10 · Bikini Bottom 16×16 / 40 · The Chum Bucket 30×16 / 99 |
| Input | Pointer (mouse + touch), right-click, long-press, full keyboard nav |
| Persistence | Best time + wins/games per level in `localStorage` |
| Hints | 3 per game (Sandy picks a verified-safe tile, not a "logical" one) |

### Rules that are load-bearing (i.e. real Minesweeper, not a lookalike)

- **First click is always safe and opens a region.** Mines are placed *after* the
  first click, excluding the clicked cell **and its 8 neighbours**. That
  guarantees `num === 0` at the click, so the flood fill always opens something —
  no "lost on move one" and no lonely single-tile start.
- **Flood fill** expands through zero-tiles only, stopping at numbered tiles.
- **Chording** — click (or double-click / middle-click / tap) an open number whose
  adjacent flag count matches: every unflagged neighbour opens at once. If the
  flags are wrong, it detonates. That is the classic behaviour and it is tested.
- **Flag cycle** — flag → question → clear. A question mark does *not* block a
  reveal; a flag does, and also blocks the flood fill.
- **Win** = every non-mine tile revealed (flagging is not required). Remaining
  mines are auto-flagged on the win.
- **Mine counter** can go negative when you over-flag, exactly like the original.
- **Timer** starts at the first uncover (or the first flag, if you flag first) and
  freezes on win/loss.

## Art

Everything is procedural canvas 2D — zero image assets, zero network requests.

- **Plankton** = mine. Green bean body, one big eye with a red iris, antennae with
  bulbs, evil eyebrow, fang smirk.
- **Krabby Patty** = flag. Sesame bun, lettuce frill, patty, bottom bun, drop shadow.
- **SpongeBob's face = the new-game button**, and it reacts: `ready` → `press`
  (braced on pointerdown) → `wins` (sunglasses + grin) → `lose` (X eyes, wavy
  frown). The body is a wobbly rounded rect so the sponge silhouette is organic,
  with pores, freckles and lashes drawn per-face.
- **Tiles**: raised sand with a bevel highlight/shadow pair and hashed pebbles;
  revealed tiles are flat wet sand with the classic 1–8 colour ramp.
- **LED counters**: hand-drawn 7-segment digits with glow, centred and signed.

## Audio

Web Audio API synthesis only, no assets. Reveal pop (pitch scales with the number),
a bubbly sweep when the flood opens a region, two-tone flag ding, unflag glide,
chord triple-blip, explosion = filtered noise burst + descending saw, Plankton's
four-note laugh, and a five-note win arpeggio. Every tone is scheduled on
`audioCtx.currentTime` — never `setTimeout` — so multi-note cues never jitter the
frame loop. `AudioContext` is created lazily and resumed on the first gesture;
mute is persisted.

## Architecture

- Single `index.html`, one inline `<script>`, IIFE-scoped, `'use strict'`.
- `st` is a flat state object; the board is four typed arrays (`mine`, `num`,
  `rev`, `mark` — `Uint8Array`).
- Rendering is two-layer: tiles rasterise once into an offscreen cache canvas
  (invalidated by `st.dirty`), then each frame composites cache → cursor ring →
  particles → win flash. The rAF loop never touches the DOM except when a counter
  value actually changes.
- Deterministic RNG (`mulberry32`) seeded per game, so any board can be
  replayed from `(seed, firstClick)` — that is what makes the harness meaningful.
- `window.GAME` exposes the state machine, the raw grids, a fake-clock hook and
  a synchronous `drawNow()`.
- URL modes: `?selftest=1` (in-page pixel + rules suite), `?audit=1&level=N`
  (layout metrics as JSON in the title), `?demo=1&seed` (scripted mid-game board
  for screenshots — used because headless Chrome may skip rAF under virtual time).

## Verification

Two layers, both zero-dependency, both gating the deploy:

| Gate | Command | Checks |
|---|---|---|
| Logic (Node, no browser) | `node harness.js` | 179 |
| Browser (headless Chrome) | `node scripts/verify_browser.js` | 42 |

`harness.js` stubs the DOM and a **strict** canvas-2D proxy that throws on any
member that isn't a real `CanvasRenderingContext2D` property, then drives real
playthroughs: first-click safety over 280 seeded boards across all three levels,
flood-fill invariants (no mine ever uncovered, every 0-tile fully bordered, the
opened region connected to the click), determinism, the full flag/chord/hint/win/
lose state machine, timer freeze, localStorage round-trip, real pointer-event
sequences through the actual handlers, and 60 solve-to-win runs.

`scripts/verify_browser.js` runs `?selftest=1` in headless Chrome — which samples
real pixels out of the board, face, patty, Plankton and LED canvases — then audits
layout through `scripts/cdp.js`, a 90-line CDP driver built on Node's built-in
WebSocket. **CDP is not optional here:** `chrome --headless --window-size=390,844`
cannot go below Windows' ~500 px minimum window width, so a "phone test" that way
silently measures a 512 px tablet and returns a cropped screenshot. The gate
asserts the emulated viewport really is 390×844, that no page chrome overflows,
that the board fills ≥70 % of a phone screen and stays inside its frame, and that
touch targets are ≥44 px.

## Deployment

Single `index.html` + `.nojekyll`, `main` branch, GitHub Pages from the branch
root. No build step, no Actions, no dependencies to install.

## Licence

MIT for the code. *Fan tribute — not affiliated with Nickelodeon or Paramount.
SpongeBob SquarePants and related characters are trademarks of their respective
owners; this is a non-commercial homage.*
