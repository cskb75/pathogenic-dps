// Connections between slots, drawn like the game's organelle editor
// (scn/player/bodyparts/connection.tscn, connection.gd):
//
// - A curve from slot to slot: Curve2D with a 30 px handle pointing back into
//   the body from each external slot (none from internal ones).
// - EditorLine: 15 px wide, pinched to 57% in the middle, a dark gold edge
//   around a core whose bright band slides along the line on a 4 s sine
//   (editor_line_gradient.gdshader). Connections between organelles that work
//   together are bright; the rest are dimmed grey (update_visibility).
// - ArrowLine: small_arrow.png (a thin line with a chevron every 101 px), 25
//   px wide, fading in toward 70% of the line and out at its end, scrolled by
//   arrow_scroll.gdshader. The editor shows arrows only for the organelle you
//   hover or hold (links.ts), in the colour of the organelle they come from.

import { useMemo, useRef, type CSSProperties } from 'react';
import type { Vec } from '../engine/geometry';
import { useClock, useTick } from './clock';

export interface Curve {
  p0: Vec;
  c1: Vec;
  c2: Vec;
  p3: Vec;
}

/** A connection's curve (in SVG units), given each end and its outward facing (external slots). */
export function connectionCurve(a: Vec, b: Vec, facingA: Vec | undefined, facingB: Vec | undefined, handle: number): Curve {
  const back = (p: Vec, f: Vec | undefined) => (f ? { x: p.x - f.x * handle, y: p.y - f.y * handle } : p);
  return { p0: a, c1: back(a, facingA), c2: back(b, facingB), p3: b };
}

function at(c: Curve, t: number): Vec {
  const u = 1 - t;
  const [a, b, d, e] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: a * c.p0.x + b * c.c1.x + d * c.c2.x + e * c.p3.x, y: a * c.p0.y + b * c.c1.y + d * c.c2.y + e * c.p3.y };
}

/** Points along the curve, evenly spaced by length (Curve2D.tessellate_even_length), with the distance to each. */
function samples(c: Curve, n = 24) {
  const raw = Array.from({ length: 65 }, (_, i) => at(c, i / 64));
  const dist = [0];
  for (let i = 1; i < raw.length; i++) dist.push(dist[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y));
  const total = dist.at(-1)! || 1;
  const pointAt = (f: number) => {
    const want = f * total;
    let i = 1;
    while (i < dist.length - 1 && dist[i] < want) i++;
    const k = (want - dist[i - 1]) / (dist[i] - dist[i - 1] || 1);
    const p = { x: raw[i - 1].x + (raw[i].x - raw[i - 1].x) * k, y: raw[i - 1].y + (raw[i].y - raw[i - 1].y) * k };
    const l = Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y) || 1;
    return { p, dir: { x: (raw[i].x - raw[i - 1].x) / l, y: (raw[i].y - raw[i - 1].y) / l } };
  };
  return { points: Array.from({ length: n + 1 }, (_, i) => pointAt(i / n)), pointAt, length: total };
}

/** EditorLine's width curve: 1 at the ends, 0.572 in the middle, flat at each. */
function pinch(t: number) {
  const x = t <= 0.5 ? t / 0.5 : (1 - t) / 0.5;
  return 1 - 0.428 * x * x * (3 - 2 * x);
}

/** A ribbon along the curve, `width(t)` wide, with round ends. */
function ribbon(c: Curve, width: (t: number) => number): string {
  const { points } = samples(c);
  const n = points.length - 1;
  const left: Vec[] = [];
  const right: Vec[] = [];
  points.forEach(({ p, dir }, i) => {
    const hw = width(i / n) / 2;
    left.push({ x: p.x - dir.y * hw, y: p.y + dir.x * hw });
    right.push({ x: p.x + dir.y * hw, y: p.y - dir.x * hw });
  });
  const f = (v: Vec) => `${v.x.toFixed(2)},${v.y.toFixed(2)}`;
  const r0 = (width(0) / 2).toFixed(2);
  const r1 = (width(1) / 2).toFixed(2);
  return `M${left.map(f).join('L')}A${r1},${r1} 0 0 0 ${f(right.at(-1)!)}L${right.reverse().map(f).join('L')}A${r0},${r0} 0 0 0 ${f(left[0])}Z`;
}

// editor_line_gradient.gdshader's colours.
const GOLD_DARK = [0.6216, 0.3991, 0];
const GOLD = [0.9672, 0.6289, 0];
const tint = (c: number[], k: number) => `rgb(${c.map((v) => Math.round(v * k * 255)).join(' ')})`;
// Ease-out and ease-in sine, to move the bright band like 0.5 + 0.5 * sin(t).
const SINE = '0.61 1 0.88 1;0.12 0 0.39 0;0.61 1 0.88 1;0.12 0 0.39 0';

/**
 * One connection. `px` is SVG units per game pixel. `active` when organelles
 * at both ends work together; `near` when it touches the selected slot.
 */
