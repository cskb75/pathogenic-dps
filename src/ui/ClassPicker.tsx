// The pathogen picker: a carousel of specimen tubes, after the game's
// character select (scn/ui/start_menus/player_selection.tscn), flattened into
// a row. The chosen pathogen stands in the middle; the rest wrap around it.
// Each tube holds the pathogen's starting body, hairs swaying (Specimen.tsx).

import { useEffect, useId, useMemo, useRef, type CSSProperties, type Dispatch, type KeyboardEvent, type PointerEvent } from 'react';
import type { Build, ClassDef, GameData } from '../engine/types';
import type { Action } from '../state/build';
import { useAnimation } from './animation';
import { uiArt } from './art';
import { Clock, ClockContext } from './clock';
import { Specimen, specimenBody, specimenOf } from './Specimen';

interface Props {
  data: GameData;
  build: Build;
  dispatch: Dispatch<Action>;
  onSwitched: () => void;
}

/** The way round the ring from the chosen pathogen to pathogen `i`: -3 to 3 of seven, negative to the left. */
export function ringOffset(i: number, selected: number, count: number): number {
  const d = (((i - selected) % count) + count) % count;
  return d > count / 2 ? d - count : d;
}

/** Tube size and brightness by distance from the middle; further out than this, tubes are hidden. */
const SCALE = [1, 0.74, 0.58, 0.48];
const OPACITY = [1, 0.9, 0.7, 0.4];
/** Room between neighbouring tubes, in tube widths. */
const GAP = 1.12;

/** Where a tube `rel` places from the middle sits, in front-tube widths, and how big it is. */
export function tubePlace(rel: number): { x: number; scale: number; opacity: number } {
  const n = Math.abs(rel);
  if (n >= SCALE.length) return { x: Math.sign(rel) * 6, scale: SCALE.at(-1)!, opacity: 0 };
  let x = 0;
  for (let k = 1; k <= n; k++) x += ((SCALE[k - 1] + SCALE[k]) / 2) * GAP;
  return { x: Math.sign(rel) * x, scale: SCALE[n], opacity: OPACITY[n] };
}

/** A swipe this far across (pixels) steps to the next pathogen. */
const SWIPE_PX = 40;

