// Organelles on the body, moving the way the game's organelle editor shows them
// (motion.ts). With animation off they're drawn at rest (organelleArt.tsx).
//
// A bending line is drawn the way Godot's Line2D stretches its texture: the
// texture runs along the line's length, so each segment shows its own slice of
// it. Moving elements are updated in place every frame, not re-rendered.

import { useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { Vec } from '../engine/geometry';
import { art } from './art';
import { fixedSteps, useClock, useTick } from './clock';
import { GunRest, LashRest, PHYSICS_HZ, TentacleRest, type Motion } from './motion';
import { ArtLayers, flatShape, Layer, type ArtLayer, type OrganelleArtDef } from './organelleArt';
import { useOutline, type Outline } from './outline';

type Chain = NonNullable<ArtLayer['chain']>;
export type Update = MutableRefObject<((pts: Vec[]) => void) | null>;
/** The plain Flagellum's colour, and the rarity outline's (none for Common). */
interface Paint {
  color?: string;
  outline?: string;
}

/** An organelle at its slot (in the slot's frame): moving when animation is on and the game moves it. */
export function OrganelleArt({ look, color, outline }: { look: OrganelleArtDef } & Paint) {
  const clock = useClock();
  const m = look.motion;
  const paint = { color, outline };
  if (!clock || !m) return <ArtLayers layers={look.layers.filter((l) => !l.masked)} {...paint} />;
  if (m.kind === 'pulse') return <Pulsing look={look} motion={m} paint={paint} />;
  if (m.kind === 'lash') return <Lashing look={look} motion={m} paint={paint} />;
  return <Bending look={look} motion={m} paint={paint} />;
}

/** Every layer, with `moving` drawn in place of the layers it names. */
function Layers({ look, paint, moving }: { look: OrganelleArtDef; paint: Paint; moving: Record<number, ReactNode> }) {
  return <>{look.layers.map((l, i) => (l.masked ? null : i in moving ? <g key={i}>{moving[i]}</g> : <Layer key={i} layer={l} {...paint} />))}</>;
}

/** Internal organelles: the sprite pulses about the slot's centre (the scene's autoplayed "wiggle"). */
function Pulsing({ look, motion, paint }: { look: OrganelleArtDef; motion: Extract<Motion, { kind: 'pulse' }>; paint: Paint }) {
  // Each organelle starts somewhere in its cycle, so they don't beat together.
  const [begin] = useState(() => -Math.random() * motion.dur);
  const moving: Record<number, ReactNode> = {};
  for (const i of motion.layers) {
    moving[i] = (
      <g>
        <animateTransform
          attributeName="transform"
          type="scale"
          values={motion.scales.join(';')}
          keyTimes={motion.times.map((t) => t / motion.dur).join(';')}
          calcMode="spline"
          keySplines={motion.times
            .slice(1)
            .map(() => '0.45 0 0.55 1')
            .join(';')}
          dur={`${motion.dur}s`}
          begin={`${begin.toFixed(3)}s`}
          repeatCount="indefinite"
        />
        <Layer layer={look.layers[i]} {...paint} />
      </g>
    );
  }
  return <Layers look={look} paint={paint} moving={moving} />;
}

const inChain = (c: Chain, pts: Vec[]) => pts.map((p) => ({ x: c.x + p.x, y: c.y + p.y }));

/** Weapons and pseudopods: their line bends as it sways or wobbles. */
function Bending({ look, motion, paint }: { look: OrganelleArtDef; motion: Extract<Motion, { kind: 'gun' | 'tentacle' }>; paint: Paint }) {
  const layer = look.layers[motion.layer];
  const chain = layer.chain!;
  const sim = useMemo(() => (motion.kind === 'gun' ? new GunRest(motion, chain.n, chain.seg) : new TentacleRest(motion)), [motion, chain]);
  const steps = useMemo(() => fixedSteps(PHYSICS_HZ), []);
  const update: Update = useRef(null);
  useTick((dt, now) => {
    if (sim instanceof GunRest) steps(dt, () => sim.tick(now));
    else sim.step(dt);
    update.current?.(inChain(chain, sim.pts));
  });
  return <Layers look={look} paint={paint} moving={{ [motion.layer]: <Line layer={layer} pts={inChain(chain, sim.pts)} update={update} paint={paint} /> }} />;
}

/** Flagella: the connector flutters about its end at the slot, the body trailing behind. */
function Lashing({ look, motion, paint }: { look: OrganelleArtDef; motion: Extract<Motion, { kind: 'lash' }>; paint: Paint }) {
  const hair = look.layers[motion.hair];
  const body = look.layers[motion.body];
  const pivot = { x: hair.chain!.x, y: hair.chain!.y };
  const sim = useMemo(() => new LashRest(motion), [motion]);
  const steps = useMemo(() => fixedSteps(PHYSICS_HZ), []);
  const turn = useRef<SVGGElement>(null);
  const update: Update = useRef(null);
  const place = (pts: Vec[]) => {
    const c = Math.cos(sim.angle);
    const s = Math.sin(sim.angle);
    return pts.map((p) => {
      const x = motion.origin[0] + p.x;
      const y = motion.origin[1] + p.y;
      return { x: pivot.x + x * c - y * s, y: pivot.y + x * s + y * c };
    });
  };
  const rotate = () => `rotate(${((sim.angle * 180) / Math.PI).toFixed(3)} ${pivot.x} ${pivot.y})`;
  useTick((dt) => {
    const before = sim.angle;
    steps(dt, () => sim.tick());
    sim.step(dt, before);
    turn.current?.setAttribute('transform', rotate());
    update.current?.(place(sim.pts));
  });
  return (
    <Layers
      look={look}
      paint={paint}
      moving={{
        [motion.hair]: (
          <g ref={turn} transform={rotate()}>
            <Layer layer={hair} {...paint} />
          </g>
        ),
        [motion.body]: <Line layer={body} pts={place(sim.pts)} update={update} paint={paint} />,
      }}
    />
  );
}

/** A line through `pts`: its texture sliced along it, or (untextured) a tapered shape. */
export function Line({ layer, pts, update, paint }: { layer: ArtLayer; pts: Vec[]; update: Update; paint: Paint }) {
  return layer.src ? (
    <TexturedLine layer={layer} pts={pts} update={update} outline={paint.outline} />
  ) : (
    <TaperedLine layer={layer} pts={pts} update={update} color={paint.color} />
  );
}

/** Slices overlap by this much, so no seams show where the line bends. */
const SEAM = 0.006;

interface Slice {
  x: number;
  y: number;
  deg: number;
  length: number;
  /** The part of the texture it shows, in texture widths (stretched lines run 0-1; tiled ones count tiles). */
  u0: number;
  du: number;
}

/**
 * Line2D with a stretched (or tiled) texture: caps extend the first and last
 * segments by half the width. `beyond` adds slices past both ends (in texture
 * widths), where only an outline shows.
 */
function slices(layer: ArtLayer, pts: Vec[], beyond: number): Slice[] {
  const c = layer.chain!;
  const half = c.width / 2;
  const dir = (a: Vec, b: Vec) => {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  };
  const along = (p: Vec, d: Vec, k: number) => ({ x: p.x + d.x * k, y: p.y + d.y * k });
  const d0 = dir(pts[0], pts[1]);
  const d1 = dir(pts.at(-2)!, pts.at(-1)!);
  const capStart = c.caps[0] ? half : 0;
  const capEnd = c.caps[1] ? half : 0;
  const parts: { from: Vec; to: Vec }[] = [];
  if (capStart) parts.push({ from: along(pts[0], d0, -capStart), to: pts[0] });
  for (let i = 1; i < pts.length; i++) parts.push({ from: pts[i - 1], to: pts[i] });
  if (capEnd) parts.push({ from: pts.at(-1)!, to: along(pts.at(-1)!, d1, capEnd) });
  const lengths = parts.map((p) => Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y));
  const unit = layer.tile ?? lengths.reduce((a, b) => a + b, 0);
  let s = 0;
  const out: Slice[] = parts.map((p, i) => {
    const slice = { x: p.from.x, y: p.from.y, deg: (Math.atan2(p.to.y - p.from.y, p.to.x - p.from.x) * 180) / Math.PI, length: lengths[i], u0: s / unit, du: lengths[i] / unit };
    s += lengths[i];
    return slice;
  });
  if (beyond > 0) {
    const start = parts[0].from;
    const end = parts.at(-1)!.to;
    const b = along(start, d0, -beyond * unit);
    out.unshift({ x: b.x, y: b.y, deg: out[0].deg, length: beyond * unit, u0: -beyond, du: beyond });
    out.push({ x: end.x, y: end.y, deg: out.at(-1)!.deg, length: beyond * unit, u0: s / unit, du: beyond });
  }
  return out;
}

