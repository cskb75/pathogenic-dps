// A run followed by its seed: the 8-character code from the game's pause menu,
// and what you took at each step, so the app can tell what the seed offers next.
// Saved in the browser on its own, apart from the build.

import { isValidSeed, type ShopAction } from '../engine/seeded/offers';
import { defaultUnlocks, type PoolContext, type Unlocks } from '../engine/seeded/pools';

/** One level-up: how often you rerolled, the cards you saw last, and what you took. */
export interface LevelPick {
  level: number;
  rerolls: number;
  /** Game keys of the cards shown (mutations), or evolution ids. */
  shown: string[];
  /** A mutation's game key, an evolution's body id, or 'skip'. */
  took: string;
}

export interface FloorLog {
  /** Normal rooms more (or fewer) than the floor usually has: shifts everything after them. */
  offset: number;
  /** Your build when the floor was made: the shop's organelles were picked then. */
  context?: PoolContext;
  shop: ShopAction[];
  /** The special room you found ('' for none) and the secret room. */
  special?: string;
  secret?: string;
  /** Rewards you took, by where they were (boss:0, shop:2, item1:1...). */
  taken: string[];
}

export interface SeededRun {
  version: 1;
  seed: string;
  classId: string;
  picks: LevelPick[];
  /** Rerolls used at the level-up you're on. */
  rerolls: number;
  /** The floor you're on: 1 (Skin) to 7 (Brain). */
  floor: number;
  floors: Record<number, FloorLog>;
  unlocks: Unlocks;
}

export type RunAction =
  | { type: 'start'; seed: string; classId: string; context: PoolContext }
  | { type: 'end' }
  | { type: 'reroll' }
  | { type: 'unreroll' }
  | { type: 'pick'; pick: Omit<LevelPick, 'level' | 'rerolls'> }
  | { type: 'undoPick' }
  | { type: 'enterFloor'; floor: number; context: PoolContext }
  | { type: 'setOffset'; floor: number; offset: number }
  | { type: 'setRoom'; floor: number; room: 'special' | 'secret'; key: string }
  | { type: 'shop'; floor: number; action: ShopAction }
  | { type: 'undoShop'; floor: number }
  | { type: 'toggleTaken'; floor: number; id: string }
  | { type: 'setUnlocks'; patch: Partial<Unlocks> };

export const FLOOR_COUNT = 7;
const emptyFloor = (): FloorLog => ({ offset: 0, shop: [], taken: [] });

/** Total rerolls used before the level-up you're on (the game counts them across the run). */
export const rerollsBefore = (run: SeededRun) => run.picks.reduce((s, p) => s + p.rerolls, 0);
/** The level-up you're on: the first is level 1. */
export const currentLevel = (run: SeededRun) => run.picks.length + 1;
export const floorLog = (run: SeededRun, floor: number): FloorLog => run.floors[floor] ?? emptyFloor();

function patchFloor(run: SeededRun, floor: number, patch: (f: FloorLog) => Partial<FloorLog>): SeededRun {
  const f = floorLog(run, floor);
  return { ...run, floors: { ...run.floors, [floor]: { ...f, ...patch(f) } } };
}

