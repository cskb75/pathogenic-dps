import { describe, expect, it } from 'vitest';
import type { Vec } from '../engine/geometry';
import organelleArt from '../data/organelle_art.json';
import specimens from '../data/specimens.json';
import { GunRest, HairRest, LashRest, PHYSICS_HZ, TentacleRest, type Motion } from './motion';

const looks = organelleArt.organelles as unknown as Record<string, { motion?: Motion; layers: { chain?: { n: number; seg: number } }[] }>;
const motionOf = <K extends Motion['kind']>(id: string, kind: K) => {
  const m = looks[id].motion!;
  expect(m.kind).toBe(kind);
  return m as Extract<Motion, { kind: K }>;
};
const seeded = (seed = 1) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const angle = (a: Vec, b: Vec) => Math.atan2(b.y - a.y, b.x - a.x);
const lengths = (pts: Vec[]) => pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));

describe('organelle motion', () => {
  it('gives every weapon, pseudopod, flagellum and internal organelle its game motion', () => {
    const kinds = Object.values(looks).map((l) => l.motion?.kind ?? 'none');
    expect(kinds.filter((k) => k === 'gun')).toHaveLength(32);
    expect(kinds.filter((k) => k === 'tentacle')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'lash')).toHaveLength(6);
    expect(kinds.filter((k) => k === 'pulse').length).toBeGreaterThan(60);
    expect(motionOf('oxysome', 'pulse')).toMatchObject({ dur: 0.5, scales: [1, 1.1, 1] });
  });

  it('sways a weapon toward its aim, bending along the line and keeping its length', () => {
    const m = motionOf('thermal-lance', 'gun');
    const chain = looks['thermal-lance'].layers[m.layer].chain!;
    const gun = new GunRest(m, chain.n, chain.seg, seeded());
    for (let t = 0; t < 1; t++) gun.tick(0);
    expect(gun.pts.at(-1)!.y).toBeCloseTo(0, 6);
    // Hold the aim at its widest for a few seconds.
    const peak = Math.PI / 2 / 0.7;
    for (let t = 0; t < 3 * PHYSICS_HZ; t++) gun.tick(peak);
    const tip = angle(gun.pts.at(-2)!, gun.pts.at(-1)!);
    expect(tip).toBeGreaterThan(0.05);
    expect(tip).toBeLessThanOrEqual(m.amp + 1e-6);
    // The base bends least.
    expect(Math.abs(angle(gun.pts[0], gun.pts[1]))).toBeLessThan(tip);
    for (const l of lengths(gun.pts)) expect(l).toBeCloseTo(m.seg, 6);
  });

  it("leaves the points gun.gd doesn't move where they were (the Cryophore)", () => {
    const m = motionOf('cryophore', 'gun');
    const chain = looks.cryophore.layers[m.layer].chain!;
    expect(chain.n).toBeGreaterThan(m.n);
    const gun = new GunRest(m, chain.n, chain.seg, seeded());
    for (let t = 0; t < 120; t++) gun.tick(2);
    expect(gun.pts.at(-1)).toEqual({ x: (chain.n - 1) * chain.seg, y: 0 });
  });

  it('wobbles a pseudopod with a wave running down it, the same at 30 and 60 fps', () => {
    const m = motionOf('kinetic-pseudopod', 'tentacle');
    const run = (fps: number) => {
      const t = new TentacleRest(m, seeded(7));
      let widest = 0;
      for (let f = 0; f < 10 * fps; f++) {
        t.step(1 / fps);
        widest = Math.max(widest, Math.abs(t.pts.at(-1)!.y));
        for (const p of t.pts) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      }
      for (const l of lengths(t.pts)) expect(l).toBeCloseTo(m.seg, 2);
      return widest;
    };
    const still = new TentacleRest(m, seeded(7));
    still.step(0);
    for (const p of still.pts) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    const at60 = run(60);
    const length = (m.n - 1) * m.seg;
    // The tip swings further than a rigid ±10° turn would carry it, but stays well within the tentacle's reach.
    expect(at60).toBeGreaterThan(length * Math.sin(m.wobble) * 0.5);
    expect(at60).toBeLessThan(length * 0.6);
    expect(run(30)).toBeCloseTo(at60, 0);
  });

  it('flutters a flagellum about ±14°, its body trailing behind', () => {
    const m = motionOf('pyroflagellum', 'lash');
    const lash = new LashRest(m, seeded(3));
    let widest = 0;
    let bent = 0;
    for (let f = 0; f < 20 * PHYSICS_HZ; f++) {
      const before = lash.angle;
      lash.tick();
      lash.step(1 / PHYSICS_HZ, before);
      widest = Math.max(widest, Math.abs(lash.angle));
      bent = Math.max(bent, Math.abs(angle(lash.pts[0], lash.pts.at(-1)!)));
    }
    expect(widest).toBeGreaterThan(0.2);
    expect(widest).toBeLessThan(0.3);
    expect(bent).toBeGreaterThan(0.001);
    for (const l of lengths(lash.pts)) expect(l).toBeCloseTo(m.seg, 6);
  });

  it("sways a pathogen's hairs by up to 10°, the sway running down to the tip (hair.gd)", () => {
    const helminth = specimens.helminth.hairs[0];
    expect(helminth).toMatchObject({ n: 20, stiffness: 0.3 });
    const hair = new HairRest(helminth, seeded(5));
    let root = 0;
    let lag = 0;
    let spread = 0;
    for (let f = 0; f < 10 * 60; f++) {
      hair.step(1 / 60);
      const a = angle(hair.pts[0], hair.pts[1]);
      root = Math.max(root, Math.abs(a));
      lag = Math.max(lag, Math.abs(angle(hair.pts.at(-2)!, hair.pts.at(-1)!) - a));
      for (const p of hair.pts.slice(1)) spread = Math.max(spread, Math.abs(Math.atan2(p.y, p.x)));
    }
    expect(root).toBeGreaterThan(helminth.sway * 0.95);
    expect(root).toBeLessThanOrEqual(helminth.sway + 1e-9);
    // The tip whips behind the root, but the hair never folds back on itself.
    expect(lag).toBeGreaterThan(0.1);
    expect(spread).toBeLessThan(0.6);
    for (const l of lengths(hair.pts)) expect(l).toBeCloseTo(helminth.seg, 6);
  });
});
