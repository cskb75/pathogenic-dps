import { useMemo } from 'react';
import type { CalcResult } from '../engine/calc';
import type { Build, GameData } from '../engine/types';
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
  const best = Math.max(...result.sources.map((s) => s.attack!.dps), 0);

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
            <div className="total-value secondary">{fmtNum(result.totalMultiTargetDps)}</div>
          </div>
        )}
      </div>

      {result.sources.length === 0 ? (
        <p className="muted">Equip a weapon on an external slot to see DPS.</p>
      ) : (
        <table className="sources">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col" className="num">
                DPS
              </th>
              <th scope="col" className="share-col">
                <span className="sr-only">Share</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.sources.map((s) => {
              const a = s.attack!;
              const share = result.totalDps > 0 && !a.excluded ? a.dps / result.totalDps : 0;
              return (
                <tr
                  key={s.slotId}
                  className={`${selected === s.slotId ? 'selected' : ''} ${a.excluded ? 'excluded' : ''}`}
                  onClick={() => onSelect(s.slotId)}
                >
                  <th scope="row">
                    <button className="link source-name" onClick={() => onSelect(s.slotId)}>
                      <span className="rarity-dot" style={{ background: rarityColor.get(s.instance.rarity) }} />
                      {s.def.name}
                    </button>
                    <span className="tags">
                      {s.overcharge.uptime > 0 && <span className="badge overcharge">OC {fmtPct(s.overcharge.uptime)}</span>}
                      {a.excluded && <span className="badge">not counted</span>}
                      {s.notes.length > 0 && <span className="badge warn" title={s.notes.join(' ')}>!</span>}
                    </span>
                  </th>
                  <td className="num">{fmtNum(a.dps)}</td>
                  <td className="share-col">
                    <div className="bar" aria-hidden="true">
                      <div style={{ width: `${best > 0 ? (a.dps / best) * 100 : 0}%` }} />
                    </div>
                    <span className="sr-only">{fmtPct(share)} of total</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
