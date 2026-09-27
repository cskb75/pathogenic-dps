import { useMemo, useState, type CSSProperties, type Dispatch, type KeyboardEvent } from 'react';
import { placementOptions, removePieceTree, type PlacementOption, type Slot } from '../engine/body';
import type { CalcResult } from '../engine/calc';
import { findClass } from '../engine/calc';
import type { Vec } from '../engine/geometry';
import type { Build, GameData } from '../engine/types';
import type { Action } from '../state/build';
import { abbreviate } from './format';

type Tool = { kind: 'select' } | { kind: 'add'; pieceType: string } | { kind: 'remove' };

interface Props {
  data: GameData;
  build: Build;
  result: CalcResult;
  selected: string | null;
  onSelect: (slotId: string | null) => void;
  dispatch: Dispatch<Action>;
}

// Drawing scale: one piece edge = 100 SVG units.
const S = 100;
const R_INTERNAL = 0.17;
const R_EXTERNAL = 0.12;
const EXTERNAL_OFFSET = 0.08;

const pts = (vs: Vec[]) => vs.map((v) => `${v.x * S},${v.y * S}`).join(' ');

function slotCenter(slot: Slot): Vec {
  if (!slot.facing) return slot.position;
  return { x: slot.position.x + slot.facing.x * EXTERNAL_OFFSET, y: slot.position.y + slot.facing.y * EXTERNAL_OFFSET };
}

