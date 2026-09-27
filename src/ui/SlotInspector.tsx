import { useMemo, type CSSProperties, type Dispatch } from 'react';
import type { CalcResult, Link, MitoResult } from '../engine/calc';
import { findClass } from '../engine/calc';
import type { Build, GameData, Rarity } from '../engine/types';
import type { Action } from '../state/build';
import { WeaponBreakdown } from './Breakdown';
import { CATEGORY_LABELS, CATEGORY_ORDER, fmtNum, fmtPct } from './format';

interface Props {
  data: GameData;
  build: Build;
  result: CalcResult;
  slotId: string | null;
  onSelect: (slotId: string | null) => void;
  dispatch: Dispatch<Action>;
}

const LINK_TEXT: Record<Link['kind'], { in: string; out: string }> = {
  attack: { in: 'Receives attacks from', out: 'Passes attacks to' },
  gun: { in: 'Attack speed from', out: 'Speeds up' },
  overcharge: { in: 'Overcharged by', out: 'Overcharges' },
};

export function SlotInspector({ data, build, result, slotId, onSelect, dispatch }: Props) {
  const infos = useMemo(() => new Map(data.organelles.map((o) => [o.id, o])), [data]);
  const slot = slotId ? result.body.slotById.get(slotId) : undefined;

  if (!slot) {
    return (
      <section id="inspector" className="panel inspector" aria-label="Slot">
        <h2>Slot</h2>
        <p className="muted">Select a slot on the body to equip an organelle, pick its rarity and traits, or graft the slot.</p>
      </section>
    );
  }

  const cls = findClass(data, build.classId);
  const state = build.slots[slot.id] ?? {};
  const inst = state.organelle;
  const info = inst ? infos.get(inst.id) : undefined;
  const accepts = state.graft === 'omni' ? ['internal', 'external'] : [slot.kind];
  const item = result.items.get(slot.id);
  const pieceName = cls.pieceTypes.find((p) => p.id === slot.pieceType)?.name ?? slot.pieceType;
  const choices = data.organelles.filter((o) => accepts.includes(o.slot));
  const nameOf = (id: string) => {
    const other = build.slots[id]?.organelle;
    return other ? (infos.get(other.id)?.name ?? other.id) : 'empty slot';
  };

  const incoming = result.links.filter((l) => l.to === slot.id);
  const outgoing = result.links.filter((l) => l.from === slot.id);
  const linked = new Set([...incoming.map((l) => l.from), ...outgoing.map((l) => l.to)]);
  const idle = (result.body.connections.get(slot.id) ?? []).filter((id) => build.slots[id]?.organelle && !linked.has(id));

  const setOrganelle = (id: string) => {
    if (!id) return dispatch({ type: 'setOrganelle', slotId: slot.id, organelle: undefined });
    dispatch({ type: 'setOrganelle', slotId: slot.id, organelle: { id, rarity: inst?.rarity ?? 'common', traits: [] } });
  };
  const setRarity = (rarity: Rarity) => inst && dispatch({ type: 'setOrganelle', slotId: slot.id, organelle: { ...inst, rarity } });
  const toggleTrait = (id: string, on: boolean) =>
    inst && dispatch({ type: 'setOrganelle', slotId: slot.id, organelle: { ...inst, traits: on ? [...inst.traits, id] : inst.traits.filter((t) => t !== id) } });

  return (
    <section id="inspector" className="panel inspector" aria-label="Slot">
      <div className="panel-head">
        <h2>
          {slot.kind === 'internal' ? 'Internal' : 'External'} slot <span className="muted">· {pieceName}</span>
        </h2>
        <button className="ghost-button" onClick={() => onSelect(null)} aria-label="Close slot">
          ✕
        </button>
      </div>

      <div className="field-row">
        <label htmlFor="organelle">Organelle</label>
        <select id="organelle" value={inst?.id ?? ''} onChange={(e) => setOrganelle(e.target.value)}>
          <option value="">— Empty —</option>
          {CATEGORY_ORDER.map((cat) => {
            const list = choices.filter((o) => o.category === cat);
            if (!list.length) return null;
            return (
              <optgroup key={cat} label={CATEGORY_LABELS[cat]}>
                {list.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
            );
          })}
          {info && !accepts.includes(info.slot) && <option value={info.id}>{info.name} (wrong slot type)</option>}
          {inst && !info && <option value={inst.id}>Unknown: {inst.id}</option>}
        </select>
      </div>

      <div className="field-row">
        <label htmlFor="graft">Graft</label>
        <select id="graft" value={state.graft ?? ''} onChange={(e) => dispatch({ type: 'setSlot', slotId: slot.id, patch: { graft: e.target.value || undefined } })}>
          <option value="">None</option>
          {data.grafts.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}: {g.description}
            </option>
          ))}
        </select>
      </div>

      {info && inst && (
        <>
          <p className="description">
            {info.description}
            {item && !item.modeled && <span className="badge warn">not modeled yet</span>}
            {item?.modeled && !info.demoId && <span className="badge warn">patch notes only</span>}
          </p>
          {item?.notes.map((n) => (
            <p key={n} className="note">
              {n}
            </p>
          ))}
          {!item && <p className="note warn">{info.name} goes in {info.slot} slots. Graft this slot as Omni or move it.</p>}

          <fieldset className="rarity-picker">
            <legend>Rarity</legend>
            {data.rarities.map((r) => (
              <button
                key={r.id}
                className={inst.rarity === r.id ? 'active' : ''}
                aria-pressed={inst.rarity === r.id}
                style={{ '--rarity': r.color } as CSSProperties}
                onClick={() => setRarity(r.id)}
              >
                {r.name}
              </button>
            ))}
          </fieldset>

          <fieldset className="traits">
            <legend>Traits</legend>
            {data.traits.map((t) => (
              <label key={t.id} title={t.description}>
                <input type="checkbox" checked={inst.traits.includes(t.id)} onChange={(e) => toggleTrait(t.id, e.target.checked)} />
                {t.name}
              </label>
            ))}
          </fieldset>

          {item?.mito && <MitoControls mito={item.mito} slotId={slot.id} dispatch={dispatch} />}
          {item && !item.mito && item.charge > 0 && <p className="small">Holds {fmtNum(item.charge)} Overcharge on average.</p>}

          {(incoming.length > 0 || outgoing.length > 0 || idle.length > 0) && (
            <div className="connections">
              <h3>Connections</h3>
              <ul>
                {incoming.map((l) => (
                  <li key={`in-${l.kind}-${l.from}`}>
                    <span className={`dot ${l.kind}`} />
                    {LINK_TEXT[l.kind].in}{' '}
                    <button className="link" onClick={() => onSelect(l.from)}>
                      {nameOf(l.from)}
                    </button>
                  </li>
                ))}
                {outgoing.map((l) => (
                  <li key={`out-${l.kind}-${l.to}`}>
                    <span className={`dot ${l.kind}`} />
                    {LINK_TEXT[l.kind].out}{' '}
                    <button className="link" onClick={() => onSelect(l.to)}>
                      {nameOf(l.to)}
                    </button>
                  </li>
                ))}
                {idle.map((id) => (
                  <li key={`idle-${id}`} className="muted">
                    <span className="dot idle" />
                    Connected to{' '}
                    <button className="link" onClick={() => onSelect(id)}>
                      {nameOf(id)}
                    </button>
                    , no effect between them
                  </li>
                ))}
              </ul>
            </div>
          )}

          {item?.weapon && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!state.excluded}
                  onChange={(e) => dispatch({ type: 'setSlot', slotId: slot.id, patch: { excluded: !e.target.checked || undefined } })}
                />
                Count toward total DPS <span className="muted">(untick if it can't aim at the target)</span>
              </label>
              <WeaponBreakdown weapon={item.weapon} />
            </>
          )}

          <button className="danger wide" onClick={() => setOrganelle('')}>
            Remove {info.name}
          </button>
        </>
      )}
    </section>
  );
}

function MitoControls({ mito, slotId, dispatch }: { mito: MitoResult; slotId: string; dispatch: Dispatch<Action> }) {
  return (
    <div className="field-stack">
      <p className="small">
        <strong>{mito.trigger}</strong>: {fmtNum(mito.charge)} Overcharge
        {mito.duration !== undefined && <> for {fmtNum(mito.duration)}s</>}
      </p>
      <label htmlFor="uptime">
        Active {fmtPct(mito.uptime)} of the fight{' '}
        <span className="muted">{mito.overridden ? `(estimate: ${fmtPct(mito.estimated)})` : '(estimated from your fight assumptions)'}</span>
      </label>
      <input
        id="uptime"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={mito.uptime}
        onChange={(e) => dispatch({ type: 'setSlot', slotId, patch: { uptime: Number(e.target.value) } })}
      />
      {mito.overridden && (
        <button className="link small" onClick={() => dispatch({ type: 'setSlot', slotId, patch: { uptime: undefined } })}>
          Use the estimate
        </button>
      )}
    </div>
  );
}
