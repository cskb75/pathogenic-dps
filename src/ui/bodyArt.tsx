// Pathogen bodies as the game draws them: evolving bodies' sprites, the
// Nanobot's module textures and the Amoeba's merged blobs. Shared by the body
// view (BodyEditor.tsx) and the pathogen carousel (Specimen.tsx).

import type { Vec } from '../engine/geometry';
import type { BodyPlan } from '../engine/types';
import { art } from './art';

/** Drawing scale: one editor unit (a Nanobot module side, or 100 game pixels) = 100 SVG units. */
export const S = 100;

/** An SVG path through closed loops (fill it with the evenodd rule, so holes stay holes). */
export const loopsPath = (loops: Vec[][]) => loops.map((l) => `M${l.map((v) => `${(v.x * S).toFixed(1)},${(v.y * S).toFixed(1)}`).join('L')}Z`).join('');

/** An evolving body's sprite (or its outline, when there's no art). */
export function BodyArt({ plan, filter }: { plan: BodyPlan; filter?: string }) {
  if (plan.sprite) {
    const s = plan.sprite;
    return <image href={art(s.src)} x={s.x * S} y={s.y * S} width={s.w * S} height={s.h * S} className="body-art" filter={filter} preserveAspectRatio="none" />;
  }
  if (plan.outline.length > 2) return <polygon className="piece" points={plan.outline.map(([x, y]) => `${x * S},${y * S}`).join(' ')} />;
  return null;
}

/**
 * A Nanobot module's texture. In the game a square's sprite is 1.03 modules
 * wide; a triangle's is 1.06 x 0.94, drawn apex up, 0.15 modules above its centre.
 */
export function PieceArt({ vertices, center }: { vertices: Vec[]; center: Vec }) {
  if (vertices.length === 4) {
    const a = (Math.atan2(vertices[1].y - vertices[0].y, vertices[1].x - vertices[0].x) * 180) / Math.PI;
    const w = 1.029;
    return (
      <image
        href={art('art/classes/nanobot-square.webp')}
        x={(center.x - w / 2) * S}
        y={(center.y - w / 2) * S}
        width={w * S}
        height={w * S}
        transform={`rotate(${a} ${center.x * S} ${center.y * S})`}
        className="piece-art"
        preserveAspectRatio="none"
      />
    );
  }
  if (vertices.length !== 3) return null;
  // Turn the texture's apex toward one of the triangle's corners (all three look alike).
  const apex = vertices[0];
  const a = (Math.atan2(apex.y - center.y, apex.x - center.x) * 180) / Math.PI + 90;
  const w = 1.0615;
  const h = 0.944;
  return (
    <image
      href={art('art/classes/nanobot-triangle.webp')}
      x={(center.x - w / 2 + 0.008) * S}
      y={(center.y - h / 2 - 0.146) * S}
      width={w * S}
      height={h * S}
      transform={`rotate(${a} ${center.x * S} ${center.y * S})`}
      className="piece-art"
      preserveAspectRatio="none"
    />
  );
}

/**
 * The Amoeba's body: its blobs merged into `path` (amoebaShape.ts), filled with
 * the game's pattern and ringed like threshold_outline.gdshader.
 */
export function BlobArt({ path, filter }: { path: string; filter?: string }) {
  return (
    <>
      <defs>
        {/* threshold_outline.gdshader: the pattern tiles 4 times across the 700x1000 px composer,
            whose centre is the first blob, and is tinted by the fill colour (0.7 grey). */}
        <pattern id="amoeba-texture" patternUnits="userSpaceOnUse" x={-350} y={-500} width={175} height={250}>
          <image href={art('art/classes/amoeba-pattern.webp')} width={175} height={250} preserveAspectRatio="none" />
          <rect width={175} height={250} fill="#000" opacity={0.3} />
        </pattern>
      </defs>
      {/* The game's two outline rings sit outside the body: 5 px bright, then 7 px dark. */}
      <g filter={filter}>
        <path d={path} className="blob-outline outer" />
        <path d={path} className="blob-outline inner" />
        <path d={path} className="blob" fillRule="evenodd" />
      </g>
    </>
  );
}
