import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type ReactNode } from 'react';
import { findClass } from '../engine/calc';
import { EVOLUTION_LEVELS, isValidSeed, normalizeSeed } from '../engine/seeded/offers';
import { findOrganelle, ids, poolContext, seeded, TAG } from '../engine/seeded/pools';
import { floorView, levelView, toInstance, type FloorView, type MutationCard, type RewardView } from '../engine/seeded/predict';
import type { Build, GameData, OrganelleInstance } from '../engine/types';
import type { Action } from '../state/build';
import { emptyBuild } from '../state/build';
import { FLOOR_COUNT, floorLog, type RunAction, type SeededRun } from '../state/seededRun';
import { Icon, PlanThumb, mutationIcon, organelleIcon } from './art';

interface Props {
  data: GameData;
  build: Build;
  dispatch: Dispatch<Action>;
  run: SeededRun | null;
  runDispatch: Dispatch<RunAction>;
  /** Puts an organelle in your hand in the body editor, to drop on a slot. */
  onTake: (organelle: OrganelleInstance) => void;
}

/** "ABCD3467" as the pause menu shows it: "ABCD 3467". */
export const formatSeed = (seed: string) => (seed.length > 4 ? `${seed.slice(0, 4)} ${seed.slice(4)}` : seed);

const RARITY_NAMES = ['Common', 'Rare', 'Epic', 'Legendary'];
const TRAIT_NAMES: Record<string, string> = { eternal: 'Eternal', ephemeral: 'Ephemeral', excitable: 'Excitable', cancerous: 'Cancerous' };
const SPECIAL_NAMES: Record<string, string> = {
  blacksmith_room: 'Blacksmith',
  challenge_room: 'Challenge room',
  dna_room_1: 'DNA room (three organelles)',
  dna_room_2: 'DNA room (DNA mutations)',
  heal_room_1: 'Healing room',
  heal_room_2: 'Healing room (large)',
};
const SECRET_NAMES: Record<string, string> = { secret_room1: 'Secret room (no organelles)', secret_room2: 'Secret room (with organelles)' };

/** Follow a run by its seed: what each level-up, boss, shop and item room offers, as you take things. */
export function SeededRunPanel({ data, build, dispatch, run, runDispatch, onTake }: Props) {
  return (
    <section className="panel seeded-run" aria-labelledby="seeded-heading">
      <div className="panel-head">
        <div>
          <h2 id="seeded-heading">Seeded run</h2>
          <p className="muted small">
            A run's seed decides its level-up cards, boss rewards, shops and item rooms. Enter it, then pick what you take as you go: the app rolls what comes
            next the way the game does.
          </p>
        </div>
        {run && (
          <div className="seed-badge">
            <span className="muted small">Seed</span>
            <span className="seed-code">{formatSeed(run.seed)}</span>
            <button className="link small" onClick={() => window.confirm('End this run? What you logged is forgotten (your build stays).') && runDispatch({ type: 'end' })}>
              End run
            </button>
          </div>
        )}
      </div>
      {run ? (
        <ActiveRun data={data} build={build} dispatch={dispatch} run={run} runDispatch={runDispatch} onTake={onTake} />
      ) : (
        <StartRun data={data} build={build} dispatch={dispatch} runDispatch={runDispatch} />
      )}
    </section>
  );
}

