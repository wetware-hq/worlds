// Bandercatch: the gamestate compiler and decompiler.
//   compile   : manifest_txt -> state_graph
//   decompile : state_graph  -> manifest_txt (canonical)
// Laws: compile(decompile(g)) deep-equals g, and decompile(compile(m)) is the canonical form of m,
// so decompile . compile is idempotent and the graph root is the sha256 of the canonical text.
import { sha256hex } from "./sha256.ts";

export const GAME_KINDS = ["fit", "lattice", "helix", "catch", "chaos", "stack", "seal", "orbit"] as const;
export type GameKind = (typeof GAME_KINDS)[number];
export const ORDINALS = ["first", "second", "third", "fourth"] as const;

export interface Way {
  id: string;
  to: string;
  label: string;
}
export interface Game {
  kind: GameKind;
  params: Record<string, string>;
}
export interface State {
  id: string;
  name: string;
  repo: string;
  game: Game;
  text: string[];
  ways: Way[];
}
export interface StateGraph {
  worlds: 1;
  title: string;
  start: string;
  max: number;
  states: State[];
}

export type Code =
  | "bad_manifest"
  | "dup_state"
  | "no_start"
  | "unknown_target"
  | "unknown_game"
  | "bad_way"
  | "unreachable";

export class BandercatchError extends Error {
  readonly code: Code;
  readonly line: number;
  constructor(code: Code, line: number, message: string) {
    super(`${code}${line ? ` (line ${line})` : ""}: ${message}`);
    this.code = code;
    this.line = line;
  }
}

const ID = /^[a-z][a-z0-9-]{0,31}$/;
const PARAM = /^([a-z][a-z0-9]*)=(\S+)$/;

export function compile(manifest: string): StateGraph {
  const lines = manifest.replace(/\r\n?/g, "\n").split("\n");
  const head: Partial<Record<"worlds" | "title" | "start" | "max", string>> = {};
  const states: State[] = [];
  const lineOf = new Map<string, number>();
  let cur: State | null = null;
  let curLine = 0;
  const fail = (code: Code, n: number, msg: string): never => {
    throw new BandercatchError(code, n, msg);
  };

  lines.forEach((raw, i) => {
    const n = i + 1;
    const t = raw.trim();
    if (t === "" || t.startsWith("#")) return;
    const sp = t.indexOf(" ");
    const key = sp < 0 ? t : t.slice(0, sp);
    const rest = sp < 0 ? "" : t.slice(sp + 1).trim();

    if (!cur) {
      if (key === "state") {
        if (!ID.test(rest)) fail("bad_manifest", n, `bad state id "${rest}"`);
        if (lineOf.has(rest)) fail("dup_state", n, `state "${rest}" is defined twice`);
        cur = { id: rest, name: "", repo: "", game: { kind: "fit", params: {} }, text: [], ways: [] };
        curLine = n;
        lineOf.set(rest, n);
        return;
      }
      if (key === "worlds" || key === "title" || key === "start" || key === "max") {
        lineOf.set(` ${key}`, n);
        if (head[key] !== undefined) fail("bad_manifest", n, `"${key}" given twice`);
        if (!rest) fail("bad_manifest", n, `"${key}" needs a value`);
        head[key] = rest;
        return;
      }
      return fail("bad_manifest", n, `unexpected "${key}" outside a state`);
    }

    const s: State = cur;
    switch (key) {
      case "end": {
        if (!s.name) fail("bad_manifest", curLine, `state "${s.id}" has no name`);
        if (!s.repo) fail("bad_manifest", curLine, `state "${s.id}" has no repo`);
        if (!s.text.length) fail("bad_manifest", curLine, `state "${s.id}" has no text`);
        if (s.ways.length === 1) fail("bad_way", curLine, `state "${s.id}" offers one way; offer none or at least two`);
        states.push(s);
        cur = null;
        return;
      }
      case "name":
      case "repo":
        if (!rest) fail("bad_manifest", n, `"${key}" needs a value`);
        if (s[key]) fail("bad_manifest", n, `"${key}" given twice`);
        s[key] = rest;
        return;
      case "game": {
        const [kind, ...ps] = rest.split(/\s+/);
        if (!(GAME_KINDS as readonly string[]).includes(kind)) fail("unknown_game", n, `unknown game "${kind}"`);
        const params: Record<string, string> = {};
        for (const p of ps) {
          const m = PARAM.exec(p);
          if (!m) fail("bad_manifest", n, `bad game parameter "${p}"`);
          if (m![1] in params) fail("bad_manifest", n, `parameter "${m![1]}" given twice`);
          params[m![1]] = m![2];
        }
        const sorted: Record<string, string> = {};
        for (const k of Object.keys(params).sort()) sorted[k] = params[k];
        s.game = { kind: kind as GameKind, params: sorted };
        checkGame(s.game, n);
        return;
      }
      case "text":
        if (!rest) fail("bad_manifest", n, "empty text");
        s.text.push(rest);
        return;
      case "way": {
        const m = /^(\S+)\s+(\S+)\s+(.+)$/.exec(rest);
        if (!m) fail("bad_way", n, "a way is: way <ordinal> <target> <label>");
        const [, id, to, label] = m!;
        const want = ORDINALS[s.ways.length];
        if (id !== want) fail("bad_way", n, `expected the ${want ?? "last"} way, got "${id}"`);
        s.ways.push({ id, to, label: label.trim() });
        return;
      }
      default:
        return fail("bad_manifest", n, `unexpected "${key}" inside state "${s.id}"`);
    }
  });

  if (cur) fail("bad_manifest", curLine, `state "${(cur as State).id}" has no "end"`);
  if (head.worlds !== "1") fail("bad_manifest", 1, 'the first field must be "worlds 1"');
  if (!head.title) fail("bad_manifest", 0, "no title");
  const max = Number(head.max ?? "16");
  if (!Number.isInteger(max) || max < 1) fail("bad_manifest", 0, `bad max "${head.max}"`);

  const g: StateGraph = { worlds: 1, title: head.title!, start: head.start ?? "", max, states };
  validate(g, lineOf);
  return g;
}