/** A tube per pathogen, the chosen one in front. Switching replaces the body; run state carries over. */
export function ClassPicker({ data, build, dispatch, onSwitched }: Props) {
  const classes = data.classes;
  const count = classes.length;
  const selected = Math.max(0, classes.findIndex((c) => c.id === build.classId));
  const current = classes[selected];
  const equipped = Object.values(build.slots).some((s) => s.organelle);

  const animation = useAnimation();
  const clock = useMemo(() => new Clock(), []);
  const sectionRef = useRef<HTMLElement>(null);
  // Only animate while the carousel is on screen.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => clock.setVisible(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [clock]);

  // A tube that wraps from one end of the row to the other jumps there instead of sliding across.
  const lastRel = useRef<number[]>([]);
  const rels = classes.map((_, i) => ringOffset(i, selected, count));
  useEffect(() => {
    lastRel.current = rels;
  });

  const tubes = useRef<(HTMLButtonElement | null)[]>([]);
  function pick(index: number, focus = false) {
    const i = ((index % count) + count) % count;
    const cls = classes[i];
    if (cls.id !== build.classId) {
      if (equipped && !window.confirm(`Switch to the ${cls.name}? Its body starts empty. Mutations and settings carry over; plasmids don't.`)) return;
      dispatch({ type: 'setClass', classId: cls.id });
      onSwitched();
    }
    if (focus) requestAnimationFrame(() => tubes.current[i]?.focus());
  }

  // Arrow keys move through the pathogens, as in a radio group.
  function onKeyDown(e: KeyboardEvent) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step !== undefined) pick(selected + step, true);
    else if (e.key === 'Home') pick(0, true);
    else if (e.key === 'End') pick(count - 1, true);
    else return;
    e.preventDefault();
  }

  // Swiping the row steps one pathogen along; the click that ends a swipe doesn't pick a tube.
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  function onPointerDown(e: PointerEvent) {
    if (!e.isPrimary) return;
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    swiped.current = false;
  }
  function onPointerUp(e: PointerEvent) {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    swiped.current = true;
    pick(selected + (dx < 0 ? 1 : -1));
  }

  return (
    <section ref={sectionRef} className="pathogen-carousel" style={{ '--lab': `url(${uiArt('lab-backdrop')})` } as CSSProperties}>
      <div className="carousel-stage">
        <button type="button" className="carousel-arrow prev" aria-label="Previous pathogen" onClick={() => pick(selected - 1)}>
          <img src={uiArt('select-arrow')} alt="" width={56} height={41} draggable={false} />
        </button>
        <ClockContext.Provider value={animation.on ? clock : null}>
          <div
            className="carousel-track"
            role="radiogroup"
            aria-label="Pathogen"
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (swipe.current = null)}
          >
            {classes.map((c, i) => {
              const rel = rels[i];
              const place = tubePlace(rel);
              const jumped = lastRel.current[i] !== undefined && Math.abs(lastRel.current[i] - rel) > 1;
              const style = { '--x': place.x, '--s': place.scale, '--o': place.opacity, zIndex: 10 - Math.abs(rel), ...(jumped ? { transition: 'none' } : {}) } as CSSProperties;
              return (
                <button
                  key={c.id}
                  ref={(el) => void (tubes.current[i] = el)}
                  type="button"
                  role="radio"
                  aria-checked={rel === 0}
                  tabIndex={rel === 0 ? 0 : -1}
                  aria-label={`${c.name}: ${c.tagline}`}
                  className={`carousel-tube ${rel === 0 ? 'active' : ''} ${Math.abs(rel) > 1 ? 'far' : ''}`}
                  style={style}
                  onClick={() => {
                    if (swiped.current) return;
                    pick(i);
                  }}
                >
                  <Tube cls={c} data={data} />
                  <span className="carousel-tube-name" aria-hidden="true">
                    {c.name}
                  </span>
                </button>
              );
            })}
          </div>
        </ClockContext.Provider>
        <button type="button" className="carousel-arrow next" aria-label="Next pathogen" onClick={() => pick(selected + 1)}>
          <img src={uiArt('select-arrow')} alt="" width={56} height={41} draggable={false} />
        </button>
      </div>
      {/* Every caption takes the same spot, only the chosen one showing, so the carousel keeps its height as you switch. */}
      <div className="carousel-caption">
        {classes.map((c) => (
          <div key={c.id} className={c === current ? 'current' : ''}>
            <h2 className="carousel-name">{c.name}</h2>
            <p className="carousel-tagline">{c.tagline}</p>
            <p className="carousel-desc">{c.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// tube.tscn, in game pixels from the middle of the glass. Our tubes are shorter
// than the game's (its glass is 646 px tall): the rims stay, the straight
// middle of the glass, its glow and the pathogen's mask shrink.
const GLASS = { w: 237, h: 646 };
const GLOW = { w: 235, h: 641 };
const MASK = { w: 185, h: 620 };
const TUBE_H = 400;
const CUT = GLASS.h - TUBE_H;
/** The glass's rounded ends, kept whole when the middle shrinks. */
const RIM = 90;
/** The whole tube: cap above, bulb below. */
const VIEW = { x: -135, y: -TUBE_H / 2 - 96, w: 270, h: TUBE_H + 240 };
/** How much bigger than the game (player_scale) a pathogen may be drawn, room allowing. */
const ENLARGE = 1.4;

/** The game's tube with the pathogen floating in it, lit from below in its colour. */
function Tube({ cls, data }: { cls: ClassDef; data: GameData }) {
  const id = useId().replace(/[^\w-]/g, '');
  const spec = specimenOf(cls.id);
  const { box } = useMemo(() => specimenBody(cls, data), [cls, data]);
  // Fit the body (not its hairs: the tube cuts those off, as in the game) inside the glass.
  const room = { w: MASK.w - 30, h: MASK.h - CUT - 70 };
  const scale = Math.min(spec.scale * ENLARGE, room.w / (box.w * 100), room.h / (box.h * 100));
  const light = spec.light ?? '#3fb7ff';
  return (
    <svg className="tube" viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`} aria-hidden="true">
      <defs>
        <mask id={`${id}-in`} style={{ maskType: 'alpha' }}>
          <Sliced href={uiArt('tube-mask')} w={MASK.w} h={MASK.h - CUT} iw={MASK.w} ih={MASK.h} />
        </mask>
        <radialGradient id={`${id}-light`}>
          <stop offset="0" stopColor={light} stopOpacity={0.75} />
          <stop offset="1" stopColor={light} stopOpacity={0} />
        </radialGradient>
      </defs>
      <image href={uiArt('tube-cap')} x={-135} y={-TUBE_H / 2 - 96} width={270} height={110} />
      <image href={uiArt('tube-bulb')} x={-98.5} y={TUBE_H / 2 - 10} width={197} height={154} />
      <Sliced href={uiArt('tube-glow')} w={GLOW.w} h={GLOW.h - CUT} iw={GLOW.w} ih={GLOW.h} opacity={0.84} />
      <image href={uiArt('tube-hole-top')} x={-92.5} y={-TUBE_H / 2 + 6} width={183} height={62} />
      <image href={uiArt('tube-hole-below')} x={-91.5} y={TUBE_H / 2 - 51} width={183} height={42} />
      <g mask={`url(#${id}-in)`}>
        {/* The tube's own light sits just under the pathogen (tube.tscn PointLight2D). */}
        <ellipse className="tube-light" cx={0} cy={TUBE_H / 2 - 40} rx={150} ry={210} fill={`url(#${id}-light)`} />
        <g transform={`translate(0 15) scale(${scale.toFixed(4)})`}>
          <Specimen cls={cls} data={data} />
        </g>
      </g>
      <Sliced href={uiArt('tube-glass')} w={GLASS.w} h={TUBE_H} iw={GLASS.w} ih={GLASS.h} />
    </svg>
  );
}

/**
 * A tube part centred on the origin, `w` x `h`: the texture's top and bottom
 * RIM pixels as they are, its middle stretched to fill the rest.
 */
function Sliced({ href, w, h, iw, ih, opacity }: { href: string; w: number; h: number; iw: number; ih: number; opacity?: number }) {
  const x = -w / 2;
  const y = -h / 2;
  const mid = h - 2 * RIM;
  // Each piece overlaps the next by a pixel, so no seam shows.
  const piece = (top: number, height: number, from: number, rows: number) => (
    <svg x={x} y={top} width={w} height={height} viewBox={`0 ${from} ${iw} ${rows}`} preserveAspectRatio="none">
      <image href={href} width={iw} height={ih} preserveAspectRatio="none" />
    </svg>
  );
  return (
    <g opacity={opacity}>
      {piece(y, RIM + 1, 0, RIM + 1)}
      {piece(y + RIM, mid, RIM, ih - 2 * RIM)}
      {piece(y + h - RIM - 1, RIM + 1, ih - RIM - 1, RIM + 1)}
    </g>
  );
}
