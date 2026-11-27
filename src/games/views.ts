// The three.js views of the minigames. A view only draws a GameState and says which move a click means;
// the rules (src/core/rules.ts) decide whether the move is taken.
import * as THREE from "three";
import { CORNERS, progress, type Arg, type GameState } from "../core/rules.ts";

export interface Move {
  verb: string;
  arg?: Arg;
}

export interface View {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  targets: THREE.Object3D[]; // clickable; userData.move holds the Move
  hold?: boolean; // fit: press and hold
  update(g: GameState, t: number, held: number): void;
  flash(ok: boolean, arg?: Arg): void;
  dispose(): void;
}

export const BASE_COLOR: Record<string, number> = { A: 0x6fd08c, C: 0x5aa9e6, G: 0xf2c14e, T: 0xef6f6c };
const INK = 0xe8e4d8;
const DIM = 0x3a4150;

function label(text: string, w = 256, h = 96, color = "#e8e4d8", bg = "rgba(20,24,32,0.92)"): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d")!;
  x.fillStyle = bg;
  x.fillRect(0, 0, w, h);
  x.strokeStyle = color;
  x.lineWidth = 4;
  x.strokeRect(2, 2, w - 4, h - 4);
  x.fillStyle = color;
  x.font = `600 ${Math.floor(h * 0.42)}px ui-monospace, Menlo, monospace`;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function base(): Pick<View, "scene" | "camera"> & { disposables: { dispose(): void }[] } {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 2, 0.1, 100);
  camera.position.set(0, 0, 7);
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const d = new THREE.DirectionalLight(0xffffff, 1.6);
  d.position.set(3, 4, 6);
  scene.add(d);
  return { scene, camera, disposables: [] };
}

function track<T extends { dispose(): void }>(list: { dispose(): void }[], x: T): T {
  list.push(x);
  return x;
}

function disposeAll(list: { dispose(): void }[], scene: THREE.Scene): void {
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
  list.forEach((x) => x.dispose());
}

// A small deterministic PRNG, so the same oligo is in the same place on every visit.
function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

let pixels: Uint8ClampedArray | null = null;
export async function loadImage(url: string): Promise<void> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  x.drawImage(img, 0, 0, 64, 64);
  pixels = x.getImageData(0, 0, 64, 64).data;
}

function fitView(): View {
  const b = base();
  const data = new Uint8Array(64 * 64 * 4);
  const tex = track(b.disposables, new THREE.DataTexture(data, 64, 64, THREE.RGBAFormat));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: tex }));
  plane.userData.move = { verb: "train" };
  b.scene.add(plane);
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.95, 3.05, 96, 1, 0, 0), new THREE.MeshBasicMaterial({ color: 0x6fd08c }));
  b.scene.add(ring);
  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(4.1, 4.1)), new THREE.LineBasicMaterial({ color: DIM }));
  b.scene.add(frame);
  let last = -1;
  let lastP = -1;
  let red = 0;
  return {
    ...b,
    targets: [plane],
    hold: true,
    update(g, t, held) {
      const p = Math.min(1, (g.total + held) / g.goal);
      const block = g.skipped ? 64 : Math.max(1, Math.round(32 * Math.pow(1 - p, 2)));
      if (block !== last && pixels) {
        last = block;
        for (let by = 0; by < 64; by += block)
          for (let bx = 0; bx < 64; bx += block) {
            const acc = [0, 0, 0];
            let n = 0;
            for (let y = by; y < Math.min(64, by + block); y++)
              for (let x = bx; x < Math.min(64, bx + block); x++, n++)
                for (let k = 0; k < 3; k++) acc[k] += pixels[(y * 64 + x) * 4 + k];
            for (let y = by; y < Math.min(64, by + block); y++)
              for (let x = bx; x < Math.min(64, bx + block); x++) {
                const o = ((63 - y) * 64 + x) * 4;
                for (let k = 0; k < 3; k++) data[o + k] = acc[k] / n;
                data[o + 3] = 255;
              }
          }
        tex.needsUpdate = true;
      }
      if (p !== lastP) {
        lastP = p;
        ring.geometry.dispose();
        ring.geometry = new THREE.RingGeometry(2.55, 2.65, 96, 1, Math.PI / 2 - Math.PI * 2 * p, Math.PI * 2 * p);
      }
      plane.rotation.y = Math.sin(t * 0.6) * 0.08;
      plane.scale.setScalar(held > 0 ? 0.97 : 1);
      (ring.material as THREE.MeshBasicMaterial).color.setHex(red > t ? 0xef6f6c : 0x6fd08c);
    },
    flash(ok) {
      if (!ok) red = performance.now() / 1000 + 0.4;
    },
    dispose: () => disposeAll(b.disposables, b.scene),
  };
}

