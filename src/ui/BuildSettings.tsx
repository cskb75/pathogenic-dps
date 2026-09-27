import type { Dispatch } from 'react';
import { findClass } from '../engine/calc';
import { STAT_KEYS, type Build, type CustomModifier, type CustomTarget, type GameData, type ModifierOp } from '../engine/types';
import type { Action } from '../state/build';
import { STAT_LABELS } from './format';

interface Props {
  data: GameData;
  build: Build;
  dispatch: Dispatch<Action>;
}

const TARGET_LABELS: Record<CustomTarget, string> = {
  attacks: 'All attacks',
  projectiles: 'Projectiles',
  weapons: 'Weapons',
  everything: 'Everything',
};

const OP_LABELS: Record<ModifierOp, string> = {
  percent: '+% (additive)',
  multiply: '× (multiplier)',
  flat: '+ (flat)',
};

const OP_DEFAULTS: Record<ModifierOp, number> = { percent: 0.1, multiply: 1.1, flat: 1 };

export function BuildSettings({ data, build, dispatch }: Props) {
  const cls = findClass(data, build.classId);
  const setCustom = (custom: CustomModifier[]) => dispatch({ type: 'setCustom', custom });
  const updateCustom = (id: string, patch: Partial<CustomModifier>) =>
    setCustom(build.custom.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <section className="panel settings" aria-label="Build settings">
      <h2>{cls.name} settings</h2>
      <p className="muted small">{cls.description}</p>

      <div className="settings-grid">
        <fieldset>
          <legend>{cls.name} upgrades</legend>
          {cls.upgrades.map((u) =>
            u.maxStacks === 1 ? (
              <label key={u.id} className="check" title={u.description}>
                <input
                  type="checkbox"
                  checked={(build.upgrades[u.id] ?? 0) > 0}
                  onChange={(e) => dispatch({ type: 'setUpgrade', id: u.id, stacks: e.target.checked ? 1 : 0 })}
                />
                <span>
                  {u.name} <span className="muted small">{u.description}</span>
                </span>
              </label>
            ) : (
              <label key={u.id} className="number-row" title={u.description}>
                <span>
                  {u.name} <span className="muted small">{u.description}</span>
                </span>
                <input
                  type="number"
                  min={0}
                  max={u.maxStacks}
                  value={build.upgrades[u.id] ?? 0}
                  onChange={(e) =>
                    dispatch({ type: 'setUpgrade', id: u.id, stacks: Math.max(0, Math.min(u.maxStacks, Number(e.target.value) || 0)) })
                  }
                />
              </label>
            ),
          )}
          {cls.upgrades.length === 0 && <p className="muted small">No upgrades in the data yet.</p>}
        </fieldset>

        <fieldset>
          <legend>Fight</legend>
          <label className="number-row">
            <span>Enemies in range</span>
            <input
              type="number"
              min={1}
              max={50}
              value={build.targets}
              onChange={(e) => dispatch({ type: 'setTargets', targets: Number(e.target.value) })}
            />
          </label>
          {data.params.map((p) => (
            <label key={p.id} className="number-row" title={p.description}>
              <span>{p.name}</span>
              <input
                type="number"
                min={p.min}
                max={p.max}
                step={p.step}
                value={build.params[p.id] ?? p.default}
                onChange={(e) => dispatch({ type: 'setParam', id: p.id, value: Number(e.target.value) })}
              />
            </label>
          ))}
          {data.conditions.map((c) => (
            <label key={c.id} className="check" title={c.description}>
              <input
                type="checkbox"
                checked={build.conditions[c.id] === true}
                onChange={(e) => dispatch({ type: 'setCondition', id: c.id, on: e.target.checked })}
              />
              {c.name}
            </label>
          ))}
        </fieldset>
      </div>

      <fieldset className="custom">
        <legend>Extra bonuses</legend>
        <p className="muted small">For anything the data doesn't cover yet, like plasmid upgrades or temporary buffs.</p>
        {build.custom.map((c) => (
          <div key={c.id} className="custom-row">
            <input aria-label="Name" placeholder="Name" value={c.label} onChange={(e) => updateCustom(c.id, { label: e.target.value })} />
            <select aria-label="Applies to" value={c.target} onChange={(e) => updateCustom(c.id, { target: e.target.value as CustomTarget })}>
              {Object.entries(TARGET_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select aria-label="Stat" value={c.stat} onChange={(e) => updateCustom(c.id, { stat: e.target.value as CustomModifier['stat'] })}>
              {STAT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {STAT_LABELS[k]}
                </option>
              ))}
            </select>
            <select
              aria-label="Type"
              value={c.op}
              onChange={(e) => {
                const op = e.target.value as ModifierOp;
                updateCustom(c.id, { op, value: OP_DEFAULTS[op] });
              }}
            >
              {Object.entries(OP_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input
              aria-label={c.op === 'percent' ? 'Percent' : 'Value'}
              type="number"
              step="any"
              value={c.op === 'percent' ? Number((c.value * 100).toFixed(4)) : c.value}
              onChange={(e) => {
                const n = Number(e.target.value) || 0;
                updateCustom(c.id, { value: c.op === 'percent' ? n / 100 : n });
              }}
            />
            <button className="ghost-button" aria-label={`Remove ${c.label || 'bonus'}`} onClick={() => setCustom(build.custom.filter((x) => x.id !== c.id))}>
              ✕
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            setCustom([
              ...build.custom,
              { id: `c${Date.now().toString(36)}`, label: '', target: 'attacks', stat: 'damage', op: 'percent', value: 0.1 },
            ])
          }
        >
          Add bonus
        </button>
      </fieldset>
    </section>
  );
}
