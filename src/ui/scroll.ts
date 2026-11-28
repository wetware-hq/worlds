// The storyline scroll: one section per gamestate reached, appended as the trace grows.
// The UI only reads the trace and the session; every move it makes goes through Session.act or Session.choose.
import { decompile, graphRoot, layers, stateOf, type StateGraph } from "../core/bandercatch.ts";
import { argType, BASES, progress, type GameState } from "../core/rules.ts";
import { Session } from "../core/session.ts";
import type { Event } from "../core/trace.ts";
import { transpile, SteerError } from "../core/transpiler.ts";
import { Stage } from "../games/stage.ts";
import type { Move } from "../games/views.ts";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const REFUSALS: Record<string, string> = {
  bad_verb: "that is not a move here",
  bad_arg: "that is not a valid move",
  done: "this game is finished",
  duplicate: "already taken",
  homopolymer: "refused: a base may not repeat its neighbour",
  out_of_order: "refused: the parts go in order",
  committed: "already sealed",
  not_committed: "refused: seal it before you reveal it",
};

const HINTS: Record<string, string> = {
  fit: "Press and hold the picture to train the net.",
  lattice: "Click units to fire them.",
  helix: "Write bases with the buttons or the A, C, G and T keys.",
  catch: "Click the drifting oligos to catch them.",
  stack: "Click the parts in order, from 1.",
  seal: "Click the coin, or use the buttons: commit first, then reveal.",
  orbit: "Click the cards as they pass.",
};

interface Part {
  el: HTMLElement;
  stageEl: HTMLElement;
  stage: Stage | null;
  game: GameState;
  stateId: string;
  stepsFrom: number;
  stepsTo: number | null;
  controls: HTMLElement;
  bar: HTMLElement;
  count: HTMLElement;
  steer: HTMLElement;
  msg: HTMLElement;
  ways: HTMLElement;
  chapter: HTMLElement;
}

export class Scroll {
  session!: Session;
  private readonly graph: StateGraph;
  private readonly sample: string;
  private parts: Part[] = [];
  private io: IntersectionObserver;
  private timer = 0;
  private dirty = false;

