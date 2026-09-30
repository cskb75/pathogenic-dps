// A pathogen as the game's character select shows it: its starting body with
// the hairs its scene attaches (the Bacterium's eyes, cilia and tails, the
// Fungal Spore's bristles, the Helminth's feelers), swaying the way hair.gd
// moves them, and the whole thing bobbing in its tube (tube.gd). Organelle
// slots aren't shown, as in the game. Data: tools/extract/specimens.py.

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { buildAmoebaBody } from '../engine/amoeba';
import { blobOutline } from '../engine/amoebaShape';
import { buildBody } from '../engine/body';
import type { ClassDef, GameData } from '../engine/types';
import specimenData from '../data/specimens.json';
import { BlobArt, BodyArt, loopsPath, PieceArt, S } from './bodyArt';
import { useTick } from './clock';
import { HairRest } from './motion';
import { Line, type Update } from './OrganelleMotion';
import type { ArtLayer } from './organelleArt';

/** A hair (scn/cells/hair.tscn), in editor units from the body's centre; +x along the hair at `rot`. */
export interface HairDef {
  x: number;
  y: number;
  rot: number;
  n: number;
  seg: number;
  width: number;
  /** Width along the hair (its width curve), per point. */
  widths?: number[];
  stiffness: number;
  fluidity: number;
  sway: number;
  /** An untextured hair's colour; textured ones draw their texture along the line. */
  color?: string;
  src?: string;
  caps?: [number, number];
  /** Drawn behind the body. */
  behind?: boolean;
}

export interface SpecimenDef {
  /** The tube's player_scale: how big the game shows it. */
  scale: number;
  /** The colour of the light under its tube. */
  light?: string;
  hairs: HairDef[];
}

const SPECIMENS = specimenData as unknown as Record<string, SpecimenDef>;
export const specimenOf = (classId: string): SpecimenDef => SPECIMENS[classId] ?? { scale: 1, hairs: [] };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxOf(pts: { x: number; y: number }[], pad = 0): Box {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

/** The starting body's art and the box it fills, in editor units. Hairs reach past it. */
export function specimenBody(cls: ClassDef, data: GameData): { box: Box; art: ReactNode } {
  if (cls.body.kind === 'evolving') {
    const plan = data.bodies[cls.body.start];
    const s = plan.sprite;
    const box = s ? { x: s.x, y: s.y, w: s.w, h: s.h } : boxOf(plan.outline.map(([x, y]) => ({ x, y })));
    return { box, art: <BodyArt plan={plan} /> };
  }
  if (cls.body.kind === 'freeform') {
    const loops = blobOutline(buildAmoebaBody(data.bodies[cls.body.start], []).blobs);
    // The outline rings reach 12 game pixels past the blob.
    return { box: boxOf(loops.flat(), 0.12), art: <BlobArt path={loopsPath(loops)} /> };
  }
  const shapes = new Map(cls.body.pieceTypes.map((p) => [p.id, p]));
  const core = buildBody([{ id: 'core', type: cls.body.corePiece }], (t) => shapes.get(t) ?? { sides: 4, centerSlot: 'internal', edgeSlot: 'external' });
  const piece = core.placed[0];
  return { box: boxOf(piece.vertices, 0.03), art: <PieceArt vertices={piece.vertices} center={piece.center} /> };
}

/** tube.gd: the pathogen bobs 25 game pixels up and down, sin(t / 2) at a random 0.9-1.1 x speed. */
export const BOB = { amp: 0.25, rate: 0.5 };

/** A pathogen in its own frame (editor units x S, the body's box centred on the origin), moving while a clock runs. */
export function Specimen({ cls, data }: { cls: ClassDef; data: GameData }) {
  const { box, art } = useMemo(() => specimenBody(cls, data), [cls, data]);
  const spec = specimenOf(cls.id);
  const [speed] = useState(() => 0.9 + Math.random() * 0.2);
  const bob = useRef<SVGGElement>(null);
  useTick((_dt, now) => bob.current?.setAttribute('transform', `translate(0 ${(Math.sin(now * BOB.rate * speed) * BOB.amp * S).toFixed(2)})`));
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return (
    <g ref={bob}>
      <g transform={`translate(${-cx * S} ${-cy * S})`}>
        {spec.hairs.map((h, i) => (h.behind ? <Hair key={i} hair={h} /> : null))}
        {art}
        {spec.hairs.map((h, i) => (h.behind ? null : <Hair key={i} hair={h} />))}
      </g>
    </g>
  );
}

function Hair({ hair }: { hair: HairDef }) {
  const layer: ArtLayer = useMemo(
    () => ({ src: hair.src, chain: { x: 0, y: 0, n: hair.n, seg: hair.seg, width: hair.width, caps: hair.caps ?? [2, 2], widths: hair.widths } }),
    [hair],
  );
  const sim = useMemo(() => new HairRest(hair), [hair]);
  const update: Update = useRef(null);
  useTick((dt) => {
    sim.step(dt);
    update.current?.(sim.pts);
  });
  return (
    <g className="hair" transform={`translate(${hair.x * S} ${hair.y * S}) rotate(${(hair.rot * 180) / Math.PI}) scale(${S})`}>
      <Line layer={layer} pts={sim.pts} update={update} paint={{ color: hair.color }} />
    </g>
  );
}
