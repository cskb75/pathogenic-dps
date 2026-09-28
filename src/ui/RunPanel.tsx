import { useState, type Dispatch } from 'react';
import { findClass, fullHp, type CalcResult } from '../engine/calc';
import { mutationStacks } from '../engine/run';
import type { Build, GameData, MutationDef, ParamDef, PlasmidDef } from '../engine/types';
import type { Action } from '../state/build';
import { Icon, mutationIcon, plasmidIcon } from './art';
import { ParamInput } from './BuildSettings';

interface Props {
  data: GameData;
  build: Build;
  result: CalcResult;
  dispatch: Dispatch<Action>;
}

const RUN_PARAMS = ['cores', 'hp', 'bossesBeaten', 'level'];

/** Mutations picked this run, plasmids bought, and the run state they depend on. */
export function RunPanel({ data, build, result, dispatch }: Props) {
  const cls = findClass(data, build.classId);
  const params = new Map(data.params.map((p) => [p.id, p]));
  const [filter, setFilter] = useState('');
  const stacks = mutationStacks(build, cls);
  const picked = Object.values(build.mutations).reduce((s, n) => s + n, 0);

  const matches = (m: MutationDef) => {
    const q = filter.trim().toLowerCase();
    return !q || m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q);
  };
  const shown = data.mutations.filter(matches);
  const dpsMutations = shown.filter((m) => m.effects);
  const noted = shown.filter((m) => !m.effects && m.notes);
  const others = shown.filter((m) => !m.effects && !m.notes);
  const mutationRow = (m: MutationDef) => (
    <MutationRow
      key={m.id}
      mutation={m}
      count={build.mutations[m.id] ?? 0}
      granted={(stacks.get(m.id) ?? 0) - (build.mutations[m.id] ?? 0)}
      onChange={(count) => dispatch({ type: 'setMutation', id: m.id, count })}
    />
  );

  const mutationName = new Map(data.mutations.map((m) => [m.id, m]));
  const affectsDps = (p: PlasmidDef) => !!p.effects || !!p.notes || (!!p.mutation && !!mutationName.get(p.mutation)?.effects);
  const plasmidRow = (p: PlasmidDef) => (
    <PlasmidRow
      key={p.id}
      icon={plasmidIcon(p, data)}
      plasmid={p}
      grants={p.mutation ? mutationName.get(p.mutation) : undefined}
      count={build.plasmids[p.id] ?? 0}
      onChange={(count) => dispatch({ type: 'setPlasmid', id: p.id, count })}
    />
  );

  return (
    <section className="panel run-panel" aria-labelledby="run-heading">
      <h2 id="run-heading">This run</h2>
      <p className="muted small">What you've picked up so far. Damage bonuses add to the organelles' own bonuses, as a share of each attack's base damage.</p>

      <div className="settings-grid">
        <fieldset>
          <legend>Run state</legend>
          {RUN_PARAMS.map((id) => params.get(id))
            .filter((p): p is ParamDef => !!p)
            .map((p) => (
              <ParamInput
                key={p.id}
                param={p}
                value={build.params[p.id] ?? (p.id === 'hp' ? fullHp(build, data) : p.default)}
                onChange={(v) => dispatch({ type: 'setParam', id: p.id, value: v })}
              />
            ))}
        </fieldset>
        <div className="run-summary" aria-live="polite">
          <h3>Active effects</h3>
          {result.run.length === 0 ? (
            <p className="muted small">No mutations or DPS plasmids picked yet.</p>
          ) : (
            <ul>
              {result.run.map((l) => (
                <li key={l.source} className={l.inactive ? 'muted' : ''}>
                  <strong>{l.source}</strong>: {l.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="picker-head">
        <h3>
          Mutations <span className="muted small">(DNA upgrades{picked > 0 ? `, ${picked} picked` : ''})</span>
        </h3>
        <div className="picker-tools">
          <input type="search" aria-label="Filter mutations" placeholder="Filter mutations" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button disabled={picked === 0} onClick={() => dispatch({ type: 'clearMutations' })}>
            Clear
          </button>
        </div>
      </div>
      {shown.length === 0 && <p className="muted small">No mutation matches "{filter}".</p>}
      {dpsMutations.length > 0 && <ul className="pick-list">{dpsMutations.map(mutationRow)}</ul>}
      {noted.length > 0 && (
        <details open={!!filter.trim() || noted.some((m) => build.mutations[m.id])}>
          <summary>Other mutations with a note ({noted.length})</summary>
          <p className="muted small">These don't change sustained DPS directly, or depend on something the calculator doesn't model yet.</p>
          <ul className="pick-list">{noted.map(mutationRow)}</ul>
        </details>
      )}
      {others.length > 0 && (
        <details open={!!filter.trim() || others.some((m) => build.mutations[m.id])}>
          <summary>Mutations with no effect on DPS ({others.length})</summary>
          <ul className="pick-list">{others.map(mutationRow)}</ul>
        </details>
      )}

      <h3>{cls.name} plasmids</h3>
      <p className="muted small">
        Bought in the plasmid tree between runs. Count each node you own: some plasmids appear more than once in the tree. The tree's layout isn't known yet, so
        they're listed here.
      </p>
      <ul className="pick-list">{cls.plasmids.filter(affectsDps).map(plasmidRow)}</ul>
      <details open={cls.plasmids.some((p) => !affectsDps(p) && build.plasmids[p.id])}>
        <summary>Plasmids with no effect on DPS ({cls.plasmids.filter((p) => !affectsDps(p)).length})</summary>
        <ul className="pick-list">{cls.plasmids.filter((p) => !affectsDps(p)).map(plasmidRow)}</ul>
      </details>
    </section>
  );
}

/** Splits "Formula from the demo code. Uses your HP." into where the numbers come from and what to do. */
function splitNotes(notes?: string): { source?: string; tip?: string } {
  if (!notes) return {};
  const m = notes.match(/^((?:Formula|Numbers) from [^.]+\.)\s*(.*)$/);
  return m ? { source: m[1], tip: m[2] || undefined } : { tip: notes };
}

function MutationRow({ mutation: m, count, granted, onChange }: { mutation: MutationDef; count: number; granted: number; onChange: (n: number) => void }) {
  const { source, tip } = splitNotes(m.notes);
  return (
    <li className={`pick ${count + granted > 0 ? 'on' : ''}`} title={source}>
      <Icon src={mutationIcon(m.id)} size={40} className="pick-icon" />
      <div className="pick-text">
        <span className="pick-name">
          {m.name}
          {granted > 0 && <span className="badge">+{granted} from plasmids</span>}
        </span>
        <span className="muted small">{m.description}</span>
        {tip && <span className="pick-note small">{tip}</span>}
      </div>
      <Stepper label={m.name} value={count} onChange={onChange} />
    </li>
  );
}

function PlasmidRow({
  plasmid: p,
  icon,
  grants,
  count,
  onChange,
}: {
  plasmid: PlasmidDef;
  icon: string;
  grants?: MutationDef;
  count: number;
  onChange: (n: number) => void;
}) {
  return (
    <li className={`pick ${count > 0 ? 'on' : ''}`}>
      <Icon src={icon} size={40} className="pick-icon" />
      <div className="pick-text">
        <span className="pick-name">{p.name}</span>
        <span className="muted small">{p.description}</span>
        {grants && <span className="pick-note small">Counts as a stack of {grants.name} in the mutation list.</span>}
        {p.notes && <span className="pick-note small">{p.notes}</span>}
      </div>
      <Stepper label={p.name} value={count} onChange={onChange} />
    </li>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button aria-label={`One less ${label}`} disabled={value <= 0} onClick={() => onChange(value - 1)}>
        −
      </button>
      <output aria-label={`${label} count`}>{value}</output>
      <button aria-label={`One more ${label}`} disabled={value >= 99} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}
