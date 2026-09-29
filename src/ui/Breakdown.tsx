import type { AttackNode, StateView, WeaponResult } from '../engine/calc';
import { fmtNum } from './format';

/** Where every number in a weapon's DPS comes from. */
/** A weapon's DPS and where it comes from. With `floor` (simple mode's worst case), `weapon` is the best case and the DPS shows as a range. */
export function WeaponBreakdown({ weapon, floor }: { weapon: WeaponResult; floor?: number }) {
  const views = [weapon.idle, ...(weapon.charged ? [weapon.charged] : [])];
  const range = floor !== undefined && Math.round(floor) !== Math.round(weapon.dps);
  return (
    <div className="breakdown">
      <p className="dps-line">
        <strong>{range ? `${fmtNum(floor!)} – ${fmtNum(weapon.dps)}` : fmtNum(weapon.dps)}</strong> DPS
        {floor !== undefined && <span className="muted"> worst to best case</span>}
        {weapon.multiDps !== weapon.dps && <span className="muted"> · {fmtNum(weapon.multiDps)} across all enemies</span>}
      </p>
      {floor !== undefined && <p className="small muted">The breakdown below is the best case.</p>}
      <p className="small muted">
        {fmtNum(weapon.attacksPerSecond)} attacks/s on average
        {weapon.staminaPerSecond > 0 && <>, using {fmtNum(weapon.staminaPerSecond)} stamina/s</>}
        {weapon.charged && <>. Averaged over when your mitochondria are active.</>}
      </p>
      {views.map((v, i) => (
        <details key={v.label} open={i === 0}>
          <summary>
            {v.label}: {fmtNum(v.dps)} DPS
          </summary>
          <StateDetails view={v} />
        </details>
      ))}
    </div>
  );
}

function StateDetails({ view }: { view: StateView }) {
  // Damage per attack -> DPS, including stamina pauses and global multipliers, so the tree adds up to the total.
  const perAttack = view.nodes.reduce((s, n) => s + n.single, 0);
  const scale = perAttack > 0 ? view.dps / perAttack : view.attacksPerSecond;
  return (
    <>
      <p className="formula small">
        {fmtNum(view.attacksPerSecond)} attacks/s
        {view.charge > 0 && <> · {fmtNum(view.charge)} Overcharge</>}
      </p>
      {view.gunTrace.length > 0 && (
        <ul className="trace">
          {view.gunTrace.map((t, i) => (
            <li key={i}>
              <span className="op">{t.text}</span> <span className="muted">{t.source}</span>
            </li>
          ))}
        </ul>
      )}
      {view.nodes.length === 0 ? (
        <p className="small muted">Doesn't attack in this state.</p>
      ) : (
        <ul className="attack-tree">
          {view.nodes.map((n, i) => (
            <AttackItem key={i} node={n} perSecond={scale} />
          ))}
        </ul>
      )}
    </>
  );
}

function AttackItem({ node, perSecond }: { node: AttackNode; perSecond: number }) {
  const dps = node.single * perSecond;
  const multi = node.multi * perSecond;
  return (
    <li>
      <div className="attack-head">
        <span className="attack-label">{node.label}</span>
        <span className="num">
          {fmtNum(dps)} DPS{multi > dps + 0.05 && <span className="muted"> ({fmtNum(multi)} all)</span>}
        </span>
      </div>
      <div className="small muted">
        {fmtNum(node.damagePerHit)} per hit × {fmtNum(node.hitsOnTarget)} hits on target
        {node.hitsOnOthers > 0 && <> + {fmtNum(node.hitsOnOthers)} on others</>} per attack
        {node.kind === 'burn' && <> (burn totals about 2× its damage as it halves each second)</>}
      </div>
      {node.trace.length > 0 && (
        <ul className="trace">
          {node.trace.map((t, i) => (
            <li key={i}>
              <span className="op">{t.text}</span> <span className="muted">{t.source}</span>
            </li>
          ))}
        </ul>
      )}
      {node.children.length > 0 && (
        <ul className="attack-tree nested">
          {node.children.map((c, i) => (
            <AttackItem key={i} node={c} perSecond={perSecond} />
          ))}
        </ul>
      )}
    </li>
  );
}