const radius = (slot: Slot) => (slot.kind === 'internal' ? R_INTERNAL : R_EXTERNAL);

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
  const organelles = useMemo(() => new Map(data.organelles.map((o) => [o.id, o])), [data]);
  const rarityColor = useMemo(() => new Map(data.rarities.map((r) => [r.id, r.color])), [data]);

  const occupied = useMemo(
    () => new Set(Object.entries(build.slots).filter(([, s]) => s.organelle).map(([id]) => id)),
    [build.slots],
  );

  const addType = tool.kind === 'add' ? cls.pieceTypes.find((p) => p.id === tool.pieceType) : undefined;
  const ghosts = useMemo(
    () => (addType ? placementOptions(body, addType.sides, occupied).filter((o) => o.valid) : []),
    [addType, body, occupied],
  );

  // Frame the body plus room for one more square on every side, so the view
  // doesn't jump when switching tools.
  const viewBox = useMemo(() => {
    const frame = placementOptions(body, 4, new Set()).filter((o) => o.valid);
    const all = [...body.placed.flatMap((p) => p.vertices), ...frame.flatMap((o) => o.vertices)];
    const xs = all.map((v) => v.x);
    const ys = all.map((v) => v.y);
    const pad = 0.35;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const w = Math.max(...xs) + pad - minX;
    const h = Math.max(...ys) + pad - minY;
    return `${minX * S} ${minY * S} ${w * S} ${h * S}`;
  }, [body]);

  const removal = useMemo(() => {
    if (tool.kind !== 'remove' || !hoverPiece || hoverPiece === build.pieces[0]?.id) return new Set<string>();
    const kept = new Set(removePieceTree(build.pieces, hoverPiece).map((p) => p.id));
    return new Set(build.pieces.filter((p) => !kept.has(p.id)).map((p) => p.id));
  }, [tool.kind, hoverPiece, build.pieces]);

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
    const lost = Object.entries(build.slots).filter(
      ([id, s]) => s.organelle && doomed.some((p) => id.startsWith(`${p.id}.`)),
    ).length;
    const what = `${doomed.length} module${doomed.length > 1 ? 's' : ''}`;
    if (lost > 0 && !window.confirm(`Remove ${what} and the ${lost} organelle${lost > 1 ? 's' : ''} on them?`)) return;
    dispatch({ type: 'removePiece', pieceId });
    setHoverPiece(null);
    if (selected && doomed.some((p) => selected.startsWith(`${p.id}.`))) onSelect(null);
  }

  const addablePieces = cls.pieceTypes.filter((p) => p.addable);
  const isTool = (t: Tool) => t.kind === tool.kind && (t.kind !== 'add' || (tool.kind === 'add' && tool.pieceType === t.pieceType));

  const hint =
    tool.kind === 'select'
      ? 'Click a slot to equip it. Circles are internal slots; small nodes on the edges are external slots.'
      : tool.kind === 'add'
        ? `Click a dashed outline to attach a ${addType?.name.toLowerCase() ?? 'module'}. Orange outlines cover an equipped organelle, which gets removed.`
        : 'Click a module to remove it and everything attached to it. The core stays.';

  return (
    <section className="panel editor" aria-label="Body editor">
      <div className="toolbar" role="toolbar" aria-label="Editing tools" onKeyDown={(e) => e.key === 'Escape' && setTool({ kind: 'select' })}>
        <button className={isTool({ kind: 'select' }) ? 'active' : ''} aria-pressed={isTool({ kind: 'select' })} onClick={() => setTool({ kind: 'select' })}>
          Select
        </button>
        {addablePieces.map((p) => (
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
        <button
          className={`danger ${isTool({ kind: 'remove' }) ? 'active' : ''}`}
          aria-pressed={isTool({ kind: 'remove' })}
          onClick={() => setTool({ kind: 'remove' })}
        >
          Remove module
        </button>
      </div>
      <p className="hint">{hint}</p>

      <svg className={`body-svg tool-${tool.kind}`} viewBox={viewBox} onClick={() => tool.kind === 'select' && onSelect(null)}>
        <defs>
          {['attack', 'gun', 'overcharge'].map((k) => (
            <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className={`arrowhead ${k}`} />
            </marker>
          ))}
        </defs>

        {body.placed.map((piece) => (
          <polygon
            key={piece.id}
            points={pts(piece.vertices)}
            className={`piece piece-${piece.type} ${removal.has(piece.id) ? 'doomed' : ''}`}
            onMouseEnter={() => setHoverPiece(piece.id)}
            onMouseLeave={() => setHoverPiece(null)}
            onClick={(e) => {
              if (tool.kind !== 'remove') return;
              e.stopPropagation();
              removePiece(piece.id);
            }}
          >
            <title>{cls.pieceTypes.find((t) => t.id === piece.type)?.name ?? piece.type}</title>
          </polygon>
        ))}

        {body.links.map(([a, b]) => {
          const key = [a, b].sort().join('|');
          return (
            <line key={key} {...trimmedLine(body.slotById.get(a)!, body.slotById.get(b)!)} className={`connector ${selectedLinks.has(key) ? 'near' : ''}`} />
          );
        })}

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
          const state = build.slots[slot.id];
          const inst = state?.organelle;
          const def = inst ? organelles.get(inst.id) : undefined;
          const c = slotCenter(slot);
          const r = radius(slot);
          const graft = state?.graft ? data.grafts.find((g) => g.id === state.graft) : undefined;
          const item = result.items.get(slot.id);
          const invalid = inst && !item;
          const inactive = !!item?.weapon && item.weapon.dps === 0;
          const unmodeled = item && !item.modeled;
          const label = `${slot.kind === 'internal' ? 'Internal' : 'External'} slot${graft ? ` (${graft.name})` : ''}: ${
            def ? `${def.name}, ${inst!.rarity}${unmodeled ? ' (not modeled yet)' : ''}` : 'empty'
          }`;
          const select = () => tool.kind === 'select' && onSelect(slot.id);
          return (
            <g
              key={slot.id}
              className={`slot slot-${slot.kind} ${def ? `filled cat-${def.category}` : 'empty'} ${selected === slot.id ? 'selected' : ''} ${
                invalid ? 'invalid' : ''
              } ${inactive ? 'inactive' : ''} ${unmodeled ? 'unmodeled' : ''} ${state?.excluded ? 'excluded' : ''}`}
              style={def ? ({ '--rarity': rarityColor.get(inst!.rarity) } as CSSProperties) : undefined}
              role="button"
              tabIndex={tool.kind === 'select' ? 0 : -1}
              aria-label={label}
              aria-pressed={selected === slot.id}
              onClick={(e) => {
                e.stopPropagation();
                select();
              }}
              onKeyDown={onActivate(select)}
            >
              <title>{label}</title>
              {slot.facing && def?.category === 'weapon' && (
                <polygon
                  className="facing"
                  points={pts([
                    { x: c.x + slot.facing.x * (r + 0.13), y: c.y + slot.facing.y * (r + 0.13) },
                    { x: c.x + slot.facing.y * 0.06 + slot.facing.x * (r + 0.03), y: c.y - slot.facing.x * 0.06 + slot.facing.y * (r + 0.03) },
                    { x: c.x - slot.facing.y * 0.06 + slot.facing.x * (r + 0.03), y: c.y + slot.facing.x * 0.06 + slot.facing.y * (r + 0.03) },
                  ])}
                />
              )}
              {graft && <circle className={`graft graft-${graft.id}`} cx={c.x * S} cy={c.y * S} r={(r + 0.045) * S} />}
              <circle className="slot-body" cx={c.x * S} cy={c.y * S} r={r * S} />
              {def && (
                <text x={c.x * S} y={c.y * S} className="slot-label" dominantBaseline="central" textAnchor="middle" fontSize={slot.kind === 'internal' ? 13 : 9.5}>
                  {abbreviate(def.name)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

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
            <span className={`swatch ring graft-${g.id}`} />
            {g.name} slot
          </li>
        ))}
      </ul>
    </section>
  );
}