function StartRun({ data, build, dispatch, runDispatch }: Pick<Props, 'data' | 'build' | 'dispatch' | 'runDispatch'>) {
  const [text, setText] = useState('');
  const [fresh, setFresh] = useState(true);
  const seed = normalizeSeed(text);
  const valid = isValidSeed(seed);
  // Letters and digits the game never puts in a seed (it leaves out look-alikes such as O and 0).
  const unused = [...new Set([...text.toUpperCase()].filter((c) => /[A-Z0-9]/.test(c) && !seeded.alphabet.includes(c)))];
  const cls = findClass(data, build.classId);
  function start(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const startBuild = fresh ? { ...emptyBuild(data, build.classId), mode: build.mode, name: `${cls.name} run ${formatSeed(seed)}`, plasmids: build.plasmids } : build;
    if (fresh) dispatch({ type: 'load', build: startBuild });
    runDispatch({ type: 'start', seed, classId: build.classId, context: poolContext(startBuild, data) });
  }
  return (
    <form className="seed-form" onSubmit={start}>
      <label className="seed-field">
        <span>Seed</span>
        <input
          value={text.toUpperCase()}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={unused.length > 0}
          placeholder="XXXX XXXX"
          aria-describedby="seed-help"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={12}
        />
      </label>
      <button type="submit" className="active" disabled={!valid}>
        Start a {cls.name} run
      </button>
      <label className="check small">
        <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />
        Start from an empty body (keeps your plasmids)
      </label>
      {unused.length > 0 && (
        <p className="seed-error small" role="alert">
          Seeds never use {unused.join(', ')}: check the pause menu again.
        </p>
      )}
      <p id="seed-help" className="muted small">
        The 8-character code in the game's pause menu. Seeds never use I, L, O, S, Z, 0, 1, 2 or 5. Pick your pathogen above first.
      </p>
    </form>
  );
}

