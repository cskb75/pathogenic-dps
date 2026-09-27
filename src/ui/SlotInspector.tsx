import { useMemo, type CSSProperties, type Dispatch } from 'react';
import type { CalcResult } from '../engine/calc';
import { findClass } from '../engine/calc';
import type { Build, Category, GameData, OrganelleDef, Rarity } from '../engine/types';
import type { Action } from '../state/build';
import { AttackBreakdown } from './Breakdown';
import { CATEGORY_LABELS, fmtNum, fmtPct, fmtStat } from './format';

interface Props {
  data: GameData;
  build: Build;
  result: CalcResult;
  slotId: string | null;
  onSelect: (slotId: string | null) => void;
  dispatch: Dispatch<Action>;
}

const CATEGORY_ORDER: Category[] = ['weapon', 'flagellum', 'infuser', 'mitochondrion', 'support', 'consumer'];

export function SlotInspector({ data, build, result, slotId, onSelect, dispatch }: Props) {
  const organelles = useMemo(() => new Map(data.organelles.map((o) => [o.id, o])), [data]);
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
  const def = inst ? organelles.get(inst.id) : undefined;
  const graft = state.graft ? data.grafts.find((g) => g.id === state.graft) : undefined;
  const accepts = graft?.accepts ?? [slot.kind];
  const item = result.items.get(slot.id);
  const pieceName = cls.pieceTypes.find((p) => p.id === slot.pieceType)?.name ?? slot.pieceType;
  const choices = data.organelles.filter((o) => accepts.includes(o.slot));
  const nameOf = (id: string) => {
    const other = build.slots[id]?.organelle;
    return other ? (organelles.get(other.id)?.name ?? other.id) : 'empty slot';
  };

  const incoming = result.interactions.filter((i) => i.to === slot.id);
  const outgoing = result.interactions.filter((i) => i.from === slot.id);
  const linked = new Set([...incoming.map((i) => i.from), ...outgoing.map((i) => i.to)]);
  const idle = (result.body.connections.get(slot.id) ?? []).filter((id) => build.slots[id]?.organelle && !linked.has(id));

  const setOrganelle = (id: string) => {
    if (!id) return dispatch({ type: 'setOrganelle', slotId: slot.id, organelle: undefined });
    dispatch({ type: 'setOrganelle', slotId: slot.id, organelle: { id, rarity: inst?.rarity ?? 'common', traits: [] } });
  };
  const setRarity = (rarity: Rarity) => inst && dispatch({ type: 'setOrganelle', slotId: slot.id, organelle: { ...inst, rarity } });
  const toggleTrait = (id: string, on: boolean) =>
    inst &&
    dispatch({
      type: 'setOrganelle',
      slotId: slot.id,
      organelle: { ...inst, traits: on ? [...inst.traits, id] : inst.traits.filter((t) => t !== id) },
    });

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
          {inst && !def && <option value={inst.id}>Unknown: {inst.id}</option>}
          {def && !accepts.includes(def.slot) && <option value={def.id}>{def.name} (wrong slot type)</option>}
        </select>
      </div>

      <div className="field-row">
        <label htmlFor="graft">Graft</label>
        <select
          id="graft"
          value={state.graft ?? ''}
          onChange={(e) => dispatch({ type: 'setSlot', slotId: slot.id, patch: { graft: e.target.value || undefined } })}
        >
          <option value="">None</option>
          {data.grafts.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}: {g.description}
            </option>
          ))}
        </select>
      </div>

      {def && inst && (
        <>
          <p className="description">
            {def.description}
            {def.placeholder && <span className="badge warn" title="Numbers not yet checked against the game">placeholder stats</span>}
          </p>

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
            {data.traits.map((t) => {
              const blocked = t.excludes?.includes(def.id);
              return (
                <label key={t.id} className={blocked ? 'disabled' : ''} title={t.description}>
                  <input
                    type="checkbox"
                    disabled={blocked}
                    checked={inst.traits.includes(t.id)}
                    onChange={(e) => toggleTrait(t.id, e.target.checked)}
                  />
                  {t.name}
                </label>
              );
            })}
          </fieldset>

          {def.mitochondrion && <MitoControls def={def} uptime={state.uptime} dispatch={dispatch} slotId={slot.id} result={result} />}

          {def.overcharge && !def.mitochondrion && <p className="muted small">Overcharge: {def.overcharge.description}</p>}

          {item && (item.overcharge.uptime > 0 || item.requiresOvercharge) && (
            <p className="small">
              Overcharged {fmtPct(item.overcharge.uptime)} of the time, holding {fmtNum(item.overcharge.charges)} charge
              {item.overcharge.charges === 1 ? '' : 's'} on average.
            </p>
          )}

          {item?.potency && !def.mitochondrion && (
            <p className="small">
              Potency {fmtStat('potency', item.potency.average)} on average
              {item.potency.charged !== item.potency.normal && (
                <span className="muted">
                  {' '}
                  ({fmtStat('potency', item.potency.normal)} normally, {fmtStat('potency', item.potency.charged)} Overcharged)
                </span>
              )}
            </p>
          )}

          {item?.notes.map((n) => (
            <p key={n} className="note warn">
              {n}
            </p>
          ))}
          {!item && (
            <p className="note warn">
              {def.name} goes in {def.slot} slots. Graft this slot as Omni or move it.
            </p>
          )}

          {(incoming.length > 0 || outgoing.length > 0 || idle.length > 0) && (
            <div className="connections">
              <h3>Connections</h3>
              <ul>
                {incoming.map((i) => (
                  <li key={`in-${i.kind}-${i.from}`}>
                    <span className={`dot ${i.kind}`} />
                    {i.kind === 'overcharge' ? 'Overcharged by' : 'Boosted by'}{' '}
                    <button className="link" onClick={() => onSelect(i.from)}>
                      {nameOf(i.from)}
                    </button>
                  </li>
                ))}
                {outgoing.map((i) => (
                  <li key={`out-${i.kind}-${i.to}`}>
                    <span className={`dot ${i.kind}`} />
                    {i.kind === 'overcharge' ? 'Overcharges' : 'Boosts'}{' '}
                    <button className="link" onClick={() => onSelect(i.to)}>
                      {nameOf(i.to)}
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

          {item?.attack && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!state.excluded}
                  onChange={(e) => dispatch({ type: 'setSlot', slotId: slot.id, patch: { excluded: !e.target.checked || undefined } })}
                />
                Count toward total DPS <span className="muted">(untick if it faces away from the target)</span>
              </label>
              <AttackBreakdown attack={item.attack} />
            </>
          )}

          <button className="danger wide" onClick={() => setOrganelle('')}>
            Remove {def.name}
          </button>
        </>
      )}
    </section>
  );
}

function MitoControls({
  def,
  uptime,
  slotId,
  result,
  dispatch,
}: {
  def: OrganelleDef;
  uptime: number | undefined;
  slotId: string;
  result: CalcResult;
  dispatch: Dispatch<Action>;
}) {
  const m = def.mitochondrion!;
  const value = uptime ?? m.defaultUptime;
  const output = result.items.get(slotId)?.mitoOutput;
  return (
    <div className="field-stack">
      <label htmlFor="uptime">
        Trigger: <strong>{m.trigger}</strong>. Active {fmtPct(value)} of the fight
      </label>
      <input
        id="uptime"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => dispatch({ type: 'setSlot', slotId, patch: { uptime: Number(e.target.value) } })}
      />
      {output && (
        <p className="small muted">
          Gives {fmtNum(output.charges)} charge{output.charges === 1 ? '' : 's'} to each connected organelle while active.
        </p>
      )}
    </div>
  );
}
