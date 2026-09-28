import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type KeyboardEvent, type MouseEvent } from 'react';
import { buildAmoebaBody, nextGrowthId, placeBlob, type AmoebaBody, type Blob } from '../engine/amoeba';
import { placementOptions, removePieceTree, type PlacementOption, type Slot, type SlotKind } from '../engine/body';
import type { CalcResult } from '../engine/calc';
import { evolutionPath, findClass, slotState } from '../engine/calc';
import type { Vec } from '../engine/geometry';
import type { BodyPlan, Build, EvolvingBody, GameData, ModularBody } from '../engine/types';
import type { Action } from '../state/build';
import { art, PlanThumb } from './art';
import { ArtLayers, flagellumColor, layerCorners, organelleArt, slotArt } from './organelleArt';

type Tool = { kind: 'select' } | { kind: 'add'; pieceType: string } | { kind: 'grow'; slot: SlotKind } | { kind: 'remove' };

interface Props {
  data: GameData;
  build: Build;
  result: CalcResult;
  selected: string | null;
  onSelect: (slotId: string | null) => void;
  dispatch: Dispatch<Action>;
}

// Drawing scale: one editor unit (a Nanobot module side, or 100 game pixels) = 100 SVG units.
const S = 100;
const R_INTERNAL = 0.17;
const R_EXTERNAL = { modular: 0.12, fixed: 0.145 };
/** When the view zooms out to fit long organelles, slots stay at least this big on screen (radius in pixels). */
const MIN_SLOT_PX: Record<SlotKind, number> = { internal: 11, external: 9 };
/** Screen pixels per editor unit that line widths are drawn for (a bare body fills the view at about this scale). */
const REF_UNIT_PX = 150;
/** Room around organelle art at the edges of the view. */
const ART_PAD = 0.15;
/** The game's rarity outline is about 2.5 game pixels (0.025 units) wide; keep it visible when zoomed out. */
const OUTLINE = { units: 0.025, minPx: 1.3 };
/** Nanobot edge slots sit slightly outside the module. */
const EXTERNAL_OFFSET = 0.08;

const pts = (vs: Vec[]) => vs.map((v) => `${v.x * S},${v.y * S}`).join(' ');

const onActivate = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

