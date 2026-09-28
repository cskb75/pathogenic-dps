// Game art: organelle and mutation icons from pathogenic.wiki; body sprites,
// plasmid icons and class textures from the game files,
// served from public/art (see tools/extract).

import { useState, type CSSProperties } from 'react';
import type { BodyPlan, Category, ClassDef, GameData, PlasmidDef, SlotKind } from '../engine/types';

/** URL for a file under public/. */
export const art = (path: string) => `${import.meta.env.BASE_URL}${path}`;

export const organelleIcon = (id: string) => art(`art/organelles/${id}.webp`);
export const mutationIcon = (id: string) => art(`art/mutations/${id}.webp`);

/** The game's UI art (frames, type icons, plasmid menu), from tools/extract/ui_art.py. */
export const uiArt = (name: string) => art(`art/ui/${name}.webp`);

/** The icon the game's tooltip shows for an organelle's type; some types have an external variant. */
export function typeIconName(category: Category, slot: SlotKind): string {
  const external = slot === 'external';
  switch (category) {
    case 'weapon':
      return 'type-weapons';
    case 'infuser':
      return 'type-modifiers';
    case 'mitochondrion':
      return external ? 'type-mitochondria-external' : 'type-mitochondria';
    case 'active':
      return external ? 'type-actives-external' : 'type-actives';
    case 'flagellum':
    case 'pseudopod':
      return 'type-lashes';
    default:
      return external ? 'type-support-external' : 'type-support';
  }
}

/** A small organelle type icon (the icons are 7:10). */
export function TypeIcon({ category, slot, height = 20 }: { category: Category; slot: SlotKind; height?: number }) {
  return <img className="type-icon" src={uiArt(typeIconName(category, slot))} width={Math.round(height * 0.7)} height={height} alt="" draggable={false} />;
}

/** Plasmids that start you with a mutation have no icon of their own: they use the mutation's. */
export function plasmidIcon(p: PlasmidDef, data: GameData): string {
  if (p.icon) return art(p.icon);
  return p.mutation && data.mutations.some((m) => m.id === p.mutation) ? mutationIcon(p.mutation) : '';
}

interface IconProps {
  src: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/** A decorative icon that disappears if its file is missing. */
export function Icon({ src, size = 32, className = '', style }: IconProps) {
  const [broken, setBroken] = useState<string | null>(null);
  if (broken === src) return <span className={`icon icon-missing ${className}`} style={{ width: size, height: size, ...style }} aria-hidden="true" />;
  return (
    <img
      className={`icon ${className}`}
      src={src}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setBroken(src)}
      style={style}
    />
  );
}

/** The area around a body plan's slots: long tails and wide lobes are cropped. */
export function planFrame(plan: BodyPlan, pad: number) {
  const xs = plan.slots.map((s) => s.x);
  const ys = plan.slots.map((s) => s.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

/** A body's sprite, cropped to its slots. */
export function PlanThumb({ plan, size }: { plan: BodyPlan; size: number }) {
  const f = planFrame(plan, 0.35);
  const s = plan.sprite;
  // Square frame, centred on the slots.
  const side = Math.max(f.w, f.h);
  const vb = `${f.x - (side - f.w) / 2} ${f.y - (side - f.h) / 2} ${side} ${side}`;
  return (
    <svg className="portrait" width={size} height={size} viewBox={vb} aria-hidden="true">
      {s && <image href={art(s.src)} x={s.x} y={s.y} width={s.w} height={s.h} preserveAspectRatio="none" />}
    </svg>
  );
}

/** A pathogen's portrait: its starting body, or a drawing for modular bodies. */
export function ClassPortrait({ cls, data, size = 56 }: { cls: ClassDef; data: GameData; size?: number }) {
  const start = cls.body.kind === 'evolving' ? data.bodies[cls.body.start] : undefined;
  if (cls.body.kind === 'freeform') return <Icon src={art('art/classes/amoeba.webp')} size={size} className="portrait" />;
  if (start?.sprite) return <PlanThumb plan={start} size={size} />;
  if (cls.portrait) return <Icon src={art(cls.portrait)} size={size} className="portrait" />;
  return (
    <svg className="portrait" width={size} height={size} viewBox="-2 -2 4 4" aria-hidden="true">
      <polygon points="-0.6,-0.6 0.6,-0.6 0.6,0.6 -0.6,0.6" className="nb-core" />
      <polygon points="0.6,-0.6 0.6,0.6 1.64,0" className="nb-tri" />
      <polygon points="-0.6,-0.6 -0.6,0.6 -1.64,0" className="nb-tri" />
      <polygon points="-0.6,-0.6 0.6,-0.6 0.6,-1.8 -0.6,-1.8" className="nb-square" />
      <polygon points="-0.6,0.6 0.6,0.6 0,1.64" className="nb-tri" />
      <circle r="0.3" className="nb-slot" />
    </svg>
  );
}
