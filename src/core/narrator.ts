// The gameplay narrator: second-person, present-tense frame chapters written from the trace alone.
// Every statement of fact cites the event that records it as [e<seq>]; it never chooses.
import type { State, StateGraph } from "./bandercatch.ts";
import { joinList } from "./transpiler.ts";

const fmtBits = (b: number): string => (Number.isInteger(b) ? String(b) : b.toFixed(3));
const bitsOf = (b: number): string => `${fmtBits(b)} bit${b === 1 ? "" : "s"}`;
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;
const lc = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const cite = (...seqs: number[]): string => seqs.map((s) => `[e${s}]`).join("");
const range = (a: number, b: number): string => (a === b ? cite(a) : `[e${a}–e${b}]`);

export function opening(g: StateGraph, manifestSeq: number): string {
  return [
    `You are about to read ${g.title}, the life of one chromosome in ${plural(g.states.length, "part")} ${cite(manifestSeq)}.`,
    "The scroll runs downward. Each part you reach becomes a new page below this one, with a small game in it.",
    "Play the game, or skip it, and the page offers you its ways on.",
    "Every move you make is written down, read back as a plain steering command, and counted.",
    `The scroll never chooses for you, and it holds at most ${g.max} parts ${cite(manifestSeq)}.`,
    "If you would rather not steer, you can hand it a script and watch it replay you.",
  ].join(" ");
}

export interface Visit {
  from: State;
  to: State | null; // null when the way ends the scroll
  way: string;
  label: string;
  bits: number;
  wayKind: "choice" | "reflex";
  waySeq: number;
  hingeSeq: number;
  headingSeq: number | null;
  line: number | null;
  moves: { first: number; last: number; count: number } | null;
  refused: { seq: number; code: string }[];
  skipSeq: number | null;
  steer: string[];
  manifestSeq: number;
  totals: { bits: number; choices: number; parts: number; max: number };
}

export function afterWay(v: Visit): string {
  const out: string[] = [];
  const back = v.to?.id === v.from.id;
  if (v.wayKind === "choice") {
    out.push(`You take the ${v.way} way out of ${v.from.name} ${cite(v.waySeq)}: ${lc(v.label)}.`);
    if (v.bits === 0) out.push(`It is worth 0 bits: both ways lead to ${v.to?.name}, so the scroll would have gone on the same whichever you took ${cite(v.hingeSeq)}.`);
    else if (back) out.push(`It is worth ${fmtBits(v.bits)} bit ${cite(v.hingeSeq)}. That way leads back to ${v.from.name}; you may stay as long as you like, and the scroll counts each stay.`);
    else out.push(`It is worth ${fmtBits(v.bits)} bit, because the ways lead to different places ${cite(v.hingeSeq)}.`);
  } else {
    out.push(`The replay takes the ${v.way} way out of ${v.from.name} ${cite(v.waySeq)}, because line ${v.line} of your script says so ${cite(v.headingSeq!)}.`);
    out.push(`It costs you 0 bits; you paid for the whole script once, when you handed it over ${cite(v.headingSeq!)}.`);
  }
  if (v.skipSeq !== null && (!v.moves || v.moves.count === 1)) out.push(`You skipped its game ${cite(v.skipSeq)}.`);
  else if (v.moves) {
    let s = `Before that, ${plural(v.moves.count, "move")} went into its game ${range(v.moves.first, v.moves.last)}`;
    if (v.refused.length) {
      const codes = joinList([...new Set(v.refused.map((r) => r.code))]);
      s += `, and the rules refused ${v.refused.length} of them (${codes}) ${cite(...v.refused.map((r) => r.seq))}`;
    }
    out.push(s + ".");
    const shown = v.steer.slice(0, 3).join(" ") + (v.steer.length > 3 ? " …" : "");
    if (shown) out.push(`Read back as steering, they say: “${shown}”`);
  }
  if (v.to && back) out.push(`You are back in ${v.to.name}.`);
  else if (v.to) out.push(`Next is ${v.to.name}, from the ${v.to.repo} repository ${cite(v.manifestSeq)}.`);
  out.push(
    `So far you have made ${plural(v.totals.choices, "choice")} worth ${bitsOf(v.totals.bits)}, and read ${v.totals.parts} of at most ${v.totals.max} parts ${cite(v.manifestSeq)}.`,
  );
  return out.join(" ");
}

export function again(from: State, choiceSeq: number, start: State): string {
  return `At ${from.name} you choose to read another life ${cite(choiceSeq)}. The scroll goes back to ${start.name} and keeps everything above; the count of parts goes on from here.`;
}

export interface Ending {
  reason: "terminal" | "max" | "reader";
  at: State;
  stopSeq: number;
  waySeq: number | null;
  manifestSeq: number;
  path: string[];
  bits: number;
  choices: number;
  illusory: number;
  moves: number;
  refused: number;
  reflexes: number;
  max: number;
}

export function closing(e: Ending): string {
  const out: string[] = [];
  if (e.reason === "terminal") out.push(`The scroll ends at ${e.at.name} ${cite(e.stopSeq)}.`);
  else if (e.reason === "max") out.push(`The scroll stops at ${e.at.name} after ${e.max} parts, its limit ${cite(e.stopSeq, e.manifestSeq)}.`);
  else out.push(`You close the scroll at ${e.at.name} ${cite(e.waySeq ?? e.stopSeq)}.`);
  out.push(`You have read ${plural(e.path.length, "part")}: ${e.path.join(" → ")}.`);
  let s = `You made ${plural(e.choices, "choice")} worth ${bitsOf(e.bits)}`;
  if (e.illusory) s += `, ${e.illusory} of them worth nothing because both ways met`;
  s += `, and ${plural(e.moves, "move")}, ${e.refused} of them refused.`;
  out.push(s);
  if (e.reflexes) out.push(`The replay took ${plural(e.reflexes, "way")} for you, at 0 bits each.`);
  out.push("Every event is in the trace, chained by SHA-256: the same steering script replayed gives the same root.");
  return out.join(" ");
}
