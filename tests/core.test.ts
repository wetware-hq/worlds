import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  BandercatchError, compile, decompile, graphRoot, hingeBits, layers, reachable, walks,
} from "../src/core/bandercatch.ts";
import { init, step } from "../src/core/rules.ts";
import { Session, play } from "../src/core/session.ts";
import { sha256hex } from "../src/core/sha256.ts";
import { ROOT_EMPTY, Trace, jcs, replayRoot } from "../src/core/trace.ts";
import { parse, transpile } from "../src/core/transpiler.ts";

const story = readFileSync(new URL("../story/proof-of-life.txt", import.meta.url), "utf8");
const sample = readFileSync(new URL("../story/sample.steer.txt", import.meta.url), "utf8");
const g = compile(story);

const tiny = (body: string): string => `worlds 1\ntitle Tiny\nstart a\nmax 4\n${body}`;
const st = (id: string, ways = "", game = "seal"): string =>
  `state ${id}\n  name ${id}\n  repo web\n  game ${game}\n  text hello\n${ways}end\n`;

test("sha256 matches FIPS 180-4 vectors", () => {
  assert.equal(sha256hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(
    sha256hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  );
  assert.equal(sha256hex("a".repeat(1000)), "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
});

test("jcs sorts keys and the trace chain replays to the same root", () => {
  assert.equal(jcs({ b: 1, a: [true, null, "x"] }), '{"a":[true,null,"x"],"b":1}');
  const t = new Trace();
  assert.equal(t.root, ROOT_EMPTY);
  t.append("machine", "text", { z: 1, a: 2 }, []);
  t.append("human", "choice", { picked: "first" }, [1]);
  assert.equal(replayRoot(t.events), t.root);
  const tampered = t.events.map((e) => ({ ...e }));
  tampered[0].body = { z: 1, a: 3 };
  assert.notEqual(replayRoot(tampered), t.root);
});

test("bandercatch round-trips the story", () => {
  const canon = decompile(g);
  assert.deepEqual(compile(canon), g);
  assert.equal(decompile(compile(canon)), canon);
  assert.equal(graphRoot(g), sha256hex(canon));
  assert.equal(g.states.length, 12);
  assert.equal(reachable(g).size, 12);
  assert.equal(walks(g, g.start, g.max), 7753);
  assert.equal(layers(g).flat().length, 12);
});

test("bandercatch decompiles any graph it compiled, comments and spacing aside", () => {
  const messy = story.replace(/^ {2}/gm, "\t").replace(/\n/g, "\n\n# note\n");
  assert.deepEqual(compile(messy), g);
});

test("bandercatch refuses malformed manifests with a code and a line", () => {
  const cases: [string, string][] = [
    [tiny(st("a") + st("a")), "dup_state"],
    [tiny(st("a", "  way first b go\n")), "bad_way"],
    [tiny(st("a", "  way first b go\n  way second c go\n") + st("b")), "unknown_target"],
    [tiny(st("a", "", "tetris")), "unknown_game"],
    [tiny(st("a") + st("b")), "unreachable"],
    [tiny(st("a", "  way second b go\n  way first b go\n") + st("b")), "bad_way"],
    ["worlds 1\ntitle T\nstart z\nmax 4\n" + st("a"), "no_start"],
    ["worlds 2\n", "bad_manifest"],
    [tiny(st("a", "", "catch goal=9 n=8")), "bad_manifest"],
    [tiny(st("a", "", "orbit goal=3 cards=x,y")), "bad_manifest"],
    [tiny(st("a", "", "orbit goal=1 cards=salt_and_pepper,y")), "bad_manifest"],

  ];
  for (const [m, code] of cases) {
    assert.throws(() => compile(m), (e: unknown) => e instanceof BandercatchError && e.code === code && e.line > 0, code);
  }
});

test("bandercatch accepts orbit cards in any case", () => {
  assert.doesNotThrow(() => compile(tiny(st("a", "", "orbit goal=2 cards=DNA,RNA"))));
});

test("bits: a real fork is 1 bit, an illusory fork is 0", () => {
  const s = (id: string) => g.states.find((x) => x.id === id)!;
  assert.equal(hingeBits(s("media")), 1);
  assert.equal(hingeBits(s("cgr")), 0);
  assert.equal(hingeBits(s("print")), 0);
});

test("rules refuse bad moves and change nothing", () => {
  const h = init({ kind: "helix", params: { goal: "3" } });
  assert.equal(step(h, "write", "A"), null);
  assert.equal(step(h, "write", "A"), "homopolymer");
  assert.equal(step(h, "write", "U"), "bad_arg");
  assert.equal(step(h, "jump", "C"), "bad_verb");
  assert.deepEqual(h.bases, ["A"]);
  const k = init({ kind: "stack", params: { goal: "2" } });
  assert.equal(step(k, "place", 2), "out_of_order");
  const z = init({ kind: "seal", params: {} });
  assert.equal(step(z, "reveal"), "not_committed");
  assert.equal(step(z, "commit"), null);
  assert.equal(step(z, "commit"), "committed");
  assert.equal(step(z, "reveal"), null);
  assert.equal(z.done, true);
  assert.equal(step(z, "reveal"), "done");
});

test("transpiler: parse inverts transpile on the sample", () => {
  const steps = parse(sample, g);
  assert.deepEqual(parse(transpile(steps, g).join("\n"), g), steps);
  assert.throws(() => parse("In web, juggle units 1.", g), /not a move/);
  assert.throws(() => parse("At print, take the first way.", g), /not offered/);
  assert.throws(() => parse("At web, take the frist way.", g), /no frist way/);
});

test("the Reader's steering replays to the same path and moves", () => {
  const r = new Session(g);
  r.begin();
  for (const u of [600, 400]) r.act("train", u);
  assert.equal(r.choose("second"), null);
  r.act("skip");
  assert.equal(r.act("train", 5), "done");
  r.choose("first");
  r.act("fire", 7);
  assert.equal(r.act("fire", 7), "duplicate");
  assert.equal(r.choose("first"), "not_offered");
  const replay = play(g, r.steering());
  assert.deepEqual(replay.path, r.path);
  assert.deepEqual(replay.steps, r.steps);
  assert.equal(r.steering(), replay.steering());
});

test("the sample replays to the end, deterministically", () => {
  const a = play(g, sample);
  const b = play(g, sample);
  assert.equal(a.ended, true);
  assert.equal(a.path.at(-1), "print");
  assert.equal(a.trace.root, b.trace.root);
  assert.equal(replayRoot(a.trace.events), a.trace.root);
  const kinds = a.trace.events.map((e) => e.kind);
  assert.equal(kinds.filter((k) => k === "choice").length, 0);
  assert.equal(kinds.filter((k) => k === "reflex").length, 12);
  assert.equal(kinds.filter((k) => k === "heading").length, 1);
});

test("every chapter cites only earlier events, and every loop passes through the Reader or the script", () => {
  const s = play(g, sample);
  for (const e of s.trace.events) {
    for (const c of e.cites) assert.ok(c >= 1 && c < e.seq, `e${e.seq} cites e${c}`);
    if (e.kind === "chapter") {
      for (const m of (e.body as { text: string }).text.matchAll(/\[e(\d+)/g)) assert.ok(Number(m[1]) < e.seq);
    }
  }
  const events = s.trace.events;
  for (let i = 0; i < events.length; i++) {
    if (events[i].kind !== "hinge") continue;
    const next = events.slice(i + 1).find((e) => ["choice", "reflex", "take", "stop"].includes(e.kind));
    assert.ok(!next || ["choice", "reflex"].includes(next.kind));
  }
});

test("a script that no longer fits hands control back", () => {
  const s = new Session(g);
  s.begin();
  s.hand("In web, fire unit 1.\n");
  assert.equal(s.tick(), false);
  assert.equal(s.trace.events.at(-1)!.kind, "take");
  assert.equal(s.replaying, false);
});

test("the scroll stops at its limit", () => {
  const lines = ["In media, train the net for 1000 steps.", "At media, take the second way: look at it a little longer."];
  const s = play(g, Array(g.max).fill(lines.join("\n")).join("\n"));
  assert.equal(s.path.length, g.max);
  assert.equal(s.ended, true);
  assert.equal((s.trace.events.find((e) => e.kind === "stop")!.body as { reason: string }).reason, "max");
});
