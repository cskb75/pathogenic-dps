import { useMemo } from 'react';
import type { CalcResult } from '../engine/calc';
import type { Build, GameData } from '../engine/types';
import { Icon, organelleIcon } from './art';
import { fmtNum, fmtPct } from './format';

interface Props {
  data: GameData;
  build: Build;
  result: CalcResult;
  selected: string | null;
  onSelect: (slotId: string) => void;
}

export function Results({ data, build, result, selected, onSelect }: Props) {
  const rarityColor = useMemo(() => new Map(data.rarities.map((r) => [r.id, r.color])), [data]);
  const best = Math.max(...result.weapons.map((w) => w.dps), 0);
  const unmodeled = [...result.items.values()].filter((i) => !i.modeled);

  return (
    <section className="panel results" aria-label="DPS results">
      <div className="totals">
        <div>
          <div className="total-label">Single-target DPS</div>
          <div className="total-value" aria-live="polite">
            {fmtNum(result.totalDps)}
          </div>
        </div>
        {build.targets > 1 && (
          <div>
            <div className="total-label">DPS vs {build.targets} enemies</div>
            <div className="total-value secondary">{fmtNum(result.totalMultiDps)}</div>
          </div>
        )}
      </div>
      {result.staminaDuty < 0.995 && (
        <p className="small muted">
          Stamina lets you fire {fmtPct(result.staminaDuty)} of the time; the numbers include the pauses. Minions, pseudopods and actives don't need
          stamina, so they keep going.
        </p>
      )}

      {result.weapons.length === 0 ? (
        <p className="muted">Equip a weapon on an external slot to see DPS.</p>
      ) : (
        <table className="sources">
          <thead>
            <tr>
              <th scope="col">Weapon</th>
              <th scope="col" className="num">
                DPS
              </th>
              <th scope="col" className="share-col">
                <span className="sr-only">Share</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.weapons.map((w) => {
              const share = result.totalDps > 0 && !w.excluded ? w.dps / result.totalDps : 0;
              const charge = result.items.get(w.slotId)?.charge ?? 0;
              return (
                <tr key={w.slotId} className={`${selected === w.slotId ? 'selected' : ''} ${w.excluded ? 'excluded' : ''}`} onClick={() => onSelect(w.slotId)}>
                  <th scope="row">
                    <button className="link source-name" onClick={() => onSelect(w.slotId)}>
                      <Icon src={organelleIcon(w.info.id)} size={28} className="row-icon" style={{ borderColor: rarityColor.get(w.instance.rarity) }} />
                      <span>
                        {w.info.name}
                        {result.body.slotById.get(w.slotId)?.mirrorOf && <span className="muted small"> (mirror)</span>}
                      </span>
                    </button>
                    <span className="tags">
                      {charge > 0 && <span className="badge overcharge">OC {fmtNum(charge)}</span>}
                      {w.excluded && <span className="badge">not counted</span>}
                    </span>
                  </th>
                  <td className="num">{fmtNum(w.dps)}</td>
                  <td className="share-col">
                    <div className="bar" aria-hidden="true">
                      <div style={{ width: `${best > 0 ? (w.dps / best) * 100 : 0}%` }} />
                    </div>
                    <span className="sr-only">{fmtPct(share)} of total</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {unmodeled.length > 0 && (
        <p className="note">
          Not modeled yet, so not counted:{' '}
          {unmodeled.map((u, i) => (
            <span key={u.slotId}>
              {i > 0 && ', '}
              <button className="link" onClick={() => onSelect(u.slotId)}>
                {u.info.name}
              </button>
            </span>
          ))}
        </p>
      )}

      {result.warnings.length > 0 && (
        <ul className="warnings">
          {result.warnings.map((w) => (
            <li key={w} className="note warn">
              {w}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