export function runReducer(run: SeededRun | null, action: RunAction): SeededRun | null {
  if (action.type === 'start') {
    if (!isValidSeed(action.seed)) return run;
    return {
      version: 1,
      seed: action.seed,
      classId: action.classId,
      picks: [],
      rerolls: 0,
      floor: 1,
      floors: { 1: { ...emptyFloor(), context: action.context } },
      unlocks: run?.unlocks ?? defaultUnlocks,
    };
  }
  if (!run) return run;
  switch (action.type) {
    case 'end':
      return null;
    case 'reroll':
      return { ...run, rerolls: run.rerolls + 1 };
    case 'unreroll':
      return { ...run, rerolls: Math.max(0, run.rerolls - 1) };
    case 'pick':
      return { ...run, picks: [...run.picks, { ...action.pick, level: currentLevel(run), rerolls: run.rerolls }], rerolls: 0 };
    case 'undoPick': {
      const last = run.picks.at(-1);
      return last ? { ...run, picks: run.picks.slice(0, -1), rerolls: last.rerolls } : run;
    }
    case 'enterFloor': {
      const floor = Math.max(1, Math.min(FLOOR_COUNT, Math.round(action.floor)));
      // A floor's shop is stocked when the floor is made: remember the build at that moment.
      const next = patchFloor(run, floor, (f) => (f.context ? {} : { context: action.context }));
      return { ...next, floor };
    }
    case 'setOffset':
      return patchFloor(run, action.floor, () => ({ offset: Math.max(-20, Math.min(20, Math.round(action.offset))) }));
    case 'setRoom':
      return patchFloor(run, action.floor, () => ({ [action.room]: action.key }));
    case 'shop':
      return patchFloor(run, action.floor, (f) => ({ shop: [...f.shop, action.action] }));
    case 'undoShop':
      return patchFloor(run, action.floor, (f) => ({ shop: f.shop.slice(0, -1) }));
    case 'toggleTaken':
      return patchFloor(run, action.floor, (f) => ({ taken: f.taken.includes(action.id) ? f.taken.filter((t) => t !== action.id) : [...f.taken, action.id] }));
    case 'setUnlocks':
      return { ...run, unlocks: { ...run.unlocks, ...action.patch } };
  }
}

const STORAGE_KEY = 'pathogenic-dps:seeded-run';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
const int = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback);

function parseContext(v: unknown): PoolContext | undefined {
  if (!isObject(v) || typeof v.kind !== 'string') return undefined;
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  const mutations: Record<string, number> = {};
  if (isObject(v.mutations)) for (const [k, n] of Object.entries(v.mutations)) if (typeof n === 'number' && n > 0) mutations[k] = Math.round(n);
  return {
    kind: v.kind,
    slots: strings(v.slots),
    mutations,
    maxStamina: num(v.maxStamina, 100),
    dodgeCd: num(v.dodgeCd, 1.2),
    dodgeInvul: num(v.dodgeInvul, 0.3),
    missingHp: v.missingHp === true,
  };
}

function parseShop(v: unknown): ShopAction[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((a): ShopAction[] => (a === 'reroll' ? ['reroll'] : isObject(a) && typeof a.buy === 'number' ? [{ buy: Math.round(a.buy) }] : []));
}

/** Reads a saved run, dropping anything malformed. */
export function parseRun(value: unknown): SeededRun | null {
  if (!isObject(value) || value.version !== 1 || typeof value.seed !== 'string' || !isValidSeed(value.seed) || typeof value.classId !== 'string') return null;
  const picks: LevelPick[] = Array.isArray(value.picks)
    ? value.picks.filter(isObject).map((p, i) => ({ level: i + 1, rerolls: Math.max(0, int(p.rerolls, 0)), shown: strings(p.shown), took: typeof p.took === 'string' ? p.took : '' }))
    : [];
  const floors: Record<number, FloorLog> = {};
  if (isObject(value.floors))
    for (const [k, f] of Object.entries(value.floors)) {
      const n = Number(k);
      if (!isObject(f) || !Number.isInteger(n) || n < 1 || n > FLOOR_COUNT) continue;
      floors[n] = {
        offset: Math.max(-20, Math.min(20, int(f.offset, 0))),
        context: parseContext(f.context),
        shop: parseShop(f.shop),
        ...(typeof f.special === 'string' ? { special: f.special } : {}),
        ...(typeof f.secret === 'string' ? { secret: f.secret } : {}),
        taken: strings(f.taken),
      };
    }
  const u = isObject(value.unlocks) ? value.unlocks : {};
  return {
    version: 1,
    seed: value.seed,
    classId: value.classId,
    picks,
    rerolls: Math.max(0, int(value.rerolls, 0)),
    floor: Math.max(1, Math.min(FLOOR_COUNT, int(value.floor, 1))),
    floors,
    unlocks: { prefixes: u.prefixes !== false, devilRoom: u.devilRoom !== false, locked: strings(u.locked) },
  };
}

export function loadRun(): SeededRun | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? parseRun(JSON.parse(saved)) : null;
  } catch {
    return null;
  }
}

export function saveRun(run: SeededRun | null) {
  try {
    if (run) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(run));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private windows can refuse storage: the run just won't survive a reload.
  }
}
