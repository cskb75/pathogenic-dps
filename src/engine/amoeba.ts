// The Amoeba's body: blobs grown where the player places them.
//
// Each Ectoplasmic Bulge / Endomembrane Folding pick grows a blob with an
// external / internal slot. A build stores the placements in order; the body
// is rebuilt by replaying them with the game's rules
// (PlayerAmoeba._clamp_to_existing_blobs, AmoebaSlotEvolution):
//   - a blob off the middle line is mirrored: an external slot gets a twin that
//     copies its organelle, an internal slot gets an independent second slot
//   - a new slot connects to up to 3 nearby slots: externals only to internals,
//     internals to anything; never across the middle line, never crossing an
//     existing connection; the closest candidate always, the rest only while
//     they have fewer than 3 connections
//
// Units are editor units (100 game pixels), measured from the first blob's
// centre, with y pointing to the back of the body.

import type { Body, Slot, SlotKind } from './body';
import { PLAN_PIECE } from './body';
import type { Vec } from './geometry';
import type { BodyPlan } from './types';

export interface Growth {
  /** Stable id: slot ids are "Blob<id>" and "Blob<id>Mirror". */
  id: number;
  kind: SlotKind;
  x: number;
  y: number;
}

export interface Blob {
  x: number;
  y: number;
  r: number;
  /** The placement that grew it (absent for the first blob). */
  growthId?: number;
}

export const AMOEBA = {
  /** First blob (INITIAL_BLOB_RADIUS) and each grown blob (AmoebaEvolution.blob_radius). */
  startRadius: 2.2,
  blobRadius: 0.8,
  /** External slots sit this far out from the blob centre, as a share of its radius. */
  externalOut: 0.37,
  /** Within this distance of the middle line a placement snaps onto it and isn't mirrored. */
  mirrorBand: 0.2,
  /** Blobs must overlap the closest blob (max) and not sit on top of any (min), as a share of the two radii. */
  maxDist: 0.54,
  minDist: 0.35,
  maxConnections: 3,
  /** Connection reach, as a multiple of the blob radius; 1.5x further for one link if nothing is in reach. */
  reach: 2.4,
  extendedReach: 1.5,
  /** How close a slot must be to the reflection of another to count as its counterpart. */
  counterpart: 0.12,
} as const;

const dist2 = (a: Vec, b: Vec) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Where a blob placed at `pos` actually lands: snapped to the middle line, overlapping the body. */
export function placeBlob(blobs: Blob[], pos: Vec, radius: number = AMOEBA.blobRadius): Vec {
  let p = { ...pos };
  if (Math.abs(p.x) <= AMOEBA.mirrorBand) p.x = 0;
  if (blobs.length === 0) return p;
  const clampToOverlap = (q: Vec): Vec => {
    let closest = blobs[0];
    for (const b of blobs) if (dist2(q, b) < dist2(q, closest)) closest = b;
    const max = (radius + closest.r) * AMOEBA.maxDist;
    const d = Math.sqrt(dist2(q, closest));
    if (d <= max) return q;
    const dir = d < 1e-5 ? { x: 0, y: -1 } : { x: (q.x - closest.x) / d, y: (q.y - closest.y) / d };
    return { x: closest.x + dir.x * max, y: closest.y + dir.y * max };
  };
  p = clampToOverlap(p);
  for (let i = 0; i < 5; i++) {
    let pushed = false;
    for (const b of blobs) {
      const min = (radius + b.r) * AMOEBA.minDist;
      const d = Math.sqrt(dist2(p, b));
      if (d >= min) continue;
      const dir = d < 1e-5 ? { x: 0, y: -1 } : { x: (p.x - b.x) / d, y: (p.y - b.y) / d };
      p = { x: b.x + dir.x * min, y: b.y + dir.y * min };
      pushed = true;
    }
    if (!pushed) break;
  }
  p = clampToOverlap(p);
  if (Math.abs(p.x) <= AMOEBA.mirrorBand) p.x = 0;
  return p;
}

/** Godot's Geometry2D.segment_intersects_segment (touching counts). */
function segmentsCross(a1: Vec, a2: Vec, b1: Vec, b2: Vec): boolean {
  const B = { x: a2.x - a1.x, y: a2.y - a1.y };
  const len = B.x * B.x + B.y * B.y;
  if (len <= 0) return false;
  const Bn = { x: B.x / len, y: B.y / len };
  const rot = (v: Vec) => ({ x: v.x * Bn.x + v.y * Bn.y, y: v.y * Bn.x - v.x * Bn.y });
  const C = rot({ x: b1.x - a1.x, y: b1.y - a1.y });
  const D = rot({ x: b2.x - a1.x, y: b2.y - a1.y });
  const eps = 1e-9;
  if ((C.y < -eps && D.y < -eps) || (C.y > eps && D.y > eps)) return false;
  if (Math.abs(C.y - D.y) < 1e-12) return false;
  const t = D.x + ((C.x - D.x) * D.y) / (D.y - C.y);
  return t >= 0 && t <= 1;
}

