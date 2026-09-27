// Turns a list of pieces into the slot graph the calculator works on.
//
// Each piece has an internal slot in its centre and an external slot on every
// edge that is not covered by another piece. Connectors are fixed by the
// geometry:
//   - a piece's centre slot connects to each external slot on its own edges
//   - centre slots of two pieces that share an edge connect to each other

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
}

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
  for (const s of shared) {
    const a = pieceById.get(s.a)!;
    const b = pieceById.get(s.b)!;
    if (shapeOf(a.type).centerSlot && shapeOf(b.type).centerSlot) links.push([centerSlotId(a.id), centerSlotId(b.id)]);
  }

  const connections = new Map<string, string[]>(slots.map((s) => [s.id, []]));
  for (const [a, b] of links) {
    connections.get(a)!.push(b);
    connections.get(b)!.push(a);
  }

  return { placed, pieceById, slots, slotById: new Map(slots.map((s) => [s.id, s])), connections, links, freeEdges, errors };
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