function latticeView(): View {
  const b = base();
  b.camera.position.set(0, 2.2, 7.4);
  b.camera.lookAt(0, 0, 0);
  const geo = new THREE.SphereGeometry(0.13, 16, 12);
  const units: THREE.Mesh[] = [];
  for (let i = 0; i < 128; i++) {
    const layer = Math.floor(i / 64);
    const k = i % 64;
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: DIM, emissive: 0x000000 }));
    m.position.set((k % 8) * 0.42 - 1.47 + (layer ? 0.2 : -0.2), Math.floor(k / 8) * 0.42 - 1.47, layer ? -1.2 : 1.2);
    m.userData.move = { verb: "fire", arg: i };
    m.userData.home = m.position.clone();
    units.push(m);
    b.scene.add(m);
  }
  let red = -1;
  let redAt = 0;
  return {
    ...b,
    targets: units,
    update(g, t) {
      units.forEach((u, i) => {
        const on = g.picked.includes(i);
        const mat = u.material as THREE.MeshStandardMaterial;
        const w = 1.5 + (i % 7) * 0.6;
        const s = on ? Math.sin(t * w + i) : 0;
        mat.color.setHex(i === red && redAt > t ? 0xef6f6c : on ? 0x6fd08c : DIM);
        mat.emissive.setRGB(0, on ? 0.25 + 0.25 * s : 0, on ? 0.15 : 0);
        u.position.y = u.userData.home.y + s * 0.12;
        u.scale.setScalar(on ? 1.25 : 1);
      });
      b.scene.rotation.y = Math.sin(t * 0.25) * 0.35;
    },
    flash(ok, arg) {
      if (!ok && typeof arg === "number") {
        red = arg;
        redAt = performance.now() / 1000 + 0.4;
      }
    },
    dispose: () => disposeAll(b.disposables, b.scene),
  };
}

const COMPLEMENT: Record<string, string> = { A: "T", T: "A", C: "G", G: "C" };

function helixView(): View {
  const b = base();
  const group = new THREE.Group();
  b.scene.add(group);
  const ball = new THREE.SphereGeometry(0.16, 16, 12);
  const rung = new THREE.CylinderGeometry(0.035, 0.035, 1, 6);
  let count = -1;
  let red = 0;
  const mats = Object.fromEntries(Object.entries(BASE_COLOR).map(([k, c]) => [k, new THREE.MeshStandardMaterial({ color: c })]));
  const rungMat = new THREE.MeshStandardMaterial({ color: 0x8a8f99 });
  b.disposables.push(ball, rung, rungMat, ...Object.values(mats));
  return {
    ...b,
    targets: [],
    update(g, t) {
      if (g.bases.length !== count) {
        count = g.bases.length;
        group.clear();
        const n = Math.max(g.goal, count);
        g.bases.forEach((x, i) => {
          const a = i * 0.62;
          const y = (i - (n - 1) / 2) * 0.3;
          const p1 = new THREE.Vector3(Math.cos(a) * 1.1, y, Math.sin(a) * 1.1);
          const p2 = p1.clone().setX(-p1.x).setZ(-p1.z);
          const s1 = new THREE.Mesh(ball, mats[x]);
          s1.position.copy(p1);
          const s2 = new THREE.Mesh(ball, mats[COMPLEMENT[x]]);
          s2.position.copy(p2);
          const r = new THREE.Mesh(rung, rungMat);
          r.position.set(0, y, 0);
          r.scale.y = 2.2;
          r.rotation.z = Math.PI / 2;
          r.rotation.y = -a;
          group.add(s1, s2, r);
        });
      }
      group.rotation.y = t * 0.5;
      group.rotation.z = 0.5;
      group.position.x = red > t ? Math.sin(t * 60) * 0.06 : 0;
    },
    flash(ok) {
      if (!ok) red = performance.now() / 1000 + 0.35;
    },
    dispose: () => {
      group.clear();
      disposeAll(b.disposables, b.scene);
    },
  };
}

