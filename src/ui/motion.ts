// How organelles move at rest in the game's organelle editor, ported from its
// scripts. tools/extract/organelle_art.py records each organelle's values.
//
// Every chain works in its line's own frame: the line starts at (0, 0) and runs
// along +x. Units are editor units (100 game pixels).

import type { Vec } from '../engine/geometry';

export type Motion =
  /** gun.gd (every weapon) and the Chemoreceptor Antenna: the aim sways and the line bends toward it. */
  | { kind: 'gun'; layer: number; n: number; seg: number; stiffness: number; amp: number }
  /** scn/cells/tentacle.gd with no target: the base wobbles and a wave runs down the tentacle. */
  | { kind: 'tentacle'; layer: number; n: number; seg: number; fluidity: number; straighten: number; spring: number; wobble: number; speed: number; stretch: [number, number] }
  /** lash.gd: the connector flutters about the slot; the body (scn/cells/hair.gd) trails behind it. */
  | { kind: 'lash'; hair: number; body: number; origin: [number, number]; n: number; seg: number; stiffness: number; fluidity: number; sway: number }
  /** An autoplayed AnimationPlayer scaling the Visual node: the internal organelles' "wiggle". */
  | { kind: 'pulse'; layers: number[]; dur: number; times: number[]; scales: number[] };

