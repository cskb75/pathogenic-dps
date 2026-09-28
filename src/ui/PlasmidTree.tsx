import { useMemo, useState, type Dispatch, type KeyboardEvent } from 'react';
import type { Build, ClassDef, GameData, PlasmidDef } from '../engine/types';
import type { Action } from '../state/build';
import { availableNodes } from '../state/plasmidTree';
import { plasmidIcon } from './art';

interface Props {
  data: GameData;
  cls: ClassDef;
  build: Build;
  dispatch: Dispatch<Action>;
}

const R = 46;

/** A pathogen's plasmid tree, laid out as in the game. Click nodes to own them. */
export function PlasmidTree({ data, cls, build, dispatch }: Props) {
  const nodes = cls.plasmids;
  const owned = useMemo(() => new Set(Object.keys(build.plasmids)), [build.plasmids]);
  const available = useMemo(() => availableNodes(nodes, owned), [nodes, owned]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const mutations = useMemo(() => new Map(data.mutations.map((m) => [m.id, m])), [data]);
  const [focus, setFocus] = useState<string | null>(null);
  const shown = focus ? byId.get(focus) : undefined;

  const box = useMemo(() => {
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const pad = R + 14;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    return { vb: `${minX} ${minY} ${Math.max(...xs) + pad - minX} ${Math.max(...ys) + pad - minY}` };
  }, [nodes]);

  const affectsDps = (p: PlasmidDef) => !!p.effects || (!!p.mutation && !!mutations.get(p.mutation)?.effects);
  const toggle = (id: string) => dispatch({ type: 'togglePlasmid', id });
  const onKey = (id: string) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(id);
    }
  };
  const links = nodes.flatMap((n) => n.links.filter((to) => byId.has(to)).map((to) => [n, byId.get(to)!] as const));
  const isOwned = (n: PlasmidDef) => n.root || owned.has(n.id);
  const ownedDps = nodes.filter((n) => owned.has(n.id) && affectsDps(n));

  return (
    <div className="plasmid-tree">
      <div className="picker-head">
        <h3>
          {cls.name} plasmid tree <span className="muted small">({owned.size} owned)</span>
        </h3>
        <button disabled={owned.size === 0} onClick={() => dispatch({ type: 'clearPlasmids' })}>
          Clear
        </button>
      </div>
      <p className="muted small">
        Laid out as in the game. Click a node to own it (and the path to it); click an owned node to give it back. Gold rings change your damage.
      </p>
      <svg className="plasmid-svg" viewBox={box.vb} role="group" aria-label={`${cls.name} plasmid tree`}>
        {links.map(([a, b]) => (
          <line key={`${a.id}>${b.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`plasmid-link ${isOwned(a) && isOwned(b) ? 'owned' : ''}`} />
        ))}
        {nodes.map((n) => {
          const state = n.root ? 'root' : owned.has(n.id) ? 'owned' : available.has(n.id) ? 'available' : 'locked';
          const icon = plasmidIcon(n, data);
          const label = `${n.name}: ${n.description}${state === 'owned' ? ' (owned)' : ''}`;
          return (
            <g
              key={n.id}
              className={`plasmid-node ${state} ${affectsDps(n) ? 'dps' : ''} ${focus === n.id ? 'focus' : ''}`}
              transform={`translate(${n.x} ${n.y})`}
              role={n.root ? undefined : 'button'}
              tabIndex={n.root ? -1 : 0}
              aria-pressed={n.root ? undefined : owned.has(n.id)}
              aria-label={label}
              onClick={() => !n.root && toggle(n.id)}
              onKeyDown={onKey(n.id)}
              onMouseEnter={() => setFocus(n.id)}
              onFocus={() => setFocus(n.id)}
            >
              <title>{label}</title>
              <circle r={R} className="plasmid-bg" />
              {icon && <image href={icon} x={-R * 0.95} y={-R * 0.95} width={R * 1.9} height={R * 1.9} preserveAspectRatio="xMidYMid meet" />}
              <circle r={R} className="plasmid-ring" />
            </g>
          );
        })}
      </svg>
      <div className="plasmid-detail" aria-live="polite">
        {shown ? (
          <>
            <strong>{shown.name}</strong>
            <span className="muted small">{shown.description}</span>
            {shown.mutation && mutations.get(shown.mutation) && <span className="pick-note small">Counts as a stack of {mutations.get(shown.mutation)!.name}.</span>}
            {shown.notes && <span className="pick-note small">{shown.notes}</span>}
          </>
        ) : (
          <span className="muted small">Point at a node to see what it does.</span>
        )}
      </div>
      {ownedDps.length > 0 && (
        <p className="small">
          <span className="muted">Owned nodes that change damage: </span>
          {ownedDps.map((n) => n.name).join(', ')}
        </p>
      )}
    </div>
  );
}