const sliceTransform = (s: Slice) => `translate(${s.x.toFixed(4)} ${s.y.toFixed(4)}) rotate(${s.deg.toFixed(3)})`;

function TexturedLine({ layer, pts, update, outline }: { layer: ArtLayer; pts: Vec[]; update: Update; outline?: string }) {
  const ring = useOutline(art(layer.src!), outline, layer.outline);
  const groups = useRef<(SVGGElement | null)[]>([]);
  const boxes = useRef<(SVGSVGElement | null)[]>([]);
  const half = layer.chain!.width / 2;
  // The outline reaches `pad` texels past the texture on every side.
  const [pu, pv] = ring ? [ring.pad / ring.w, ring.pad / ring.h] : [0, 0];
  const box = (s: Slice) => `${s.u0.toFixed(5)} ${(-pv).toFixed(5)} ${s.du.toFixed(5)} ${(1 + 2 * pv).toFixed(5)}`;
  update.current = (next) => {
    slices(layer, next, pu).forEach((s, i) => {
      groups.current[i]?.setAttribute('transform', sliceTransform(s));
      boxes.current[i]?.setAttribute('viewBox', box(s));
      boxes.current[i]?.setAttribute('width', String(s.length + SEAM));
    });
  };
  return (
    <g opacity={layer.opacity}>
      {slices(layer, pts, pu).map((s, i) => {
        // A tiled texture needs every copy the slice can reach.
        const copies = Array.from({ length: Math.floor(s.u0 + s.du + pu) - Math.floor(s.u0 - pu) + 1 }, (_, k) => Math.floor(s.u0 - pu) + k);
        return (
          <g key={i} ref={(el) => void (groups.current[i] = el)} transform={sliceTransform(s)}>
            <svg
              ref={(el) => void (boxes.current[i] = el)}
              x={0}
              y={-half * (1 + 2 * pv)}
              width={s.length + SEAM}
              height={half * 2 * (1 + 2 * pv)}
              viewBox={box(s)}
              preserveAspectRatio="none"
              overflow="hidden"
            >
              {ring && copies.map((k) => <OutlineCopy key={`o${k}`} ring={ring} at={k} pu={pu} pv={pv} stretched={!layer.tile} />)}
              {copies.map((k) => (!layer.tile && k !== 0 ? null : <image key={k} href={art(layer.src!)} x={k} y={0} width={1} height={1} preserveAspectRatio="none" />))}
            </svg>
          </g>
        );
      })}
    </g>
  );
}