const crossesAxis = (ax: number, bx: number) =>
  Math.abs(ax) > AMOEBA.mirrorBand && Math.abs(bx) > AMOEBA.mirrorBand && Math.sign(ax) !== Math.sign(bx);

/** Mutable slot graph used while replaying placements. */
class Graph {
  slots: Slot[] = [];
  byId = new Map<string, Slot>();
  links = new Map<string, Set<string>>();
  /** Slot id -> its linked mirror twin (external pairs, and the starting ESlot1). */
  partner = new Map<string, string>();

  add(slot: Slot) {
    this.slots.push(slot);
    this.byId.set(slot.id, slot);
    this.links.set(slot.id, new Set());
  }

  link(a: string, b: string) {
    if (a === b) return;
    this.links.get(a)!.add(b);
    this.links.get(b)!.add(a);
  }

  segments(): [Slot, Slot][] {
    const out: [Slot, Slot][] = [];
    for (const [a, set] of this.links) for (const b of set) if (a < b) out.push([this.byId.get(a)!, this.byId.get(b)!]);
    return out;
  }

  /** AmoebaSlotEvolution._find_within_radius */
  nearby(pos: Vec, kind: SlotKind, maxDist: number, maxConn: number, exclude: string[]): string[] {
    const segs = this.segments();
    const candidates: { d: number; slot: Slot; saturated: boolean }[] = [];
    for (const s of this.slots) {
      if (kind === 'external' && s.kind === 'external') continue;
      if (crossesAxis(pos.x, s.position.x)) continue;
      const d = dist2(pos, s.position);
      if (d > maxDist * maxDist) continue;
      if (segs.some(([a, b]) => a.id !== s.id && b.id !== s.id && segmentsCross(pos, s.position, a.position, b.position))) continue;
      const count = [...this.links.get(s.id)!].filter((o) => !exclude.includes(o)).length;
      candidates.push({ d, slot: s, saturated: count >= AMOEBA.maxConnections });
    }
    candidates.sort((a, b) => a.d - b.d);
    const result: string[] = [];
    const pairs = new Set<string>();
    let used = 0;
    candidates.forEach(({ slot, saturated }, i) => {
      if ((i > 0 && saturated) || used >= maxConn) return;
      result.push(slot.id);
      const twin = slot.kind === 'external' ? this.partner.get(slot.id) : undefined;
      if (twin) {
        const key = [slot.id, twin].sort()[0];
        if (!pairs.has(key)) {
          pairs.add(key);
          used++;
        }
      } else used++;
    });
    return result;
  }

  /** AmoebaSlotEvolution._find_compatible_nearby_slots */
  connectTargets(pos: Vec, kind: SlotKind, exclude: string[]): string[] {
    const reach = AMOEBA.blobRadius * AMOEBA.reach;
    const near = this.nearby(pos, kind, reach, AMOEBA.maxConnections, exclude);
    return near.length ? near : this.nearby(pos, kind, reach * AMOEBA.extendedReach, 1, exclude);
  }

  /** The slot that plays `id`'s role on the other side (AmoebaSlotEvolution.mirror_counterpart). */
  counterpart(id: string): string | undefined {
    const s = this.byId.get(id)!;
    if (Math.abs(s.position.x) <= AMOEBA.mirrorBand) return id;
    const twin = this.partner.get(id);
    if (twin) return twin;
    const target = { x: -s.position.x, y: s.position.y };
    let best: string | undefined;
    let bestD = AMOEBA.counterpart ** 2;
    for (const o of this.slots) {
      if (o.id === id || o.kind !== s.kind) continue;
      const d = dist2(o.position, target);
      if (d < bestD) {
        bestD = d;
        best = o.id;
      }
    }
    return best;
  }
}