/** Godot's physics tick: gun.gd and lash.gd step once per tick with fixed weights. */
export const PHYSICS_HZ = 60;

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const len = (a: Vec) => Math.hypot(a.x, a.y);
const norm = (a: Vec): Vec => {
  const l = len(a);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
const rotate = (a: Vec, r: number): Vec => ({ x: a.x * Math.cos(r) - a.y * Math.sin(r), y: a.x * Math.sin(r) + a.y * Math.cos(r) });
const between = (lo: number, hi: number, random: () => number) => lo + (hi - lo) * random();

/** A straight line of `count` points `spacing` apart. */
const straight = (count: number, spacing: number): Vec[] => Array.from({ length: count }, (_, i) => ({ x: i * spacing, y: 0 }));

/**
 * gun.gd in the organelle editor: the aim sways by sin(t * speed) / 5 rad (the
 * antenna: * 0.18), speed random in 0.7-1.3. Each tick every segment eases toward
 * a direction that turns from the previous segment's toward the aim along the
 * line, then keeps its length. Points past `n` don't move (the Cryophore's
 * line is longer than its script moves).
 */
export class GunRest {
  readonly pts: Vec[];
  private readonly speed: number;

  constructor(
    private readonly m: Extract<Motion, { kind: 'gun' }>,
    points: number,
    spacing: number,
    random = Math.random,
  ) {
    this.pts = straight(points, spacing);
    this.speed = between(0.7, 1.3, random);
  }

  /** One physics tick at `time` seconds (the game uses its global clock). */
  tick(time: number) {
    const { n, seg, stiffness, amp } = this.m;
    const target = rotate({ x: 1, y: 0 }, Math.sin(time * this.speed) * amp);
    let last = this.pts[0];
    let lastDir: Vec = { x: 1, y: 0 };
    for (let i = 1; i < Math.min(n, this.pts.length); i++) {
      const base = add(last, scale(lerp(lastDir, target, i / n), seg));
      const pos = lerp(this.pts[i], base, stiffness);
      const dir = norm(sub(pos, last));
      this.pts[i] = add(last, scale(dir, seg));
      lastDir = dir;
      last = this.pts[i];
    }
  }
}

/** tentacle.gd simulates at this rate and adjusts its weights for the real frame time. */
const REFERENCE_HZ = 240;

/** tentacle.gd's _interleaved: the lerp weight that matches REFERENCE_HZ steps at this frame time. */
function interleaved(w: number, dt: number): number {
  const s = Math.min(Math.max(w, 0.001), 0.999);
  const r = 1 - s;
  const n = dt * REFERENCE_HZ;
  return Math.min(Math.max(1 - (r * (1 - r ** n)) / (n * s), 0), 0.999);
}

/**
 * tentacle.gd with no target (a pseudopod waiting in the editor): the first
 * segment wobbles by sin(time * speed) * wobble, every later point eases toward
 * the straight continuation of the one before it, and a spring keeps segment
 * lengths. The lag makes a wave run down the tentacle.
 */
export class TentacleRest {
  readonly pts: Vec[];
  private time: number;
  private readonly speed: number;

  constructor(
    private readonly m: Extract<Motion, { kind: 'tentacle' }>,
    random = Math.random,
  ) {
    this.pts = straight(m.n, m.seg);
    this.time = between(0, Math.PI * 2, random);
    this.speed = between(0.7, 1.3, random);
  }

  step(dt: number) {
    const { n, seg, straighten, spring, wobble, speed, stretch } = this.m;
    // interleaved() divides by the frame time.
    if (n < 2 || !(dt > 0)) return;
    this.time += dt;
    const pts = this.pts;
    pts[0] = { x: 0, y: 0 };
    pts[1] = rotate({ x: seg, y: 0 }, Math.sin(this.time * speed * this.speed) * wobble);
    for (let i = 2; i < n; i++) {
      const prevDir = norm(sub(pts[i - 1], pts[i - 2]));
      if (len(prevDir) === 0) continue;
      const chainT = (i - 1) / Math.max(1, n - 1);
      const w = Math.min(Math.max(straighten * (1 - chainT / 10) * (60 / REFERENCE_HZ) * 4, 0), 0.9999);
      pts[i] = lerp(pts[i], add(pts[i - 1], scale(prevDir, seg)), interleaved(w, dt));
    }
    const springLerp = interleaved(Math.min(Math.max((spring * 60) / REFERENCE_HZ, 0), 0.9999), dt);
    let prev = pts[1];
    for (let i = 2; i < n; i++) {
      const to = sub(pts[i], prev);
      const current = len(to);
      const dir = current < 0.00001 ? norm(sub(prev, pts[i - 2])) : norm(to);
      const want = Math.min(Math.max(current + (seg - current) * springLerp, seg * stretch[0]), seg * stretch[1]);
      pts[i] = add(prev, scale(dir, want));
      prev = pts[i];
    }
  }
}

/**
 * scn/cells/hair.gd on a body that isn't moving (the character select's
 * pathogens): its root direction sways by sin(t * 2π / period) * sway, the
 * period 4 s x a random 0.7-1.3, and each later point eases toward the straight
 * continuation of the one before it, with a half-life set by `stiffness`, then
 * keeps its segment length. So the sway runs down the hair a little late.
 * (`fluidity` only matters while the body moves.)
 */
export class HairRest {
  readonly pts: Vec[];
  private time: number;
  private readonly period: number;
  private readonly halfLife: number;

  constructor(
    private readonly m: { n: number; seg: number; stiffness: number; sway: number },
    random = Math.random,
  ) {
    this.pts = straight(m.n, m.seg);
    this.period = 4 * between(0.7, 1.3, random);
    this.time = random() * this.period;
    this.halfLife = -(1 / 60) / (Math.log(1 - m.stiffness) / Math.log(2));
  }

  step(dt: number) {
    if (!(dt > 0)) return;
    this.time += dt;
    const { seg, sway } = this.m;
    const pull = 1 - 2 ** (-dt / this.halfLife);
    let lastDir = rotate({ x: 1, y: 0 }, sway * Math.sin((this.time * 2 * Math.PI) / this.period));
    let last = this.pts[0];
    for (let i = 1; i < this.pts.length; i++) {
      const pos = lerp(this.pts[i], add(last, scale(lastDir, seg)), pull);
      const dir = norm(sub(pos, last));
      this.pts[i] = add(last, scale(dir, seg));
      lastDir = dir;
      last = this.pts[i];
    }
  }
}

/**
 * lash.gd in the organelle editor, plus the hair.gd body hanging off it.
 *
 * The connector's rotation eases toward 0 by 0.2 per tick (the slot's default
 * ±45° range) and adds sin(t * 20) / 4 * 0.2, with t advancing at 0.1 x a random
 * 0.5-1 rate: so it sways about ±14° every 3-6 s. The body is attached `origin`
 * along the connector; each frame its points first keep where they were (so they
 * trail the rotation, by `fluidity`), then ease back toward a straight line with
 * a half-life set by `stiffness`.
 */
export class LashRest {
  /** The connector's rotation about the slot, radians. */
  angle = 0;
  /** The body's points, in its own frame (before `angle` and `origin`). */
  readonly pts: Vec[];
  private flutter: number;
  private readonly rate: number;
  private readonly halfLife: number;

  constructor(
    private readonly m: Extract<Motion, { kind: 'lash' }>,
    random = Math.random,
  ) {
    this.pts = straight(m.n, m.seg);
    this.flutter = between(0, 10, random);
    this.rate = between(0.5, 1, random);
    this.halfLife = -(1 / 60) / (Math.log(1 - m.stiffness) / Math.log(2));
  }

  /** One physics tick: the connector's flutter. */
  tick() {
    this.angle += (0 - this.angle) * 0.2;
    this.flutter += (1 / PHYSICS_HZ) * 0.1 * this.rate;
    this.angle += (Math.sin(this.flutter * 20) / 4) * 0.2;
  }

  /** One frame of the body, after the connector turned from `before` to `this.angle`. */
  step(dt: number, before: number) {
    const { seg, fluidity } = this.m;
    const o = { x: this.m.origin[0], y: this.m.origin[1] };
    // Last frame's points, seen from the connector's new angle.
    const want = this.pts.map((p) => sub(rotate(add(o, p), before - this.angle), o));
    const pull = 1 - 2 ** (-dt / this.halfLife);
    let last = this.pts[0];
    let lastDir = rotate({ x: 1, y: 0 }, 0);
    for (let i = 1; i < this.pts.length; i++) {
      const base = add(last, scale(lastDir, seg));
      let pos = lerp(this.pts[i], want[i], fluidity);
      pos = lerp(pos, base, pull);
      const dir = norm(sub(pos, last));
      this.pts[i] = add(last, scale(dir, seg));
      lastDir = dir;
      last = this.pts[i];
    }
  }
}
