// Rarity outlines, the way scn/shaders/outline.gdshader draws them: the
// texture's alpha, sampled at 24 offsets (12 at the full radius, 12 at half,
// turned 15°), in the outline colour, under the texture. Each (texture, colour,
// radius) is baked once on a canvas into an image drawn beneath the texture, so
// a moving organelle costs no filter work per frame.

import { useEffect, useState } from 'react';

const RING: [number, number][] = [
  [1, 0], [0.86603, 0.5], [0.5, 0.86603], [0, 1], [-0.5, 0.86603], [-0.86603, 0.5],
  [-1, 0], [-0.86603, -0.5], [-0.5, -0.86603], [0, -1], [0.5, -0.86603], [0.86603, -0.5],
  [0.48296, 0.12941], [0.35355, 0.35355], [0.12941, 0.48296], [-0.12941, 0.48296], [-0.35355, 0.35355], [-0.48296, 0.12941],
  [-0.48296, -0.12941], [-0.35355, -0.35355], [-0.12941, -0.48296], [0.12941, -0.48296], [0.35355, -0.35355], [0.48296, -0.12941],
];

export interface Outline {
  /** The outline image: the texture's size plus `pad` texels all round. */
  url: string;
  pad: number;
  /** The texture's size in texels. */
  w: number;
  h: number;
}

const baked = new Map<string, Promise<Outline | null>>();

function bake(src: string, color: string, radius: number): Promise<Outline | null> {
  const key = `${src}|${color}|${radius}`;
  let job = baked.get(key);
  if (!job) {
    job = (async () => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const pad = Math.ceil(radius) + 1;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth + pad * 2;
      canvas.height = img.naturalHeight + pad * 2;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      for (const [x, y] of RING) ctx.drawImage(img, pad + x * radius, pad + y * radius);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done));
      return blob ? { url: URL.createObjectURL(blob), pad, w: img.naturalWidth, h: img.naturalHeight } : null;
    })().catch(() => null);
    baked.set(key, job);
  }
  return job;
}

/** The outline for a texture in `color`, once it's baked (null until then, or with no colour). */
export function useOutline(src: string | undefined, color: string | undefined, radius: number | undefined): Outline | null {
  const [outline, setOutline] = useState<Outline | null>(null);
  useEffect(() => {
    if (!src || !color || !radius || typeof document === 'undefined') {
      setOutline(null);
      return;
    }
    let live = true;
    bake(src, color, radius).then((o) => live && setOutline(o));
    return () => {
      live = false;
    };
  }, [src, color, radius]);
  return outline;
}
