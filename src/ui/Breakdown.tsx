import type { AttackResult, StateResult } from '../engine/calc';
import type { StatKey } from '../engine/types';
import { STAT_LABELS, fmtContribution, fmtNum, fmtPct, fmtStat } from './format';

const ATTACK_STATS: StatKey[] = ['damage', 'attackSpeed', 'projectiles', 'hits', 'critChance', 'critMultiplier', 'pierce', 'forks'];
const STAT_DEFAULTS: Partial<Record<StatKey, number>> = { projectiles: 1, hits: 1, critChance: 0, pierce: 0, forks: 0 };

/** Where every number in an attack's DPS comes from. */
export function AttackBreakdown({ attack }: { attack: AttackResult }) {
  const states: { title: string; state: StateResult }[] = [];
  if (attack.normal) states.push({ title: attack.charged ? 'Normal' : 'Breakdown', state: attack.normal });
  if (attack.charged) states.push({ title: 'While Overcharged', state: attack.charged });

  return (
    <div className="breakdown">
      <p className="dps-line">
        <strong>{fmtNum(attack.dps)}</strong> DPS
        {attack.multiTargetDps !== attack.dps && <span className="muted"> · {fmtNum(attack.multiTargetDps)} across targets</span>}
      </p>
      {attack.normal && attack.charged && (
        <p className="small muted">
          {fmtNum(attack.normal.dps)} normally, {fmtNum(attack.charged.dps)} while Overcharged, averaged by uptime.
        </p>
      )}
      {!attack.normal && <p className="small muted">Only attacks while Overcharged.</p>}
      {states.map(({ title, state }, i) => (
        <details key={title} open={i === 0}>
          <summary>
            {title}: {fmtNum(state.dps)} DPS
          </summary>
          <StateTable state={state} />
        </details>
      ))}
    </div>
  );
}

function StateTable({ state }: { state: StateResult }) {
  // Always show damage and attack speed; show the rest only when they matter.
  const shown = ATTACK_STATS.filter((k) => {
    if (k === 'damage' || k === 'attackSpeed') return true;
    if (k === 'critMultiplier') return state.stats.critChance.value > 0;
    const line = state.stats[k];
    return line.contributions.length > 0 || line.value !== STAT_DEFAULTS[k];
  });
  return (
    <>
      <table className="stat-table">
        <thead>
          <tr>
            <th scope="col">Stat</th>
            <th scope="col">Base</th>
            <th scope="col">Modifiers</th>
            <th scope="col">Final</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((k) => {
            const line = state.stats[k];
            return (
              <tr key={k}>
                <th scope="row">{STAT_LABELS[k]}</th>
                <td>{fmtStat(k, line.base)}</td>
                <td>
                  {line.contributions.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    <ul className="contribs">
                      {line.contributions.map((c, i) => (
                        <li key={i}>
                          <span className={`op op-${c.op}`}>{fmtContribution(k, c.op, c.value)}</span> {c.source}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="num">{fmtStat(k, line.value)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="formula small">
        {fmtNum(state.hitDamage)} avg per hit × {fmtNum(state.hitsPerSecond)} hits/s = {fmtNum(state.directDps)} direct DPS
      </p>
      {state.statuses.map((s) => (
        <p key={s.status} className="formula small">
          + {s.name}: {fmtNum(s.applicationsPerSecond)} applications/s from {s.sources.join(', ')},{' '}
          {s.stacks < 1 ? `up ${fmtPct(s.stacks)} of the time` : `${fmtNum(s.stacks)} stack${s.stacks === 1 ? '' : 's'}`} ={' '}
          {fmtNum(s.dps)} DPS
        </p>
      ))}
      {state.targetsHit > 1 && <p className="formula small">Hits {state.targetsHit} enemies per attack.</p>}
    </>
  );
}
