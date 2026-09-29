import type { Dispatch } from 'react';
import { modeOf } from '../engine/simple';
import type { Build, CustomKind, CustomModifier, GameData, ParamDef } from '../engine/types';
import type { Action } from '../state/build';

interface Props {
  data: GameData;
  build: Build;
  dispatch: Dispatch<Action>;
}

const KINDS: Record<CustomKind, { label: string; unit: 'percent' | 'mult'; initial: number }> = {
  damage: { label: '+% of base damage', unit: 'percent', initial: 0.1 },
  damageMult: { label: '× all damage', unit: 'mult', initial: 1.1 },
  attackSpeed: { label: '+% attack speed', unit: 'percent', initial: 0.1 },
  overchargeStrength: { label: '+% Overcharge strength', unit: 'percent', initial: 0.2 },
};

const GROUPS: { title: string; ids: string[] }[] = [
  {
    title: 'Aim and positioning',
    ids: ['angledHit', 'pelletHit', 'sideHit', 'mineHit', 'orbContact', 'stauroLasers', 'fireballContact', 'targetDistance', 'backstabChance', 'beatSync', 'nearbyTime', 'frozenTime'],
  },
  { title: 'Actives and flagella', ids: ['surgeHit', 'coneHit', 'arcHit', 'puddleContact', 'sprintTime', 'backHit'] },
  { title: 'Overcharge triggers', ids: ['roomLength', 'killRate', 'hitsTakenRate', 'dodgeRate', 'dodgeRateAll', 'blockRate', 'slashRate', 'pickupRate', 'perfectRooms'] },
  { title: 'Minions', ids: ['minionEngagement', 'minionLifetime', 'minionHitRate'] },
  { title: 'Stamina and stacking organelles', ids: ['staminaLimits', 'maxStamina', 'resonantStacks'] },
];

export function BuildSettings({ data, build, dispatch }: Props) {
  // Simple mode fixes the fight assumptions (src/engine/simple.ts); your own stay saved for Detailed.
  const simple = modeOf(build) === 'simple';
  const params = new Map(data.params.map((p) => [p.id, p]));
  const setCustom = (custom: CustomModifier[]) => dispatch({ type: 'setCustom', custom });
  const updateCustom = (id: string, patch: Partial<CustomModifier>) => setCustom(build.custom.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <section className="panel settings" aria-labelledby="settings-heading">
      <h2 id="settings-heading">Fight assumptions</h2>
      {simple ? (
        <div className="simple-note">
          <p className="small">
            Simple mode shows DPS from the worst case to the best case, so there's nothing to set here. Both assume you play it perfectly: every
            aimed shot lands and stamina never runs out.
          </p>
          <div className="simple-ends">
            <div>
              <h3>Worst case</h3>
              <p className="small muted">
                Nothing situational helps. No Overcharge: every mitochondrion is off. Kills, hits, dodges, blocks, slashes and pickups trigger nothing,
                and targets are never frozen. Shots that go sideways, backwards, all around you or at random hit as often as usual, as do mines,
                backstabs and minions.
              </p>
            </div>
            <div>
              <h3>Best case</h3>
              <p className="small muted">
                Everything maxed, even past what the game quite allows. Every mitochondrion always on, every trigger (kills, hits, dodges, blocks,
                slashes, pickups) at the top of its range, targets always frozen, enemies right next to you, beside and behind you, and every
                sideways, all-around and arcing shot through your target. Long rooms, minions that last all room and always have someone to fight.
              </p>
            </div>
          </div>
          <button onClick={() => dispatch({ type: 'setMode', mode: 'detailed' })}>Set them yourself (Detailed mode)</button>
        </div>
      ) : (
        <p className="muted small">Things that depend on how you play. Hover a name for details.</p>
      )}
      <div className="settings-grid">
        <fieldset>
          <legend>Targets</legend>
          <label className="number-row" title="Enemies an area or piercing attack can reach at once, for multi-target DPS.">
            <span>Enemies in range</span>
            <input type="number" min={1} max={50} value={build.targets} onChange={(e) => dispatch({ type: 'setTargets', targets: Number(e.target.value) })} />
          </label>
        </fieldset>
        {!simple && GROUPS.map((g) => (
          <fieldset key={g.title}>
            <legend>{g.title}</legend>
            {g.ids.map((id) => params.get(id)).filter((p): p is ParamDef => !!p).map((p) => (
              <ParamInput key={p.id} param={p} value={build.params[p.id] ?? p.default} onChange={(v) => dispatch({ type: 'setParam', id: p.id, value: v })} />
            ))}
          </fieldset>
        ))}
      </div>

      <fieldset className="custom">
        <legend>Extra bonuses</legend>
        <p className="muted small">For anything the calculator doesn't cover yet.</p>
        {build.custom.map((c) => {
          const kind = KINDS[c.kind];
          return (
            <div key={c.id} className="custom-row">
              <input aria-label="Name" placeholder="Name" value={c.label} onChange={(e) => updateCustom(c.id, { label: e.target.value })} />
              <select
                aria-label="Type"
                value={c.kind}
                onChange={(e) => {
                  const k = e.target.value as CustomKind;
                  updateCustom(c.id, { kind: k, value: KINDS[k].initial });
                }}
              >
                {Object.entries(KINDS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
              <input
                aria-label={kind.unit === 'percent' ? 'Percent' : 'Multiplier'}
                type="number"
                step="any"
                value={kind.unit === 'percent' ? Number((c.value * 100).toFixed(4)) : c.value}
                onChange={(e) => {
                  const n = Number(e.target.value) || 0;
                  updateCustom(c.id, { value: kind.unit === 'percent' ? n / 100 : n });
                }}
              />
              <button className="ghost-button" aria-label={`Remove ${c.label || 'bonus'}`} onClick={() => setCustom(build.custom.filter((x) => x.id !== c.id))}>
                ✕
              </button>
            </div>
          );
        })}
        <button onClick={() => setCustom([...build.custom, { id: `c${Date.now().toString(36)}`, label: '', kind: 'damage', value: KINDS.damage.initial }])}>
          Add bonus
        </button>
      </fieldset>
    </section>
  );
}

export function ParamInput({ param, value, onChange }: { param: ParamDef; value: number; onChange: (v: number) => void }) {
  const shown = param.percent ? Math.round(value * 100) : value;
  return (
    <label className="number-row" title={param.description}>
      <span>{param.name}</span>
      <span className="param-input">
        <input
          type="number"
          min={param.percent ? param.min * 100 : param.min}
          max={param.percent ? param.max * 100 : param.max}
          step={param.percent ? param.step * 100 : param.step}
          value={shown}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            const v = param.percent ? n / 100 : n;
            onChange(Math.min(param.max, Math.max(param.min, v)));
          }}
        />
        {param.percent && <span className="muted">%</span>}
      </span>
    </label>
  );
}
