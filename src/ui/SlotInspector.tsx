import { useEffect, useMemo, useState, type CSSProperties, type Dispatch } from 'react';
import type { CalcResult, Link, MitoResult } from '../engine/calc';
import { findClass, slotState } from '../engine/calc';
import type { Build, GameData, Rarity, SlotKind } from '../engine/types';
import type { Action } from '../state/build';
import { art, Icon, organelleIcon, TypeIcon } from './art';
import { WeaponBreakdown } from './Breakdown';
import { OrganellePicker } from './OrganellePicker';
import { CATEGORY_LABELS, CATEGORY_TYPE, fmtNum, fmtPct } from './format';
import { slotArt } from './organelleArt';

interface Props {
  data: GameData;
  build: Build;
  result: CalcResult;
  slotId: string | null;
  onSelect: (slotId: string | null) => void;
  dispatch: Dispatch<Action>;
  /** Picks an organelle up from the list: dragged, or carried to a slot you click. */
  onGrab: (organelleId: string, mode: 'drag' | 'carry') => void;
}

const LINK_TEXT: Record<Link['kind'], { in: string; out: string }> = {
  attack: { in: 'Receives attacks from', out: 'Passes attacks to' },
  gun: { in: 'Attack speed from', out: 'Speeds up' },
  overcharge: { in: 'Overcharged by', out: 'Overcharges' },
  fires: { in: 'Fired by', out: 'Fires' },
};

export function SlotInspector({ data, build, result, slotId, onSelect, dispatch, onGrab }: Props) {
  const infos = useMemo(() => new Map(data.organelles.map((o) => [o.id, o])), [data]);
  const [picking, setPicking] = useState(false);
  useEffect(() => setPicking(false), [slotId]);
  const slot = slotId ? result.body.slotById.get(slotId) : undefined;

  if (!slot) {
    return (
      <section id="inspector" className="panel inspector" aria-label="Organelles">
        <h2>Organelles</h2>
        <p className="muted small">
          Drag one onto a slot on the body, or click it and then click a slot. Select a slot to set its organelle's rarity and traits, or graft the slot.
        </p>
        <OrganellePicker data={data} accepts={['internal', 'external']} onPick={(id) => onGrab(id, 'carry')} onGrab={(id) => onGrab(id, 'drag')} />
      </section>
    );
  }

  const cls = findClass(data, build.classId);
  const body = result.body;
  const own = build.slots[slot.id] ?? {};
  const state = slotState(build, body, slot.id) ?? {};
  const source = slot.mirrorOf;
  const twin = source ?? body.slots.find((s) => s.mirrorOf === slot.id)?.id;
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

      {twin && <p className="note">Mirrored: this slot and the one on the other side always hold the same organelle. Changes here apply to both; the slot type is each slot's own.</p>}

      <fieldset className="graft-picker">
        <legend>Slot type</legend>
        <button className={`chip ${!own.graft ? 'active' : ''}`} aria-pressed={!own.graft} onClick={() => dispatch({ type: 'setSlot', slotId: slot.id, patch: { graft: undefined } })}>
          <img className="graft-chip-sprite" src={art(slotArt(slot.kind, special?.id).src!)} alt="" />
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
              <img className="graft-chip-sprite" src={art(slotArt(slot.kind, g.id).src!)} alt="" />
              {g.name}
            </button>
          ))}
        {effectiveGraft && <p className="muted small">{data.grafts.find((g) => g.id === effectiveGraft)?.description}</p>}
      </fieldset>

      {info && inst && !picking ? (
        <div
          className={`organelle-card type-${CATEGORY_TYPE[info.category]}`}
          style={{ '--rarity': data.rarities.find((r) => r.id === inst.rarity)?.color } as CSSProperties}
        >
          <Icon src={organelleIcon(info.id)} size={64} className="organelle-card-icon" />
          <div className="organelle-card-text">
            <strong className="organelle-card-name">{info.name}</strong>
            <span className="organelle-card-type small">
              <TypeIcon category={info.category} slot={info.slot} height={20} />
              {CATEGORY_LABELS[info.category]} · {info.slot}
            </span>
            <span className="small">{info.description}</span>
            <span>
              {item && !item.modeled && <span className="badge warn">not counted in DPS</span>}
            </span>
          </div>
          <div className="organelle-card-actions">
            <button onClick={() => setPicking(true)}>Change</button>
            <button className="danger" onClick={() => setOrganelle('')}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <>
          {picking && (
            <button className="link small" onClick={() => setPicking(false)}>
              Keep {info?.name ?? 'the current organelle'}
            </button>
          )}
          <OrganellePicker data={data} accepts={accepts} current={inst?.id} onPick={setOrganelle} onGrab={(id) => onGrab(id, 'drag')} />
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
