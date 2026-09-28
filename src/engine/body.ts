// Turns a body into the slot graph the calculator works on.
//
// Modular bodies (Nanobot) are built from pieces. Each piece has an internal
// slot in its centre and an external slot on every edge that is not covered
// by another piece. Connectors are fixed by the geometry, as in the game
// (PlayerNanobot._rebuild_external_internal_connections):
//   - an external slot connects to its own piece's centre slot, and to the
//     centre slot of every piece sharing an edge with its piece, unless its own
//     centre sits on the straight line between them (the slot faces away)
//   - centre slots of two pieces that share an edge connect to each other
//
// Other classes have fixed layouts (body plans) extracted from the game, with
// their own connections, built-in special slots and mirrored slots.

import {
  coveredEdges,
  edgeMidpoint,
  edgeNormal,
  findSharedEdges,
  layoutBody,
  attachedVertices,
  polygonsOverlap,
  type PieceInstance,
  type PlacedPiece,
  type Vec,
} from './geometry';
import type { BodyPlan, SpecialSlot } from './types';

export type SlotKind = 'internal' | 'external';

export interface PieceShape {
  sides: number;
  /** Kind of slot in the centre of the piece, or null for none. */
  centerSlot: SlotKind | null;
  /** Kind of slot on each free edge, or null for none. */
  edgeSlot: SlotKind | null;
}

export interface Slot {
  id: string;
  pieceId: string;
  pieceType: string;
  kind: SlotKind;
  position: Vec;
  /** Direction an external slot faces (out of the body). */
  facing?: Vec;
  edge?: number;
  /** Built into the body: acts like a graft. */
  special?: SpecialSlot;
  /** Mirrored twin of this slot: holds a copy of its organelle. */
  mirrorOf?: string;
}

/** Game pixels per editor unit of modular pieces (the Nanobot's BLOCK_SIZE). */
export const MODULE_PX = 102.4;

export interface Body {
  placed: PlacedPiece[];
  pieceById: Map<string, PlacedPiece>;
  slots: Slot[];
  slotById: Map<string, Slot>;
  /** Slot id -> ids of slots it is connected to. */
  connections: Map<string, string[]>;
  /** Each connector once, for drawing. */
  links: [string, string][];
  freeEdges: { pieceId: string; edge: number }[];
  errors: { pieceId: string; reason: string }[];
  /** Fixed layouts: the body plan (outline, sprite). */
  plan?: BodyPlan;
  /**
   * The body's centre, and hundreds of game pixels per editor unit. Effects
   * that care where a slot is ("the right half") measure (position - center) * scale.
   */
  frame: { center: Vec; scale: number };
}

export const centerSlotId = (pieceId: string) => `${pieceId}.c`;
export const edgeSlotId = (pieceId: string, edge: number) => `${pieceId}.e${edge}`;

export function buildBody(pieces: PieceInstance[], shapeOf: (type: string) => PieceShape): Body {
  const { placed, errors } = layoutBody(pieces, (t) => shapeOf(t).sides);
  const shared = findSharedEdges(placed);
  const covered = new Set<string>();
  for (const s of shared) {
    covered.add(`${s.a}:${s.aEdge}`);
    covered.add(`${s.b}:${s.bEdge}`);
  }

  const slots: Slot[] = [];
  const links: [string, string][] = [];
  const freeEdges: Body['freeEdges'] = [];

  for (const piece of placed) {
    const shape = shapeOf(piece.type);
    const center = shape.centerSlot ? centerSlotId(piece.id) : null;
    if (shape.centerSlot) {
      slots.push({ id: center!, pieceId: piece.id, pieceType: piece.type, kind: shape.centerSlot, position: piece.center });
    }
    for (let e = 0; e < piece.sides; e++) {
      if (covered.has(`${piece.id}:${e}`)) continue;
      freeEdges.push({ pieceId: piece.id, edge: e });
      if (!shape.edgeSlot) continue;
      const id = edgeSlotId(piece.id, e);
      slots.push({
        id,
        pieceId: piece.id,
        pieceType: piece.type,
        kind: shape.edgeSlot,
        position: edgeMidpoint(piece, e),
        facing: edgeNormal(piece, e),
        edge: e,
      });
      if (center) links.push([center, id]);
    }
  }

  const pieceById = new Map(placed.map((p) => [p.id, p]));
  const neighbours = new Map<string, PlacedPiece[]>(placed.map((p) => [p.id, []]));
  for (const s of shared) {
    const a = pieceById.get(s.a)!;
    const b = pieceById.get(s.b)!;
    neighbours.get(a.id)!.push(b);
    neighbours.get(b.id)!.push(a);
    if (shapeOf(a.type).centerSlot && shapeOf(b.type).centerSlot) links.push([centerSlotId(a.id), centerSlotId(b.id)]);
  }
  for (const slot of slots) {
    if (slot.edge === undefined) continue;
    const own = pieceById.get(slot.pieceId)!;
    for (const n of neighbours.get(own.id)!) {
      if (!shapeOf(n.type).centerSlot || passesThrough(slot.position, n.center, own.center)) continue;
      links.push([slot.id, centerSlotId(n.id)]);
    }
  }

  const connections = new Map<string, string[]>(slots.map((s) => [s.id, []]));
  for (const [a, b] of links) {
    connections.get(a)!.push(b);
    connections.get(b)!.push(a);
  }

  // The game's centre body is the average of the block centres.
  const center = placed.length
    ? { x: placed.reduce((s, p) => s + p.center.x, 0) / placed.length, y: placed.reduce((s, p) => s + p.center.y, 0) / placed.length }
    : { x: 0, y: 0 };
  return {
    placed,
    pieceById,
    slots,
    slotById: new Map(slots.map((s) => [s.id, s])),
    connections,
    links,
    freeEdges,
    errors,
    frame: { center, scale: MODULE_PX / 100 },
  };
}

