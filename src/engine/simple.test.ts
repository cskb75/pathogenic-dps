import { describe, expect, it } from 'vitest';
import { gameData } from '../data';
import { exampleBuild } from '../state/build';
import { calculate } from './calc';
import { calculateMode, dpsRange, SIMPLE_PARAMS, simpleBuild, withOrganelle } from './simple';
import type { Build, SlotState } from './types';

/** The run state (RunPanel.tsx): kept as you set it in both modes. */
const RUN_STATE = ['cores', 'hp', 'bossesBeaten', 'level', 'phagosomeKills', 'recycled', 'eaten'];
const org = (id: string, extra: Partial<SlotState> = {}): SlotState => ({ organelle: { id, rarity: 'rare', traits: [] }, ...extra });
const simple = (build: Build): Build => ({ ...build, mode: 'simple' });

// A Bacterium with a gun, a flagellum that fires on dodges and a mitochondrion charging the gun.
const bacterium: Build = {
  version: 2,
  name: 't',
  classId: 'bacterium',
  pieces: [],
  evolutions: [],
  slots: { ESlot1: org('thermal-lance'), ISlot1: org('entrant-mitochondrion'), EBackSlot1: org('ballistic-flagellum'), ESlot3: org('scatter-ejector') },
  mutations: {},
  plasmids: {},
  params: {},
  targets: 1,
  custom: [],
};

describe('simple mode', () => {
  it('sets every fight assumption at both ends, and none of the run state', () => {
    const fight = gameData.params.map((p) => p.id).filter((id) => !RUN_STATE.includes(id));
    expect(Object.keys(SIMPLE_PARAMS).sort()).toEqual(fight.sort());
  });

  it('keeps your run state and your own detailed values', () => {
    const build = simple({ ...bacterium, params: { hp: 2, cores: 40, pelletHit: 0.2 } });
    const floor = simpleBuild(build, gameData, 'floor');
    expect(floor.params).toMatchObject({ hp: 2, cores: 40, pelletHit: 1, staminaLimits: 0, killRate: 0, dodgeRateAll: 0 });
    // The build itself is untouched, for switching back to detailed.
    expect(build.params).toEqual({ hp: 2, cores: 40, pelletHit: 0.2 });
    const ceiling = simpleBuild(build, gameData, 'ceiling');
    expect(ceiling.params.dodgeRateAll).toBeCloseTo(1 / 1.2);
    expect(ceiling.params.frozenTime).toBe(1);
  });

  it('switches Overcharge off at the worst end and keeps every mitochondrion on at the best', () => {
    const { main, floor } = calculateMode(simple(exampleBuild(gameData)), gameData);
    expect([...floor!.items.values()].every((i) => i.charge === 0)).toBe(true);
    expect(main.items.get('p2.c')?.mito?.uptime).toBe(1);
    expect([...main.items.values()].some((i) => i.charge > 0)).toBe(true);
    expect(floor!.totalDps).toBeLessThan(main.totalDps);
  });

  it('puts the detailed defaults between the two ends, and nothing that only dodging fires at the worst end', () => {
    for (const build of [exampleBuild(gameData), bacterium]) {
      const detailed = calculate({ ...build, mode: 'detailed' }, gameData).totalDps;
      const [lo, hi] = dpsRange(simple(build), gameData);
      expect(lo).toBeLessThanOrEqual(hi);
      expect(detailed).toBeLessThanOrEqual(hi + 1e-6);
    }
    const { floor } = calculateMode(simple(bacterium), gameData);
    expect(floor!.items.get('EBackSlot1')?.weapon?.dps).toBe(0);
    expect(floor!.items.get('ESlot1')?.weapon?.dps).toBeGreaterThan(0);
  });

  it('gives the same number at both ends in detailed mode', () => {
    const [lo, hi] = dpsRange({ ...bacterium, mode: 'detailed' }, gameData);
    expect(lo).toBe(hi);
    expect(hi).toBe(calculate(bacterium, gameData).totalDps);
  });

  it('tries an organelle in a slot the way picking it does', () => {
    const build = { ...bacterium, slots: { ...bacterium.slots, ISlot1: org('entrant-mitochondrion', { uptime: 0.3, graft: 'volatile' }) } };
    const tried = withOrganelle(build, 'ISlot1', 'oxysome');
    expect(tried.slots.ISlot1).toEqual({ graft: 'volatile', organelle: { id: 'oxysome', rarity: 'rare', traits: [] } });
    expect(withOrganelle(build, 'ISlot2', 'oxysome').slots.ISlot2.organelle?.rarity).toBe('common');
    expect(build.slots.ISlot1.organelle?.id).toBe('entrant-mitochondrion');
  });
});
