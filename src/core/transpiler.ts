// The language transpiler: minigame moves and ways <-> steering commands in plain English.
// One line per run of moves with the same verb in one gamestate, one line per way taken.
// Law: parse(transpile(steps)) deep-equals steps.
import { stateOf, type StateGraph } from "./bandercatch.ts";
import { argType, init, type Act, type Arg, type GameState } from "./rules.ts";

export type Step = { type: "act"; act: Act } | { type: "way"; state: string; way: string };

export class SteerError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(`steer (line ${line}): ${message}`);
    this.line = line;
  }
}

type Phrase = { one: string; many: string };

function phrase(g: GameState, verb: string): Phrase {
  if (verb === "skip") return { one: "skip the game", many: "skip the game" };
  switch (g.kind) {
    case "fit": return { one: "train the net for {list} steps", many: "train the net for {list} steps" };
    case "lattice": return { one: "fire unit {list}", many: "fire units {list}" };
    case "helix": return { one: "write the base {list}", many: "write the bases {list}" };
    case "catch": return { one: "catch oligo {list}", many: "catch oligos {list}" };
    case "stack": return { one: "place part {list}", many: "place parts {list}" };
    case "seal": return verb === "commit"
      ? { one: "commit the seal", many: "commit the seal" }
      : { one: "reveal the salt", many: "reveal the salt" };
    case "orbit": return { one: `${verb} {list}`, many: `${verb} {list}` };
  }
}

export function joinList(xs: string[]): string {
  return xs.length < 2 ? (xs[0] ?? "") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
}
const splitList = (s: string): string[] => s.split(/, | and /).map((x) => x.trim());

function fmtArg(g: GameState, a: Arg): string {
  return argType(g, "") === "card" ? g.cards[a as number] : String(a);
}

export function wayLine(state: string, way: string, label?: string): string {
  if (way === "again") return `At ${state}, read another life.`;
  if (way === "stop") return `At ${state}, close the scroll.`;
  return `At ${state}, take the ${way} way${label ? `: ${label.charAt(0).toLowerCase()}${label.slice(1)}` : ""}.`;
}

export function transpile(steps: Step[], graph: StateGraph): string[] {
  const lines: string[] = [];
  for (let i = 0; i < steps.length; ) {
    const s = steps[i];
    if (s.type === "way") {
      const st = stateOf(graph, s.state);
      lines.push(wayLine(s.state, s.way, st.ways.find((w) => w.id === s.way)?.label));
      i++;
      continue;
    }
    const g = init(stateOf(graph, s.act.state).game);
    const grouped = argType(g, s.act.verb) !== "none";
    const run: Arg[] = [];
    let j = i;
    while (
      j < steps.length && steps[j].type === "act" &&
      (steps[j] as { act: Act }).act.state === s.act.state &&
      (steps[j] as { act: Act }).act.verb === s.act.verb &&
      (grouped || j === i)
    ) {
      const a = (steps[j] as { act: Act }).act.arg;
      if (a !== undefined) run.push(a);
      j++;
    }
    const p = phrase(g, s.act.verb);
    const text = (run.length > 1 ? p.many : p.one).replace("{list}", joinList(run.map((a) => fmtArg(g, a))));
    lines.push(`In ${s.act.state}, ${text}.`);
    i = j;
  }
  return lines;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parse(text: string, graph: StateGraph): Step[] {
  const steps: Step[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    let m = /^At ([a-z][a-z0-9-]*), (read another life|close the scroll|take the (\w+) way(?:: .*)?)\.$/.exec(line);
    if (m) {
      const st = graph.states.find((x) => x.id === m![1]);
      if (!st) throw new SteerError(n, `no state "${m[1]}"`);
      const way = m[2] === "read another life" ? "again" : m[2] === "close the scroll" ? "stop" : m[3];
      if ((way === "again" || way === "stop") !== (st.ways.length === 0)) throw new SteerError(n, `"${m[2]}" is not offered at ${st.id}`);
      if (st.ways.length && !st.ways.some((w) => w.id === way)) throw new SteerError(n, `${st.id} has no ${way} way`);
      steps.push({ type: "way", state: st.id, way });
      return;
    }
    m = /^In ([a-z][a-z0-9-]*), (.+)\.$/.exec(line);
    if (!m) throw new SteerError(n, `not a steering command: "${line}"`);
    const st = graph.states.find((x) => x.id === m![1]);
    if (!st) throw new SteerError(n, `no state "${m[1]}"`);
    const g = init(st.game);
    for (const verb of [g.kind === "seal" ? "commit" : g.verb, ...(g.kind === "seal" ? ["reveal"] : []), "skip"]) {
      const p = phrase(g, verb);
      for (const form of [p.many, p.one]) {
        const re = new RegExp("^" + esc(form).replace("\\{list\\}", "(.+)") + "$");
        const mm = re.exec(m[2]);
        if (!mm) continue;
        if (mm[1] === undefined) {
          steps.push({ type: "act", act: { state: st.id, game: g.kind, verb } });
          return;
        }
        for (const item of splitList(mm[1])) {
          const t = argType(g, verb);
          let arg: Arg;
          if (t === "int") {
            if (!/^\d+$/.test(item)) throw new SteerError(n, `"${item}" is not a number`);
            arg = Number(item);
          } else if (t === "card") {
            const k = g.cards.indexOf(item);
            if (k < 0) throw new SteerError(n, `"${item}" is not a card in ${st.id}`);
            arg = k;
          } else arg = item;
          steps.push({ type: "act", act: { state: st.id, game: g.kind, verb, arg } });
        }
        return;
      }
    }
    throw new SteerError(n, `"${m[2]}" is not a move in ${st.id} (${g.kind})`);
  });
  return steps;
}
