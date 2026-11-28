# worlds

World-building for the biotechnology club. **Proof of Life** is the wetware storyline scroll: the life of one chromosome told as a branching story, one page per gamestate, one three.js minigame per page.

> Research material only. See [`DISCLAIMER`](DISCLAIMER).

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # node --test, no browser needed
npm run build        # typecheck + production build in dist/
npm run bandercatch -- check story/proof-of-life.txt
npm run bandercatch -- play  story/proof-of-life.txt story/sample.steer.txt --chapters
```

## What you do

Scroll down. Each gamestate you reach becomes a new section below the last one, with a small game in it: train a net on the astronaut picture, fire sine units, write bases, catch oligos, read the web back, stack a build plan, seal a coin, cite claims. Finish the game (or skip it) and the section offers its ways on. A game's canvas only exists while its section is on screen.

The side panel shows the map of the story, your bits and moves, the steering script written from your moves, and the trace root.

The story follows the stack in [`web/docs/organize-stack.md`](https://github.com/wetware-hq/web/blob/main/docs/organize-stack.md): image → web → sequence → oligo pool → read-back → loop → build plan (tesseract) → coin (bases) → wiki page (helix) → research (popper) or forum (agora) → print (med3).

## How it is built

The ticket asked for four pieces. Each is one module in `src/core/`, with no DOM or three.js in it, so the CLI and the tests run the same code as the page.

| Piece | Module | What it does |
|---|---|---|
| gamestate compiler | `bandercatch.ts` | `compile(manifest_txt) → state_graph` and `decompile(state_graph) → manifest_txt` |
| gameplay narrator | `narrator.ts`, `session.ts` | writes a second-person chapter after every way taken, citing trace events |
| scrollable minigames | `rules.ts`, `src/games/`, `src/ui/` | the rules of each game, its three.js view, and the scroll |
| language transpiler | `transpiler.ts` | every move ⇄ a plain-English steering command |

### Bandercatch: `manifest_txt ⇄ state_graph`

A manifest ([`story/proof-of-life.txt`](story/proof-of-life.txt)) is line-based:

```text
worlds 1
title Proof of Life
start media
max 16

state dna
  name the sequence
  repo web
  game helix goal=12
  text Every two bytes of the web become eleven bases ...
  way first pool Cut it into oligos
  way second view Decipher it straight back to the web
end
```

`compile` checks it and returns a `StateGraph`. It refuses with a code and a line number: `bad_manifest`, `dup_state`, `no_start`, `unknown_target`, `unknown_game`, `bad_way` (one way only, or ways out of order) and `unreachable`. A state with no ways is an ending.

`decompile` writes the canonical manifest: no comments, two-space indent, sorted game parameters. The laws, checked in `tests/core.test.ts`:

- `compile(decompile(g))` deep-equals `g`;
- `decompile(compile(m))` is the canonical form of `m`, so `decompile ∘ compile` is idempotent;
- the graph root is `sha256(decompile(g))`.

### The narrator and the trace

These follow tulip's rules ([`tulip/docs/follow-agent-contract.md`](https://github.com/wetware-hq/tulip/blob/main/docs/follow-agent-contract.md)):

- **The Reader chooses; the engine never does.** A gamestate only moves on through a `choice` (the Reader) or a `reflex` (a steering script the Reader handed over). The `heading` event that hands over the script is where its bits are paid. Each reflex costs 0 bits.
- **Bits count distinct outcomes.** A fork whose ways lead to different places is worth 1 bit. The read-back's two ways both lead to the loop, so that fork is worth 0 bits, and the narrator says so.
- **Narration cites the trace.** Every chapter is written from events alone and cites them as `[e<seq>]`. It only cites earlier events.
- **The trace is append-only and hash-chained.** Each event is `{seq, world, kind, body, cites}`. `root_n = sha256(root_{n-1} ‖ sha256(jcs(event)))`, starting from `sha256("worlds/1")`. Replaying the same steering script gives the same root.

### Minigames

Each game kind has pure rules in `rules.ts` (`init`, `step`, `progress`). A refused move changes nothing and is recorded as a `refuse` event with its code, such as `homopolymer`, `duplicate`, `out_of_order` or `not_committed`.

| Kind | Move | Refused when |
|---|---|---|
| `fit` | hold the picture: `train` n steps | — |
| `lattice` | `fire` a unit, 0–127 | already fired |
| `helix` | `write` a base | it repeats the last base |
| `catch` | `catch` an oligo | already caught |
| `stack` | `place` part k | not the next part |
| `seal` | `commit`, then `reveal` | reveal before commit |
| `orbit` | cite a card (the verb is set in the manifest) | already cited |

Every game also takes `skip`. The three.js views in `src/games/views.ts` only draw a `GameState` and map a click to a move. `Stage` creates a WebGL canvas when its section scrolls into view and frees it when the section leaves.

### Steering commands

`transpile` turns moves and ways into one English line per run of moves:

```text
In dna, write the bases A, C, G, T, A, G, C, T, G, A, C and T.
At dna, take the first way: cut it into oligos.
In mint, commit the seal.
At print, close the scroll.
```

`parse` reads them back into moves, so `parse(transpile(steps))` deep-equals `steps`. Paste a script into the panel and choose **Replay this script** to watch it play. Choose **Take the controls** to stop it at any point. [`story/sample.steer.txt`](story/sample.steer.txt) is one whole life.

## Layout

```text
src/core/      sha256, trace, bandercatch, rules, transpiler, narrator, session
src/games/     three.js views and the per-section stage
src/ui/        the scroll and the side panel
story/         the manifest and a sample steering script
tools/         the bandercatch CLI
tests/         node --test
```
