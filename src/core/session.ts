// The session: one Reader walking one state graph. It owns the trace and is the only writer to it.
import {
  graphRoot, hingeBits, isTerminal, stateOf, walks, type State, type StateGraph,
} from "./bandercatch.ts";
import { afterWay, again, closing, opening } from "./narrator.ts";
import { init, step, type Arg, type GameState, type RefuseCode } from "./rules.ts";
import { Trace, type Event } from "./trace.ts";
import { parse, transpile, type Step } from "./transpiler.ts";

export type By = "reader" | "script";

export interface Offered {
  id: string;
  label: string;
  to: string | null;
}

export class Session {
  readonly graph: StateGraph;
  readonly trace = new Trace();
  readonly steps: Step[] = []; // everything steered so far, Reader and script alike
  state!: State;
  game!: GameState;
  path: string[] = [];
  offered: Offered[] | null = null;
  ended = false;
  private manifestSeq = 0;
  private textSeq = 0;
  private hingeSeq = 0;
  private visitMoves: { seq: number; code: RefuseCode | null; skip: boolean; refuseSeq: number }[] = [];
  private visitSteps: Step[] = [];
  private bits = 0;
  private choices = 0;
  private illusory = 0;
  private moves = 0;
  private refused = 0;
  private reflexes = 0;
  private heading: { seq: number; steps: Step[]; lines: number[]; at: number } | null = null;

  constructor(graph: StateGraph) {
    this.graph = graph;
  }

  begin(): void {
    const g = this.graph;
    this.manifestSeq = this.trace.append("machine", "manifest", {
      title: g.title, root: graphRoot(g), states: g.states.length, start: g.start, max: g.max,
    }).seq;
    this.chapter(opening(g, this.manifestSeq), [this.manifestSeq]);
    this.enter(g.start);
  }

  get replaying(): boolean {
    return this.heading !== null && this.heading.at < this.heading.steps.length;
  }

  private chapter(text: string, cites: number[]): Event {
    return this.trace.append("frame", "chapter", { text }, cites);
  }

  private enter(id: string): void {
    this.state = stateOf(this.graph, id);
    this.game = init(this.state.game);
    this.path.push(id);
    this.offered = null;
    this.visitMoves = [];
    this.visitSteps = [];
    const s = this.state;
    this.textSeq = this.trace.append("machine", "text", {
      state: s.id, name: s.name, repo: s.repo, game: s.game.kind, text: s.text,
    }, [this.manifestSeq]).seq;
  }

  act(verb: string, arg?: Arg, by: By = "reader"): RefuseCode | null {
    if (this.ended) return "done";
    const s = this.state;
    const body: Record<string, unknown> = { state: s.id, game: s.game.kind, verb, by };
    if (arg !== undefined) body.arg = arg;
    const cites = [this.textSeq, ...(by === "script" && this.heading ? [this.heading.seq] : [])];
    const e = this.trace.append(by === "reader" ? "human" : "machine", "act", body, cites);
    const code = step(this.game, verb, arg);
    let refuseSeq = 0;
    this.moves++;
    if (code) {
      this.refused++;
      refuseSeq = this.trace.append("machine", "refuse", { state: s.id, code }, [e.seq]).seq;
    } else {
      const st: Step = { type: "act", act: { state: s.id, game: s.game.kind, verb, ...(arg !== undefined ? { arg } : {}) } };
      this.steps.push(st);
      this.visitSteps.push(st);
    }
    this.visitMoves.push({ seq: e.seq, code, skip: verb === "skip" && !code, refuseSeq });
    if (!code && this.game.done) this.offer();
    return code;
  }

  private offer(): void {
    const s = this.state;
    this.offered = isTerminal(s)
      ? [{ id: "again", label: "Read another life", to: this.graph.start }, { id: "stop", label: "Close the scroll", to: null }]
      : s.ways.map((w) => ({ id: w.id, label: w.label, to: w.to }));
    this.hingeSeq = this.trace.append("machine", "hinge", {
      state: s.id, name: s.name, offered: this.offered, bits: isTerminal(s) ? 1 : hingeBits(s),
    }, [this.textSeq]).seq;
  }