function catchView(g0: GameState): View {
  const b = base();
  const geo = new THREE.CapsuleGeometry(0.07, 0.6, 4, 8);
  b.disposables.push(geo);
  const r = rand(129);
  const rods = Array.from({ length: g0.n }, (_, i) => {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: Object.values(BASE_COLOR)[i % 4] }));
    m.userData.move = { verb: "catch", arg: i };
    m.userData.seed = [r() * 6 - 3, r() * 3 - 0.8, r() * 2 - 1, r() * 6.28, 0.3 + r() * 0.5];
    b.scene.add(m);
    return m;
  });
  const tray = new THREE.Mesh(new THREE.BoxGeometry(6, 0.06, 0.6), new THREE.MeshStandardMaterial({ color: DIM }));
  tray.position.set(0, -2.15, 0);
  b.scene.add(tray);
  let red = -1;
  let redAt = 0;
  return {
    ...b,
    targets: rods,
    update(g, t) {
      rods.forEach((m, i) => {
        const k = g.picked.indexOf(i);
        const [x, y, z, ph, sp] = m.userData.seed as number[];
        if (k >= 0) {
          const target = new THREE.Vector3(-2.6 + k * (5.2 / Math.max(1, g.goal - 1)), -1.75, 0);
          m.position.lerp(target, 0.15);
          m.rotation.set(0, 0, 0);
        } else {
          m.position.set(x + Math.sin(t * sp + ph) * 0.35, y + Math.cos(t * sp * 0.8 + ph) * 0.3, z);
          m.rotation.set(ph + t * sp, 0, ph + t * sp * 0.7);
        }
        (m.material as THREE.MeshStandardMaterial).emissive.setHex(i === red && redAt > t ? 0x661111 : 0);
      });
    },
    flash(ok, arg) {
      if (!ok && typeof arg === "number") {
        red = arg;
        redAt = performance.now() / 1000 + 0.4;
      }
    },
    dispose: () => disposeAll(b.disposables, b.scene),
  };
}

function chaosView(): View {
  const b = base();
  const S = 4;
  const at = (x: number, y: number) => new THREE.Vector3((x - 0.5) * S, (y - 0.5) * S, 0);
  b.scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(S, S)), new THREE.LineBasicMaterial({ color: DIM })));
  const corners = Object.entries(CORNERS).map(([k, [x, y]]) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.32, 32), new THREE.MeshBasicMaterial({ map: track(b.disposables, label(k, 96, 96, "#11151c", `#${BASE_COLOR[k].toString(16).padStart(6, "0")}`)) }));
    m.position.copy(at(x, y)).add(new THREE.Vector3((x - 0.5) * 0.8, (y - 0.5) * 0.8, 0.01));
    m.userData.move = { verb: "jump", arg: k };
    b.scene.add(m);
    return m;
  });
  const MAX = 512;
  const pos = new Float32Array(MAX * 3);
  const col = new Float32Array(MAX * 3);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  pg.setAttribute("color", new THREE.BufferAttribute(col, 3));
  b.scene.add(new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.09, vertexColors: true })));
  const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.5 }));
  b.scene.add(line);
  const cursor = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.14, 24), new THREE.MeshBasicMaterial({ color: INK }));
  b.scene.add(cursor);
  let count = -1;
  return {
    ...b,
    targets: corners,
    update(g, t) {
      if (g.points.length !== count) {
        count = g.points.length;
        const n = Math.min(MAX, count);
        const c = new THREE.Color();
        for (let i = 0; i < n; i++) {
          const v = at(...g.points[i]);
          pos.set([v.x, v.y, 0], i * 3);
          c.setHex(i === 0 ? INK : BASE_COLOR[g.bases[i - 1]]);
          col.set([c.r, c.g, c.b], i * 3);
        }
        pg.setDrawRange(0, n);
        pg.attributes.position.needsUpdate = pg.attributes.color.needsUpdate = true;
        const a = at(...g.points[Math.max(0, count - 2)]);
        const z = at(...g.points[count - 1]);
        lg.setFromPoints([a, z]);
        cursor.position.copy(z);
      }
      cursor.scale.setScalar(1 + Math.sin(t * 4) * 0.15);
    },
    flash() {},
    dispose: () => disposeAll(b.disposables, b.scene),
  };
}

function stackView(g0: GameState): View {
  const b = base();
  b.camera.position.set(0, 1.6, 7);
  b.camera.lookAt(0, -0.3, 0);
  const r = rand(7);
  const order = Array.from({ length: g0.n }, (_, i) => i).sort(() => r() - 0.5);
  const blocks = Array.from({ length: g0.n }, (_, i) => {
    const tex = track(b.disposables, label(`part ${i + 1}`, 256, 96));
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.8), [
      new THREE.MeshStandardMaterial({ color: 0x2a3140 }), new THREE.MeshStandardMaterial({ color: 0x2a3140 }),
      new THREE.MeshStandardMaterial({ color: 0x2a3140 }), new THREE.MeshStandardMaterial({ color: 0x2a3140 }),
      new THREE.MeshStandardMaterial({ map: tex }), new THREE.MeshStandardMaterial({ color: 0x2a3140 }),
    ]);
    const slot = order.indexOf(i);
    m.userData.move = { verb: "place", arg: i + 1 };
    m.userData.home = new THREE.Vector3(slot < 3 ? -2.6 : 2.6, -1.6 + (slot % 3) * 0.75, 0);
    m.position.copy(m.userData.home);
    b.scene.add(m);
    return m;
  });
  let red = -1;
  let redAt = 0;
  return {
    ...b,
    targets: blocks,
    update(g, t) {
      blocks.forEach((m, i) => {
        const placed = g.picked.includes(i + 1);
        const target = placed ? new THREE.Vector3(0, -1.6 + i * 0.52, 0) : m.userData.home;
        m.position.lerp(target, 0.15);
        if (i === red && redAt > t) m.position.x += Math.sin(t * 60) * 0.04;
        m.rotation.y = placed ? Math.sin(t * 0.8 + i) * 0.05 : 0.3 * (m.position.x < 0 ? 1 : -1);
      });
    },
    flash(ok, arg) {
      if (!ok && typeof arg === "number") {
        red = arg - 1;
        redAt = performance.now() / 1000 + 0.4;
      }
    },
    dispose: () => disposeAll(b.disposables, b.scene),
  };
}

