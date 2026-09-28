import { describe, expect, it } from 'vitest';
import { buildBody, centerSlotId, edgeSlotId, placementOptions, removePieceTree, type PieceShape } from './body';
import { layoutBody, polygonsOverlap, rootVertices, type PieceInstance } from './geometry';

const shapes: Record<string, PieceShape> = {
  core: { sides: 4, centerSlot: 'internal', edgeSlot: 'external' },
  square: { sides: 4, centerSlot: 'internal', edgeSlot: 'external' },
  triangle: { sides: 3, centerSlot: 'internal', edgeSlot: 'external' },
};
const shapeOf = (t: string) => shapes[t];
const sidesOf = (t: string) => shapes[t].sides;

describe('geometry', () => {
  it('places the core as a unit square centred on the origin', () => {
    const vs = rootVertices(4);
    expect(vs).toHaveLength(4);
    for (const v of vs) {
      expect(Math.abs(v.x)).toBeCloseTo(0.5);
      expect(Math.abs(v.y)).toBeCloseTo(0.5);
    }
  });

  it('attaches a square to each side of the core without overlap', () => {
    const pieces: PieceInstance[] = [
      { id: 'c', type: 'core' },
      ...[0, 1, 2, 3].map((e) => ({ id: `s${e}`, type: 'square', attach: { to: 'c', edge: e } })),
    ];
    const { placed, errors } = layoutBody(pieces, sidesOf);
    expect(errors).toEqual([]);
    expect(placed).toHaveLength(5);
    const centers = placed.slice(1).map((p) => [Math.round(p.center.x), Math.round(p.center.y)].join(','));
    expect(new Set(centers)).toEqual(new Set(['0,-1', '1,0', '0,1', '-1,0']));
  });

  it('attaches an equilateral triangle outside the parent', () => {
    const pieces: PieceInstance[] = [
      { id: 'c', type: 'core' },
      { id: 't', type: 'triangle', attach: { to: 'c', edge: 0 } },
    ];
    const { placed, errors } = layoutBody(pieces, sidesOf);
    expect(errors).toEqual([]);
    const tri = placed[1];
    expect(polygonsOverlap(placed[0].vertices, tri.vertices)).toBe(false);
    // Triangle apex is sqrt(3)/2 from the shared edge, away from the core centre.
    const apexDistance = Math.max(...tri.vertices.map((v) => Math.hypot(v.x, v.y)));
    expect(apexDistance).toBeCloseTo(0.5 + Math.sqrt(3) / 2);
  });

  it('uses edge 0 of an attached piece as the shared edge', () => {
    // Attaching back onto edge 0 would put a square right on top of the core.
    const { errors } = layoutBody(
      [
        { id: 'c', type: 'core' },
        { id: 'a', type: 'square', attach: { to: 'c', edge: 1 } },
        { id: 'b', type: 'square', attach: { to: 'a', edge: 0 } },
      ],
      sidesOf,
    );
    expect(errors).toEqual([{ pieceId: 'b', reason: 'Overlaps another piece' }]);
  });

  it('rejects a second triangle squeezed into a 90 degree gap', () => {
    // Core + right square + bottom square leave a 90 degree notch at the
    // bottom-right corner. One triangle (60 degrees) fits there; two do not.
    const base = buildBody([{ id: 'c', type: 'core' }], shapeOf);
    const right = base.slots.find((s) => s.facing && s.facing.x > 0.9)!.edge!;
    const down = base.slots.find((s) => s.facing && s.facing.y > 0.9)!.edge!;
    const pieces: PieceInstance[] = [
      { id: 'c', type: 'core' },
      { id: 'r', type: 'square', attach: { to: 'c', edge: right } },
      { id: 'd', type: 'square', attach: { to: 'c', edge: down } },
    ];
    const mid = buildBody(pieces, shapeOf);
    const rDown = mid.slots.find((s) => s.pieceId === 'r' && s.facing && s.facing.y > 0.9)!.edge!;
    const dRight = mid.slots.find((s) => s.pieceId === 'd' && s.facing && s.facing.x > 0.9)!.edge!;
    const { errors } = layoutBody(
      [
        ...pieces,
        { id: 't1', type: 'triangle', attach: { to: 'r', edge: rDown } },
        { id: 't2', type: 'triangle', attach: { to: 'd', edge: dRight } },
      ],
      sidesOf,
    );
    expect(errors).toEqual([{ pieceId: 't2', reason: 'Overlaps another piece' }]);
  });
});

