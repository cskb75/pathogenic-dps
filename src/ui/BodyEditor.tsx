import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { AMOEBA, buildAmoebaBody, nextGrowthId, placeBlob, type AmoebaBody, type Blob } from '../engine/amoeba';
import { blobOutline, loneBlobEdge } from '../engine/amoebaShape';
import { placementOptions, removePieceTree, type PlacementOption, type Slot, type SlotKind } from '../engine/body';
import type { CalcResult } from '../engine/calc';
import { EVOLUTION_LEVELS, evolutionOffer, findClass, SKIP_EVOLUTION, slotState } from '../engine/calc';
import type { Vec } from '../engine/geometry';
import type { BodyPlan, Build, EvolvingBody, GameData, ModularBody } from '../engine/types';
import type { Action } from '../state/build';
import { drop, fits, lift, type Carry, type Held } from '../state/held';
import { useAnimation } from './animation';
import { art, organelleIcon, PlanThumb } from './art';
import { BlobArt, BodyArt, loopsPath, PieceArt, S } from './bodyArt';
import { Clock, ClockContext } from './clock';
import { connectionCurve, ConnectionLine, FlowArrows, type Curve } from './Connections';
import { arrowPaint, hoverArrows, linkInfo, worksTogether } from './links';
import { ArtLayers, flagellumColor, layerCorners, organelleArt, slotArt } from './organelleArt';
import { OrganelleArt } from './OrganelleMotion';

type Tool = { kind: 'select' } | { kind: 'add'; pieceType: string } | { kind: 'grow'; slot: SlotKind } | { kind: 'remove' };

interface Props {
  data: GameData;
  build: Build;
  result: CalcResult;
  selected: string | null;
  onSelect: (slotId: string | null) => void;
  dispatch: Dispatch<Action>;
  /** The organelle in your hand, if any (src/state/held.ts). */
  carry: Carry | null;
  setCarry: (carry: Carry | null) => void;
}

const R_INTERNAL = 0.17;
const R_EXTERNAL = { modular: 0.12, fixed: 0.145 };
/** When the view zooms out to fit long organelles, slots stay at least this big on screen (radius in pixels). */
const MIN_SLOT_PX: Record<SlotKind, number> = { internal: 11, external: 9 };
/** Screen pixels per editor unit that line widths are drawn for (a bare body fills the view at about this scale). */
const REF_UNIT_PX = 150;
/** Room around organelle art at the edges of the view. */
const ART_PAD = 0.15;
/** Nanobot edge slots sit slightly outside the module. */
const EXTERNAL_OFFSET = 0.08;

const pts = (vs: Vec[]) => vs.map((v) => `${v.x * S},${v.y * S}`).join(' ');

/** A held organelle snaps to a slot this close (editor units; the game uses 40 game pixels), or this many screen pixels. */
const SNAP_REACH = 0.45;
const SNAP_PX = 36;
/** How far a pointer moves before a press on an organelle becomes a drag. */
const DRAG_START_PX = 6;
/**
 * How bright the game's organelle editor draws a body: about 0.115 of its
 * texture in linear light, so nearly black inside a dim rim. The body's
 * material is lit (toon_lighting2.gdshader) under the world's Darken
 * CanvasModulate; organelles aren't. Measured from in-game screenshots of the
 * Amoeba and the Bacterium, which agree.
 */
const BODY_LIGHT = 0.115;

const onActivate = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