  constructor(graph: StateGraph, sample: string) {
    this.graph = graph;
    this.sample = sample;
    this.io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const p = this.parts.find((x) => x.stageEl === en.target);
        if (!p) continue;
        if (en.isIntersecting && !p.stage) p.stage = new Stage(p.stageEl, () => p.game, (m) => this.move(p, m), () => this.live(p));
        else if (!en.isIntersecting && p.stage) {
          p.stage.dispose();
          p.stage = null;
        }
      }
    }, { rootMargin: "120px 0px" });
    const loop = (ms: number): void => {
      const t = ms / 1000;
      for (const p of this.parts) p.stage?.frame(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    window.addEventListener("resize", () => this.parts.forEach((p) => p.stage?.resize()));
    window.addEventListener("keydown", (e) => this.key(e));
    $("replay").onclick = () => this.replay($<HTMLTextAreaElement>("steer").value);
    $("sample").onclick = () => {
      $<HTMLTextAreaElement>("steer").value = this.sample;
      $("steer-msg").textContent = "The sample is loaded. Replay it to watch a whole life.";
    };
    $("take").onclick = () => {
      this.session.take();
      this.stopTimer();
    };
    $("restart").onclick = () => this.start();
    $("download").onclick = () => {
      const a = h("a");
      a.href = URL.createObjectURL(new Blob([this.session.trace.jsonl()], { type: "application/x-ndjson" }));
      a.download = "trace.jsonl";
      a.click();
      URL.revokeObjectURL(a.href);
    };
    $("panel-toggle").onclick = () => {
      const open = document.body.classList.toggle("panel-open");
      $("panel-toggle").setAttribute("aria-expanded", String(open));
    };
    $("title").textContent = graph.title;
    $("manifest").textContent = decompile(graph);
    $("graph-root").textContent = graphRoot(graph).slice(0, 12);
  }

  start(script?: string): void {
    this.stopTimer();
    for (const p of this.parts) {
      p.stage?.dispose();
      this.io.unobserve(p.stageEl);
    }
    this.parts = [];
    $("scroll").replaceChildren();
    $("end").hidden = true;
    $("end").replaceChildren();
    this.session = new Session(this.graph);
    this.session.trace.on((e) => this.onEvent(e));
    this.session.begin();
    if (script !== undefined) {
      this.session.hand(script);
      this.timer = window.setInterval(() => {
        if (!this.session.tick()) this.stopTimer();
      }, 140);
    }
    this.mark();
  }

  private replay(script: string): void {
    try {
      const s = new Session(this.graph);
      s.begin();
      s.hand(script); // parse first, so a bad script leaves this run alone
    } catch (e) {
      $("steer-msg").textContent = e instanceof SteerError ? e.message : String(e);
      return;
    }
    $("steer-msg").textContent = "Replaying. The script steers; take the controls at any time.";
    this.start(script);
    window.scrollTo({ top: $("scroll").offsetTop - 20, behavior: "smooth" });
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = 0;
    this.mark();
  }

  private get current(): Part | undefined {
    return this.parts[this.parts.length - 1];
  }

  private live(p: Part): boolean {
    const s = this.session;
    return p === this.current && !s.ended && !s.replaying && !s.offered;
  }

  private move(p: Part, m: Move): void {
    if (!this.live(p)) return;
    this.session.act(m.verb, m.arg);
  }

  private key(e: KeyboardEvent): void {
    const p = this.current;
    if (!p || !this.live(p) || e.target instanceof HTMLTextAreaElement || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toUpperCase();
    if (p.game.kind === "helix" && (BASES as readonly string[]).includes(k)) {
      this.session.act(p.game.verb, k);
    }
  }

  private onEvent(e: Event): void {
    const s = this.session;
    const b = e.body as Record<string, unknown>;
    switch (e.kind) {
      case "chapter":
        if (!this.current) $("opening").textContent = String(b.text);
        else if (s.trace.events[e.seq - 2]?.kind === "stop") this.ending(String(b.text));
        else this.current.chapter.textContent = String(b.text);
        break;
      case "text":
        if (this.current) this.current.stepsTo = s.steps.length;
        this.part(e);
        break;
      case "refuse": {
        const p = this.current!;
        const act = s.trace.events[e.cites[0] - 1].body as { arg?: string | number };
        p.stage?.flash(false, act.arg);
        p.msg.textContent = REFUSALS[String(b.code)] ?? String(b.code);
        p.msg.classList.remove("pop");
        void p.msg.offsetWidth;
        p.msg.classList.add("pop");
        break;
      }
      case "act":
        this.current!.msg.textContent = "";
        break;
      case "hinge":
        this.ways(e);
        break;
      case "choice":
      case "reflex":
        for (const btn of this.current!.ways.querySelectorAll("button")) {
          btn.disabled = true;
          if (btn.dataset.id === b.picked) btn.classList.add("picked");
        }
        break;
    }
    this.mark();
  }

  private part(e: Event): void {
    const s = this.session;
    const st = stateOf(this.graph, String((e.body as { state: string }).state));
    const el = h("section", "part");
    el.dataset.state = st.id;
    const head = h("header");
    head.append(h("span", "no", `Part ${this.parts.length + 1}`), h("h2", "", st.name), h("span", "repo", st.repo));
    el.append(head);
    for (const t of st.text) el.append(h("p", "text", t));
    const stageEl = h("div", "stage");
    const controls = h("div", "controls");
    const meter = h("div", "meter");
    const bar = h("i");
    const count = h("span", "count");
    meter.append(h("span", "track"), count);
    meter.firstElementChild!.append(bar);
    const msg = h("p", "msg");
    const steer = h("pre", "steer");
    const ways = h("nav", "ways");
    const chapter = h("p", "chapter");
    el.append(stageEl, h("p", "hint", HINTS[st.game.kind]), controls, meter, msg, steer, ways, chapter);
    const p: Part = {
      el, stageEl, stage: null, game: s.game, stateId: st.id, stepsFrom: s.steps.length, stepsTo: null,
      controls, bar, count, steer, msg, ways, chapter,
    };
    this.buttons(p);
    this.parts.push(p);
    $("scroll").append(el);
    this.io.observe(stageEl);
    if (this.parts.length > 1) requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  private buttons(p: Part): void {
    const g = p.game;
    const add = (text: string, verb: string, arg?: string | number, cls = ""): void => {
      const b = h("button", cls, text);
      b.onclick = () => this.move(p, { verb, arg });
      p.controls.append(b);
    };
    if (g.kind === "helix") for (const x of BASES) add(x, g.verb, x, `base base-${x}`);
    if (g.kind === "seal") {
      add("Commit the seal", "commit");
      add("Reveal the salt", "reveal");
    }
    if (g.kind === "orbit") g.cards.forEach((c, i) => add(c, g.verb, i, "card"));
    add("Skip the game", "skip", undefined, "skip");
  }

  private ways(e: Event): void {
    const p = this.current!;
    const b = e.body as { offered: { id: string; label: string; to: string | null }[]; bits: number };
    p.ways.replaceChildren();
    const bits = h("span", "bits", `${b.bits} bit${b.bits === 1 ? "" : "s"}`);
    bits.title = b.bits === 0 ? "Both ways lead to the same place." : "The ways lead to different places.";
    p.ways.append(bits);
    for (const o of b.offered) {
      const btn = h("button", "way");
      btn.dataset.id = o.id;
      btn.append(h("span", "label", o.label), h("span", "to", o.to ? `→ ${stateOf(this.graph, o.to).name}` : "→ the end"));
      btn.onclick = () => {
        if (!this.session.replaying) this.session.choose(o.id);
      };
      p.ways.append(btn);
    }
  }

  private ending(text: string): void {
    const end = $("end");
    end.hidden = false;
    end.append(h("p", "chapter", text));
  }

  private mark(): void {
    if (this.dirty) return;
    this.dirty = true;
    requestAnimationFrame(() => {
      this.dirty = false;
      this.refresh();
    });
  }

  private refresh(): void {
    const s = this.session;
    for (const p of this.parts) {
      const live = this.live(p);
      p.el.classList.toggle("live", live);
      p.el.classList.toggle("done", p.game.done);
      for (const b of p.controls.querySelectorAll("button")) b.disabled = !live;
      p.bar.style.width = `${Math.round(progress(p.game) * 100)}%`;
      const unit = p.game.kind === "fit" ? `${p.game.total} / ${p.game.goal} steps` : `${p.game.moves} move${p.game.moves === 1 ? "" : "s"}`;
      p.count.textContent = p.game.skipped ? "skipped" : unit;
      const steps = s.steps.slice(p.stepsFrom, p.stepsTo ?? undefined).filter((x) => x.type === "act");
      p.steer.textContent = transpile(steps, this.graph).join("\n");
      p.steer.hidden = steps.length === 0;
      if (argType(p.game, p.game.verb) === "none" && p.game.kind !== "seal") p.steer.hidden = true;
    }
    if (!s.replaying) $<HTMLTextAreaElement>("steer").value = s.steering().trim() ? s.steering() : $<HTMLTextAreaElement>("steer").value;
    $<HTMLButtonElement>("take").disabled = !s.replaying;
    if (!s.replaying && this.timer === 0 && $("steer-msg").textContent?.startsWith("Replaying")) $("steer-msg").textContent = s.ended ? "The replay reached the end." : "You have the controls.";
    const t = s.totals;
    const dl = $("totals");
    dl.replaceChildren();
    for (const [k, v] of [
      ["parts", `${s.path.length} / ${this.graph.max}`], ["choices", t.choices], ["bits", Number.isInteger(t.bits) ? t.bits : t.bits.toFixed(2)],
      ["moves", t.moves], ["refused", t.refused], ["replayed", t.reflexes], ["events", s.trace.events.length],
    ] as const) dl.append(h("dt", "", k), h("dd", "", String(v)));
    $("root").textContent = `root ${s.trace.root}`;
    this.map();
  }

  private map(): void {
    const svg = $("map") as unknown as SVGSVGElement;
    const L = layers(this.graph);
    const W = 260;
    const RH = 34;
    svg.setAttribute("viewBox", `0 0 ${W} ${L.length * RH + 10}`);
    const pos = new Map<string, [number, number]>();
    L.forEach((row, r) => row.forEach((id, i) => pos.set(id, [(W / (row.length + 1)) * (i + 1), 20 + r * RH])));
    const ns = "http://www.w3.org/2000/svg";
    const el = (tag: string, a: Record<string, string | number>): SVGElement => {
      const e = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(a)) e.setAttribute(k, String(v));
      return e;
    };
    svg.replaceChildren();
    const path = this.session.path;
    const walked = new Set(path.slice(1).map((id, i) => `${path[i]}>${id}`));
    for (const st of this.graph.states)
      for (const w of st.ways) {
        const [x1, y1] = pos.get(st.id)!;
        const [x2, y2] = pos.get(w.to)!;
        const on = walked.has(`${st.id}>${w.to}`);
        if (st.id === w.to) svg.append(el("circle", { cx: x1 + 14, cy: y1 - 8, r: 7, class: on ? "edge on" : "edge", fill: "none" }));
        else svg.append(el("path", { d: `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`, class: on ? "edge on" : "edge", fill: "none" }));
      }
    const seen = new Set(path);
    const here = this.session.ended ? null : this.session.state?.id;
    for (const st of this.graph.states) {
      const [x, y] = pos.get(st.id)!;
      svg.append(el("circle", { cx: x, cy: y, r: 6, class: `node${seen.has(st.id) ? " seen" : ""}${st.id === here ? " here" : ""}` }));
      const t = el("text", { x: x + 9, y: y + 4, class: "nl" });
      t.textContent = st.id;
      svg.append(t);
    }
  }
}