/** Direction from the nearest existing blob to this one (AmoebaSlotEvolution._away_dir_from_nearest). */
function awayDir(blob: Blob, others: Blob[]): Vec {
  let best: Blob | undefined;
  for (const b of others) if (b !== blob && (!best || dist2(blob, b) < dist2(blob, best))) best = b;
  let dir: Vec;
  if (best && dist2(blob, best) > 1e-10) {
    const d = Math.sqrt(dist2(blob, best));
    dir = { x: (blob.x - best.x) / d, y: (blob.y - best.y) / d };
  } else if (Math.hypot(blob.x, blob.y) > 1e-5) {
    const d = Math.hypot(blob.x, blob.y);
    dir = { x: blob.x / d, y: blob.y / d };
  } else return { x: 0, y: -1 };
  if (Math.abs(blob.x) < 0.005) {
    if (Math.abs(dir.y) < 1e-4) return { x: 0, y: -1 };
    dir = { x: 0, y: Math.sign(dir.y) };
  }
  return dir;
}

export interface AmoebaBody extends Body {
  blobs: Blob[];
}

/** Slot ids a growth creates, in order (the second only when it was mirrored). */
export const growthSlotIds = (g: Growth) => [`Blob${g.id}`, `Blob${g.id}Mirror`];

/** Replays the starting body plus every placement, in order. */
export function buildAmoebaBody(start: BodyPlan, growth: Growth[]): AmoebaBody {
  const g = new Graph();
  const blobs: Blob[] = [{ x: 0, y: 0, r: AMOEBA.startRadius }];
  for (const s of start.slots) {
    g.add({
      id: s.id,
      pieceId: PLAN_PIECE,
      pieceType: PLAN_PIECE,
      kind: s.kind,
      position: { x: s.x, y: s.y },
      ...(s.kind === 'external' ? { facing: { x: Math.cos(s.r), y: Math.sin(s.r) } } : {}),
      ...(s.mirrorOf ? { mirrorOf: s.mirrorOf } : {}),
    });
    if (s.mirrorOf) {
      g.partner.set(s.id, s.mirrorOf);
      g.partner.set(s.mirrorOf, s.id);
    }
  }
  for (const [a, b] of start.links) if (g.byId.has(a) && g.byId.has(b)) g.link(a, b);

  for (const step of growth) {
    const at = placeBlob(blobs, { x: step.x, y: step.y });
    const positions = at.x === 0 ? [at] : [at, { x: -at.x, y: at.y }];
    const before = [...blobs];
    const made: Blob[] = positions.map((p) => ({ ...p, r: AMOEBA.blobRadius, growthId: step.id }));
    blobs.push(...made);
    const [first, second] = growthSlotIds(step);
    const created: string[] = [];
    made.forEach((blob, i) => {
      const id = i === 0 ? first : second;
      const dir = awayDir(blob, before);
      const external = step.kind === 'external';
      const position = external
        ? { x: blob.x + dir.x * blob.r * AMOEBA.externalOut, y: blob.y + dir.y * blob.r * AMOEBA.externalOut }
        : { x: blob.x, y: blob.y };
      let targets: string[];
      if (i === 0) {
        targets = g.connectTargets(position, step.kind, []);
      } else {
        // The mirror half copies the first half's connections, reflected.
        const source = [...g.links.get(created[0])!];
        const mapped = [...new Set(source.map((t) => g.counterpart(t)).filter((t): t is string => !!t && t !== created[0]))];
        targets = source.length === 0 ? [] : mapped.length ? mapped : g.connectTargets(position, step.kind, created);
      }
      g.add({
        id,
        pieceId: PLAN_PIECE,
        pieceType: PLAN_PIECE,
        kind: step.kind,
        position,
        ...(external ? { facing: dir } : {}),
        ...(external && i === 1 ? { mirrorOf: created[0] } : {}),
      });
      if (external && i === 1) {
        g.partner.set(id, created[0]);
        g.partner.set(created[0], id);
      }
      for (const t of targets) g.link(id, t);
      created.push(id);
    });
  }

  const links: [string, string][] = g.segments().map(([a, b]) => [a.id, b.id]);
  const connections = new Map(g.slots.map((s) => [s.id, [...g.links.get(s.id)!]]));
  // The centre body sits near the middle of the blob mass.
  const mass = blobs.reduce((s, b) => s + b.r * b.r, 0);
  const center = { x: 0, y: blobs.reduce((s, b) => s + b.y * b.r * b.r, 0) / mass };
  return {
    placed: [],
    pieceById: new Map(),
    slots: g.slots,
    slotById: g.byId,
    connections,
    links,
    freeEdges: [],
    errors: [],
    plan: start,
    frame: { center, scale: 1 },
    blobs,
  };
}

/** The next free growth id. */
export const nextGrowthId = (growth: Growth[]) => growth.reduce((m, g) => Math.max(m, g.id + 1), 0);
