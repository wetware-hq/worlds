// A stage owns one WebGL canvas for one gamestate. It exists only while its section is on screen:
// the scroll creates it when the section scrolls in and disposes of it when the section scrolls out.
import * as THREE from "three";
import type { Arg, GameState } from "../core/rules.ts";
import { makeView, type Move, type View } from "./views.ts";

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  private view: View;
  private ray = new THREE.Raycaster();
  private down = 0;
  private tap: { x: number; y: number; move: Move } | null = null;
  private hovering = false;
  private readonly el: HTMLElement;
  private readonly game: () => GameState;
  private readonly onMove: (m: Move) => void;
  private readonly live: () => boolean;

  constructor(el: HTMLElement, game: () => GameState, onMove: (m: Move) => void, live: () => boolean) {
    this.el = el;
    this.game = game;
    this.onMove = onMove;
    this.live = live;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.view = makeView(game());
    el.appendChild(this.renderer.domElement);
    this.resize();
    const c = this.renderer.domElement;
    c.addEventListener("pointerdown", this.pointerDown);
    c.addEventListener("pointerup", this.pointerUp);
    c.addEventListener("pointerleave", this.pointerLeave);
    c.addEventListener("pointercancel", this.pointerLeave);
    c.addEventListener("pointermove", this.pointerMove);
  }

  private hit(e: PointerEvent): Move | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.view.camera);
    const h = this.ray.intersectObjects(this.view.targets, false)[0];
    return h ? (h.object.userData.move as Move) : null;
  }

  private pointerDown = (e: PointerEvent): void => {
    if (!this.live()) return;
    const m = this.hit(e);
    if (!m) return;
    if (this.view.hold) this.down = performance.now();
    else this.tap = { x: e.clientX, y: e.clientY, move: m };
  };

  // A move on a target is taken on release, so a swipe that scrolls the page is not a move.
  private pointerUp = (e: PointerEvent): void => {
    const t = this.tap;
    this.tap = null;
    if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10 && this.live()) this.onMove(t.move);
    if (this.down) this.release();
  };

  private release(): void {
    const held = this.heldSteps();
    this.down = 0;
    this.onMove({ verb: "train", arg: Math.max(1, held) });
  }

  private pointerLeave = (): void => {
    this.tap = null;
    if (this.down) this.release();
  };

  private pointerMove = (e: PointerEvent): void => {
    const over = this.live() && this.hit(e) !== null;
    if (over !== this.hovering) this.renderer.domElement.style.cursor = (this.hovering = over) ? "pointer" : "default";
  };

  // Holding the picture trains 250 steps a second, in whole steps of 10.
  private heldSteps(): number {
    return this.down ? Math.round(((performance.now() - this.down) / 1000) * 25) * 10 : 0;
  }

  flash(ok: boolean, arg?: Arg): void {
    this.view.flash(ok, arg);
  }

  resize(): void {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    this.renderer.setSize(w, h, false);
    this.view.camera.aspect = w / h;
    this.view.camera.fov = w / h < 1.2 ? 62 : 42;
    this.view.camera.updateProjectionMatrix();
  }

  frame(t: number): void {
    const g = this.game();
    const held = this.down ? Math.min(this.heldSteps(), Math.max(0, g.goal - g.total)) : 0;
    this.view.update(g, t, held);
    this.renderer.render(this.view.scene, this.view.camera);
  }

  dispose(): void {
    this.view.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