describe('slot graph', () => {
  it('gives a lone core one internal slot and four external slots', () => {
    const body = buildBody([{ id: 'c', type: 'core' }], shapeOf);
    expect(body.slots.filter((s) => s.kind === 'internal')).toHaveLength(1);
    expect(body.slots.filter((s) => s.kind === 'external')).toHaveLength(4);
    expect(body.connections.get(centerSlotId('c'))).toHaveLength(4);
  });

  it('removes the covered edge slots and links neighbouring centres', () => {
    const body = buildBody(
      [
        { id: 'c', type: 'core' },
        { id: 's', type: 'square', attach: { to: 'c', edge: 1 } },
      ],
      shapeOf,
    );
    expect(body.slotById.has(edgeSlotId('c', 1))).toBe(false);
    // 3 free edges on each square
    expect(body.slots.filter((s) => s.kind === 'external')).toHaveLength(6);
    expect(body.connections.get(centerSlotId('c'))).toContain(centerSlotId('s'));
    // Side edges reach both centres; the far edge faces away from the core and reaches only its own.
    const far = body.slots.find((s) => s.pieceId === 's' && s.facing && s.facing.x > 0.9)!;
    expect(body.connections.get(far.id)).toEqual([centerSlotId('s')]);
    const side = body.slots.find((s) => s.pieceId === 's' && s.facing && s.facing.y < -0.9)!;
    expect(body.connections.get(side.id)).toEqual([centerSlotId('s'), centerSlotId('c')]);
    // The body's centre is the average of the module centres; a module is 102.4 game pixels.
    expect(body.frame.center.x).toBeCloseTo(0.5);
    expect(body.frame.scale).toBeCloseTo(1.024);
  });

  it('detects edges shared with pieces other than the parent (closing a ring)', () => {
    // 2x2 block: core, right, below, and below-right attached to "right".
    const base = buildBody([{ id: 'c', type: 'core' }], shapeOf);
    const right = base.slots.find((s) => s.facing && s.facing.x > 0.9)!.edge!;
    const down = base.slots.find((s) => s.facing && s.facing.y > 0.9)!.edge!;
    const pieces: PieceInstance[] = [
      { id: 'c', type: 'core' },
      { id: 'r', type: 'square', attach: { to: 'c', edge: right } },
      { id: 'd', type: 'square', attach: { to: 'c', edge: down } },
    ];
    const mid = buildBody(pieces, shapeOf);
    const rDown = mid.slots.find((s) => s.pieceId === 'r' && s.facing && s.facing.y > 0.9)!.edge!;
    const body = buildBody([...pieces, { id: 'x', type: 'square', attach: { to: 'r', edge: rDown } }], shapeOf);
    expect(body.errors).toEqual([]);
    expect(body.connections.get(centerSlotId('x'))).toEqual(expect.arrayContaining([centerSlotId('r'), centerSlotId('d')]));
    // Ring of 4 squares: 8 free edges in total.
    expect(body.slots.filter((s) => s.kind === 'external')).toHaveLength(8);
  });

  it('reports which occupied external slots a placement would cover', () => {
    const base = buildBody([{ id: 'c', type: 'core' }], shapeOf);
    const options = placementOptions(base, 4, new Set([edgeSlotId('c', 0)]));
    expect(options.every((o) => o.valid)).toBe(true);
    expect(options.find((o) => o.edge === 0)!.covers).toEqual([edgeSlotId('c', 0)]);
    expect(options.filter((o) => o.covers.length === 0)).toHaveLength(3);
  });

  it('removes a piece together with everything attached to it', () => {
    const pieces: PieceInstance[] = [
      { id: 'c', type: 'core' },
      { id: 'a', type: 'square', attach: { to: 'c', edge: 0 } },
      { id: 'b', type: 'triangle', attach: { to: 'a', edge: 2 } },
      { id: 'd', type: 'square', attach: { to: 'c', edge: 2 } },
    ];
    expect(removePieceTree(pieces, 'a').map((p) => p.id)).toEqual(['c', 'd']);
  });
});