export function BodyEditor({ data, build, result, selected, onSelect, dispatch }: Props) {
  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  const [hoverPiece, setHoverPiece] = useState<string | null>(null);
  const cls = findClass(data, build.classId);
  const body = result.body;
  const plan = body.plan;
  const modular = cls.body.kind === 'modular' ? cls.body : null;
  const freeform = cls.body.kind === 'freeform';
  const blobs = (body as Partial<AmoebaBody>).blobs;
  const svgRef = useRef<SVGSVGElement>(null);
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

  /** Line between two slots, trimmed so it starts and ends at their edges. */
  function trimmedLine(a: Slot, b: Slot) {
    const p = slotCenter(a);
    const q = slotCenter(b);
    const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const ux = (q.x - p.x) / d;
    const uy = (q.y - p.y) / d;
    const ra = radius(a) + 0.02;
    const rb = radius(b) + 0.03;
    return { x1: (p.x + ux * ra) * S, y1: (p.y + uy * ra) * S, x2: (q.x - ux * rb) * S, y2: (q.y - uy * rb) * S };
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
    return { at, next, fresh, links, blobs: next.blobs.filter((b) => b.growthId === step.id) };
  }, [activeTool, cursor, blobs, plan, build.growth, body]);

  const viewBox = useMemo(() => {
    let all: Vec[];
    let pad: number;
    if (blobs) {
      // Frame the blobs with room to grow one more on every side.
      all = blobs.flatMap((b) => [
        { x: b.x - b.r, y: b.y - b.r },
        { x: b.x + b.r, y: b.y + b.r },
      ]);
      pad = 0.9;
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
  }, [body, plan, blobs, equipped]);

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
  const outline = Math.max(OUTLINE.units, OUTLINE.minPx / (unitPx * artScale));

  const removal = useMemo(() => {
    if (activeTool.kind !== 'remove' || !hoverPiece || hoverPiece === build.pieces[0]?.id) return new Set<string>();
    const kept = new Set(removePieceTree(build.pieces, hoverPiece).map((p) => p.id));
    return new Set(build.pieces.filter((p) => !kept.has(p.id)).map((p) => p.id));
  }, [activeTool.kind, hoverPiece, build.pieces]);

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

  const hasMirrors = body.slots.some((s) => s.mirrorOf);
  const hint =
    activeTool.kind === 'select'
      ? `Click a slot or an organelle to equip it. Round slots are internal. External slots point the way their organelle will stick out.${hasMirrors ? ' Dashed slots copy the organelle from the matching slot on the other side.' : ''}`
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
        <EvolutionPicker data={data} build={build} body={cls.body as EvolvingBody} dispatch={dispatch} />
      )}
      <p className="hint">{hint}</p>

      <svg
        ref={svgRef}
        className={`body-svg tool-${activeTool.kind} ${plan ? 'fixed' : 'modular'} ${freeform ? 'freeform' : ''}`}
        viewBox={viewBox.box}
        style={{ ...(plan ? { aspectRatio: String(viewBox.aspect) } : {}), '--k': zoom } as CSSProperties}
        onMouseMove={(e) => activeTool.kind === 'grow' && setCursor(toBody(e))}
        onMouseLeave={() => setCursor(null)}
        onClick={(e) => {
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
          {['attack', 'gun', 'overcharge'].map((k) => (
            <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className={`arrowhead ${k}`} />
            </marker>
          ))}
          {/* Organelles above Common get an outline in their rarity's colour, like the game's outline shaders (scn/shaders/outline_*.tres). */}
          {data.rarities.slice(1).map((r) => (
            <filter key={r.id} id={`${ids}-outline-${r.id}`} x="-25%" y="-25%" width="150%" height="150%">
              <feMorphology in="SourceAlpha" operator="dilate" radius={outline} result="grown" />
              <feFlood floodColor={r.color} />
              <feComposite in2="grown" operator="in" result="outline" />
              <feMerge>
                <feMergeNode in="outline" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          ))}
          {/* The body's silhouette: internal organelles' patterns only show inside it. */}
          <mask id={`${ids}-body`} style={{ maskType: 'alpha' }}>
            {plan?.sprite && !blobs && <image href={art(plan.sprite.src)} x={plan.sprite.x * S} y={plan.sprite.y * S} width={plan.sprite.w * S} height={plan.sprite.h * S} preserveAspectRatio="none" />}
            {plan && !plan.sprite && !blobs && <polygon points={plan.outline.map(([x, y]) => `${x * S},${y * S}`).join(' ')} fill="#fff" />}
            {blobs?.map((b, i) => <circle key={i} cx={b.x * S} cy={b.y * S} r={b.r * S} fill="#fff" />)}
            {body.placed.map((piece) => (
              <polygon key={piece.id} points={pts(piece.vertices)} fill="#fff" />
            ))}
          </mask>
        </defs>

        {plan && !blobs && <BodyArt plan={plan} />}

        {blobs && (
          <g className="blobs">
            <defs>
              {/* The game tiles this pattern 4 times across its 512px blob canvas. */}
              <pattern id="amoeba-texture" patternUnits="userSpaceOnUse" width={128} height={128}>
                <image href={art('art/classes/amoeba-pattern.webp')} width={128} height={128} />
              </pattern>
            </defs>
            {['outer', 'inner'].map((ring) =>
              blobs.map((b, i) => <circle key={`${ring}${i}`} className={`blob-outline ${ring}`} cx={b.x * S} cy={b.y * S} r={b.r * S} />),
            )}
            {blobs.map((b, i) => (
              <circle
                key={`f${i}`}
                className={`blob ${b.growthId === undefined ? 'first' : 'grown'}`}
                cx={b.x * S}
                cy={b.y * S}
                r={b.r * S}
                onClick={(e) => {
                  if (activeTool.kind !== 'remove') return;
                  e.stopPropagation();
                  removeBlob(b);
                }}
              >
                {b.growthId !== undefined && <title>Grown blob</title>}
              </circle>
            ))}
            {growPreview?.blobs.map((b, i) => <circle key={`g${i}`} className="blob-ghost" cx={b.x * S} cy={b.y * S} r={b.r * S} />)}
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

        {body.links.map(([a, b]) => {
          const key = [a, b].sort().join('|');
          return <line key={key} {...trimmedLine(body.slotById.get(a)!, body.slotById.get(b)!)} className={`connector ${selectedLinks.has(key) ? 'near' : ''}`} />;
        })}

        {/* The game's slot sprites: a disc inside, a teardrop pointing out for external slots, with their own
            art for Volatile, Conductive and Omni slots (built in or grafted). Organelles cover them. */}
        <g className="slot-sprites">
          {body.slots.map((slot) => (
            <g key={slot.id} transform={placement(slot).transform}>
              <ArtLayers layers={[slotArt(slot.kind, slotState(build, body, slot.id)?.graft ?? slot.special)]} />
            </g>
          ))}
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
                const layers = e.look.layers.filter((l) => !l.masked);
                const rarity = data.rarities[Math.min(e.rarity, data.rarities.length - 1)];
                return (
                  <g
                    key={slot.id}
                    transform={placement(slot).transform}
                    className={`organelle ${dim ? 'dim' : ''} ${selected === slot.id ? 'selected' : ''}`}
                    onClick={(ev) => {
                      if (activeTool.kind !== 'select') return;
                      ev.stopPropagation();
                      onSelect(slot.id);
                    }}
                  >
                    <g filter={e.rarity > 0 ? `url(#${ids}-outline-${rarity.id})` : undefined}>
                      <ArtLayers layers={layers} color={flagellumColor(e.look, build.classId, e.rarity)} />
                    </g>
                  </g>
                );
              })}
          </g>
        ))}

        {result.links.map((l) => {
          const dim = selected && l.from !== selected && l.to !== selected;
          return (
            <line
              key={`${l.kind}:${l.from}>${l.to}`}
              {...trimmedLine(body.slotById.get(l.from)!, body.slotById.get(l.to)!)}
              className={`flow ${l.kind} ${dim ? 'dim' : ''}`}
              markerEnd={`url(#arrow-${l.kind})`}
            />
          );
        })}

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
          const label = `${kind} slot${graft ? ` (${graft.name}${slot.special && !state?.graft ? ', built in' : ''})` : ''}${
            slot.mirrorOf ? `, copy of ${slot.mirrorOf}` : ''
          }: ${def ? `${def.name}, ${inst!.rarity}${unmodeled ? ' (not modeled yet)' : ''}` : 'empty'}`;
          const select = () => activeTool.kind === 'select' && onSelect(slot.id);
          return (
            <g
              key={slot.id}
              className={`slot slot-${slot.kind} ${def ? `filled cat-${def.category}` : 'empty'} ${selected === slot.id ? 'selected' : ''} ${
                invalid ? 'invalid' : ''
              } ${inactive ? 'inactive' : ''} ${unmodeled ? 'unmodeled' : ''} ${state?.excluded ? 'excluded' : ''} ${slot.mirrorOf ? 'mirror' : ''}`}
              role="button"
              tabIndex={activeTool.kind === 'select' ? 0 : -1}
              aria-label={label}
              aria-pressed={selected === slot.id}
              onClick={(e) => {
                e.stopPropagation();
                select();
              }}
              onKeyDown={onActivate(select)}
            >
              <title>{label}</title>
              <circle className="slot-body" cx={c.x * S} cy={c.y * S} r={r * S} />
            </g>
          );
        })}
      </svg>

      <Legend data={data} mirrors={hasMirrors} />
    </section>
  );
}

