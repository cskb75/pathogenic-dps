import { describe, expect, it } from 'vitest';
import { amoebaStart } from '../data/amoeba';
import { AMOEBA, buildAmoebaBody } from './amoeba';
import { blobField, blobOutline, BLOB_FIELD, loneBlobEdge } from './amoebaShape';

const dist = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);

describe('amoeba outline', () => {
  it('fills a lone blob out to about a third of its radius, where the game puts the first external slot', () => {
    const edge = loneBlobEdge(AMOEBA.startRadius);
    expect(edge).toBeCloseTo(0.744, 2);
    const eslot = amoebaStart.slots.find((s) => s.id === 'ESlot1')!;
    expect(Math.abs(dist(eslot) - edge)).toBeLessThan(0.01);
    const loops = blobOutline([{ x: 0, y: 0, r: AMOEBA.startRadius }]);
    expect(loops).toHaveLength(1);
    for (const p of loops[0]) expect(Math.abs(dist(p) - edge)).toBeLessThan(0.02);
  });

  it('crosses the threshold exactly on the traced outline', () => {
    const blobs = [
      { x: 0, y: 0, r: AMOEBA.startRadius },
      { x: 1.2, y: -0.9, r: AMOEBA.blobRadius },
    ];
    for (const p of blobOutline(blobs)[0]) expect(blobField(blobs, p)).toBeCloseTo(BLOB_FIELD.threshold, 2);
  });

  it('keeps two blobs joined within the placement limit, and apart well beyond it', () => {
    const r = AMOEBA.blobRadius;
    const at = (d: number) => blobOutline([{ x: 0, y: 0, r }, { x: d, y: 0, r }]).length;
    expect(at(2 * r * AMOEBA.maxDist)).toBe(1);
    expect(at(2 * r * 0.66)).toBe(1);
    expect(at(2 * r * 0.72)).toBe(2);
  });

  it('grows a lobe well past the starting body', () => {
    const body = buildAmoebaBody(amoebaStart, [{ id: 0, kind: 'external', x: 3, y: 0 }]);
    const reach = Math.max(...blobOutline(body.blobs).flat().map((p) => p.x));
    // The blob lands at the edge of the placement limit (1.62) and bulges ~0.4 past its centre.
    expect(reach).toBeGreaterThan(1.9);
    expect(reach).toBeLessThan(2.2);
    expect(blobOutline(body.blobs)).toHaveLength(1);
  });
});
