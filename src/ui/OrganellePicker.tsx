import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { isModeled } from '../engine/sim/behaviours';
import type { GameData, OrganelleInfo, SlotKind } from '../engine/types';
import { Icon, organelleIcon, TypeIcon } from './art';
import { CATEGORY_LABELS, CATEGORY_ORDER, CATEGORY_TYPE } from './format';
import { deltaTone, formatDelta, type Delta } from './useDeltas';

interface Props {
  data: GameData;
  /** Slot kinds the slot accepts. */
  accepts: SlotKind[];
  current?: string;
  onPick: (id: string) => void;
  /** Dragging a tile picks the organelle up, to drop on the body (mouse and pen; on touch, tap it instead). */
  onGrab?: (id: string) => void;
  /** How much each organelle would change your DPS in the slot (useDeltas.ts), shown on its tile. */
  deltas?: Map<string, Delta>;
  /** Tells the reader what the deltas compare against. */
  deltaNote?: string;
}

/** How far a pointer moves before a press on a tile becomes a drag. */
const DRAG_START_PX = 6;

/** A searchable grid of organelle icons, grouped by category. */
export function OrganellePicker({ data, accepts, current, onPick, onGrab, deltas, deltaNote }: Props) {
  const [query, setQuery] = useState('');
  const dragged = useRef(false);
  function press(e: ReactPointerEvent, id: string) {
    dragged.current = false;
    if (!onGrab || e.pointerType === 'touch' || e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_START_PX) return;
      stop();
      dragged.current = true;
      onGrab(id);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }
  const [category, setCategory] = useState<string>('all');
  const [byGain, setByGain] = useState(false);
  const choices = useMemo(() => data.organelles.filter((o) => accepts.includes(o.slot)), [data, accepts]);
  const categories = CATEGORY_ORDER.filter((c) => choices.some((o) => o.category === c));
  const q = query.trim().toLowerCase();
  const filtered = choices.filter(
    (o) => (category === 'all' || o.category === category) && (!q || o.name.toLowerCase().includes(q) || o.description.toLowerCase().includes(q)),
  );
  // Most DPS gained first (best case, then worst case); ones still being worked out go last.
  const gain = (id: string) => deltas?.get(id) ?? [-Infinity, -Infinity];
  const shown = deltas && byGain ? [...filtered].sort((a, b) => gain(b.id)[1] - gain(a.id)[1] || gain(b.id)[0] - gain(a.id)[0]) : filtered;

  return (
    <div className="organelle-picker">
      <div className="picker-filters">
        <input type="search" aria-label="Search organelles" placeholder="Search organelles" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="chips" role="group" aria-label="Category">
          {['all', ...categories].map((c) => (
            <button key={c} className={`chip ${category === c ? 'active' : ''}`} aria-pressed={category === c} onClick={() => setCategory(c)}>
              {c !== 'all' && <TypeIcon category={c as OrganelleInfo['category']} slot={accepts[0]} height={16} />}
              {c === 'all' ? 'All' : CATEGORY_LABELS[c as OrganelleInfo['category']]}
            </button>
          ))}
        </div>
        {deltas && (
          <div className="delta-bar">
            <span className="muted small">{deltaNote}</span>
            <label className="check small">
              <input type="checkbox" checked={byGain} onChange={(e) => setByGain(e.target.checked)} />
              Most DPS first
            </label>
          </div>
        )}
      </div>
      <div className="organelle-grid" role="listbox" aria-label="Organelles">
        {shown.length === 0 && <p className="muted small">Nothing matches.</p>}
        {shown.map((o) => {
          const modeled = isModeled(o.id);
          const delta = o.id === current ? undefined : deltas?.get(o.id);
          return (
            <button
              key={o.id}
              role="option"
              aria-selected={o.id === current}
              className={`organelle-tile type-${CATEGORY_TYPE[o.category]} ${o.id === current ? 'active' : ''} ${modeled ? '' : 'unmodeled'}`}
              title={`${o.name}: ${o.description}${modeled ? '' : ' (not counted in DPS yet)'}${delta ? `\n${formatDelta(delta)} DPS here` : ''}`}
              onPointerDown={(e) => press(e, o.id)}
              onClick={() => !dragged.current && onPick(o.id)}
              draggable={false}
            >
              <Icon src={organelleIcon(o.id)} size={40} />
              <span className="tile-name">{o.name}</span>
              {deltas && o.id !== current && (
                <span className={`tile-delta ${delta ? deltaTone(delta) : ''}`} aria-label={delta ? `${formatDelta(delta)} DPS` : undefined}>
                  {delta ? formatDelta(delta) : '…'}
                </span>
              )}
              {deltas && o.id === current && <span className="tile-delta current">here now</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
