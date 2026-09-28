import { useMemo, useState } from 'react';
import { isModeled } from '../engine/sim/behaviours';
import type { GameData, OrganelleInfo, SlotKind } from '../engine/types';
import { Icon, organelleIcon, TypeIcon } from './art';
import { CATEGORY_LABELS, CATEGORY_ORDER, CATEGORY_TYPE } from './format';

interface Props {
  data: GameData;
  /** Slot kinds the slot accepts. */
  accepts: SlotKind[];
  current?: string;
  onPick: (id: string) => void;
}

/** A searchable grid of organelle icons, grouped by category. */
export function OrganellePicker({ data, accepts, current, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const choices = useMemo(() => data.organelles.filter((o) => accepts.includes(o.slot)), [data, accepts]);
  const categories = CATEGORY_ORDER.filter((c) => choices.some((o) => o.category === c));
  const q = query.trim().toLowerCase();
  const shown = choices.filter(
    (o) => (category === 'all' || o.category === category) && (!q || o.name.toLowerCase().includes(q) || o.description.toLowerCase().includes(q)),
  );

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
      </div>
      <div className="organelle-grid" role="listbox" aria-label="Organelles">
        {shown.length === 0 && <p className="muted small">Nothing matches.</p>}
        {shown.map((o) => {
          const modeled = isModeled(o.id);
          return (
            <button
              key={o.id}
              role="option"
              aria-selected={o.id === current}
              className={`organelle-tile type-${CATEGORY_TYPE[o.category]} ${o.id === current ? 'active' : ''} ${modeled ? '' : 'unmodeled'}`}
              title={`${o.name}: ${o.description}${modeled ? '' : ' (not counted in DPS yet)'}`}
              onClick={() => onPick(o.id)}
            >
              <Icon src={organelleIcon(o.id)} size={40} />
              <span className="tile-name">{o.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
