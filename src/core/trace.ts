import { sha256hex } from "./sha256.ts";

export type World = "human" | "machine" | "frame";

export type Kind =
  | "manifest" // machine: the compiled state graph and its root
  | "chapter" // frame: a second-person chapter from the narrator
  | "text" // machine: the incipit of a gamestate
  | "act" // human: one minigame move (or machine, when a replay script plays it)
  | "refuse" // machine: a move the game rules refused, with a code
  | "hinge" // machine: the ways offered out of a gamestate
  | "choice" // human: the Reader picks one offered way
  | "reflex" // machine: a replay script picks the way its line names
  | "heading" // human: the Reader hands a steering script to the replay
  | "take" // human: the Reader takes the controls back
  | "stop"; // machine: the scroll ends, with a reason

export interface Event {
  seq: number;
  world: World;
  kind: Kind;
  body: unknown;
  cites: number[];
}

export const ROOT_EMPTY = sha256hex("worlds/1");

// RFC 8785 JSON canonicalisation for the value shapes a trace holds
// (objects, arrays, strings, finite numbers, booleans, null).
export function jcs(v: unknown): string {
  if (v === null || typeof v !== "object") {
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error("jcs: non-finite number");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + jcs(o[k])).join(",") + "}";
}

export const ehash = (e: Event): string => sha256hex(jcs(e));

export const chain = (root: string, e: Event): string => sha256hex(root + ehash(e));

export class Trace {
  readonly events: Event[] = [];
  readonly roots: string[] = [];
  private listeners: ((e: Event, root: string) => void)[] = [];

  get root(): string {
    return this.roots.length ? this.roots[this.roots.length - 1] : ROOT_EMPTY;
  }

  get next(): number {
    return this.events.length + 1;
  }

  append(world: World, kind: Kind, body: unknown, cites: number[] = []): Event {
    const e: Event = { seq: this.next, world, kind, body, cites: [...cites] };
    this.events.push(e);
    this.roots.push(chain(this.root, e));
    for (const f of this.listeners) f(e, this.root);
    return e;
  }

  on(f: (e: Event, root: string) => void): void {
    this.listeners.push(f);
  }

  jsonl(): string {
    return this.events.map((e) => jcs(e)).join("\n") + (this.events.length ? "\n" : "");
  }
}

export function replayRoot(events: Event[]): string {
  let r = ROOT_EMPTY;
  for (const e of events) r = chain(r, e);
  return r;
}
