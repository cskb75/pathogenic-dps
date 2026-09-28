// How organelles look on the body, from the game's own scenes
// (tools/extract/organelle_art.py). Every layer is in the slot's frame, in
// hundreds of game pixels: +x points out of the body along the slot's facing,
// and the round end of an external organelle's texture sits on the slot.

import type { Vec } from '../engine/geometry';
import type { SlotKind } from '../engine/types';
import artData from '../data/organelle_art.json';
import { art } from './art';

export interface ArtLayer {
  /** An image over the rect (x, y, w, h)... */
  src?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** ...placed by this matrix (a b c d e f) when it isn't just the rect. */
  m?: number[];
  /** The texture repeats every `tile` units along x instead of stretching. */
  tile?: number;
  /** A polygon in the pathogen's colour (the plain Flagellum). */
  points?: number[][];
  fill?: 'parasite';
  /** A pattern the game shows only inside the body (internal organelles). */
  masked?: boolean;
  opacity?: number;
}

interface OrganelleArtDef {
  layers: ArtLayer[];
  /** Flagellum colours per pathogen (normal_lash.gd parasite_colors). */
  colors?: number[][];
}

/** Slot sprites per slot type: 'plain', or a graft id (Volatile, Conductive and Omni slots have their own art). */
const DATA = artData as unknown as { slots: Record<string, Record<SlotKind, ArtLayer>>; organelles: Record<string, OrganelleArtDef> };

export const organelleArt = (id: string): OrganelleArtDef | undefined => DATA.organelles[id];
export const slotArt = (kind: SlotKind, type = 'plain'): ArtLayer => (DATA.slots[type] ?? DATA.slots.plain)[kind];

/** The game's pathogen index (G.ParasiteType) for classes the Flagellum has a colour for. */
const PARASITE_INDEX: Record<string, number> = { bacterium: 0, 'fungal-spore': 1, helminth: 2 };

/**
 * The plain Flagellum's colour: the pathogen's colour, brighter with rarity
 * (normal_lash.gd). Pathogens without a colour of their own keep the first.
 */
export function flagellumColor(def: OrganelleArtDef, classId: string, rarity: number): string {
  const colors = def.colors ?? [[0.5, 0.5, 0.5]];
  const index = PARASITE_INDEX[classId];
  const bright = index !== undefined && index < colors.length ? 1 + 0.3 * Math.min(rarity, 4) : 1;
  const c = colors[index !== undefined && index < colors.length ? index : 0];
  const hex = (v: number) =>
    Math.round(Math.min(1, v * bright) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(c[0])}${hex(c[1])}${hex(c[2])}`;
}

function applyMatrix(m: number[] | undefined, x: number, y: number): Vec {
  return m ? { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] } : { x, y };
}

/** Outline points of a layer, in the slot's frame. */
export function layerCorners(l: ArtLayer): Vec[] {
  if (l.points) return l.points.map(([x, y]) => ({ x, y }));
  const { x = 0, y = 0, w = 0, h = 0 } = l;
  return [applyMatrix(l.m, x, y), applyMatrix(l.m, x + w, y), applyMatrix(l.m, x, y + h), applyMatrix(l.m, x + w, y + h)];
}

/** Draws art layers in the slot's frame. */
export function ArtLayers({ layers, color }: { layers: ArtLayer[]; color?: string }) {
  return (
    <>
      {layers.map((l, i) => {
        if (l.points) {
          // The game lights this flat shape; a darker rim gives it the edge the textured organelles have.
          return (
            <polygon
              key={i}
              points={l.points.map((p) => p.join(',')).join(' ')}
              fill={color}
              stroke={color && `color-mix(in srgb, ${color} 45%, black)`}
              strokeWidth={0.03}
              strokeLinejoin="round"
              opacity={l.opacity}
            />
          );
        }
        const { x = 0, y = 0, w = 0, h = 0 } = l;
        const transform = l.m ? `matrix(${l.m.join(' ')})` : undefined;
        if (l.tile) {
          // LINE_TEXTURE_TILE: copies of the texture side by side, cut off at the line's end.
          const copies = Math.ceil(w / l.tile);
          return (
            <g key={i} transform={transform} opacity={l.opacity}>
              <svg x={x} y={y} width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" overflow="hidden">
                {Array.from({ length: copies }, (_, k) => (
                  <image key={k} href={art(l.src!)} x={k * l.tile!} y={0} width={l.tile} height={h} preserveAspectRatio="none" />
                ))}
              </svg>
            </g>
          );
        }
        return <image key={i} href={art(l.src!)} x={x} y={y} width={w} height={h} transform={transform} opacity={l.opacity} preserveAspectRatio="none" />;
      })}
    </>
  );
}