/**
 * Whether `point` lies on the segment a -> b (away from its ends), within a
 * tenth of a module: the game's test for a slot facing away from a neighbour.
 */
function passesThrough(a: Vec, b: Vec, point: Vec): boolean {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const lenSq = ab.x * ab.x + ab.y * ab.y;
  if (lenSq < 1e-4) return false;
  const t = ((point.x - a.x) * ab.x + (point.y - a.y) * ab.y) / lenSq;
  if (t <= 0.05 || t >= 0.95) return false;
  return Math.hypot(a.x + ab.x * t - point.x, a.y + ab.y * t - point.y) < 0.1;
}

/** Pseudo piece id for slots on a fixed layout. */
export const PLAN_PIECE = 'body';

export function buildPlanBody(plan: BodyPlan): Body {
  const slots: Slot[] = plan.slots.map((s) => ({
    id: s.id,
    pieceId: PLAN_PIECE,
    pieceType: PLAN_PIECE,
    kind: s.kind,
    position: { x: s.x, y: s.y },
    ...(s.kind === 'external' ? { facing: { x: Math.cos(s.r), y: Math.sin(s.r) } } : {}),
    ...(s.special ? { special: s.special } : {}),
    ...(s.mirrorOf ? { mirrorOf: s.mirrorOf } : {}),
  }));
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const links = plan.links.filter(([a, b]) => slotById.has(a) && slotById.has(b));
  const connections = new Map<string, string[]>(slots.map((s) => [s.id, []]));
  for (const [a, b] of links) {
    connections.get(a)!.push(b);
    connections.get(b)!.push(a);
  }
  // Plans are already centred on the body's centre, in hundreds of game pixels.
  return { placed: [], pieceById: new Map(), slots, slotById, connections, links, freeEdges: [], errors: [], plan, frame: { center: { x: 0, y: 0 }, scale: 1 } };
}

export interface PlacementOption {
  pieceId: string;
  edge: number;
  vertices: Vec[];
  /** False when the new piece would overlap an existing one. */
  valid: boolean;
  /** External slots (from `occupied`) the new piece would cover up. */
  covers: string[];
}

/**
 * Where a new piece with `sides` sides could go. `occupied` holds slot ids
 * that have an organelle in them, so the caller can warn before covering one.
 */
export function placementOptions(body: Body, sides: number, occupied: Set<string>): PlacementOption[] {
  return body.freeEdges.map(({ pieceId, edge }) => {
    const parent = body.pieceById.get(pieceId)!;
    const vertices = attachedVertices(parent, edge, sides);
    const valid = !body.placed.some((p) => polygonsOverlap(p.vertices, vertices));
    const covers = valid
      ? coveredEdges(body.placed, vertices)
          .map((c) => edgeSlotId(c.pieceId, c.edge))
          .filter((id) => occupied.has(id))
      : [];
    return { pieceId, edge, vertices, valid, covers };
  });
}

/** Removes a piece and everything attached to it (directly or indirectly). */
export function removePieceTree(pieces: PieceInstance[], pieceId: string): PieceInstance[] {
  const doomed = new Set([pieceId]);
  for (const p of pieces) {
    if (p.attach && doomed.has(p.attach.to)) doomed.add(p.id);
  }
  return pieces.filter((p) => !doomed.has(p.id));
}