/**
 * A Nanobot module's texture. In the game a square's sprite is 1.03 modules
 * wide; a triangle's is 1.06 x 0.94, drawn apex up, 0.15 modules above its centre.
 */
function PieceArt({ vertices, center }: { vertices: Vec[]; center: Vec }) {
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

function BodyArt({ plan }: { plan: BodyPlan }) {
  if (plan.sprite) {
    const s = plan.sprite;
    return <image href={art(s.src)} x={s.x * S} y={s.y * S} width={s.w * S} height={s.h * S} className="body-art" preserveAspectRatio="none" />;
  }
  if (plan.outline.length > 2) return <polygon className="piece" points={plan.outline.map(([x, y]) => `${x * S},${y * S}`).join(' ')} />;
  return null;
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

function EvolutionPicker({ data, build, body, dispatch }: { data: GameData; build: Build; body: EvolvingBody; dispatch: Dispatch<Action> }) {
  const current = evolutionPath(build, data).at(-1);
  if (body.tiers.length === 0) {
    return <p className="note">Only the starting body is known so far: evolutions need the full game's files.</p>;
  }
  return (
    <div className="evolutions">
      {body.tiers.map((options, tier) => {
        const picked = build.evolutions[tier] ?? '';
        return (
          <fieldset key={tier} className="evolution-tier">
            <legend>Evolution {tier + 1}</legend>
            <div className="evolution-options">
              <button className={`evolution-card none ${picked ? '' : 'active'}`} aria-pressed={!picked} onClick={() => dispatch({ type: 'setEvolution', tier, id: '' })}>
                <span className="evolution-name">{tier === 0 ? 'Not yet' : 'Skip'}</span>
              </button>
              {options.map((id) => {
                const plan = data.bodies[id];
                if (!plan) return null;
                const active = picked === id;
                const perks = [
                  plan.bonusDamage ? `+${Math.round(plan.bonusDamage * 100)}% damage` : '',
                  plan.bonusHp ? `+${plan.bonusHp} max HP` : '',
                  plan.bonusStamina ? `+${plan.bonusStamina} stamina` : '',
                ]
                  .filter(Boolean)
                  .join(', ');
                return (
                  <button
                    key={id}
                    className={`evolution-card ${active ? 'active' : ''} ${current?.id === id ? 'current' : ''}`}
                    aria-pressed={active}
                    onClick={() => dispatch({ type: 'setEvolution', tier, id: active ? '' : id })}
                    title={plan.description ?? plan.name}
                  >
                    {plan.sprite && <PlanThumb plan={plan} size={40} />}
                    <span className="evolution-name">{plan.name}</span>
                    {perks && <span className="evolution-perk">{perks}</span>}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

function Legend({ data, mirrors }: { data: GameData; mirrors: boolean }) {
  return (
    <ul className="legend" aria-label="Legend">
      {data.rarities.map((r) => (
        <li key={r.id}>
          <span className="swatch ring" style={{ borderColor: r.color }} />
          {r.name}
        </li>
      ))}
      <li>
        <span className="swatch line attack" />
        Attack passes through
      </li>
      <li>
        <span className="swatch line gun" />
        Attack speed
      </li>
      <li>
        <span className="swatch line overcharge" />
        Overcharge
      </li>
      {data.grafts.map((g) => (
        <li key={g.id}>
          <img className="swatch slot-sprite" src={art(slotArt('internal', g.id).src!)} width={16} height={16} alt="" />
          {g.name} slot
        </li>
      ))}
      {mirrors && (
        <li>
          <span className="swatch ring mirror" />
          Mirrored copy
        </li>
      )}
    </ul>
  );
}
