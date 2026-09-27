// Geometry for modular bodies (Nanobot squares and triangles).
//
// Every piece is a regular polygon with side length 1. The first piece (the
// core) sits at the origin; every other piece is attached to a free edge of a
// piece placed before it. Positions are derived from that attachment tree, so
// a build only has to store "which piece, which edge" for each module.

export interface Vec {
  x: number;
  y: number;
}

export interface PieceInstance {
  id: string;
  /** Piece type id from the class definition (e.g. "core", "square", "triangle"). */
  type: string;
  /** Where this piece is attached. Absent only for the core piece. */
  attach?: { to: string; edge: number };
}

export interface PlacedPiece {
  id: string;
  type: string;
  sides: number;
  vertices: Vec[];
  center: Vec;
}

export const EPS = 1e-6;

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const len = (a: Vec) => Math.hypot(a.x, a.y);
const rotate = (v: Vec, angle: number): Vec => ({
  x: v.x * Math.cos(angle) - v.y * Math.sin(angle),
  y: v.x * Math.sin(angle) + v.y * Math.cos(angle),
});

export const samePoint = (a: Vec, b: Vec) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;

export function centroid(vertices: Vec[]): Vec {
  const sum = vertices.reduce(add, { x: 0, y: 0 });
  return { x: sum.x / vertices.length, y: sum.y / vertices.length };
}

/** +1 or -1 depending on the polygon's winding direction. */
function windingSign(vertices: Vec[]): number {
  return cross(sub(vertices[1], vertices[0]), sub(vertices[2], vertices[1])) > 0 ? 1 : -1;
}

/**
 * Walks a regular polygon starting with the edge a -> b, turning by the
 * exterior angle in direction `turn` at each vertex.
 */
function walkPolygon(a: Vec, b: Vec, sides: number, turn: number): Vec[] {
  const vertices = [a, b];
  let dir = sub(b, a);
  for (let i = 2; i < sides; i++) {
    dir = rotate(dir, (turn * 2 * Math.PI) / sides);
    vertices.push(add(vertices[vertices.length - 1], dir));
  }
  return vertices;
}

/** The core piece: a regular polygon centred on the origin with a flat top edge. */
export function rootVertices(sides: number): Vec[] {
  // Start with the top edge, walking left-to-right, turning clockwise on screen
  // (y grows downward in SVG, so a positive turn is clockwise visually).
  const raw = walkPolygon({ x: -0.5, y: 0 }, { x: 0.5, y: 0 }, sides, 1);
  const c = centroid(raw);
  return raw.map((v) => sub(v, c));
}

export function edgeOf(piece: PlacedPiece, edge: number): [Vec, Vec] {
  return [piece.vertices[edge], piece.vertices[(edge + 1) % piece.sides]];
}

export function edgeMidpoint(piece: PlacedPiece, edge: number): Vec {
  const [a, b] = edgeOf(piece, edge);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Unit vector pointing out of the piece through the given edge. */
export function edgeNormal(piece: PlacedPiece, edge: number): Vec {
  const m = sub(edgeMidpoint(piece, edge), piece.center);
  const l = len(m);
  return { x: m.x / l, y: m.y / l };
}

/** Vertices of a new piece with `sides` sides attached to `edge` of `parent`. */
export function attachedVertices(parent: PlacedPiece, edge: number, sides: number): Vec[] {
  const [a, b] = edgeOf(parent, edge);
  // Walk the shared edge in reverse with the same winding: the new polygon
  // then lies on the far side of the edge from the parent.
  return walkPolygon(b, a, sides, windingSign(parent.vertices));
}

function project(vertices: Vec[], axis: Vec): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of vertices) {
    const p = dot(v, axis);
    min = Math.min(min, p);
    max = Math.max(max, p);
  }
  return [min, max];
}

/**
 * True when two convex polygons overlap with positive area. Polygons that only
 * touch along an edge or at a corner do not count as overlapping.
 */
export function polygonsOverlap(a: Vec[], b: Vec[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const e = sub(poly[(i + 1) % poly.length], poly[i]);
      const axis = { x: -e.y, y: e.x };
      const [minA, maxA] = project(a, axis);
      const [minB, maxB] = project(b, axis);
      if (maxA <= minB + EPS || maxB <= minA + EPS) return false;
    }
  }
  return true;
}

export interface LayoutResult {
  placed: PlacedPiece[];
  /** Pieces that could not be placed (missing parent, bad edge, or overlap). */
  errors: { pieceId: string; reason: string }[];
}

/**
 * Computes absolute geometry for every piece. `sidesOf` maps a piece type id to
 * its number of sides. Pieces must be listed parents-first (the order they
 * were added in).
 */
export function layoutBody(pieces: PieceInstance[], sidesOf: (type: string) => number): LayoutResult {
  const placed: PlacedPiece[] = [];
  const byId = new Map<string, PlacedPiece>();
  const errors: LayoutResult['errors'] = [];

  pieces.forEach((piece, index) => {
    const sides = sidesOf(piece.type);
    let vertices: Vec[];
    if (index === 0) {
      vertices = rootVertices(sides);
    } else {
      const parent = piece.attach && byId.get(piece.attach.to);
      if (!piece.attach || !parent) {
        errors.push({ pieceId: piece.id, reason: 'Parent piece is missing' });
        return;
      }
      if (piece.attach.edge < 0 || piece.attach.edge >= parent.sides) {
        errors.push({ pieceId: piece.id, reason: 'Attachment edge does not exist' });
        return;
      }
      vertices = attachedVertices(parent, piece.attach.edge, sides);
      if (placed.some((p) => polygonsOverlap(p.vertices, vertices))) {
        errors.push({ pieceId: piece.id, reason: 'Overlaps another piece' });
        return;
      }
    }
    const result: PlacedPiece = { id: piece.id, type: piece.type, sides, vertices, center: centroid(vertices) };
    placed.push(result);
    byId.set(piece.id, result);
  });

  return { placed, errors };
}

function edgesCoincide(a: [Vec, Vec], b: [Vec, Vec]): boolean {
  return (samePoint(a[0], b[0]) && samePoint(a[1], b[1])) || (samePoint(a[0], b[1]) && samePoint(a[1], b[0]));
}

export interface SharedEdge {
  a: string;
  aEdge: number;
  b: string;
  bEdge: number;
}

/** Every pair of edges (on different pieces) that lie on top of each other. */
export function findSharedEdges(placed: PlacedPiece[]): SharedEdge[] {
  const shared: SharedEdge[] = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const p = placed[i];
      const q = placed[j];
      // Cheap reject: centres of neighbouring unit polygons are closer than 2.
      if (len(sub(p.center, q.center)) > 2) continue;
      for (let e = 0; e < p.sides; e++) {
        for (let f = 0; f < q.sides; f++) {
          if (edgesCoincide(edgeOf(p, e), edgeOf(q, f))) shared.push({ a: p.id, aEdge: e, b: q.id, bEdge: f });
        }
      }
    }
  }
  return shared;
}

/** Edges (of the given candidate polygon) that would cover these existing edges. */
export function coveredEdges(placed: PlacedPiece[], candidate: Vec[]): { pieceId: string; edge: number }[] {
  const out: { pieceId: string; edge: number }[] = [];
  for (const p of placed) {
    for (let e = 0; e < p.sides; e++) {
      const pe = edgeOf(p, e);
      for (let f = 0; f < candidate.length; f++) {
        if (edgesCoincide(pe, [candidate[f], candidate[(f + 1) % candidate.length]])) out.push({ pieceId: p.id, edge: e });
      }
    }
  }
  return out;
}
