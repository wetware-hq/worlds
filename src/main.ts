import manifest from "../story/proof-of-life.txt?raw";
import sample from "../story/sample.steer.txt?raw";
import { compile } from "./core/bandercatch.ts";
import { loadImage } from "./games/views.ts";
import { Scroll } from "./ui/scroll.ts";
import "./ui/style.css";

const graph = compile(manifest);
await loadImage(`${import.meta.env.BASE_URL}astronaut-64.png`).catch(() => undefined);
const scroll = new Scroll(graph, sample);
scroll.start();
Object.assign(window, { worlds: scroll });
