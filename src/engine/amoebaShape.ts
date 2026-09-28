// The Amoeba's outline, the way the game bakes it (scn/player/player_amoeba/blob_composer.gd).
//
// Every blob is a radial-gradient sprite: alpha 0.5 at its centre, falling
// linearly to 0 at 1.5x its radius. The sprites are drawn with additive
// blending, which in Godot scales the source alpha by itself (SRC_ALPHA, ONE),
// so the composer's alpha is the sum of each blob's alpha squared.
// threshold_outline.gdshader fills wherever that sum is above 0.15.
//
// A lone blob is filled out to about a third of its radius (the starting blob,
// radius 220, to 74 px: exactly where the scene puts its first external slot),
// and nearby blobs merge into lobes. That's also why the game keeps a new blob
// within 0.54x the two radii of its closest blob: two blobs stay joined up to
// about 0.68x.

import type { Blob } from './amoeba';
import type { Vec } from './geometry';

export const BLOB_FIELD = {
  /** Gradient alpha at a blob's centre (_BLOB_GRADIENT_PEAK_ALPHA). */
  peak: 0.5,
  /** The gradient reaches 0 at this multiple of the blob's radius (_BLOB_SPRITE_SIZE_FACTOR). */
  reach: 1.5,
  /** The body is where the summed field is above this (BlobComposer.THRESHOLD). */
  threshold: 0.15,
} as const;

/** The composer's alpha at a point: each blob's gradient alpha, squared, summed. */
export function blobField(blobs: Blob[], p: Vec): number {
  let sum = 0;
  for (const b of blobs) {
    const a = BLOB_FIELD.peak * (1 - Math.hypot(p.x - b.x, p.y - b.y) / (BLOB_FIELD.reach * b.r));
    if (a > 0) sum += a * a;
  }
  return sum;
}

/** How far out a lone blob of radius r is filled. */
export const loneBlobEdge = (r: number) => BLOB_FIELD.reach * r * (1 - Math.sqrt(BLOB_FIELD.threshold) / BLOB_FIELD.peak);

/**
 * The body's outline: closed loops (an island each, or a hole) traced along
 * where the field crosses the threshold, sampled every `step` units.
 */
export function blobOutline(blobs: Blob[], step = 0.03): Vec[][] {
  if (blobs.length === 0) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of blobs) {
    const reach = BLOB_FIELD.reach * b.r;
    minX = Math.min(minX, b.x - reach);
    minY = Math.min(minY, b.y - reach);
    maxX = Math.max(maxX, b.x + reach);
    maxY = Math.max(maxY, b.y + reach);
  }
  // One empty cell all round, so every loop closes inside the grid.
  minX -= step;
  minY -= step;
  const nx = Math.ceil((maxX + step - minX) / step) + 1;
  const ny = Math.ceil((maxY + step - minY) / step) + 1;
  const field = new Float64Array(nx * ny);
  for (const b of blobs) {
    const reach = BLOB_FIELD.reach * b.r;
    const i0 = Math.max(0, Math.floor((b.x - reach - minX) / step));
    const i1 = Math.min(nx - 1, Math.ceil((b.x + reach - minX) / step));
    const j0 = Math.max(0, Math.floor((b.y - reach - minY) / step));
    const j1 = Math.min(ny - 1, Math.ceil((b.y + reach - minY) / step));
    for (let j = j0; j <= j1; j++) {
      const dy = minY + j * step - b.y;
      for (let i = i0; i <= i1; i++) {
        const a = BLOB_FIELD.peak * (1 - Math.hypot(minX + i * step - b.x, dy) / reach);
        if (a > 0) field[j * nx + i] += a * a;
      }
    }
  }
  const v = (i: number, j: number) => field[j * nx + i] - BLOB_FIELD.threshold;

  // Marching squares. Crossing points live on grid edges: horizontal edge
  // (i,j)-(i+1,j) is 2*(j*nx+i), vertical edge (i,j)-(i,j+1) is 2*(j*nx+i)+1.
  // Each crossing joins exactly two segments, so loops are walked through that.
  const neighbours = new Map<number, number[]>();
  const join = (a: number, b: number) => {
    (neighbours.get(a) ?? neighbours.set(a, []).get(a)!).push(b);
    (neighbours.get(b) ?? neighbours.set(b, []).get(b)!).push(a);
  };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const tl = v(i, j) > 0;
      const tr = v(i + 1, j) > 0;
      const br = v(i + 1, j + 1) > 0;
      const bl = v(i, j + 1) > 0;
      const top = 2 * (j * nx + i);
      const bottom = 2 * ((j + 1) * nx + i);
      const left = 2 * (j * nx + i) + 1;
      const right = 2 * (j * nx + i + 1) + 1;
      const cut: number[] = [];
      if (tl !== tr) cut.push(top);
      if (tr !== br) cut.push(right);
      if (br !== bl) cut.push(bottom);
      if (bl !== tl) cut.push(left);
      if (cut.length === 2) join(cut[0], cut[1]);
      else if (cut.length === 4) {
        // Saddle: the centre decides whether the two filled corners connect.
        const centre = (v(i, j) + v(i + 1, j) + v(i + 1, j + 1) + v(i, j + 1)) / 4 > 0;
        if (tl === centre) {
          join(top, right);
          join(bottom, left);
        } else {
          join(top, left);
          join(bottom, right);
        }
      }
    }
  }
  const point = (edge: number): Vec => {
    const k = edge >> 1;
    const i = k % nx;
    const j = (k - i) / nx;
    const [i2, j2] = edge & 1 ? [i, j + 1] : [i + 1, j];
    const a = v(i, j);
    const b = v(i2, j2);
    const t = a / (a - b);
    return { x: minX + (i + (i2 - i) * t) * step, y: minY + (j + (j2 - j) * t) * step };
  };
  const loops: Vec[][] = [];
  const seen = new Set<number>();
  for (const start of neighbours.keys()) {
    if (seen.has(start)) continue;
    const loop: Vec[] = [];
    let prev = -1;
    let cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      loop.push(point(cur));
      const [a, b] = neighbours.get(cur)!;
      const next = a !== prev ? a : b;
      prev = cur;
      cur = next;
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}
