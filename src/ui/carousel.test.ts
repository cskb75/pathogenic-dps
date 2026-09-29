import { existsSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { gameData } from '../data';
import specimens from '../data/specimens.json';
import { ringOffset, tubePlace } from './ClassPicker';
import { specimenBody, specimenOf } from './Specimen';

describe('pathogen carousel', () => {
  it('puts the chosen pathogen in the middle and wraps the rest around it', () => {
    // Seven pathogens: three either side, the ring's far side split between the ends.
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => ringOffset(i, 0, 7))).toEqual([0, 1, 2, 3, -3, -2, -1]);
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => ringOffset(i, 5, 7))).toEqual([2, 3, -3, -2, -1, 0, 1]);
  });

  it('shrinks and fades tubes further out, spacing them by size', () => {
    const [mid, one, two, three] = [0, 1, 2, 3].map(tubePlace);
    expect(mid).toEqual({ x: 0, scale: 1, opacity: 1 });
    expect(tubePlace(-2)).toEqual({ ...two, x: -two.x });
    expect(one.scale).toBeLessThan(mid.scale);
    expect(three.opacity).toBeLessThan(two.opacity);
    // Neighbours never overlap: each step is at least half of both tubes' widths.
    for (const [a, b] of [
      [mid, one],
      [one, two],
      [two, three],
    ]) {
      expect(b.x - a.x).toBeGreaterThanOrEqual((a.scale + b.scale) / 2);
    }
    expect(tubePlace(4).opacity).toBe(0);
  });

  it('has a specimen for every pathogen, from the game files', () => {
    expect(Object.keys(specimens).sort()).toEqual(gameData.classes.map((c) => c.id).sort());
    for (const cls of gameData.classes) {
      const { box } = specimenBody(cls, gameData);
      expect(box.w, cls.id).toBeGreaterThan(0.5);
      expect(box.h, cls.id).toBeGreaterThan(0.5);
      for (const h of specimenOf(cls.id).hairs) {
        expect(h.n).toBeGreaterThanOrEqual(2);
        expect(h.seg).toBeGreaterThan(0);
        expect(h.stiffness).toBeGreaterThan(0);
        expect(h.stiffness).toBeLessThan(1);
        if (h.widths) expect(h.widths).toHaveLength(h.n);
        // Each hair is a colour or a texture that ships with the site.
        if (h.src) expect(existsSync(resolve(__dirname, '../../public', h.src)), h.src).toBe(true);
        else expect(h.color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    // The Bacterium's eyes, cilia and tails (scn/player/player.tscn).
    expect(specimenOf('bacterium').hairs).toHaveLength(8);
    expect(specimenOf('helminth').hairs.every((h) => h.src)).toBe(true);
  });
});
