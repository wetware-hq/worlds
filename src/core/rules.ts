// The rules of each minigame: pure, deterministic, shared by the three.js views, the replay and the tests.
import type { Game, GameKind } from "./bandercatch.ts";

export type Arg = string | number;
export interface Act {
  state: string;
  game: GameKind;
  verb: string;
  arg?: Arg;
}

export type RefuseCode =
  | "bad_verb"
  | "bad_arg"
  | "done"
  | "duplicate"
  | "homopolymer"
  | "out_of_order"
  | "committed"
  | "not_committed";

export interface GameState {
  kind: GameKind;
  goal: number;
  verb: string; // the game's main verb
  cards: string[]; // orbit labels
  n: number; // number of objects on offer (catch, orbit, lattice)
  done: boolean;
  skipped: boolean;
  moves: number;
  total: number; // fit: steps trained
  picked: number[]; // lattice/catch/orbit/stack: indices taken, in order
  bases: string[]; // helix: written bases; chaos: jumped corners
  points: [number, number][]; // chaos: the dots
  committed: boolean; // seal
  revealed: boolean; // seal
}

export const BASES = ["A", "C", "G", "T"] as const;
export const CORNERS: Record<string, [number, number]> = { A: [0, 0], C: [0, 1], G: [1, 1], T: [1, 0] };

const MAIN_VERB: Record<GameKind, string> = {
  fit: "train",
  lattice: "fire",
  helix: "write",
  catch: "catch",
  chaos: "jump",
  stack: "place",
  seal: "commit",
  orbit: "cite",
};
const DEFAULT_GOAL: Record<GameKind, number> = {
  fit: 1000, lattice: 5, helix: 12, catch: 8, chaos: 24, stack: 5, seal: 1, orbit: 3,
};

export function verbsOf(g: GameState): string[] {
  if (g.kind === "seal") return ["commit", "reveal", "skip"];
  return [g.verb, "skip"];
}

export function init(game: Game): GameState {
  const p = game.params;
  const cards = p.cards ? p.cards.split(",").map((c) => c.replace(/_/g, " ")) : [];
  const goal = p.goal ? Number(p.goal) : DEFAULT_GOAL[game.kind];
  const n =
    game.kind === "lattice" ? 128 : game.kind === "orbit" ? cards.length : game.kind === "stack" ? goal : Number(p.n ?? 24);
  return {
    kind: game.kind,
    goal,
    verb: game.kind === "orbit" ? (p.verb ?? "cite") : MAIN_VERB[game.kind],
    cards,
    n,
    done: false,
    skipped: false,
    moves: 0,
    total: 0,
    picked: [],
    bases: [],
    points: [[0.5, 0.5]],
    committed: false,
    revealed: false,
  };
}

const isInt = (a: unknown, lo: number, hi: number): a is number =>
  typeof a === "number" && Number.isInteger(a) && a >= lo && a <= hi;

// Apply one move. Returns null if it is taken, or the refusal code; a refused move changes nothing.
export function step(g: GameState, verb: string, arg?: Arg): RefuseCode | null {
  if (g.done) return "done";
  if (!verbsOf(g).includes(verb)) return "bad_verb";
  if (verb === "skip") {
    if (arg !== undefined) return "bad_arg";
    g.done = g.skipped = true;
    g.moves++;
    return null;
  }
  switch (g.kind) {
    case "fit":
      if (!isInt(arg, 1, 100000)) return "bad_arg";
      g.total += arg;
      break;
    case "lattice":
    case "catch":
    case "orbit":
      if (!isInt(arg, 0, g.n - 1)) return "bad_arg";
      if (g.picked.includes(arg)) return "duplicate";
      g.picked.push(arg);
      break;
    case "stack":
      if (!isInt(arg, 1, g.n)) return "bad_arg";
      if (arg !== g.picked.length + 1) return "out_of_order";
      g.picked.push(arg);
      break;
    case "helix":
      if (typeof arg !== "string" || !(BASES as readonly string[]).includes(arg)) return "bad_arg";
      if (g.bases[g.bases.length - 1] === arg) return "homopolymer";
      g.bases.push(arg);
      break;
    case "chaos": {
      if (typeof arg !== "string" || !(arg in CORNERS)) return "bad_arg";
      const [x, y] = g.points[g.points.length - 1];
      const [cx, cy] = CORNERS[arg];
      g.points.push([(x + cx) / 2, (y + cy) / 2]);
      g.bases.push(arg);
      break;
    }
    case "seal":
      if (arg !== undefined) return "bad_arg";
      if (verb === "commit") {
        if (g.committed) return "committed";
        g.committed = true;
      } else {
        if (!g.committed) return "not_committed";
        g.revealed = true;
      }
      break;
  }
  g.moves++;
  if (progress(g) >= 1) g.done = true;
  return null;
}

export function progress(g: GameState): number {
  if (g.skipped) return 1;
  switch (g.kind) {
    case "fit":
      return Math.min(1, g.total / g.goal);
    case "helix":
      return Math.min(1, g.bases.length / g.goal);
    case "chaos":
      return Math.min(1, (g.points.length - 1) / g.goal);
    case "seal":
      return g.revealed ? 1 : g.committed ? 0.5 : 0;
    default:
      return Math.min(1, g.picked.length / g.goal);
  }
}

export function argType(g: GameState, verb: string): "int" | "base" | "card" | "none" {
  if (verb === "skip" || g.kind === "seal") return "none";
  if (g.kind === "helix" || g.kind === "chaos") return "base";
  if (g.kind === "orbit") return "card";
  return "int";
}
