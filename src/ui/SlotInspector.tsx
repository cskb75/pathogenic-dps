import { useEffect, useMemo, useState, type CSSProperties, type Dispatch } from 'react';
import type { CalcResult, Link, MitoResult } from '../engine/calc';
import { findClass, slotState } from '../engine/calc';
import type { Build, GameData, Rarity, SlotKind } from '../engine/types';
import type { Action } from '../state/build';
import { Icon, organelleIcon } from './art';
import { WeaponBreakdown } from './Breakdown';
import { OrganellePicker } from './OrganellePicker';
import { CATEGORY_LABELS, fmtNum, fmtPct } from './format';

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
  const [picking, setPicking] = useState(false);
  useEffect(() => setPicking(false), [slotId]);
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
  const body = result.body;
  const own = build.slots[slot.id] ?? {};
  const state = slotState(build, body, slot.id) ?? {};
  const source = slot.mirrorOf;
  const inst = state.organelle;
  const info = inst ? infos.get(inst.id) : undefined;
  const effectiveGraft = own.graft ?? slot.special;
  const accepts: SlotKind[] = effectiveGraft === 'omni' ? ['internal', 'external'] : [slot.kind];
  const item = result.items.get(slot.id);
  const where =
    cls.body.kind === 'modular'
      ? (cls.body.pieceTypes.find((p) => p.id === slot.pieceType)?.name ?? slot.pieceType)
      : cls.body.kind === 'freeform' && slot.id.startsWith('Blob')
        ? 'Grown blob'
        : (body.plan?.name ?? '');
  const nameOf = (id: string) => {
    const other = slotState(build, body, id)?.organelle;
    return other ? (infos.get(other.id)?.name ?? other.id) : 'empty slot';
  };
  const special = slot.special ? data.grafts.find((g) => g.id === slot.special) : undefined;

  const incoming = result.links.filter((l) => l.to === slot.id);
  const outgoing = result.links.filter((l) => l.from === slot.id);
  const linked = new Set([...incoming.map((l) => l.from), ...outgoing.map((l) => l.to)]);
  const idle = (body.connections.get(slot.id) ?? []).filter((id) => slotState(build, body, id)?.organelle && !linked.has(id));

  // A mirrored slot's organelle is edited on its twin.
  const target = source ?? slot.id;
  const setOrganelle = (id: string) => {
    setPicking(false);
    if (!id) return dispatch({ type: 'setOrganelle', slotId: target, organelle: undefined });
    dispatch({ type: 'setOrganelle', slotId: target, organelle: { id, rarity: inst?.rarity ?? 'common', traits: [] } });
  };
  const setRarity = (rarity: Rarity) => inst && dispatch({ type: 'setOrganelle', slotId: target, organelle: { ...inst, rarity } });
  const toggleTrait = (id: string, on: boolean) =>
    inst && dispatch({ type: 'setOrganelle', slotId: target, organelle: { ...inst, traits: on ? [...inst.traits, id] : inst.traits.filter((t) => t !== id) } });

  return (
    <section id="inspector" className="panel inspector" aria-label="Slot">
      <div className="panel-head">
        <h2>
          {slot.kind === 'internal' ? 'Internal' : 'External'} slot {where && <span className="muted">· {where}</span>}
        </h2>
        <button className="ghost-button" onClick={() => onSelect(null)} aria-label="Close slot">
          ✕
        </button>
      </div>

      {source && (
        <p className="note">
          Mirrored slot: it always holds a copy of the organelle in the matching slot on the other side.{' '}
          <button className="link" onClick={() => onSelect(source)}>
            Edit that slot
          </button>
        </p>
      )}

      <fieldset className="graft-picker">
        <legend>Slot type</legend>
        <button className={`chip ${!own.graft ? 'active' : ''}`} aria-pressed={!own.graft} onClick={() => dispatch({ type: 'setSlot', slotId: slot.id, patch: { graft: undefined } })}>
          {special ? `Built-in ${special.name}` : 'Plain'}
        </button>
        {data.grafts
          .filter((g) => g.id !== slot.special)
          .map((g) => (
            <button
              key={g.id}
              className={`chip graft-chip graft-${g.id} ${own.graft === g.id ? 'active' : ''}`}
              aria-pressed={own.graft === g.id}
              title={g.description}
              onClick={() => dispatch({ type: 'setSlot', slotId: slot.id, patch: { graft: g.id } })}
            >
              {g.name}
            </button>
          ))}
        {effectiveGraft && <p className="muted small">{data.grafts.find((g) => g.id === effectiveGraft)?.description}</p>}
      </fieldset>

      {info && inst && !picking ? (
        <div className="organelle-card" style={{ '--rarity': data.rarities.find((r) => r.id === inst.rarity)?.color } as CSSProperties}>
          <Icon src={organelleIcon(info.id)} size={64} className="organelle-card-icon" />
          <div className="organelle-card-text">
            <strong>{info.name}</strong>
            <span className="muted small">
              {CATEGORY_LABELS[info.category]} · {info.slot}
            </span>
            <span className="small">{info.description}</span>
            <span>
              {item && !item.modeled && <span className="badge warn">not counted in DPS</span>}
              {item?.modeled && !info.demoId && <span className="badge warn">patch notes only</span>}
            </span>
          </div>
          {!source && (
            <div className="organelle-card-actions">
              <button onClick={() => setPicking(true)}>Change</button>
              <button className="danger" onClick={() => setOrganelle('')}>
                Remove
              </button>
            </div>
          )}
        </div>
      ) : source ? (
        <p className="muted">The other side is empty.</p>
      ) : (
        <>
          {picking && (
            <button className="link small" onClick={() => setPicking(false)}>
              Keep {info?.name ?? 'the current organelle'}
            </button>
          )}
          <OrganellePicker data={data} accepts={accepts} current={inst?.id} onPick={setOrganelle} />
        </>
      )}

      {info && inst && !picking && (
        <>
          {item?.notes.map((n) => (
            <p key={n} className="note">
              {n}
            </p>
          ))}
          {!item && <p className="note warn">{info.name} goes in {info.slot} slots. Graft this slot as Omni or move it.</p>}

          <fieldset className="rarity-picker" disabled={!!source}>
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

          <fieldset className="traits" disabled={!!source}>
            <legend>Traits</legend>
            {data.traits.map((t) => (
              <label key={t.id} title={t.description}>
                <input type="checkbox" checked={inst.traits.includes(t.id)} onChange={(e) => toggleTrait(t.id, e.target.checked)} />
                {t.name}
              </label>
            ))}
          </fieldset>

          {item?.mito && <MitoControls mito={item.mito} slotId={target} dispatch={dispatch} />}
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
                  disabled={!!source}
                  onChange={(e) => dispatch({ type: 'setSlot', slotId: target, patch: { excluded: !e.target.checked || undefined } })}
                />
                Count toward total DPS <span className="muted">(untick if it can't aim at the target)</span>
              </label>
              <WeaponBreakdown weapon={item.weapon} />
            </>
          )}
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
