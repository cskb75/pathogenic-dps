import { useId, useMemo, useState, type Dispatch, type KeyboardEvent } from 'react';
import type { Build, ClassDef, GameData, PlasmidDef } from '../engine/types';
import type { Action } from '../state/build';
import { availableNodes } from '../state/plasmidTree';
import { plasmidIcon, uiArt } from './art';

interface Props {
  data: GameData;
  cls: ClassDef;
  build: Build;
  dispatch: Dispatch<Action>;
}

const R = 46;
/** Width of the DNA strand between nodes: the game's 70px line next to its 174px node frames. */
const STRAND = 36;
/** The game scrolls its strands at 0.15 texture widths a second. */
const STRAND_SECONDS = 6.7;

/** In the game a link is gold between owned nodes, blue from an owned node and faint grey elsewhere (plasmid_connection.gd). */
type LinkState = 'owned' | 'open' | 'locked';
const STRAND_ART: Record<LinkState, string> = { owned: 'dna-yellow', open: 'dna-blue', locked: 'dna-gray' };
/** Node frames from plasmid_bg.gd, with each texture's size relative to the lit frames (174px). */
const FRAME: Record<string, { art: string; w: number; h: number }> = {
  locked: { art: 'plasmid-locked', w: 148 / 174, h: 153 / 174 },
  available: { art: 'plasmid-available', w: 1, h: 176 / 174 },
  owned: { art: 'plasmid-owned', w: 1, h: 176 / 174 },
};
FRAME.root = FRAME.owned;

/** A pathogen's plasmid tree, laid out as in the game. Click nodes to own them. */
export function PlasmidTree({ data, cls, build, dispatch }: Props) {
  const nodes = cls.plasmids;
  const owned = useMemo(() => new Set(Object.keys(build.plasmids)), [build.plasmids]);
  const available = useMemo(() => availableNodes(nodes, owned), [nodes, owned]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const mutations = useMemo(() => new Map(data.mutations.map((m) => [m.id, m])), [data]);
  const [focus, setFocus] = useState<string | null>(null);
  const shown = focus ? byId.get(focus) : undefined;
  const uid = useId().replace(/[^\w-]/g, '');
  const [still] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

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
        Laid out as in the game. Click a node to own it (and the path to it); click an owned node to give it back. Nodes with a{' '}
        <span className="swatch pip" aria-hidden="true" /> pip change your damage.
      </p>
      <div className="plasmid-stage">
        <svg className="plasmid-svg" viewBox={box.vb} role="group" aria-label={`${cls.name} plasmid tree`}>
          <defs>
            {(Object.keys(STRAND_ART) as LinkState[]).map((k) => (
              <pattern key={k} id={`${uid}-${k}`} patternUnits="userSpaceOnUse" width={STRAND} height={STRAND} y={-STRAND / 2}>
                <image href={uiArt(STRAND_ART[k])} width={STRAND} height={STRAND} preserveAspectRatio="none" />
                {!still && k !== 'locked' && (
                  <animateTransform attributeName="patternTransform" type="translate" from="0 0" to={`${STRAND} 0`} dur={`${STRAND_SECONDS}s`} repeatCount="indefinite" />
                )}
              </pattern>
            ))}
          </defs>
          {links.map(([a, b]) => {
            const state: LinkState = isOwned(a) && isOwned(b) ? 'owned' : isOwned(a) || isOwned(b) ? 'open' : 'locked';
            // Strands flow away from the owned end.
            const [from, to] = state === 'open' && isOwned(b) ? [b, a] : [a, b];
            const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
            return (
              <rect
                key={`${a.id}>${b.id}`}
                className={`plasmid-link ${state}`}
                x={0}
                y={-STRAND / 2}
                width={Math.hypot(to.x - from.x, to.y - from.y)}
                height={STRAND}
                fill={`url(#${uid}-${state})`}
                transform={`translate(${from.x} ${from.y}) rotate(${angle})`}
              />
            );
          })}
          {nodes.map((n) => {
            const state = n.root ? 'root' : owned.has(n.id) ? 'owned' : available.has(n.id) ? 'available' : 'locked';
            const icon = plasmidIcon(n, data);
            const label = `${n.name}: ${n.description}${state === 'owned' ? ' (owned)' : ''}`;
            const frame = FRAME[state];
            // The starting node's icon is a plain white disc: keep it small so its frame shows.
            const iconR = n.root ? R * 0.45 : R * 0.76;
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
                <g className="plasmid-art">
                  <image href={uiArt(frame.art)} x={-R * frame.w} y={-R * frame.h} width={2 * R * frame.w} height={2 * R * frame.h} preserveAspectRatio="none" />
                  {icon && (
                    <image className="plasmid-icon" href={icon} x={-iconR} y={-iconR} width={2 * iconR} height={2 * iconR} preserveAspectRatio="xMidYMid meet" />
                  )}
                </g>
                {affectsDps(n) && <circle className="plasmid-dps" cx={R * 0.7} cy={-R * 0.7} r={R * 0.17} />}
              </g>
            );
          })}
        </svg>
      </div>
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