function sealView(): View {
  const b = base();
  const face = track(b.disposables, label("root", 256, 256, "#f2c14e", "#2a2410"));
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.18, 64), [
    new THREE.MeshStandardMaterial({ color: 0xb8902e, metalness: 0.6, roughness: 0.35 }),
    new THREE.MeshStandardMaterial({ map: face, metalness: 0.3, roughness: 0.5 }),
    new THREE.MeshStandardMaterial({ color: 0x8c6d22, metalness: 0.6, roughness: 0.4 }),
  ]);
  coin.rotation.x = Math.PI / 2;
  b.scene.add(coin);
  const wax = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.12, 12, 64), new THREE.MeshStandardMaterial({ color: 0xa33b3b }));
  b.scene.add(wax);
  let red = 0;
  return {
    ...b,
    targets: [coin],
    update(g, t) {
      coin.userData.move = { verb: g.committed ? "reveal" : "commit" };
      wax.visible = g.committed && !g.revealed;
      wax.rotation.z = t * 0.4;
      const spin = g.revealed ? 0 : g.committed ? Math.PI : t * 0.8;
      coin.rotation.z = THREE.MathUtils.lerp(coin.rotation.z, spin, g.committed ? 0.08 : 1);
      coin.position.x = red > t ? Math.sin(t * 60) * 0.05 : 0;
    },
    flash(ok) {
      if (!ok) red = performance.now() / 1000 + 0.35;
    },
    dispose: () => disposeAll(b.disposables, b.scene),
  };
}

function orbitView(g0: GameState): View {
  const b = base();
  const cards = g0.cards.map((c, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), new THREE.MeshBasicMaterial({ map: track(b.disposables, label(c, 320, 120)), side: THREE.DoubleSide }));
    m.userData.move = { verb: g0.verb, arg: i };
    b.scene.add(m);
    return m;
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), new THREE.MeshStandardMaterial({ color: 0x5aa9e6, flatShading: true }));
  b.scene.add(core);
  let red = -1;
  let redAt = 0;
  return {
    ...b,
    targets: cards,
    update(g, t) {
      const free = cards.map((_, i) => i).filter((i) => !g.picked.includes(i));
      cards.forEach((m, i) => {
        const k = g.picked.indexOf(i);
        let target: THREE.Vector3;
        if (k >= 0) target = new THREE.Vector3(-2.4 + (k % 4) * 1.6, -1.9 - Math.floor(k / 4) * 0.7, 0.5);
        else {
          const a = t * 0.35 + (free.indexOf(i) / Math.max(1, free.length)) * Math.PI * 2;
          target = new THREE.Vector3(Math.cos(a) * 2.5, Math.sin(a) * 1.1 + 0.4, Math.sin(a) * 0.8);
        }
        m.position.lerp(target, 0.12);
        (m.material as THREE.MeshBasicMaterial).color.setHex(i === red && redAt > t ? 0xef6f6c : k >= 0 ? 0x9fe0b0 : 0xffffff);
      });
      core.rotation.set(t * 0.3, t * 0.5, 0);
      core.scale.setScalar(1 + progress(g) * 0.5);
    },
    flash(ok, arg) {
      if (!ok && typeof arg === "number") {
        red = arg;
        redAt = performance.now() / 1000 + 0.4;
      }
    },
    dispose: () => disposeAll(b.disposables, b.scene),
  };
}

export function makeView(g: GameState): View {
  switch (g.kind) {
    case "fit": return fitView();
    case "lattice": return latticeView();
    case "helix": return helixView();
    case "catch": return catchView(g);
    case "chaos": return chaosView();
    case "stack": return stackView(g);
    case "seal": return sealView();
    case "orbit": return orbitView(g);
  }
}