function ActiveRun({ data, build, dispatch, run, runDispatch, onTake }: Props & { run: SeededRun }) {
  const runClass = findClass(data, run.classId);
  const [viewing, setViewing] = useState(run.floor);
  useEffect(() => setViewing(run.floor), [run.floor]);
  if (build.classId !== run.classId)
    return (
      <p className="warn-note" role="status">
        This run is a {runClass.name} run. Switch back to the {runClass.name} above to follow it, or end the run to start another.
      </p>
    );
  return (
    <>
      <LevelUp data={data} build={build} dispatch={dispatch} run={run} runDispatch={runDispatch} onTake={onTake} />
      <div className="run-floors">
        <h3>Floors</h3>
        <div className="chips floor-tabs" role="tablist" aria-label="Floors">
          {seeded.floors.map((f) => (
            <button
              key={f.level}
              role="tab"
              aria-selected={viewing === f.level}
              className={`chip ${viewing === f.level ? 'active' : ''} ${f.level === run.floor ? 'current' : ''}`}
              onClick={() => setViewing(f.level)}
            >
              {f.level}. {f.name}
              {f.level === run.floor && <span className="sr-only"> (you're here)</span>}
            </button>
          ))}
        </div>
        <Floor data={data} build={build} dispatch={dispatch} run={run} runDispatch={runDispatch} onTake={onTake} level={viewing} />
      </div>
      <Unlocks run={run} runDispatch={runDispatch} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Level-ups

function LevelUp({ data, build, dispatch, run, runDispatch, onTake }: Props & { run: SeededRun }) {
  const view = useMemo(() => levelView(run, build, data), [run, build, data]);
  const [showMore, setShowMore] = useState(false);
  const mutationDef = (id?: string) => data.mutations.find((m) => m.id === id);

  function takeMutation(card: MutationCard) {
    if (card.appId) dispatch({ type: 'setMutation', id: card.appId, count: (build.mutations[card.appId] ?? 0) + 1 });
    runDispatch({ type: 'pick', pick: { shown: view.cards.map((c) => c.mutation.key), took: card.mutation.key } });
    setShowMore(false);
    if (card.gift?.appId) onTake({ id: card.gift.appId, rarity: 'common', traits: [] });
  }
  function takeEvolution(id: string) {
    if (!view.evolution) return;
    dispatch({ type: 'setEvolution', tier: view.evolution.tier, id });
    runDispatch({ type: 'pick', pick: { shown: [...view.evolution.guaranteed, ...view.evolution.pool], took: id } });
  }
  function undo() {
    const last = run.picks.at(-1);
    if (!last) return;
    const tier = EVOLUTION_LEVELS.indexOf(last.level);
    const cls = findClass(data, build.classId);
    if (cls.body.kind === 'evolving' && tier >= 0) dispatch({ type: 'setEvolution', tier, id: '' });
    else {
      const appId = ids(data).mutationApp.get(last.took);
      if (appId) dispatch({ type: 'setMutation', id: appId, count: Math.max(0, (build.mutations[appId] ?? 0) - 1) });
    }
    runDispatch({ type: 'undoPick' });
  }

  const name = (took: string) =>
    took === 'skip' ? 'Skipped' : (data.bodies[took]?.name ?? seeded.mutations.find((m) => m.key === took)?.name ?? took);

  return (
    <div className="run-step">
      <h3>
        Level {view.level} {view.evolution ? 'evolution' : 'mutation'}
      </h3>
      {view.evolution ? (
        <>
          <p className="muted small">
            {view.evolution.guaranteed.length
              ? 'The game always offers the first ones here, then fills the rest at random from the others, plus Skip. Evolutions aren’t seeded, so pick what it showed you.'
              : 'The game offers three of these at random, plus Skip. Evolutions aren’t seeded, so pick what it showed you.'}
          </p>
          <div className="run-cards evolutions">
            {[...view.evolution.guaranteed, ...view.evolution.pool].map((id) => {
              const plan = data.bodies[id];
              const always = view.evolution!.guaranteed.includes(id);
              return (
                <button key={id} className={`run-card evolution ${always ? 'guaranteed' : ''}`} onClick={() => takeEvolution(id)}>
                  {plan && <PlanThumb plan={plan} size={56} />}
                  <span className="run-card-name">{plan?.name ?? id}</span>
                  {always && <span className="evolution-badge">Always offered</span>}
                </button>
              );
            })}
            <button className="run-card evolution none" onClick={() => takeEvolution('skip')}>
              <span className="run-card-name">Skip</span>
              <span className="muted small">No effect</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">The game shows these four, left to right. Click the one you took.</p>
          <div className="run-cards">
            {view.cards.map((c) => (
              <MutationButton key={c.mutation.key} card={c} description={mutationDef(c.appId)?.description} onClick={() => takeMutation(c)} />
            ))}
          </div>
          <div className="toolbar run-tools">
            <button onClick={() => runDispatch({ type: 'reroll' })} title="The game's Reroll button: new cards, never the ones shown.">
              Reroll
            </button>
            {view.rerolls > 0 && (
              <button onClick={() => runDispatch({ type: 'unreroll' })}>
                Undo reroll ({view.rerolls})
              </button>
            )}
            <button className="link small" aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}>
              {showMore ? 'Hide' : 'Not what the game shows?'}
            </button>
          </div>
          {showMore && (
            <div className="run-more">
              <p className="muted small">
                Next in line, best first. Cards that need something you don't have yet (an active organelle, a lash...) are left out, so if your body in the
                app differs from the game's, these move up. Click the one you took to keep the run in step.
              </p>
              <div className="run-cards">
                {view.more.map((c) => (
                  <MutationButton key={c.mutation.key} card={c} description={mutationDef(c.appId)?.description} onClick={() => takeMutation(c)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {run.picks.length > 0 && (
        <div className="run-history">
          <ol className="chips" aria-label="Level-ups so far">
            {run.picks.map((p) => (
              <li key={p.level} className="chip static">
                <span className="muted">Lv {p.level}</span> {name(p.took)}
                {p.rerolls > 0 && <span className="muted"> · {p.rerolls} reroll{p.rerolls > 1 ? 's' : ''}</span>}
              </li>
            ))}
          </ol>
          <button className="link small" onClick={undo}>
            Undo level {run.picks.length}
          </button>
        </div>
      )}
    </div>
  );
}

function MutationButton({ card, description, onClick }: { card: MutationCard; description?: string; onClick: () => void }) {
  return (
    <button className="run-card mutation" onClick={onClick}>
      <Icon src={card.appId ? mutationIcon(card.appId) : ''} size={40} />
      <span className="run-card-name">{card.mutation.name}</span>
      {description && <span className="run-card-text">{description}</span>}
      {card.gift && (
        <span className="run-card-gift">
          Gives: <strong>{card.gift.organelle.name}</strong>
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Floors

function Floor({ data, build, dispatch, run, runDispatch, onTake, level }: Props & { run: SeededRun; level: number }) {
  const view = useMemo(() => floorView(run, build, data, level), [run, build, data, level]);
  const log = floorLog(run, level);
  const ahead = level > run.floor;

  function take(r: RewardView) {
    const was = r.taken;
    runDispatch({ type: 'toggleTaken', floor: level, id: r.at });
    if (r.reward.pick.type === 'mutation') {
      if (r.appId) dispatch({ type: 'setMutation', id: r.appId, count: Math.max(0, (build.mutations[r.appId] ?? 0) + (was ? -1 : 1)) });
      return;
    }
    const inst = toInstance(r);
    if (!was && inst) onTake(inst);
  }
  function enter() {
    runDispatch({ type: 'enterFloor', floor: level, context: poolContext(build, data) });
    dispatch({ type: 'setParam', id: 'level', value: level });
    dispatch({ type: 'setParam', id: 'bossesBeaten', value: level - 1 });
  }

  return (
    <div className="run-floor" role="tabpanel" aria-label={view.name}>
      {ahead && (
        <div className="run-ahead">
          <p className="muted small">
            A look ahead. The shop is stocked from your build when you arrive, so it can still change: press the button when you get to the {view.name}.
          </p>
          <button className="active" onClick={enter}>
            I'm on the {view.name}
          </button>
        </div>
      )}
      <p className="muted small run-offset">
        {view.rooms} normal room{view.rooms === 1 ? '' : 's'} come before the {level === 6 ? 'shop' : 'boss'}
        <span className="offset-buttons">
          <button className="small" aria-label="One room fewer" onClick={() => runDispatch({ type: 'setOffset', floor: level, offset: log.offset - 1 })}>
            −
          </button>
          <button className="small" aria-label="One room more" onClick={() => runDispatch({ type: 'setOffset', floor: level, offset: log.offset + 1 })}>
            +
          </button>
        </span>
        {log.offset !== 0 && <span> (you moved it by {log.offset > 0 ? `+${log.offset}` : log.offset})</span>}. Every room takes a number from the floor's
        reward list. If what comes after them is all off, the floor had a room more or fewer: try nudging this.
      </p>

      {view.boss && (
        <RoomBlock title="Boss reward" note="After the boss: take one of three.">
          <RewardGrid rewards={view.boss.rewards} data={data} onTake={take} />
          {run.unlocks.devilRoom && level < 6 && (
            <p className="muted small">
              Beat the boss without getting hit: a devil room portal {view.boss.devil ? <strong>opens</strong> : <strong>doesn't open</strong>} (it always does once
              the Chemoreceptor Antenna's guarantee is active).
            </p>
          )}
        </RoomBlock>
      )}
      {level === 6 && <p className="muted small">The Heart's boss drops no organelle. Its shop sits after the sixth row of rooms; the rewards on the map aren't covered yet.</p>}

      <Shop view={view} data={data} level={level} run={run} runDispatch={runDispatch} dispatch={dispatch} build={build} onTake={onTake} />

      {view.items.map((rewards, i) => (
        <RoomBlock key={i} title={`Item room ${i + 1}`} note="Item rooms show the first one, two or all three of these.">
          <RewardGrid rewards={rewards} data={data} onTake={take} />
        </RoomBlock>
      ))}

      {view.brain && (
        <RoomBlock title="Brain rooms" note="Every normal room here drops one legendary organelle when you clear it: these, in some order.">
          <RewardGrid rewards={view.brain} data={data} onTake={take} />
        </RoomBlock>
      )}

      {level > 1 && level !== 6 && (
        <RoomBlock title="Special room" note="A third of floors after the Skin have one. Which did you find?">
          <select
            aria-label="Special room"
            value={log.special ?? ''}
            onChange={(e) => runDispatch({ type: 'setRoom', floor: level, room: 'special', key: e.target.value })}
          >
            <option value="">None</option>
            {seeded.special.map((r) => (
              <option key={r.key} value={r.key}>
                {SPECIAL_NAMES[r.key] ?? r.key}
              </option>
            ))}
          </select>
          {view.special && view.special.rewards.length > 0 && <RewardGrid rewards={view.special.rewards} data={data} onTake={take} />}
        </RoomBlock>
      )}
      {level !== 6 && (
        <RoomBlock title="Secret room" note="Which secret room did you find?">
          <select aria-label="Secret room" value={log.secret ?? ''} onChange={(e) => runDispatch({ type: 'setRoom', floor: level, room: 'secret', key: e.target.value })}>
            <option value="">Not found yet</option>
            {seeded.secret.map((r) => (
              <option key={r.key} value={r.key}>
                {SECRET_NAMES[r.key] ?? r.key}
              </option>
            ))}
          </select>
          {view.secret?.rewards.map((rewards, i) => (
            <div key={i}>
              <p className="muted small">{i === 0 ? 'Pick one of three:' : 'And on its own:'}</p>
              <RewardGrid rewards={rewards} data={data} onTake={take} />
            </div>
          ))}
        </RoomBlock>
      )}

      {level === run.floor && level < FLOOR_COUNT && (
        <button
          className="wide"
          onClick={() => {
            const next = level + 1;
            runDispatch({ type: 'enterFloor', floor: next, context: poolContext(build, data) });
            dispatch({ type: 'setParam', id: 'level', value: next });
            dispatch({ type: 'setParam', id: 'bossesBeaten', value: next - 1 });
          }}
        >
          On to the {seeded.floors[level].name}
        </button>
      )}
    </div>
  );
}

function RoomBlock({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="room-block">
      <h4>{title}</h4>
      {note && <p className="muted small">{note}</p>}
      {children}
    </div>
  );
}

function rewardIcon(r: RewardView): string {
  if (!r.appId) return '';
  return r.reward.pick.type === 'organelle' ? organelleIcon(r.appId) : mutationIcon(r.appId);
}

function RewardCard({ r, data, action, done = 'Taken', onAction, extra }: { r: RewardView; data: GameData; action: string; done?: string; onAction: () => void; extra?: ReactNode }) {
  const isOrganelle = r.reward.pick.type === 'organelle';
  const rarity = isOrganelle ? r.reward.rarity : -1;
  const info = isOrganelle ? data.organelles.find((o) => o.id === r.appId) : data.mutations.find((m) => m.id === r.appId);
  const slot = isOrganelle ? (findOrganelle(r.reward.pick.item.key)?.tags.includes(TAG.Internal) ? 'Internal' : 'External') : 'Mutation';
  return (
    <div className={`run-card reward ${r.taken ? 'taken' : ''} ${rarity >= 0 ? `rarity-${RARITY_NAMES[rarity].toLowerCase()}` : ''}`}>
      <Icon src={rewardIcon(r)} size={40} />
      <span className="run-card-name">{r.name}</span>
      <span className="run-card-meta">
        {rarity >= 0 && <span className="rarity-label">{RARITY_NAMES[rarity]}</span>} <span className="muted">{slot}</span>
      </span>
      {r.reward.traits.length > 0 && <span className="run-card-traits">{r.reward.traits.map((t) => TRAIT_NAMES[t] ?? t).join(', ')}</span>}
      {info && <span className="run-card-text">{info.description}</span>}
      {extra}
      <button className={`small ${r.taken ? 'active' : ''}`} aria-pressed={r.taken} onClick={onAction}>
        {r.taken ? `${done} ✓` : action}
      </button>
    </div>
  );
}

function RewardGrid({ rewards, data, onTake }: { rewards: RewardView[]; data: GameData; onTake: (r: RewardView) => void }) {
  if (!rewards.length) return <p className="muted small">Nothing here.</p>;
  return (
    <div className="run-cards">
      {rewards.map((r) => (
        <RewardCard key={r.at} r={r} data={data} action="Take" onAction={() => onTake(r)} />
      ))}
    </div>
  );
}

function Shop({ view, data, level, run, runDispatch, dispatch, build, onTake }: Props & { view: FloorView; level: number; run: SeededRun }) {
  const log = floorLog(run, level);
  const { state } = view.shop;
  function buy(index: number) {
    const stall = view.shop.stalls[index];
    if (stall.bought) return;
    runDispatch({ type: 'shop', floor: level, action: { buy: index } });
    const r = stall.reward;
    if (!r) return;
    if (r.reward.pick.type === 'mutation') {
      if (r.appId) dispatch({ type: 'setMutation', id: r.appId, count: (build.mutations[r.appId] ?? 0) + 1 });
      return;
    }
    const inst = toInstance(r);
    if (inst) onTake(inst);
  }
  const organelles = view.shop.stalls.filter((s) => s.reward);
  const others = view.shop.stalls.filter((s) => !s.reward);
  const price = (s: (typeof view.shop.stalls)[number]) => (
    <span className="shop-price">
      <strong>{s.price.cost}</strong> cores
      {s.price.sale && <span className="sale"> sale (was {s.price.original})</span>}
      {s.price.cost !== s.price.full && <span className="muted"> ({s.price.full} before discount)</span>}
    </span>
  );
  return (
    <RoomBlock title={level === 6 ? "The Heart's shop" : 'Shop'} note={log.context ? undefined : 'Stocked from your build as it is now.'}>
      <div className="run-cards">
        {organelles.map((s) => (
          <RewardCard
            key={s.index}
            r={{ ...s.reward!, taken: s.bought }}
            data={data}
            action="Buy"
            done="Bought"
            extra={price(s)}
            onAction={() => buy(s.index)}
          />
        ))}
      </div>
      <ul className="shop-extras">
        {others.map((s) => (
          <li key={s.index}>
            {s.label}: {price(s)}{' '}
            {s.bought ? <span className="muted small">bought</span> : <button className="link small" onClick={() => buy(s.index)}>Buy</button>}
          </li>
        ))}
      </ul>
      <div className="toolbar run-tools">
        <button onClick={() => runDispatch({ type: 'shop', floor: level, action: 'reroll' })}>Reroll the shop ({state.rerollPrice} cores)</button>
        {log.shop.length > 0 && (
          <button onClick={() => runDispatch({ type: 'undoShop', floor: level })}>
            Undo {log.shop.at(-1) === 'reroll' ? 'reroll' : 'purchase'}
          </button>
        )}
        {state.rerolls > 0 && <span className="muted small">Rerolled {state.rerolls}×</span>}
      </div>
    </RoomBlock>
  );
}

function Unlocks({ run, runDispatch }: { run: SeededRun; runDispatch: Dispatch<RunAction> }) {
  const lockable = seeded.organelles.filter((o) => o.unlock);
  const locked = new Set(run.unlocks.locked);
  return (
    <details className="run-unlocks">
      <summary>What you've unlocked</summary>
      <p className="muted small">
        The seed can't see your save. Untick what you haven't unlocked yet: the game skips it, and so will the predictions.
      </p>
      <label className="check">
        <input type="checkbox" checked={run.unlocks.prefixes} onChange={(e) => runDispatch({ type: 'setUnlocks', patch: { prefixes: e.target.checked } })} />
        Prefixes (Eternal, Ephemeral, Excitable, Cancerous organelles)
      </label>
      <label className="check">
        <input type="checkbox" checked={run.unlocks.devilRoom} onChange={(e) => runDispatch({ type: 'setUnlocks', patch: { devilRoom: e.target.checked } })} />
        Devil rooms
      </label>
      <fieldset className="unlock-list">
        <legend>Organelles</legend>
        {lockable.map((o) => (
          <label key={o.key} className="check small">
            <input
              type="checkbox"
              checked={!locked.has(o.key)}
              onChange={(e) =>
                runDispatch({ type: 'setUnlocks', patch: { locked: e.target.checked ? run.unlocks.locked.filter((k) => k !== o.key) : [...run.unlocks.locked, o.key] } })
              }
            />
            {o.name}
          </label>
        ))}
      </fieldset>
    </details>
  );
}