/** One copy of the outline around texture copy `at` (a stretched texture has only copy 0). */
function OutlineCopy({ ring, at, pu, pv, stretched }: { ring: Outline; at: number; pu: number; pv: number; stretched: boolean }) {
  if (stretched && at !== 0) return null;
  return <image href={ring.url} x={at - pu} y={-pv} width={1 + 2 * pu} height={1 + 2 * pv} preserveAspectRatio="none" />;
}

/** The outline of a line of varying width through `pts`, with round ends (hair.gd). */
function taperedPath(layer: ArtLayer, pts: Vec[]): string {
  const c = layer.chain!;
  const widths = c.widths ?? pts.map(() => 1);
  const left: Vec[] = [];
  const right: Vec[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / l;
    const ny = (b.x - a.x) / l;
    const hw = (c.width * widths[i]) / 2;
    left.push({ x: p.x + nx * hw, y: p.y + ny * hw });
    right.push({ x: p.x - nx * hw, y: p.y - ny * hw });
  });
  const f = (v: Vec) => `${v.x.toFixed(4)},${v.y.toFixed(4)}`;
  const r0 = ((c.width * widths[0]) / 2).toFixed(4);
  const r1 = ((c.width * widths.at(-1)!) / 2).toFixed(4);
  return `M${left.map(f).join('L')}A${r1},${r1} 0 0 0 ${f(right.at(-1)!)}L${right.slice().reverse().map(f).join('L')}A${r0},${r0} 0 0 0 ${f(left[0])}Z`;
}

function TaperedLine({ layer, pts, update, color }: { layer: ArtLayer; pts: Vec[]; update: Update; color?: string }) {
  const path = useRef<SVGPathElement>(null);
  update.current = (next) => path.current?.setAttribute('d', taperedPath(layer, next));
  return <path ref={path} d={taperedPath(layer, pts)} opacity={layer.opacity} {...flatShape(color)} />;
}
