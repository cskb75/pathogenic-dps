// How much each organelle would change your DPS in a slot, for the organelle
// list: worked out a few at a time between frames, so the page stays
// responsive (each is a full calculation, two in simple mode).

import { useEffect, useState } from 'react';
import { dpsRange, withOrganelle } from '../engine/simple';
import type { Build, GameData } from '../engine/types';

/** The change in single-target DPS: [floor, ceiling] in simple mode, the same number twice in detailed. */
export type Delta = [number, number];

/** Milliseconds of work per slice. */
const SLICE_MS = 8;

export function useDeltas(build: Build, data: GameData, source: string | null, ids: string[]): Map<string, Delta> {
  const [deltas, setDeltas] = useState<Map<string, Delta>>(() => new Map());
  const key = ids.join(',');
  useEffect(() => {
    setDeltas(new Map());
    if (!source || ids.length === 0) return;
    const out = new Map<string, Delta>();
    const [lo, hi] = dpsRange(build, data);
    let i = 0;
    let timer = 0;
    const step = () => {
      const start = performance.now();
      while (i < ids.length && performance.now() - start < SLICE_MS) {
        const [a, b] = dpsRange(withOrganelle(build, source, ids[i]), data);
        out.set(ids[i], [a - lo, b - hi]);
        i++;
      }
      setDeltas(new Map(out));
      if (i < ids.length) timer = window.setTimeout(step, 0);
    };
    timer = window.setTimeout(step, 0);
    return () => window.clearTimeout(timer);
    // `ids` is covered by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build, data, source, key]);
  return deltas;
}

/** "+42", "−8", "±0", or a range "+12 to +40" when the two ends differ. */
export function formatDelta([lo, hi]: Delta): string {
  const one = (v: number) => {
    const n = Math.round(v);
    return n > 0 ? `+${n.toLocaleString()}` : n < 0 ? `−${(-n).toLocaleString()}` : '±0';
  };
  return Math.round(lo) === Math.round(hi) ? one(hi) : `${one(lo)} to ${one(hi)}`;
}

/** Up at both ends, down at both, some of each, or no change. */
export function deltaTone([lo, hi]: Delta): 'up' | 'down' | 'mixed' | 'flat' {
  const [a, b] = [Math.round(lo), Math.round(hi)];
  if (a === 0 && b === 0) return 'flat';
  if (a >= 0 && b >= 0) return 'up';
  if (a <= 0 && b <= 0) return 'down';
  return 'mixed';
}
