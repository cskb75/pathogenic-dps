import { useMemo, type Dispatch } from 'react';
import type { CalcResult } from '../engine/calc';
import { modeOf } from '../engine/simple';
import type { Build, GameData } from '../engine/types';
import type { Action } from '../state/build';
import { Icon, organelleIcon } from './art';
import { fmtNum, fmtPct } from './format';

interface Props {
  data: GameData;
  build: Build;
  result: CalcResult;
  /** Simple mode's worst case; `result` is then the best case. */
  floor: CalcResult | null;
  selected: string | null;
  onSelect: (slotId: string) => void;
  dispatch: Dispatch<Action>;
}

/** "1,200" or, when the two ends differ, "900 – 1,200". */
const range = (lo: number | undefined, hi: number) => (lo === undefined || Math.round(lo) === Math.round(hi) ? fmtNum(hi) : `${fmtNum(lo)} – ${fmtNum(hi)}`);

export function Results({ data, build, result, floor, selected, onSelect, dispatch }: Props) {
  const rarityColor = useMemo(() => new Map(data.rarities.map((r) => [r.id, r.color])), [data]);
  const best = Math.max(...result.weapons.map((w) => w.dps), 0);
  const unmodeled = [...result.items.values()].filter((i) => !i.modeled);
  const mode = modeOf(build);
  const floorDps = useMemo(() => new Map(floor?.weapons.map((w) => [w.slotId, w.dps]) ?? []), [floor]);

  return (
    <section className="panel results" aria-label="DPS results">
      <div className="mode-switch" role="group" aria-label="Mode">
        {(['simple', 'detailed'] as const).map((m) => (
          <button key={m} className={mode === m ? 'active' : ''} aria-pressed={mode === m} onClick={() => dispatch({ type: 'setMode', mode: m })}>
            {m === 'simple' ? 'Simple' : 'Detailed'}
          </button>
        ))}
        <span className="muted small">
          {mode === 'simple' ? 'Worst to best case: nothing to fill in.' : 'Your own fight assumptions, set below.'}
        </span>
      </div>
      <div className="totals">
        <div>
          <div className="total-label">Single-target DPS{floor && <span className="total-sub"> · worst to best case</span>}</div>
          <div className={`total-value ${floor ? 'range' : ''}`} aria-live="polite">
            {range(floor?.totalDps, result.totalDps)}
          </div>
        </div>
        {build.targets > 1 && (
          <div>
            <div className="total-label">DPS vs {build.targets} enemies</div>
            <div className={`total-value secondary ${floor ? 'range' : ''}`}>{range(floor?.totalMultiDps, result.totalMultiDps)}</div>
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
                  <td className="num">{range(floor ? (floorDps.get(w.slotId) ?? 0) : undefined, w.dps)}</td>
                  <td className="share-col">
                    <div className="bar" aria-hidden="true">
                      <div style={{ width: `${best > 0 ? (w.dps / best) * 100 : 0}%` }} />
                      {/* The worst case, over the best case's lighter bar. */}
                      {floor && <div className="bar-floor" style={{ width: `${best > 0 ? ((floorDps.get(w.slotId) ?? 0) / best) * 100 : 0}%` }} />}
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