  choose(id: string, by: By = "reader"): "not_offered" | null {
    if (this.ended || !this.offered) return "not_offered";
    const o = this.offered.find((x) => x.id === id);
    if (!o) return "not_offered";
    const from = this.state;
    const terminal = isTerminal(from);
    const bits = by === "script" ? 0 : terminal ? 1 : hingeBits(from);
    const line = by === "script" && this.heading ? this.heading.lines[this.heading.at - 1] : null;
    const e = by === "reader"
      ? this.trace.append("human", "choice", { state: from.id, picked: id, bits }, [this.hingeSeq])
      : this.trace.append("machine", "reflex", { state: from.id, picked: id, bits: 0, line }, [this.hingeSeq, this.heading!.seq]);
    if (by === "reader") {
      this.bits += bits;
      this.choices++;
      if (bits === 0) this.illusory++;
    } else this.reflexes++;
    const st: Step = { type: "way", state: from.id, way: id };
    this.steps.push(st);
    this.offered = null;

    if (id === "stop") return this.end("reader", e.seq), null;
    if (id === "again") {
      this.chapter(again(from, e.seq, stateOf(this.graph, this.graph.start)), [e.seq]);
      if (this.limit(e.seq)) return null;
      this.enter(this.graph.start);
      return null;
    }
    const to = stateOf(this.graph, o.to!);
    const mv = this.visitMoves;
    const skip = mv.find((m) => m.skip);
    this.chapter(afterWay({
      from, to, way: id, label: o.label, bits, wayKind: by === "reader" ? "choice" : "reflex",
      waySeq: e.seq, hingeSeq: this.hingeSeq, headingSeq: this.heading?.seq ?? null, line,
      moves: mv.length ? { first: mv[0].seq, last: mv[mv.length - 1].seq, count: mv.length } : null,
      refused: mv.filter((m) => m.code).map((m) => ({ seq: m.refuseSeq, code: m.code! })),
      skipSeq: skip ? skip.seq : null,
      steer: transpile(this.visitSteps, this.graph),
      manifestSeq: this.manifestSeq,
      totals: { bits: this.bits, choices: this.choices, parts: this.path.length, max: this.graph.max },
    }), [e.seq, this.hingeSeq, ...mv.map((m) => m.seq)]);
    if (this.limit(e.seq)) return null;
    this.enter(to.id);
    return null;
  }

  private limit(waySeq: number): boolean {
    if (this.path.length < this.graph.max) return false;
    this.end("max", waySeq);
    return true;
  }

  private end(reason: "terminal" | "max" | "reader", waySeq: number): void {
    const at = this.state;
    const stop = this.trace.append("machine", "stop", { reason, state: at.id }, [waySeq]);
    this.chapter(closing({
      reason: reason === "reader" && isTerminal(at) ? "terminal" : reason, at, stopSeq: stop.seq, waySeq,
      manifestSeq: this.manifestSeq,
      path: this.path.map((id) => stateOf(this.graph, id).name),
      bits: this.bits, choices: this.choices, illusory: this.illusory, moves: this.moves,
      refused: this.refused, reflexes: this.reflexes, max: this.graph.max,
    }), [stop.seq, waySeq, this.manifestSeq]);
    this.ended = true;
    this.heading = null;
  }

  steering(): string {
    return transpile(this.steps, this.graph).join("\n") + "\n";
  }

  // Hand the replay a steering script. It plays the script's steps in order from the current gamestate.
  hand(script: string): number {
    const steps = parse(script, this.graph);
    const lines: number[] = [];
    script.split(/\r?\n/).forEach((l, i) => {
      const t = l.trim();
      if (!t || t.startsWith("#")) return;
      const n = parse(t, this.graph).length;
      for (let k = 0; k < n; k++) lines.push(i + 1);
    });
    const flights = walks(this.graph, this.state.id, this.graph.max - this.path.length + 1);
    const seq = this.trace.append("human", "heading", {
      state: this.state.id, steps: steps.length, flights, bits: flights > 1 ? Math.log2(flights) : 0,
    }, [this.textSeq]).seq;
    this.bits += flights > 1 ? Math.log2(flights) : 0;
    this.choices++;
    this.heading = { seq, steps, lines, at: 0 };
    return seq;
  }

  // Play one step of the script. Returns false when there is nothing left, or the script no longer fits.
  tick(): boolean {
    const h = this.heading;
    if (!h || this.ended || h.at >= h.steps.length) return false;
    const st = h.steps[h.at++];
    const here = st.type === "act" ? st.act.state : st.state;
    if (here !== this.state.id) {
      this.take("diverged");
      return false;
    }
    if (st.type === "act") {
      if (this.offered) return this.take("diverged"), false;
      this.act(st.act.verb, st.act.arg, "script");
    } else if (this.choose(st.way, "script")) return this.take("diverged"), false;
    return this.replaying;
  }

  take(why: "reader" | "diverged" = "reader"): void {
    if (!this.heading) return;
    this.trace.append(why === "reader" ? "human" : "machine", "take", {
      state: this.state.id, why, at: this.heading.at,
    }, [this.heading.seq]);
    this.heading = null;
  }

  get totals() {
    return { bits: this.bits, choices: this.choices, moves: this.moves, refused: this.refused, reflexes: this.reflexes };
  }
}

// Play a whole steering script headlessly from the start; used by the CLI and the tests.
export function play(graph: StateGraph, script: string): Session {
  const s = new Session(graph);
  s.begin();
  s.hand(script);
  while (s.tick());
  return s;
}