export function BodyEditor({ data, build, result, selected, onSelect, dispatch, carry, setCarry }: Props) {
  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  const [hoverPiece, setHoverPiece] = useState<string | null>(null);
  const cls = findClass(data, build.classId);
  const body = result.body;
  const plan = body.plan;
  const modular = cls.body.kind === 'modular' ? cls.body : null;
  const freeform = cls.body.kind === 'freeform';
  const blobs = (body as Partial<AmoebaBody>).blobs;
  /** The Amoeba's body: its blobs merged the way the game bakes them. */
  const blobLoops = useMemo(() => (blobs ? blobOutline(blobs) : []), [blobs]);
  const blobPath = useMemo(() => loopsPath(blobLoops), [blobLoops]);
  const svgRef = useRef<SVGSVGElement>(null);
  const animation = useAnimation();
  const clock = useMemo(() => new Clock(), []);
  // Only animate while the body view is on screen.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => clock.setVisible(entry.isIntersecting));
    io.observe(svg);
    return () => io.disconnect();
  }, [clock]);
  const [cursor, setCursor] = useState<Vec | null>(null);
  const organelles = useMemo(() => new Map(data.organelles.map((o) => [o.id, o])), [data]);
  const rarityIndex = useMemo(() => new Map(data.rarities.map((r, i) => [r.id, i])), [data]);
  const ids = useId().replace(/[^\w-]/g, '');
  const slotCenter = (slot: Slot): Vec =>
    plan || !slot.facing ? slot.position : { x: slot.position.x + slot.facing.x * EXTERNAL_OFFSET, y: slot.position.y + slot.facing.y * EXTERNAL_OFFSET };

  // Organelle art is in hundreds of game pixels; a Nanobot editor unit is one module.
  const artScale = 1 / body.frame.scale;
  /** Where a slot's art goes: at the slot, turned to face out along the slot. */
  function placement(slot: Slot) {
    const c = slotCenter(slot);
    const angle = slot.facing ? Math.atan2(slot.facing.y, slot.facing.x) : 0;
    const toBody = (p: Vec): Vec => ({
      x: c.x + (p.x * Math.cos(angle) - p.y * Math.sin(angle)) * artScale,
      y: c.y + (p.x * Math.sin(angle) + p.y * Math.cos(angle)) * artScale,
    });
    return { toBody, transform: `translate(${c.x * S} ${c.y * S}) rotate(${(angle * 180) / Math.PI}) scale(${S * artScale})` };
  }

  /** Each filled slot's organelle art and rarity (empty slots show the game's slot sprite). */
  const equipped = useMemo(
    () =>
      new Map(
        body.slots.map((slot) => {
          const state = slotState(build, body, slot.id);
          const look = state?.organelle && organelleArt(state.organelle.id);
          return [slot.id, look ? { look, rarity: rarityIndex.get(state.organelle!.rarity) ?? 0, excluded: !!state.excluded } : undefined];
        }),
      ),
    [body, build, rarityIndex],
  );

  /** SVG units per game pixel (a Nanobot module is 102.4 game pixels). */
  const px = (S * artScale) / 100;
  /** The game's connection curve between two slots: it leaves an external slot heading into the body. */
  function curveBetween(a: string, b: string): Curve {
    const [sa, sb] = [body.slotById.get(a)!, body.slotById.get(b)!];
    const [ca, cb] = [slotCenter(sa), slotCenter(sb)];
    return connectionCurve({ x: ca.x * S, y: ca.y * S }, { x: cb.x * S, y: cb.y * S }, sa.facing, sb.facing, 30 * px);
  }

  const occupied = useMemo(
    () => new Set(Object.entries(build.slots).filter(([, s]) => s.organelle).map(([id]) => id)),
    [build.slots],
  );

  const activeTool = modular || freeform ? tool : ({ kind: 'select' } as Tool);
  const addType = activeTool.kind === 'add' && modular ? modular.pieceTypes.find((p) => p.id === activeTool.pieceType) : undefined;
  const ghosts = useMemo(
    () => (addType ? placementOptions(body, addType.sides, occupied).filter((o) => o.valid) : []),
    [addType, body, occupied],
  );

  /** Growing a blob: where it would land, and the body it would make. */
  const growPreview = useMemo(() => {
    if (activeTool.kind !== 'grow' || !cursor || !blobs || !plan) return null;
    const at = placeBlob(blobs, cursor);
    const growth = build.growth ?? [];
    const step = { id: nextGrowthId(growth), kind: activeTool.slot, x: at.x, y: at.y };
    const next = buildAmoebaBody(plan, [...growth, step]);
    const fresh = next.slots.filter((s) => !body.slotById.has(s.id));
    const links = next.links.filter(([a, b]) => fresh.some((s) => s.id === a || s.id === b));
    return { at, next, fresh, links, outline: loopsPath(blobOutline(next.blobs)) };
  }, [activeTool, cursor, blobs, plan, build.growth, body]);

  const fitted = useMemo(() => {
    let all: Vec[];
    let pad: number;
    if (blobs) {
      // Frame the body with room to grow one more blob anywhere: a new blob can sit
      // up to maxDist x the two radii from a blob, and its lobe bulges ~0.5 past that.
      all = [
        ...blobLoops.flat(),
        ...blobs.flatMap((b) => {
          const reach = AMOEBA.maxDist * (AMOEBA.blobRadius + b.r) + 0.5;
          return [
            { x: b.x - reach, y: b.y - reach },
            { x: b.x + reach, y: b.y + reach },
          ];
        }),
      ];
      pad = 0.1;
    } else if (plan) {
      // Frame the slots: long tails and wide lobes can run off the edges.
      all = body.slots.map((s) => s.position);
      pad = 0.55;
    } else {
      // Frame the body plus room for one more square on every side, so the view
      // doesn't jump when switching tools.
      const frame = placementOptions(body, 4, new Set()).filter((o) => o.valid);
      all = [...body.placed.flatMap((p) => p.vertices), ...frame.flatMap((o) => o.vertices)];
      pad = 0.35;
    }
    // Zoom out to fit every organelle, like the game's camera: long ones reach
    // several body widths out.
    const art = body.slots.flatMap((slot) => {
      const e = equipped.get(slot.id);
      const layers = e ? e.look.layers.filter((l) => !l.masked) : [slotArt(slot.kind)];
      const { toBody } = placement(slot);
      return layers.flatMap((l) => layerCorners(l).map(toBody));
    });
    const xs = [...all.map((v) => v.x - pad), ...all.map((v) => v.x + pad), ...art.map((v) => v.x - ART_PAD), ...art.map((v) => v.x + ART_PAD)];
    const ys = [...all.map((v) => v.y - pad), ...all.map((v) => v.y + pad), ...art.map((v) => v.y - ART_PAD), ...art.map((v) => v.y + ART_PAD)];
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const w = Math.max(...xs) - minX;
    const h = Math.max(...ys) - minY;
    return { box: `${minX * S} ${minY * S} ${w * S} ${h * S}`, aspect: w / h, w, h };
  }, [body, plan, blobs, blobLoops, equipped]);
  // While you hold an organelle the view stays as it was when you picked it up,
  // so slots don't move under the pointer.
  const lastFit = useRef(fitted);
  const heldFit = useRef<typeof fitted | null>(null);
  if (!carry) {
    heldFit.current = null;
    lastFit.current = fitted;
  } else if (!heldFit.current) heldFit.current = lastFit.current;
  const viewBox = heldFit.current ?? fitted;

  // Screen pixels per editor unit, so slots and outlines stay readable when zoomed out.
  const [screen, setScreen] = useState({ w: 600, h: 500 });
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setScreen({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);
  const unitPx = Math.max(1, Math.min(screen.w / viewBox.w, screen.h / viewBox.h));
  /** How much further out than usual the view is: lines and rings get this much thicker to keep their size on screen. */
  const zoom = Math.max(1, REF_UNIT_PX / unitPx);
  const rExternal = plan ? R_EXTERNAL.fixed : R_EXTERNAL.modular;
  const radius = (slot: Slot) => Math.max(slot.kind === 'internal' ? R_INTERNAL : rExternal, MIN_SLOT_PX[slot.kind] / unitPx);

  const removal = useMemo(() => {
    if (activeTool.kind !== 'remove' || !hoverPiece || hoverPiece === build.pieces[0]?.id) return new Set<string>();
    const kept = new Set(removePieceTree(build.pieces, hoverPiece).map((p) => p.id));
    return new Set(build.pieces.filter((p) => !kept.has(p.id)).map((p) => p.id));
  }, [activeTool.kind, hoverPiece, build.pieces]);

  // --- Carrying organelles, as in the game's organelle editor (src/state/held.ts) ---
  const held = carry?.held ?? null;
  const removeRef = useRef<HTMLDivElement>(null);
  const handRef = useRef<SVGGElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  /** The slot a held organelle would drop into, and a slot under the pointer it doesn't fit. */
  const [snap, setSnap] = useState<{ target: string | null; blocked: string | null; remove: boolean }>({ target: null, blocked: null, remove: false });
  const snapRef = useRef(snap);
  const [hovered, setHovered] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ slot: string; n: number } | null>(null);
  const twinOf = (id: string) => body.slotById.get(id)?.mirrorOf ?? body.slots.find((s) => s.mirrorOf === id)?.id;

  /** The latest render's values, for window listeners. */
  const live = useRef({ build, body, carry, unitPx });
  live.current = { build, body, carry, unitPx };

  /** A screen point in editor units. */
  function clientToBody(x: number, y: number): Vec | null {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(x, y).matrixTransform(m.inverse());
    return { x: p.x / S, y: p.y / S };
  }
  const inside = (el: Element | null | undefined, x: number, y: number) => {
    const r = el?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  /** Where the pointer is while carrying: which slot it snaps to, over the Remove zone or not. Moves the hand and the label. */
  function track(x: number, y: number) {
    const { build: b, body: bd, carry: c, unitPx: upx } = live.current;
    if (!c) return;
    const remove = inside(removeRef.current, x, y);
    const onBody = inside(svgRef.current, x, y);
    const p = onBody && !remove ? clientToBody(x, y) : null;
    let target: string | null = null;
    let blocked: string | null = null;
    if (p) {
      const reach = Math.max(SNAP_REACH, SNAP_PX / upx);
      let best = reach;
      let nearest = reach;
      for (const slot of bd.slots) {
        const at = slotCenter(slot);
        const d = Math.hypot(at.x - p.x, at.y - p.y);
        if (d > reach) continue;
        if (fits(b, bd, data, c.held, slot.id)) {
          if (d < best) [best, target] = [d, slot.id];
        } else if (d < nearest) [nearest, blocked] = [d, slot.id];
      }
      if (target) blocked = null;
    }
    const next = { target, blocked, remove };
    const prev = snapRef.current;
    if (prev.target !== target || prev.blocked !== blocked || prev.remove !== remove) {
      snapRef.current = next;
      setSnap(next);
    }
    // The held organelle follows the pointer over the body, turned away from its middle like the game does.
    const hand = handRef.current;
    if (hand) {
      if (p && !target) {
        const external = organelles.get(c.held.organelle.id)?.slot === 'external';
        const center = bd.frame.center;
        const angle = external ? (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI : 0;
        hand.setAttribute('transform', `translate(${p.x * S} ${p.y * S}) rotate(${angle}) scale(${S / bd.frame.scale})`);
        hand.setAttribute('visibility', 'visible');
      } else hand.setAttribute('visibility', 'hidden');
    }
    const chip = chipRef.current;
    if (chip) {
      chip.style.transform = `translate(${x + 16}px, ${y + 18}px)`;
      chip.classList.toggle('off-body', !onBody || remove);
      chip.hidden = false;
    }
  }

  /** Drops what you hold in a slot; a swap may leave the other organelle in your hand. */
  function dropAt(slotId: string): boolean {
    const { build: b, body: bd, carry: c } = live.current;
    if (!c) return false;
    const done = drop(b, bd, data, c.held, slotId);
    if (!done) return false;
    dispatch({ type: 'setSlots', slots: done.slots });
    setCarry(done.held ? { held: done.held, mode: 'carry' } : null);
    onSelect(slotId);
    setFlash((f) => ({ slot: slotId, n: (f?.n ?? 0) + 1 }));
    return true;
  }
  /** Puts it back: the build returns to how it was before you picked it up. */
  function putBack() {
    const c = live.current.carry;
    if (c?.held.undo) dispatch({ type: 'setSlots', slots: c.held.undo });
    setCarry(null);
  }
  /** The Remove zone: what you hold is gone (it already left its slot). */
  const discard = () => setCarry(null);
  /** Finishes a drag or a click while carrying: drop, remove or put back. */
  function release() {
    const s = snapRef.current;
    if (s.remove) discard();
    else if (!s.target || !dropAt(s.target)) putBack();
  }
  /** Swallows the click that follows letting go of a drag. */
  function eatNextClick() {
    const eat = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('click', eat, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 0);
  }

  useEffect(() => {
    if (!carry) {
      snapRef.current = { target: null, blocked: null, remove: false };
      setSnap(snapRef.current);
      return;
    }
    const move = (e: PointerEvent) => track(e.clientX, e.clientY);
    const up = (e: PointerEvent) => {
      track(e.clientX, e.clientY);
      if (live.current.carry?.mode !== 'drag') return;
      release();
      eatNextClick();
    };
    const key = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && putBack();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerdown', move, true);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', move, true);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
    };
    // The handlers read the latest values through `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!carry]);

  /** Pressing on a placed organelle and moving picks it up (a click still selects it). */
  function pressOrganelle(e: ReactPointerEvent, slotId: string) {
    if (activeTool.kind !== 'select' || carry || e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_START_PX) return;
      stop();
      const { build: b, body: bd } = live.current;
      const up = lift(b, bd, slotId);
      if (!up) return;
      dispatch({ type: 'setSlots', slots: up.slots });
      live.current.carry = { held: up.held, mode: 'drag' };
      setCarry(live.current.carry);
      onSelect(null);
      setHovered(null);
      track(ev.clientX, ev.clientY);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  /** What an organelle connects to, and in which colour (the held one previews in its target slot). */
  const infoAt = (id: string, preview: boolean) => {
    if (preview && held && snap.target && (id === snap.target || id === twinOf(snap.target))) return linkInfo(held.organelle.id);
    const o = slotState(build, body, id)?.organelle;
    return o ? linkInfo(o.id) : undefined;
  };
  /** Arrows for the organelle you hold, hover or have selected, like the game. */
  const focus = held ? snap.target : (hovered ?? selected);
  const arrows = useMemo(
    () => (focus && body.slotById.has(focus) ? hoverArrows(body, focus, (id) => infoAt(id, true)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focus, body, build, held, snap.target],
  );

  const selectedLinks = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set((body.connections.get(selected) ?? []).map((n) => [selected, n].sort().join('|')));
  }, [selected, body.connections]);

  function organelleName(slotId: string) {
    const inst = build.slots[slotId]?.organelle;
    return inst ? (organelles.get(inst.id)?.name ?? inst.id) : 'empty slot';
  }

  function addPiece(option: PlacementOption) {
    if (!addType) return;
    if (option.covers.length > 0) {
      const names = option.covers.map(organelleName).join(', ');
      if (!window.confirm(`The new ${addType.name.toLowerCase()} covers this edge. Remove ${names} from it?`)) return;
      if (selected && option.covers.includes(selected)) onSelect(null);
    }
    dispatch({ type: 'addPiece', pieceType: addType.id, to: option.pieceId, edge: option.edge });
  }

  function removePiece(pieceId: string) {
    if (pieceId === build.pieces[0]?.id) return;
    const kept = new Set(removePieceTree(build.pieces, pieceId).map((p) => p.id));
    const doomed = build.pieces.filter((p) => !kept.has(p.id));
    const lost = Object.entries(build.slots).filter(([id, s]) => s.organelle && doomed.some((p) => id.startsWith(`${p.id}.`))).length;
    const what = `${doomed.length} module${doomed.length > 1 ? 's' : ''}`;
    if (lost > 0 && !window.confirm(`Remove ${what} and the ${lost} organelle${lost > 1 ? 's' : ''} on them?`)) return;
    dispatch({ type: 'removePiece', pieceId });
    setHoverPiece(null);
    if (selected && doomed.some((p) => selected.startsWith(`${p.id}.`))) onSelect(null);
  }

  function removeBlob(blob: Blob) {
    if (blob.growthId === undefined) return;
    const ids = [`Blob${blob.growthId}`, `Blob${blob.growthId}Mirror`];
    const lost = ids.filter((id) => build.slots[id]?.organelle).length;
    if (lost > 0 && !window.confirm(`Remove this blob and the organelle in it?`)) return;
    dispatch({ type: 'removeGrowth', id: blob.growthId });
    if (selected && ids.includes(selected)) onSelect(null);
  }

  /** Mouse position in editor units. */
  function toBody(e: MouseEvent<SVGSVGElement>): Vec | null {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x / S, y: p.y / S };
  }

  const heldName = held ? (organelles.get(held.organelle.id)?.name ?? held.organelle.id) : '';
  /** What letting go would do, for the label by the pointer. */
  function chipAction() {
    if (snap.remove) return 'Remove';
    if (snap.target) {
      const there = slotState(build, body, snap.target)?.organelle;
      return there ? `Swap with ${organelles.get(there.id)?.name ?? there.id}` : 'Place here';
    }
    if (snap.blocked && held) return `Goes in ${organelles.get(held.organelle.id)?.slot ?? 'other'} slots`;
    return 'Drop on a slot';
  }
  const hint = held
    ? `Holding ${heldName}: drop it on a slot (onto another organelle to swap them), or on Remove. Esc puts it back.`
    : activeTool.kind === 'select'
      ? 'Drag organelles onto slots from the list, or from slot to slot; drop one on another to swap them. Click a slot to set rarity and traits. Hover an organelle to see what it works with.'
      : activeTool.kind === 'add'
        ? `Click a dashed outline to attach a ${addType?.name.toLowerCase() ?? 'module'}. Orange outlines cover an equipped organelle, which gets removed.`
        : activeTool.kind === 'grow'
          ? `Click where to grow a blob with ${activeTool.slot === 'internal' ? 'an internal' : 'an external'} slot. Off the middle line it's mirrored. Dashed lines show what it will connect to (up to 3 slots, never across the middle).`
          : freeform
            ? 'Click a grown blob to remove it. Later blobs keep their place but may connect differently.'
            : 'Click a module to remove it and everything attached to it. The core stays.';

  return (
    <section className="panel editor" aria-label="Body editor">
      {modular ? (
        <ModularToolbar body={modular} tool={tool} setTool={setTool} />
      ) : freeform ? (
        <FreeformToolbar tool={tool} setTool={setTool} blobs={(build.growth ?? []).length} />
      ) : (
        <EvolutionFlow data={data} build={build} body={cls.body as EvolvingBody} dispatch={dispatch} />
      )}
      <div className="hint-row">
        <p className="hint">{hint}</p>
        <label className="animate-toggle" title={animation.reduced ? 'Your system asks for reduced motion' : 'Organelles move the way the game shows them'}>
          <input type="checkbox" checked={animation.on} disabled={animation.reduced} onChange={(e) => animation.set(e.target.checked)} />
          Animate
        </label>
      </div>

      <div className="body-stage">
      <svg
        ref={svgRef}
        className={`body-svg tool-${activeTool.kind} ${plan ? 'fixed' : 'modular'} ${freeform ? 'freeform' : ''} ${held ? 'holding' : ''}`}
        viewBox={viewBox.box}
        style={{ ...(plan ? { aspectRatio: String(viewBox.aspect) } : {}), '--k': zoom } as CSSProperties}
        onMouseMove={(e) => activeTool.kind === 'grow' && setCursor(toBody(e))}
        onMouseLeave={() => setCursor(null)}
        onClick={(e) => {
          // Carrying between clicks: this click drops it (or puts it back).
          if (held) {
            track(e.clientX, e.clientY);
            release();
            return;
          }
          if (activeTool.kind === 'select') onSelect(null);
          if (activeTool.kind === 'grow') {
            const p = toBody(e);
            if (!p || !blobs) return;
            const at = placeBlob(blobs, p);
            dispatch({ type: 'addGrowth', kind: activeTool.slot, x: at.x, y: at.y });
          }
        }}
      >
        <defs>
          {/* The body as the game's organelle editor lights it (BODY_LIGHT). */}
          <filter id={`${ids}-lit`} colorInterpolationFilters="linearRGB">
            <feComponentTransfer>
              <feFuncR type="linear" slope={BODY_LIGHT} />
              <feFuncG type="linear" slope={BODY_LIGHT} />
              <feFuncB type="linear" slope={BODY_LIGHT} />
            </feComponentTransfer>
          </filter>
          {/* The body's silhouette: internal organelles' patterns only show inside it. */}
          <mask id={`${ids}-body`} style={{ maskType: 'alpha' }}>
            {plan?.sprite && !blobs && <image href={art(plan.sprite.src)} x={plan.sprite.x * S} y={plan.sprite.y * S} width={plan.sprite.w * S} height={plan.sprite.h * S} preserveAspectRatio="none" />}
            {plan && !plan.sprite && !blobs && <polygon points={plan.outline.map(([x, y]) => `${x * S},${y * S}`).join(' ')} fill="#fff" />}
            {blobs && <path d={blobPath} fill="#fff" fillRule="evenodd" />}
            {body.placed.map((piece) => (
              <polygon key={piece.id} points={pts(piece.vertices)} fill="#fff" />
            ))}
          </mask>
        </defs>

        {plan && !blobs && <BodyArt plan={plan} filter={`url(#${ids}-lit)`} />}

        {blobs && (
          <g className="blobs">
            <BlobArt path={blobPath} filter={`url(#${ids}-lit)`} />
            {activeTool.kind === 'remove' &&
              blobs
                .filter((b) => b.growthId !== undefined)
                .map((b, i) => (
                  <circle
                    // A mirrored growth makes two blobs with the same id.
                    key={`${b.growthId}:${i}`}
                    className="blob-hit"
                    cx={b.x * S}
                    cy={b.y * S}
                    r={loneBlobEdge(b.r) * 1.6 * S}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeBlob(b);
                    }}
                  >
                    <title>Grown blob</title>
                  </circle>
                ))}
            {growPreview && <path d={growPreview.outline} className="blob-ghost" fillRule="evenodd" />}
            {growPreview?.links.map(([a, b]) => {
              const p = growPreview.next.slotById.get(a)!.position;
              const q = growPreview.next.slotById.get(b)!.position;
              return <line key={`${a}|${b}`} className="connector ghost-link" x1={p.x * S} y1={p.y * S} x2={q.x * S} y2={q.y * S} />;
            })}
            {growPreview?.fresh.map((s) => (
              <circle key={s.id} className={`slot-ghost slot-${s.kind}`} cx={s.position.x * S} cy={s.position.y * S} r={radius(s) * S} />
            ))}
          </g>
        )}

        {body.placed.map((piece) => (
          <PieceArt key={`art-${piece.id}`} vertices={piece.vertices} center={piece.center} />
        ))}
        {body.placed.map((piece) => (
          <polygon
            key={piece.id}
            points={pts(piece.vertices)}
            className={`piece piece-${piece.type} ${removal.has(piece.id) ? 'doomed' : ''}`}
            onMouseEnter={() => setHoverPiece(piece.id)}
            onMouseLeave={() => setHoverPiece(null)}
            onClick={(e) => {
              if (activeTool.kind !== 'remove') return;
              e.stopPropagation();
              removePiece(piece.id);
            }}
          >
            <title>{modular?.pieceTypes.find((t) => t.id === piece.type)?.name ?? piece.type}</title>
          </polygon>
        ))}

        <ClockContext.Provider value={animation.on ? clock : null}>
          {/* Internal organelles tint the body around them (each scene's "Masked" pattern). */}
          <g mask={`url(#${ids}-body)`} className="organelle-patterns">
            {body.slots.map((slot) => {
              const e = equipped.get(slot.id);
              const layers = e?.look.layers.filter((l) => l.masked);
              if (!layers?.length) return null;
              return (
                <g key={slot.id} transform={placement(slot).transform}>
                  <ArtLayers layers={layers} />
                </g>
              );
            })}
          </g>

          {body.links.map(([a, b], i) => {
            const key = [a, b].sort().join('|');
            return (
              <ConnectionLine key={key} id={`${ids}-c${i}`} curve={curveBetween(a, b)} px={px} active={worksTogether(infoAt(a, false), infoAt(b, false))} near={selectedLinks.has(key)} />
            );
          })}

          {/* The game's slot sprites: a disc inside, a teardrop pointing out for external slots, with their own
              art for Volatile, Conductive and Omni slots (built in or grafted). Organelles cover them. */}
          <g className="slot-sprites">
            {body.slots.map((slot) => {
              // While you hold an organelle, like the game: slots it can't go in dim, its target grows and brightens.
              const target = !!snap.target && (slot.id === snap.target || slot.id === twinOf(snap.target));
              const off = !!held && !fits(build, body, data, held, slot.id);
              return (
                <g key={slot.id} transform={placement(slot).transform} className={`slot-sprite ${target ? 'target' : ''} ${off ? 'off' : ''}`}>
                  <g transform={target ? 'scale(1.15)' : undefined}>
                    <ArtLayers layers={[slotArt(slot.kind, slotState(build, body, slot.id)?.graft ?? slot.special)]} />
                  </g>
                </g>
              );
            })}
          </g>

          {/* Organelles as the game draws them: external ones stick straight out of their slot, internal ones sit on it. */}
          {(['external', 'internal'] as const).map((kind) => (
            <g key={kind} className={`organelle-art organelle-art-${kind}`}>
              {body.slots
                .filter((slot) => slot.kind === kind)
                .map((slot) => {
                  const e = equipped.get(slot.id);
                  if (!e) return null;
                  const item = result.items.get(slot.id);
                  const dim = (!!item?.weapon && item.weapon.dps === 0) || e.excluded;
                  const rarity = data.rarities[Math.min(e.rarity, data.rarities.length - 1)];
                  const covered = !!snap.target && (slot.id === snap.target || slot.id === twinOf(snap.target));
                  return (
                    <g
                      key={slot.id}
                      transform={placement(slot).transform}
                      className={`organelle ${dim ? 'dim' : ''} ${selected === slot.id ? 'selected' : ''} ${covered ? 'covered' : ''}`}
                      onPointerDown={(ev) => pressOrganelle(ev, slot.id)}
                      onPointerEnter={() => !held && setHovered(slot.id)}
                      onPointerLeave={() => setHovered((h) => (h === slot.id ? null : h))}
                      onClick={(ev) => {
                        if (activeTool.kind !== 'select' || held) return;
                        ev.stopPropagation();
                        onSelect(slot.id);
                      }}
                    >
                      <OrganelleArt look={e.look} color={flagellumColor(e.look, build.classId, e.rarity)} outline={e.rarity > 0 ? rarity.color : undefined} />
                    </g>
                  );
                })}
            </g>
          ))}

          {held && (
            <HeldArt
              held={held}
              slots={snap.target ? [snap.target, twinOf(snap.target)].filter((id): id is string => !!id) : []}
              placeAt={(id) => placement(body.slotById.get(id)!).transform}
              handRef={handRef}
              classId={build.classId}
              data={data}
            />
          )}

          {/* The game's arrows: only for the organelle you hold, hover or have selected, coloured by where they come from. */}
          {arrows.map((a, i) => {
            const from = a.toward === a.b ? a.a : a.b;
            const paint = arrowPaint(a.color);
            return <FlowArrows key={`${from}>${a.toward}`} id={`${ids}-f${i}`} curve={curveBetween(from, a.toward)} px={px} core={paint.core} glow={paint.glow} alpha={a.alpha} />;
          })}
        </ClockContext.Provider>

        {ghosts.map((g) => {
          const covered = g.covers.map(organelleName).join(', ');
          const label = `Attach ${addType?.name ?? 'module'} here${covered ? ` (covers ${covered})` : ''}`;
          return (
            <polygon
              key={`${g.pieceId}:${g.edge}`}
              points={pts(g.vertices)}
              className={`ghost ${g.covers.length ? 'covers' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={label}
              onClick={(e) => {
                e.stopPropagation();
                addPiece(g);
              }}
              onKeyDown={onActivate(() => addPiece(g))}
            >
              <title>{label}</title>
            </polygon>
          );
        })}

        {body.slots.map((slot) => {
          const state = slotState(build, body, slot.id);
          const inst = state?.organelle;
          const def = inst ? organelles.get(inst.id) : undefined;
          const c = slotCenter(slot);
          const r = radius(slot);
          const graftId = state?.graft ?? slot.special;
          const graft = graftId ? data.grafts.find((g) => g.id === graftId) : undefined;
          const item = result.items.get(slot.id);
          const invalid = inst && !item;
          const inactive = !!item?.weapon && item.weapon.dps === 0;
          const unmodeled = item && !item.modeled;
          const kind = slot.kind === 'internal' ? 'Internal' : 'External';
          const twin = twinOf(slot.id);
          const label = `${kind} slot${graft ? ` (${graft.name}${slot.special && !state?.graft ? ', built in' : ''})` : ''}${
            twin ? `, mirrored with the other side` : ''
          }: ${def ? `${def.name}, ${inst!.rarity}${unmodeled ? ' (not modeled yet)' : ''}` : 'empty'}`;
          const select = () => activeTool.kind === 'select' && onSelect(slot.id);
          return (
            <g
              key={slot.id}
              className={`slot slot-${slot.kind} ${def ? `filled cat-${def.category}` : 'empty'} ${selected === slot.id ? 'selected' : ''} ${
                invalid ? 'invalid' : ''
              } ${inactive ? 'inactive' : ''} ${unmodeled ? 'unmodeled' : ''} ${state?.excluded ? 'excluded' : ''}`}
              role="button"
              tabIndex={activeTool.kind === 'select' ? 0 : -1}
              aria-label={label}
              aria-pressed={selected === slot.id}
              onPointerDown={(e) => def && pressOrganelle(e, slot.id)}
              onPointerEnter={() => !held && def && setHovered(slot.id)}
              onPointerLeave={() => setHovered((h) => (h === slot.id ? null : h))}
              onClick={(e) => {
                // While carrying, the body view's click handler drops it.
                if (held) return;
                e.stopPropagation();
                select();
              }}
              onKeyDown={onActivate(() => (held ? dropAt(slot.id) : select()))}
            >
              <title>{label}</title>
              <circle className="slot-body" cx={c.x * S} cy={c.y * S} r={r * S} />
            </g>
          );
        })}
        {flash && body.slotById.has(flash.slot) && (
          <circle
            key={flash.n}
            className="drop-flash"
            cx={slotCenter(body.slotById.get(flash.slot)!).x * S}
            cy={slotCenter(body.slotById.get(flash.slot)!).y * S}
            r={radius(body.slotById.get(flash.slot)!) * 1.6 * S}
            onAnimationEnd={() => setFlash(null)}
          />
        )}
      </svg>
      {held && (
        <div
          ref={removeRef}
          className={`remove-zone ${snap.remove ? 'over' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={`Remove ${heldName}`}
          onClick={discard}
          onKeyDown={onActivate(discard)}
        >
          <span className="remove-zone-icon" aria-hidden="true">
            ✕
          </span>
          Remove
        </div>
      )}
      </div>
      {held && (
        <div ref={chipRef} className={`held-chip ${snap.remove ? 'remove' : ''} ${snap.blocked && !snap.target ? 'blocked' : ''}`} hidden>
          <img className="held-chip-icon" src={organelleIcon(held.organelle.id)} alt="" width={36} height={36} />
          <span className="held-chip-text">
            <strong>{heldName}</strong>
            <span>{chipAction()}</span>
          </span>
        </div>
      )}

      <Legend data={data} />
    </section>
  );
}

/**
 * The organelle in your hand: previewed in the slot it would drop into (and a
 * fainter copy on its mirrored twin), or following the pointer over the body.
 * The hand's position is set straight on the element as the pointer moves.
 */
function HeldArt({
  held,
  slots,
  placeAt,
  handRef,
  classId,
  data,
}: {
  held: Held;
  slots: string[];
  placeAt: (slotId: string) => string;
  handRef: RefObject<SVGGElement | null>;
  classId: string;
  data: GameData;
}) {
  const look = organelleArt(held.organelle.id);
  if (!look) return null;
  const rarity = Math.max(0, data.rarities.findIndex((r) => r.id === held.organelle.rarity));
  const paint = { color: flagellumColor(look, classId, rarity), outline: rarity > 0 ? data.rarities[rarity].color : undefined };
  return (
    <g className="held">
      {slots.map((id, i) => (
        <g key={id} transform={placeAt(id)} className={`held-preview ${i > 0 ? 'ghost' : ''}`}>
          <OrganelleArt look={look} {...paint} />
        </g>
      ))}
      <g ref={handRef} className="held-hand" visibility="hidden">
        <OrganelleArt look={look} {...paint} />
      </g>
    </g>
  );
}

function ModularToolbar({ body, tool, setTool }: { body: ModularBody; tool: Tool; setTool: (t: Tool) => void }) {
  const isTool = (t: Tool) => t.kind === tool.kind && (t.kind !== 'add' || (tool.kind === 'add' && tool.pieceType === t.pieceType));
  return (
    <div className="toolbar" role="toolbar" aria-label="Editing tools" onKeyDown={(e) => e.key === 'Escape' && setTool({ kind: 'select' })}>
      <button className={isTool({ kind: 'select' }) ? 'active' : ''} aria-pressed={isTool({ kind: 'select' })} onClick={() => setTool({ kind: 'select' })}>
        Select
      </button>
      {body.pieceTypes
        .filter((p) => p.addable)
        .map((p) => (
          <button
            key={p.id}
            className={isTool({ kind: 'add', pieceType: p.id }) ? 'active' : ''}
            aria-pressed={isTool({ kind: 'add', pieceType: p.id })}
            onClick={() => setTool({ kind: 'add', pieceType: p.id })}
          >
            <svg className="tool-icon" viewBox="-6 -6 12 12" aria-hidden="true">
              {p.sides === 3 ? <polygon points="0,-5 5,4 -5,4" /> : <rect x="-4.5" y="-4.5" width="9" height="9" />}
            </svg>
            Add {p.name.replace(/ module$/i, '').toLowerCase()}
          </button>
        ))}
      <button className={`danger ${isTool({ kind: 'remove' }) ? 'active' : ''}`} aria-pressed={isTool({ kind: 'remove' })} onClick={() => setTool({ kind: 'remove' })}>
        Remove module
      </button>
    </div>
  );
}

function FreeformToolbar({ tool, setTool, blobs }: { tool: Tool; setTool: (t: Tool) => void; blobs: number }) {
  const is = (t: Tool) => t.kind === tool.kind && (t.kind !== 'grow' || (tool.kind === 'grow' && tool.slot === t.slot));
  const button = (t: Tool, label: string, extra = '') => (
    <button className={`${extra} ${is(t) ? 'active' : ''}`} aria-pressed={is(t)} onClick={() => setTool(t)}>
      {label}
    </button>
  );
  return (
    <div className="toolbar" role="toolbar" aria-label="Editing tools" onKeyDown={(e) => e.key === 'Escape' && setTool({ kind: 'select' })}>
      {button({ kind: 'select' }, 'Select')}
      {button({ kind: 'grow', slot: 'external' }, 'Grow external slot')}
      {button({ kind: 'grow', slot: 'internal' }, 'Grow internal slot')}
      {blobs > 0 && button({ kind: 'remove' }, 'Remove blob', 'danger')}
      <span className="toolbar-note muted small">Ectoplasmic Bulge grows an external slot, Endomembrane Folding an internal one.</span>
    </div>
  );
}

/**
 * Evolving step by step, as in a run: the evolution picker at levels 2, 6 and
 * 10. Each step you've settled shrinks to a line you can reopen; the next one
 * shows what the game can offer there (evolutionOffer: the evolution you have
 * lists guaranteed ones, shown first; the rest are drawn at random, 3 cards in
 * all, plus Skip).
 */
function EvolutionFlow({ data, build, body, dispatch }: { data: GameData; build: Build; body: EvolvingBody; dispatch: Dispatch<Action> }) {
  if (body.tiers.length === 0) {
    return <p className="note">Only the starting body is known so far: evolutions need the full game's files.</p>;
  }
  // Settled tiers come first (an empty one before a later pick counts as skipped); the next is open.
  const open = Math.min(build.evolutions.length, body.tiers.length);
  const choose = (tier: number, id: string) => dispatch({ type: 'setEvolution', tier, id });
  const perks = (plan: BodyPlan) =>
    [
      plan.bonusDamage ? `+${Math.round(plan.bonusDamage * 100)}% damage` : '',
      plan.bonusHp ? `+${plan.bonusHp} max HP` : '',
      plan.bonusStamina ? `+${plan.bonusStamina} stamina` : '',
    ]
      .filter(Boolean)
      .join(', ');
  const offer = open < body.tiers.length ? evolutionOffer(data, body, build.evolutions, open) : null;
  const card = (id: string, guaranteed: boolean) => {
    const plan = data.bodies[id];
    const perk = perks(plan);
    return (
      <button key={id} className={`evolution-card ${guaranteed ? 'guaranteed' : ''}`} onClick={() => choose(open, id)} title={plan.description ?? plan.name}>
        {guaranteed && <span className="evolution-badge">Always offered</span>}
        {plan.sprite && <PlanThumb plan={plan} size={40} />}
        <span className="evolution-name">{plan.name}</span>
        {perk && <span className="evolution-perk">{perk}</span>}
      </button>
    );
  };
  return (
    <div className="evolution-flow">
      {build.evolutions.slice(0, open).map((pick, tier) => {
        const plan = pick && pick !== SKIP_EVOLUTION ? data.bodies[pick] : undefined;
        const perk = plan ? perks(plan) : '';
        return (
          <div key={tier} className="evolution-step done">
            <span className="evolution-level">Level {EVOLUTION_LEVELS[tier]}</span>
            {plan?.sprite && <PlanThumb plan={plan} size={28} />}
            <span className="evolution-name">{plan ? plan.name : 'Skipped'}</span>
            {perk && <span className="evolution-perk">{perk}</span>}
            <button className="link small" onClick={() => choose(tier, '')} aria-label={`Change the level ${EVOLUTION_LEVELS[tier]} evolution`}>
              Change
            </button>
          </div>
        );
      })}
      {offer && (
        <fieldset className="evolution-step open">
          <legend>
            Level {EVOLUTION_LEVELS[open]} evolution{offer.current ? ` after ${offer.current.name}` : ''}
          </legend>
          <p className="muted small">
            {offer.guaranteed.length > 0
              ? `The game always offers ${offer.guaranteed.map((id) => data.bodies[id].name).join(' and ')} here${
                  offer.guaranteed.length < 3 ? `, and ${3 - offer.guaranteed.length === 1 ? 'one' : 'two'} of the others at random` : ''
                }, plus Skip.`
              : 'The game offers 3 of these at random, plus Skip.'}
          </p>
          <div className="evolution-options">
            {offer.guaranteed.map((id) => card(id, true))}
            {offer.pool.map((id) => card(id, false))}
            <button className="evolution-card none" onClick={() => choose(open, SKIP_EVOLUTION)} title="Skip Evolution: no effect">
              <span className="evolution-name">Skip</span>
            </button>
          </div>
        </fieldset>
      )}
    </div>
  );
}

function Legend({ data }: { data: GameData }) {
  return (
    <ul className="legend" aria-label="Legend">
      {data.rarities.map((r) => (
        <li key={r.id}>
          <span className="swatch ring" style={{ borderColor: r.color }} />
          {r.name}
        </li>
      ))}
      <li>
        <span className="swatch line arrows" />
        Arrows: what the organelle you point at works with, in the colour of the one giving the effect
      </li>
      {data.grafts.map((g) => (
        <li key={g.id}>
          <img className="swatch slot-sprite" src={art(slotArt('internal', g.id).src!)} width={16} height={16} alt="" />
          {g.name} slot
        </li>
      ))}
    </ul>
  );
}
