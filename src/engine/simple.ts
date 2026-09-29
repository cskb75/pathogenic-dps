// Simple mode: no fight assumptions to fill in. DPS is shown as a range between
// two fixed sets of them, both playing perfectly (every aimed shot lands,
// stamina never runs out):
//
// - the floor: nothing situational helps. No Overcharge (every mitochondrion
//   off), no kills, hits, dodges, blocks, slashes or pickups triggering
//   anything, and anything that depends on where enemies are at its usual rate;
// - the ceiling: everything at its best. Every mitochondrion always on,
//   triggers as often as the game allows, enemies wherever they help most.
//
// The engine is unchanged: each end is the build with its fight assumptions
// replaced (run state such as HP, cores and level is kept).

import { calculate, type CalcResult } from './calc';
import type { Build, GameData } from './types';

export type Mode = 'simple' | 'detailed';

/** A build's mode: builds from before modes existed are detailed. */
export const modeOf = (build: Build): Mode => build.mode ?? 'detailed';

/** An assumption's value at one end: a number, or the end of its range in the calculator. */
type Setting = number | 'min' | 'max' | 'default';

/** The game's dodge cooldown (player.gd, dodge_cd): at most one dodge per 1.2s. */
const DODGE_CD = 1.2;

const both = (s: Setting) => ({ floor: s, ceiling: s });
const usualToBest = { floor: 'default', ceiling: 'max' } as const;
const noneToMost = (most: Setting = 'max') => ({ floor: 'min' as Setting, ceiling: most });

/** Where every fight assumption sits at each end. Run state (HP, cores, level...) isn't here: it's kept as you set it. */
export const SIMPLE_PARAMS: Record<string, { floor: Setting; ceiling: Setting }> = {
  // Your aim and timing: perfect at both ends.
  pelletHit: both('max'),
  fireballContact: both('max'),
  orbContact: both('max'),
  beatSync: both('max'),
  resonantStacks: both('max'),
  // Stamina never runs out, and you never stop shooting to sprint.
  staminaLimits: both('min'),
  maxStamina: both('default'),
  sprintTime: both('min'),

  // Where enemies are: as usual, or wherever they help most, as far as one
  // target can: on one side of the Lateral Vent (it fires both ways), taking a
  // quarter of a Projectile Surge ring or of the Galvanic Node's arcs (they go
  // all around you, and between beacons spread about the room).
  angledHit: usualToBest,
  sideHit: { floor: 'default', ceiling: 0.5 },
  backHit: usualToBest,
  surgeHit: { floor: 'default', ceiling: 0.25 },
  coneHit: usualToBest,
  arcHit: { floor: 'default', ceiling: 0.25 },
  stauroLasers: usualToBest,
  mineHit: usualToBest,
  puddleContact: usualToBest,
  backstabChance: usualToBest,
  nearbyTime: usualToBest,
  minionEngagement: usualToBest,
  targetDistance: usualToBest,
  // Rooms as long as usual; at best, minions from actives last until the room ends.
  roomLength: both('default'),
  minionLifetime: usualToBest,

  // Triggers: none at all, or as often as the game allows.
  dodgeRateAll: noneToMost(1 / DODGE_CD),
  dodgeRate: noneToMost(1 / DODGE_CD),
  slashRate: noneToMost(),
  killRate: noneToMost(),
  hitsTakenRate: noneToMost(),
  blockRate: noneToMost(),
  pickupRate: noneToMost(),
  perfectRooms: noneToMost(),
  frozenTime: noneToMost(),
  // Each minion hit about once a second: more would kill it.
  minionHitRate: noneToMost(1),
};

export type End = 'floor' | 'ceiling';

/** The build with one end's fight assumptions, and every mitochondrion off (floor) or always on (ceiling). */
export function simpleBuild(build: Build, data: GameData, end: End): Build {
  const params = { ...build.params };
  for (const p of data.params) {
    const setting = SIMPLE_PARAMS[p.id]?.[end];
    if (setting === undefined) continue;
    params[p.id] = setting === 'min' ? p.min : setting === 'max' ? p.max : setting === 'default' ? p.default : setting;
  }
  const uptime = end === 'floor' ? 0 : 1;
  const slots = Object.fromEntries(Object.entries(build.slots).map(([id, s]) => [id, s.organelle ? { ...s, uptime } : s]));
  return { ...build, params, slots };
}

export interface Results {
  /** What the page shows: the build as set (detailed), or the ceiling (simple). */
  main: CalcResult;
  /** Simple mode's floor. */
  floor: CalcResult | null;
}

/** Single-target DPS at the ends the build's mode shows: [floor, ceiling] in simple mode, the same number twice in detailed. */
export function dpsRange(build: Build, data: GameData): [number, number] {
  if (modeOf(build) === 'detailed') {
    const dps = calculate(build, data).totalDps;
    return [dps, dps];
  }
  return [calculate(simpleBuild(build, data, 'floor'), data).totalDps, calculate(simpleBuild(build, data, 'ceiling'), data).totalDps];
}

/**
 * The build with organelle `id` in slot `source` (a mirrored pair's source
 * slot), as picking it in the slot panel does: at the rarity of the organelle
 * there now (or Common), without traits, keeping the slot's graft.
 */
export function withOrganelle(build: Build, source: string, id: string): Build {
  const current = build.slots[source] ?? {};
  const organelle = { id, rarity: current.organelle?.rarity ?? 'common', traits: [] };
  return { ...build, slots: { ...build.slots, [source]: { ...(current.graft ? { graft: current.graft } : {}), organelle } } };
}

/** DPS for a build in its mode. */
export function calculateMode(build: Build, data: GameData): Results {
  if (modeOf(build) === 'detailed') return { main: calculate(build, data), floor: null };
  return { main: calculate(simpleBuild(build, data, 'ceiling'), data), floor: calculate(simpleBuild(build, data, 'floor'), data) };
}