export function ConnectionLine({ id, curve, px, active, near }: { id: string; curve: Curve; px: number; active: boolean; near: boolean }) {
  const animate = !!useClock();
  const k = active ? 1 : 0.623;
  const outer = useMemo(() => ribbon(curve, (t) => 15 * px * pinch(t)), [curve, px]);
  const inner = useMemo(() => ribbon(curve, (t) => 15 * 0.3 * px * pinch(t)), [curve, px]);
  return (
    <g className={`connection ${active ? 'active' : ''} ${near ? 'near' : ''}`} opacity={active ? 0.95 : near ? 0.75 : 0.4}>
      <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={curve.p0.x} y1={curve.p0.y} x2={curve.p3.x} y2={curve.p3.y}>
        <stop offset={0} stopColor={tint(GOLD_DARK, k)} />
        <stop offset={0.5} stopColor={tint(GOLD, k)}>
          {animate && <animate attributeName="offset" values="0.5;1;0.5;0;0.5" keyTimes="0;0.25;0.5;0.75;1" calcMode="spline" keySplines={SINE} dur="4s" repeatCount="indefinite" />}
        </stop>
        <stop offset={1} stopColor={tint(GOLD_DARK, k)} />
      </linearGradient>
      <path d={outer} fill={tint(GOLD_DARK, k)} />
      <path d={inner} fill={`url(#${id})`} />
    </g>
  );
}

// small_arrow.png is 101 x 28 texels, drawn 25 px wide: the chevron's tip sits
// 66% along each copy.
const ARROW_EVERY = 101;
const ARROW_TIP = 0.66;
/** The chevron, in game pixels, tip at the origin pointing along +x. */
const CHEVRON = 'M0,0L-20,-9.8L-13,0L-20,9.8Z';
/** ArrowLine's gradient: invisible at the start, full at 70%, invisible at the end. */
const fade = (x: number) => (x < 0 ? 0 : x < 0.7047 ? x / 0.7047 : x < 1 ? (1 - x) / (1 - 0.7047) : 0);

/**
 * Arrows along a connection: chevrons scrolling from `curve.p0` to `curve.p3`
 * the way arrow_scroll.gdshader moves the texture (speed 2.5, one copy per
 * 101 px). `core` and `glow` are the HDR colour on screen (links.ts,
 * arrowPaint); `alpha` fades arrows further back along a chain.
 */
export function FlowArrows({ id, curve, px, core, glow, alpha }: { id: string; curve: Curve; px: number; core: string; glow: string; alpha: number }) {
  const shape = useMemo(() => samples(curve), [curve]);
  const length = shape.length / px; // game pixels
  const count = Math.ceil(length / ARROW_EVERY) + 2;
  const chevrons = useRef<(SVGPathElement | null)[]>([]);
  const time = useRef(0);
  const place = (t: number) => {
    const scroll = (((2.5 * t + length / ARROW_EVERY / 4) % 2) + 2) % 2 - 1.25;
    const spacing = ARROW_EVERY / length;
    const first = Math.ceil((0 - scroll) / spacing - ARROW_TIP);
    return Array.from({ length: count }, (_, i) => {
      const x = scroll + (first + i + ARROW_TIP) * spacing;
      if (x < 0 || x > 1) return null;
      const { p, dir } = shape.pointAt(x);
      const deg = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
      return { transform: `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${deg.toFixed(2)}) scale(${px})`, opacity: fade(x) };
    });
  };
  useTick((dt) => {
    time.current += dt;
    place(time.current).forEach((c, i) => {
      const el = chevrons.current[i];
      if (!el) return;
      el.setAttribute('visibility', c ? 'visible' : 'hidden');
      if (c) {
        el.setAttribute('transform', c.transform);
        el.setAttribute('opacity', c.opacity.toFixed(3));
      }
    });
  });
  const d = `M${curve.p0.x},${curve.p0.y}C${curve.c1.x},${curve.c1.y} ${curve.c2.x},${curve.c2.y} ${curve.p3.x},${curve.p3.y}`;
  return (
    <g className="flow" opacity={alpha} style={{ '--flow': core, '--flow-glow': glow } as CSSProperties}>
      <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={curve.p0.x} y1={curve.p0.y} x2={curve.p3.x} y2={curve.p3.y}>
        <stop offset={0} className="flow-stop" stopOpacity={0} />
        <stop offset={0.7047} className="flow-stop" stopOpacity={1} />
        <stop offset={1} className="flow-stop" stopOpacity={0} />
      </linearGradient>
      <linearGradient id={`${id}-glow`} gradientUnits="userSpaceOnUse" x1={curve.p0.x} y1={curve.p0.y} x2={curve.p3.x} y2={curve.p3.y}>
        <stop offset={0} className="flow-glow-stop" stopOpacity={0} />
        <stop offset={0.7047} className="flow-glow-stop" stopOpacity={0.45} />
        <stop offset={1} className="flow-glow-stop" stopOpacity={0} />
      </linearGradient>
      {/* The game's glow: the colour's hue spread around the bright line. */}
      <path d={d} className="flow-line" stroke={`url(#${id}-glow)`} strokeWidth={9 * px} strokeLinecap="round" fill="none" />
      <path d={d} className="flow-line" stroke={`url(#${id})`} strokeWidth={2.7 * px} fill="none" />
      {place(time.current).map((c, i) => (
        <path
          key={i}
          ref={(el) => void (chevrons.current[i] = el)}
          d={CHEVRON}
          className="flow-chevron"
          visibility={c ? 'visible' : 'hidden'}
          transform={c?.transform}
          opacity={c?.opacity}
        />
      ))}
    </g>
  );
}