const posInt = (v: string | undefined): boolean => v !== undefined && /^[1-9][0-9]*$/.test(v);

// A game whose goal cannot be reached would lock its ways behind Skip, so refuse it here.
function checkGame(game: Game, line: number): void {
  const p = game.params;
  const bad = (msg: string): never => {
    throw new BandercatchError("bad_manifest", line, msg);
  };
  if (p.goal !== undefined && !posInt(p.goal)) bad(`goal must be a whole number above 0`);
  if (p.n !== undefined && !posInt(p.n)) bad(`n must be a whole number above 0`);
  const goal = p.goal === undefined ? ({ lattice: 5, catch: 8, orbit: 3 } as Record<string, number>)[game.kind] : Number(p.goal);
  let pool: number | undefined;
  if (game.kind === "lattice") pool = 128;
  if (game.kind === "catch") pool = Number(p.n ?? 24);
  if (game.kind === "orbit") {
    const cards = (p.cards ?? "").split(",");
    if (!p.cards || cards.some((c) => !/^[a-z0-9-]+(_[a-z0-9-]+)*$/.test(c))) bad(`cards must be a comma list of words joined by _`);
    if (cards.some((c) => c.split("_").includes("and"))) bad(`a card name cannot contain the word "and"`);
    if (new Set(cards).size !== cards.length) bad(`cards must be distinct`);
    pool = cards.length;
  }
  if (pool !== undefined && goal !== undefined && goal > pool) bad(`goal ${goal} is more than the ${pool} there are to pick`);
}

export function validate(g: StateGraph, lineOf = new Map<string, number>()): void {
  const ids = new Set(g.states.map((s) => s.id));
  if (!ids.has(g.start)) throw new BandercatchError("no_start", lineOf.get(" start") ?? 0, `start "${g.start}" is not a state`);
  for (const s of g.states)
    for (const w of s.ways)
      if (!ids.has(w.to))
        throw new BandercatchError("unknown_target", lineOf.get(s.id) ?? 0, `${s.id}.${w.id} -> "${w.to}" is not a state`);
  const seen = reachable(g);
  for (const s of g.states)
    if (!seen.has(s.id))
      throw new BandercatchError("unreachable", lineOf.get(s.id) ?? 0, `state "${s.id}" cannot be reached from "${g.start}"`);
}

export function decompile(g: StateGraph): string {
  const out = [`worlds ${g.worlds}`, `title ${g.title}`, `start ${g.start}`, `max ${g.max}`];
  for (const s of g.states) {
    const params = Object.keys(s.game.params)
      .sort()
      .map((k) => ` ${k}=${s.game.params[k]}`)
      .join("");
    out.push("", `state ${s.id}`, `  name ${s.name}`, `  repo ${s.repo}`, `  game ${s.game.kind}${params}`);
    for (const t of s.text) out.push(`  text ${t}`);
    for (const w of s.ways) out.push(`  way ${w.id} ${w.to} ${w.label}`);
    out.push("end");
  }
  return out.join("\n") + "\n";
}

export const graphRoot = (g: StateGraph): string => sha256hex(decompile(g));

export function stateOf(g: StateGraph, id: string): State {
  const s = g.states.find((x) => x.id === id);
  if (!s) throw new BandercatchError("unknown_target", 0, `no state "${id}"`);
  return s;
}

export const isTerminal = (s: State): boolean => s.ways.length === 0;

export function reachable(g: StateGraph, from = g.start): Set<string> {
  const seen = new Set<string>();
  const todo = [from];
  while (todo.length) {
    const id = todo.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const s = g.states.find((x) => x.id === id);
    if (s) for (const w of s.ways) todo.push(w.to);
  }
  return seen;
}

// Bits of a hinge: log2 of the distinct places its ways lead to (0 for an illusory choice).
export function hingeBits(s: State): number {
  const distinct = new Set(s.ways.map((w) => w.to)).size;
  return distinct > 1 ? Math.log2(distinct) : 0;
}

// Distinct walks from a state, entering at most `budget` more states, ending at a terminal or at the budget.
export function walks(g: StateGraph, from: string, budget: number): number {
  const memo = new Map<string, number>();
  const go = (id: string, k: number): number => {
    const key = `${id}/${k}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const s = stateOf(g, id);
    let n = 1;
    if (k > 1 && !isTerminal(s)) {
      n = 0;
      for (const to of new Set(s.ways.map((w) => w.to))) n += go(to, k - 1);
    }
    memo.set(key, n);
    return n;
  };
  return go(from, budget);
}

// Layered layout for drawing the graph: depth = shortest distance from start.
export function layers(g: StateGraph): string[][] {
  const depth = new Map<string, number>([[g.start, 0]]);
  const q = [g.start];
  while (q.length) {
    const id = q.shift()!;
    for (const w of stateOf(g, id).ways)
      if (!depth.has(w.to)) {
        depth.set(w.to, depth.get(id)! + 1);
        q.push(w.to);
      }
  }
  const out: string[][] = [];
  for (const s of g.states) (out[depth.get(s.id)!] ??= []).push(s.id);
  return out;
}
