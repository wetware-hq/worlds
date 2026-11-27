// Bandercatch CLI.
//   node tools/bandercatch.ts compile   <manifest.txt>        -> state graph JSON on stdout
//   node tools/bandercatch.ts decompile <graph.json>          -> canonical manifest on stdout
//   node tools/bandercatch.ts check     <manifest.txt>        -> root, round trip, walk counts
//   node tools/bandercatch.ts play      <manifest.txt> <steer.txt> [--trace out.jsonl] [--chapters]
import { readFileSync, writeFileSync } from "node:fs";
import { BandercatchError, compile, decompile, graphRoot, walks, type StateGraph } from "../src/core/bandercatch.ts";
import { play } from "../src/core/session.ts";

const [cmd, a, b, ...rest] = process.argv.slice(2);
const read = (p: string): string => readFileSync(p, "utf8");

try {
  if (cmd === "compile") process.stdout.write(JSON.stringify(compile(read(a)), null, 2) + "\n");
  else if (cmd === "decompile") process.stdout.write(decompile(JSON.parse(read(a)) as StateGraph));
  else if (cmd === "check") {
    const g = compile(read(a));
    const canon = decompile(g);
    const ok = decompile(compile(canon)) === canon && JSON.stringify(compile(canon)) === JSON.stringify(g);
    console.log(`title    ${g.title}`);
    console.log(`states   ${g.states.length}, start ${g.start}, max ${g.max}`);
    console.log(`root     ${graphRoot(g)}`);
    console.log(`roundtrip ${ok ? "ok" : "FAIL"}`);
    console.log(`walks    ${walks(g, g.start, g.max)} distinct walks from ${g.start} within ${g.max} parts`);
    if (!ok) process.exit(1);
  } else if (cmd === "play") {
    const s = play(compile(read(a)), read(b));
    const t = rest.indexOf("--trace");
    if (t >= 0) writeFileSync(rest[t + 1], s.trace.jsonl());
    if (rest.includes("--chapters"))
      for (const e of s.trace.events) if (e.kind === "chapter") console.log(`e${e.seq}: ${(e.body as { text: string }).text}\n`);
    console.log(`path     ${s.path.join(" -> ")}`);
    console.log(`events   ${s.trace.events.length}`);
    console.log(`ended    ${s.ended}`);
    console.log(`root     ${s.trace.root}`);
  } else {
    console.error("usage: bandercatch compile|decompile|check|play ...");
    process.exit(2);
  }
} catch (e) {
  if (e instanceof BandercatchError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
